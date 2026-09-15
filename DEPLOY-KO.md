# DSTRK 실제 관리자 서버 연결 가이드

이 패키지는 DSTRK 쇼핑몰과 관리자 대시보드를 연결할 수 있는 Node.js 서버입니다.

## 1. 서버 배포

GitHub에 이 프로젝트를 올린 뒤 Node.js/Docker를 실행할 수 있는 호스팅에 `server` 폴더를 배포합니다.

필수 환경변수:

- `NODE_ENV=production`
- `ADMIN_EMAIL=관리자 이메일`
- `ADMIN_PASSWORD=긴 랜덤 비밀번호`
- `FRONTEND_ORIGIN=https://kjh8477.github.io`
- `SESSION_DAYS=7`

`ADMIN_PASSWORD`는 최소 16자 이상의 랜덤 문자열을 사용하세요.

## 2. 서버 URL 확인

예를 들어 서버 주소가:

`https://dstrk-api.example.com`

이라면 GitHub Pages의 `index.html`에서 다른 JS보다 먼저 다음을 넣습니다.

```html
<script>
window.DSTRK_API_BASE = 'https://dstrk-api.example.com';
</script>
```

실제 서버 주소로 바꿔야 합니다.

## 3. 관리자 접속

서버 주소 뒤에 `/admin/`을 붙입니다.

`https://dstrk-api.example.com/admin/`

`.env`에 지정한 관리자 이메일/비밀번호로 로그인합니다.

## 4. 주문 확인

고객이 쇼핑몰에서 체크아웃하면 `/api/orders`로 주문이 저장되고 관리자 페이지의 ORDERS에서 조회할 수 있습니다.

2개 이상이면 서버가 자동으로 `30,000원` 런칭 할인을 계산합니다.

## 5. 운영 전 필수 보완

- PostgreSQL 등 운영용 DB 사용 검토
- HTTPS
- 실제 PG 결제 연동 및 서버측 결제 검증
- 개인정보 처리방침/이용약관/배송/환불 정책
- 관리자 2FA
- DB 백업
- 관리자 접근 로그 및 최소권한
- 카드번호/CVC/CVV를 직접 저장하지 않기

## 주의

현재 서버의 `/api/orders`는 결제 연동 전 주문 저장 API입니다. 이 API의 `total` 응답을 곧바로 실제 카드 승인 금액으로 사용하면 안 됩니다. 실제 판매에서는 PG 결제 승인 결과를 서버에서 검증하고 주문을 PAID로 변경해야 합니다.
