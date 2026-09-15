# DSTRK — Admin / Backend

이 폴더는 기존 DSTRK 쇼핑몰에 **관리자 전용 대시보드 + 고객/주문 DB**를 붙이기 위한 서버입니다.

## 포함 기능

- `/admin` 관리자 로그인
- 관리자 전용 세션(HttpOnly cookie)
- 관리자 로그인 시도 rate limit
- 고객 목록 / 검색
- 고객의 전화번호·배송지·주문수·결제금액 조회
- 주문 목록 / 검색
- 상품·사이즈·수량·주문자·배송지·할인·최종금액 조회
- 주문 결제상태 / 주문상태 API
- 체크아웃에서 서버로 주문 저장
- 서버가 **2개 이상 구매 시 ₩30,000 런칭 할인**을 다시 계산
- 서버가 `DSTRK` 쿠폰을 다시 검증하여 20% 할인 계산
- 비밀번호는 bcrypt 해시로 저장
- 카드번호/CVC는 DB에 저장하지 않음

## 1. 관리자 계정 설정

`server/.env.example`을 복사해서 `server/.env`를 만드세요.

예:

```env
NODE_ENV=production
PORT=3000
ADMIN_EMAIL=관리자이메일
ADMIN_PASSWORD=매우긴랜덤비밀번호
FRONTEND_ORIGIN=https://kjh8477.github.io
SESSION_DAYS=7
```

**운영 서버에서는 반드시 강한 관리자 비밀번호를 사용하세요.**

서버를 처음 실행하면 `ADMIN_EMAIL` 계정이 DB에 생성됩니다.

## 2. 실행

Node.js 20 이상 권장.

```bash
cd server
npm install
npm start
```

브라우저:

```text
http://localhost:3000/
http://localhost:3000/admin/
```

관리자 페이지에서 `.env`에 넣은 이메일/비밀번호로 로그인합니다.

## 3. 실제 운영 시

GitHub Pages는 HTML/CSS/JS를 제공하는 정적 호스팅이므로 Node 서버를 실행할 수 없습니다.

따라서:

```text
GitHub Pages
     ↓
DSTRK Node 서버
     ↓
SQLite(테스트/소규모) 또는 PostgreSQL(운영 권장)
     ↓
관리자 / 주문 데이터
```

구조로 운영합니다.

프론트엔드를 별도 GitHub Pages에서 계속 사용할 경우 `index.html`의

```js
window.DSTRK_API_BASE
```

를 실제 DSTRK API 서버 주소로 설정해야 합니다.

예:

```html
<script>
window.DSTRK_API_BASE = 'https://api.example.com';
</script>
```

이 설정은 `index.html`의 다른 스크립트보다 먼저 넣어야 합니다.

## 4. 데이터

주문이 체크아웃에서 서버에 정상 저장되면:

- 고객이 없으면 고객 레코드가 자동 생성됩니다.
- 고객이 이미 있으면 이름/전화번호/배송지가 갱신됩니다.
- 주문은 `orders` 테이블에 저장됩니다.
- 관리자 페이지에서 바로 조회할 수 있습니다.

## 5. 중요한 보안 사항

이 프로젝트는 **관리자/주문 DB 구조와 동작하는 대시보드**를 제공하지만, 이것만으로 카드 결제 상용 서비스가 완성되는 것은 아닙니다.

실제 판매 전에 반드시:

1. PostgreSQL 같은 운영용 DB로 이전
2. HTTPS 적용
3. 결제 PG 연동 및 서버측 결제 검증
4. 개인정보 처리방침 / 이용약관 / 환불·배송 정책 준비
5. 관리자 계정 2FA 등 추가 보호
6. DB 백업
7. 개인정보 접근 로그 및 최소권한 설정

을 적용하세요.

특히 **카드번호, CVC/CVV를 DSTRK DB에 저장하지 마세요.**
