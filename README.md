# 룬 & 크라운 (Rune & Crown)

중세 마법과 기사 테마의 2D 온라인 실시간 전략 게임.

- 기획: [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)
- 기술 설계: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## 폴더

| 폴더 | 내용 |
|---|---|
| `shared/` | 서버·클라이언트 공용 코드: 상수, 소켓 프로토콜, 맵 생성 |
| `server/` | Node.js + Socket.IO 게임 서버: 인증, 로비 |
| `client/` | Vite + Canvas 클라이언트: 로그인, 로비, 맵 렌더링 |
| `docs/` | 기획서, 기술 설계서 |

## 로컬에서 실행하기

Node.js 24 이상이 필요합니다.

```bash
npm install
npm run dev
```

- 서버는 `http://localhost:3000`, 클라이언트는 `http://localhost:5173`에서 뜹니다.
- `.env` 파일이 없으면 서버와 클라이언트 모두 **개발 모드**로 동작합니다. Firebase 없이 게스트로 접속합니다.
- 1v1을 혼자 시험하려면 `http://localhost:5173`을 탭 두 개로 여세요. 탭마다 다른 플레이어가 됩니다.
  한 탭에서 방을 만들고, 다른 탭에서 입장한 뒤 둘 다 **준비**를 누르면 게임이 시작됩니다.

카메라 조작: WASD·방향키·화면 가장자리로 이동, 마우스 휠로 확대/축소, 가운데 버튼 드래그, 미니맵 클릭.

## 테스트

```bash
npm test
```

맵 대칭·연결성 테스트와 로비(입장·준비·시작) 통합 테스트가 돌아갑니다.

## Firebase 연결하기

1. [Firebase 콘솔](https://console.firebase.google.com)에서 프로젝트를 만듭니다.
2. **Authentication → 로그인 방법**에서 **익명**을 사용 설정합니다.
3. **Firestore Database**를 만듭니다. 위치는 `asia-northeast3 (서울)`을 고르세요 (나중에 바꿀 수 없습니다).
4. **프로젝트 설정 → 내 앱**에서 웹 앱을 추가하고, 설정 값을 `client/.env`에 넣습니다. 형식은 `client/.env.example`을 보세요.
5. **프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성**으로 JSON 파일을 받고, Base64로 인코딩해 `server/.env`의 `FIREBASE_SERVICE_ACCOUNT`에 넣습니다.
   - Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("service-account.json"))`
   - macOS·Linux: `base64 -i service-account.json | tr -d '\n'`
   - JSON 파일은 저장소 밖에 보관하세요.
6. Firestore 보안 규칙을 배포합니다.
   ```bash
   npx firebase-tools login
   npx firebase-tools use --add
   npx firebase-tools deploy --only firestore:rules
   ```

서버와 클라이언트는 **둘 다 Firebase 모드이거나 둘 다 개발 모드**여야 접속됩니다.

## 배포하기

### 게임 서버 — Render

**New → Web Service**에서 GitHub 저장소를 연결하고 아래처럼 설정합니다.

| 항목 | 값 |
|---|---|
| Root Directory | 비움 |
| Build Command | `npm ci` |
| Start Command | `npm run start -w server` |
| Region | Singapore |
| Health Check Path | `/health` |

환경 변수: `NODE_ENV=production`, `CLIENT_ORIGINS=https://<사이트 이름>.netlify.app`, `FIREBASE_SERVICE_ACCOUNT=<Base64 값>`

### 클라이언트 — Netlify

**Add new site → Import an existing project**에서 GitHub 저장소를 고르면 `netlify.toml` 설정이 자동으로 적용됩니다.

환경 변수: `VITE_SERVER_URL=https://<서비스 이름>.onrender.com`, `VITE_FIREBASE_API_KEY` 외 `client/.env.example`의 값들
