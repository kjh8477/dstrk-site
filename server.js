import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS || 7));
const isProd = process.env.NODE_ENV === "production";

if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === "CHANGE_THIS_TO_A_LONG_RANDOM_PASSWORD") {
  console.warn("⚠️ ADMIN_EMAIL / ADMIN_PASSWORD를 .env에서 설정하세요. 운영환경에서는 반드시 강한 비밀번호를 사용하세요.");
}

const db = new Database(path.join(__dirname, "dstrk.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  shipping_address TEXT,
  items_json TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  launch_discount INTEGER NOT NULL DEFAULT 0,
  coupon_discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'PENDING',
  order_status TEXT NOT NULL DEFAULT 'NEW',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(admin_id) REFERENCES admins(id) ON DELETE CASCADE
);
`);

async function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password === "CHANGE_THIS_TO_A_LONG_RANDOM_PASSWORD") return;
  const existing = db.prepare("SELECT id FROM admins WHERE email = ?").get(email);
  if (!existing) {
    const hash = await bcrypt.hash(password, 12);
    db.prepare("INSERT INTO admins(email,password_hash) VALUES(?,?)").run(email, hash);
    console.log(`✅ 관리자 계정 생성: ${email}`);
  }
}
await ensureAdmin();

app.use(cors({
  origin: (origin, cb) => {
    const allowed = (process.env.FRONTEND_ORIGIN || "").split(",").map(v => v.trim()).filter(Boolean);
    if (!origin || allowed.includes(origin)) return cb(null, true);
    return cb(new Error("CORS origin not allowed"));
  },
  credentials: true
}));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function setSession(res, adminId) {
  const raw = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(raw);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare("INSERT INTO sessions(token_hash,admin_id,expires_at) VALUES(?,?,?)")
    .run(tokenHash, adminId, expires);
  res.cookie("dstrk_admin", raw, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: SESSION_DAYS * 86400000,
    path: "/"
  });
}

function requireAdmin(req, res, next) {
  const raw = req.cookies.dstrk_admin;
  if (!raw) return res.status(401).json({ error: "관리자 로그인이 필요합니다." });
  const session = db.prepare(`
    SELECT s.admin_id, a.email
    FROM sessions s JOIN admins a ON a.id=s.admin_id
    WHERE s.token_hash=? AND s.expires_at > datetime('now')
  `).get(hashToken(raw));
  if (!session) return res.status(401).json({ error: "관리자 세션이 만료되었습니다." });
  req.admin = session;
  next();
}

app.post("/api/admin/login", loginLimiter, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const admin = db.prepare("SELECT * FROM admins WHERE email=?").get(email);
  if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
    return res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." });
  }
  setSession(res, admin.id);
  res.json({ ok: true, email: admin.email });
});

app.post("/api/admin/logout", (req, res) => {
  const raw = req.cookies.dstrk_admin;
  if (raw) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hashToken(raw));
  res.clearCookie("dstrk_admin", { httpOnly: true, secure: isProd, sameSite: isProd ? "none" : "lax", path: "/" });
  res.json({ ok: true });
});

app.get("/api/admin/me", requireAdmin, (req, res) => {
  res.json({ ok: true, email: req.admin.email });
});

app.get("/api/admin/stats", requireAdmin, (req, res) => {
  const customers = db.prepare("SELECT COUNT(*) AS n FROM customers").get().n;
  const orders = db.prepare("SELECT COUNT(*) AS n FROM orders").get().n;
  const paid = db.prepare("SELECT COALESCE(SUM(total),0) AS n FROM orders WHERE payment_status='PAID'").get().n;
  const pending = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE payment_status='PENDING'").get().n;
  res.json({ customers, orders, paid, pending });
});

app.get("/api/admin/customers", requireAdmin, (req, res) => {
  const q = String(req.query.q || "").trim();
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 100)));
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`
      SELECT c.id,c.email,c.name,c.phone,c.address,c.created_at,
             COUNT(o.id) AS order_count,
             COALESCE(SUM(CASE WHEN o.payment_status='PAID' THEN o.total ELSE 0 END),0) AS paid_total
      FROM customers c LEFT JOIN orders o ON o.customer_id=c.id
      WHERE c.email LIKE ? OR c.name LIKE ? OR c.phone LIKE ?
      GROUP BY c.id ORDER BY c.id DESC LIMIT ?
    `).all(like, like, like, limit);
  } else {
    rows = db.prepare(`
      SELECT c.id,c.email,c.name,c.phone,c.address,c.created_at,
             COUNT(o.id) AS order_count,
             COALESCE(SUM(CASE WHEN o.payment_status='PAID' THEN o.total ELSE 0 END),0) AS paid_total
      FROM customers c LEFT JOIN orders o ON o.customer_id=c.id
      GROUP BY c.id ORDER BY c.id DESC LIMIT ?
    `).all(limit);
  }
  res.json(rows);
});

app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const q = String(req.query.q || "").trim();
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 100)));
  const rows = q
    ? db.prepare(`
      SELECT * FROM orders
      WHERE order_no LIKE ? OR customer_name LIKE ? OR customer_email LIKE ?
      ORDER BY id DESC LIMIT ?
    `).all(`%${q}%`,`%${q}%`,`%${q}%`,limit)
    : db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT ?").all(limit);
  res.json(rows.map(r => ({...r, items: JSON.parse(r.items_json)})));
});

app.get("/api/admin/orders/:id", requireAdmin, (req,res) => {
  const row = db.prepare("SELECT * FROM orders WHERE id=?").get(Number(req.params.id));
  if (!row) return res.status(404).json({error:"주문을 찾을 수 없습니다."});
  res.json({...row, items: JSON.parse(row.items_json)});
});

app.patch("/api/admin/orders/:id", requireAdmin, (req,res) => {
  const paymentStatus = req.body.payment_status;
  const orderStatus = req.body.order_status;
  const allowedPayment = ["PENDING","PAID","FAILED","REFUNDED"];
  const allowedOrder = ["NEW","PREPARING","SHIPPED","DELIVERED","CANCELLED"];
  if (!allowedPayment.includes(paymentStatus) || !allowedOrder.includes(orderStatus)) {
    return res.status(400).json({error:"허용되지 않는 상태입니다."});
  }
  const result = db.prepare("UPDATE orders SET payment_status=?, order_status=? WHERE id=?")
    .run(paymentStatus, orderStatus, Number(req.params.id));
  if (!result.changes) return res.status(404).json({error:"주문을 찾을 수 없습니다."});
  res.json({ok:true});
});

/* 고객/주문 API: 실제 쇼핑몰 프론트엔드가 연결될 때 사용 */
app.post("/api/customers", async (req,res) => {
  const email=String(req.body.email||"").trim().toLowerCase();
  const password=String(req.body.password||"");
  const name=String(req.body.name||"").trim();
  if (!email || !password || !name || password.length < 8) return res.status(400).json({error:"이메일, 이름, 8자 이상 비밀번호가 필요합니다."});
  if (db.prepare("SELECT id FROM customers WHERE email=?").get(email)) return res.status(409).json({error:"이미 가입된 이메일입니다."});
  const hash=await bcrypt.hash(password,12);
  const info=db.prepare("INSERT INTO customers(email,password_hash,name,phone,address) VALUES(?,?,?,?,?)")
    .run(email,hash,name,String(req.body.phone||""),String(req.body.address||""));
  res.status(201).json({id:info.lastInsertRowid,email,name});
});

app.post("/api/orders", async (req,res) => {
  const b=req.body;
  const items=Array.isArray(b.items)?b.items:[];
  if (!items.length || !b.customer_email || !b.customer_name) return res.status(400).json({error:"주문 정보가 부족합니다."});
  const cleanItems=items.map(i=>({
    product_id:String(i.product_id||""),
    name:String(i.name||"DSTRK PRODUCT"),
    size:String(i.size||""),
    quantity:Math.max(1,Math.floor(Number(i.quantity||1))),
    unit_price:139000
  }));
  const subtotal=cleanItems.reduce((s,i)=>s+i.unit_price*i.quantity,0);
  const launch_discount=cleanItems.reduce((s,i)=>s+i.quantity,0)>=2?30000:0;
  const couponCode=String(b.coupon_code||"").trim().toUpperCase();
  const coupon_discount=couponCode==="DSTRK"?Math.round(subtotal*0.20):0;
  const total=Math.max(0,subtotal-launch_discount-coupon_discount);
  const orderNo=`DSTRK-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const customerEmail=String(b.customer_email).trim().toLowerCase();
  let customer=db.prepare("SELECT id FROM customers WHERE email=?").get(customerEmail);
  if (!customer) {
    const randomHash=await bcrypt.hash(crypto.randomBytes(24).toString("hex"),12);
    const info=db.prepare("INSERT INTO customers(email,password_hash,name,phone,address) VALUES(?,?,?,?,?)")
      .run(customerEmail,randomHash,String(b.customer_name),String(b.customer_phone||""),String(b.shipping_address||""));
    customer={id:info.lastInsertRowid};
  } else {
    db.prepare("UPDATE customers SET name=?,phone=?,address=? WHERE id=?")
      .run(String(b.customer_name),String(b.customer_phone||""),String(b.shipping_address||""),customer.id);
  }
  db.prepare(`
    INSERT INTO orders(order_no,customer_id,customer_name,customer_email,customer_phone,shipping_address,items_json,subtotal,launch_discount,coupon_discount,total)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).run(orderNo,customer?.id||null,String(b.customer_name),customerEmail,
    String(b.customer_phone||""),String(b.shipping_address||""),JSON.stringify(cleanItems),subtotal,launch_discount,coupon_discount,total);
  res.status(201).json({ok:true,order_no:orderNo,subtotal,launch_discount,total});
});

app.use("/admin", express.static(path.join(__dirname, "admin")));
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

app.listen(PORT, ()=>console.log(`DSTRK server running on http://localhost:${PORT}`));
