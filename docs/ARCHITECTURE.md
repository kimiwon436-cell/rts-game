# 룬 & 크라운 — 기술 설계서 v0.1

> 클라이언트는 명령만 보내고, 서버가 세계를 계산하며, Firebase는 결과만 기억한다.

- 문서 단계: 2단계 (기술 스택·아키텍처)
- 작성일: 2026-09-15
- 기준 기획: [GAME_DESIGN.md](GAME_DESIGN.md) v0.2

---

## 1. 핵심 결정

| 결정 | 선택 | 이유 |
|---|---|---|
| 동기화 모델 | **서버 권위 시뮬레이션** + 스냅샷 보간 | 클라이언트는 명령만 보내고 결과는 서버가 계산한다. 자원·전투 조작이 불가능하고, 락스텝(결정론 동기화)보다 재접속과 디버깅이 쉽다. |
| 시뮬레이션 틱 | 20Hz (50ms) 고정 타임스텝, 매 틱 델타 스냅샷 | RTS에 충분한 반응성. 1v1 규모에서 대역폭 부담이 작다. |
| 실시간 통신 | Socket.IO 4 (WebSocket) | 방(room) 브로드캐스트, 자동 재연결, 핸드셰이크 인증을 기본 제공한다. |
| 공용 코드 | `shared/` 워크스페이스 패키지 | 유닛 수치·피해 배율표·프로토콜을 서버와 클라이언트가 같은 파일로 쓴다. 수치가 어긋날 일이 없다. |
| 클라이언트 | Vite + Canvas 2D, HUD는 DOM | 게임 엔진 없이 가볍게. Vite가 모듈 번들링과 환경 변수(`VITE_*`)를 해결한다. 버튼·패널은 Canvas보다 DOM이 만들기 쉽다. |
| Firebase | Auth(익명 → Google) + Firestore(프로필·전적) | 실시간 게임 상태는 Firestore에 쓰지 않는다. 지연이 크고 쓰기마다 비용이 든다. |
| 호스팅 | 클라이언트 Netlify · 게임 서버 Render · 데이터 Firebase | Netlify는 정적 파일과 서버리스 함수만 돌려서 WebSocket 서버를 상주시킬 수 없다. |
| 런타임 | Node.js 24 LTS, ES 모듈 | 서버·공용 코드·브라우저가 같은 `import` 문법을 쓴다. `node --watch`, `node --test` 내장. |

---

## 2. 시스템 구성

```mermaid
flowchart LR
  GH[GitHub main] -->|push| NF[Netlify<br/>client/dist]
  GH -->|push → 자동 배포| RD[게임 서버<br/>Render]
  NF -->|HTML·JS 로드| BR[브라우저 클라이언트<br/>Canvas]
  BR -->|game:cmd 명령| RD
  RD -->|game:snap 틱마다 델타| BR
  BR <-->|로그인 · ID 토큰| AU[Firebase Auth]
  RD -->|경기 종료 시 기록| FS[(Firestore)]
  BR -->|프로필 읽기| FS
```

| 구성 요소 | 호스팅 | 책임 |
|---|---|---|
| 클라이언트 | Netlify | 렌더링, 입력, 보간, UI. 게임 규칙 판정은 하지 않는다 |
| 게임 서버 | Render (싱가포르 리전) | 로비, 경기 방, 시뮬레이션, 길찾기, 스냅샷, 토큰 검증 |
| Firebase Auth | Firebase | 익명·Google 로그인, ID 토큰 발급 |
| Firestore | Firebase (`asia-northeast3` 서울) | 유저 프로필, 전적, 경기 결과 |

- Render 무료 플랜은 요청이 없으면 잠들어 첫 연결이 느릴 수 있다. 개발·테스트는 무료로, 공개 테스트부터는 상시 실행 플랜을 쓴다.
- Firestore 위치는 한 번 정하면 바꿀 수 없으니 처음 만들 때 서울 리전을 고른다.

---

## 3. 폴더 구조

```
rune-and-crown/
├─ package.json              # npm 워크스페이스 (shared, server, client)
├─ netlify.toml              # 클라이언트 빌드·배포 설정
├─ firebase.json             # Firestore 규칙 배포 설정
├─ firestore.rules
├─ .gitignore                # node_modules, dist, .env, 서비스 계정 키
├─ docs/
│  ├─ GAME_DESIGN.md
│  └─ ARCHITECTURE.md
│
├─ shared/                   # 서버·클라이언트 공용. DOM·Node API를 쓰지 않는 순수 JS
│  ├─ package.json           # name: @rune/shared
│  └─ src/
│     ├─ constants.js        # TICK_MS, TILE_SIZE, MAP_SIZE, 인구 상한
│     ├─ protocol.js         # 소켓 이벤트 이름, 명령 타입, 스냅샷 비트마스크
│     ├─ data/
│     │  ├─ units.js         # 유닛 능력치 (GAME_DESIGN 3장)
│     │  ├─ buildings.js     # 건물 능력치 (5장)
│     │  ├─ damage.js        # 피해 배율표, 피해 공식
│     │  └─ market.js        # 시장 시세 규칙
│     └─ map/
│        ├─ grid.js          # 타일 ↔ 월드 좌표, 건물 풋프린트
│        └─ maps/duel01.js   # 1v1 맵: 지형, 금광, 숲, 마나 샘
│
├─ server/
│  ├─ package.json
│  ├─ .env.example
│  └─ src/
│     ├─ index.js            # HTTP + Socket.IO 시작, /health
│     ├─ config.js           # 환경 변수 읽기
│     ├─ firebase.js         # Admin SDK 초기화
│     ├─ net/
│     │  ├─ auth.js          # 핸드셰이크 ID 토큰 검증
│     │  ├─ lobby.js         # 방 목록, 입장, 준비
│     │  ├─ rateLimit.js     # 명령 토큰 버킷
│     │  └─ validate.js      # 명령 페이로드 검사
│     ├─ game/
│     │  ├─ Room.js          # 경기 한 판. 틱 루프, 플레이어 슬롯, 재접속
│     │  ├─ World.js         # 엔티티 저장소, 플레이어 자원, 공간 해시
│     │  ├─ Simulation.js    # 틱마다 시스템을 정해진 순서로 실행
│     │  ├─ entities.js      # createUnit, createBuilding
│     │  ├─ systems/
│     │  │  ├─ commands.js
│     │  │  ├─ movement.js
│     │  │  ├─ gathering.js
│     │  │  ├─ construction.js
│     │  │  ├─ production.js
│     │  │  ├─ combat.js
│     │  │  ├─ economy.js    # 마나 생산, 시장 시세 회복, 인구
│     │  │  └─ victory.js
│     │  ├─ pathfinding/
│     │  │  ├─ NavGrid.js    # 통행 가능 칸. 건물·나무·성문 반영
│     │  │  ├─ BinaryHeap.js
│     │  │  ├─ astar.js
│     │  │  ├─ smooth.js     # 시야선 검사로 경로 다듬기
│     │  │  └─ PathQueue.js  # 틱당 계산 예산
│     │  └─ sync/
│     │     ├─ snapshot.js   # 플레이어별 델타 스냅샷
│     │     └─ visibility.js # (확장) 전장의 안개
│     └─ persistence/
│        └─ matches.js       # 경기 결과 Firestore 기록
│
└─ client/
   ├─ package.json
   ├─ vite.config.js
   ├─ index.html
   ├─ .env.example
   ├─ public/assets/         # 스프라이트, 사운드
   └─ src/
      ├─ main.js             # 로그인 → 로비 → 게임
      ├─ firebase.js         # 클라이언트 SDK, 익명 로그인
      ├─ net/
      │  ├─ socket.js        # 연결, 토큰 전달, 재접속
      │  └─ commands.js      # 명령 전송, seq 관리
      ├─ world/
      │  ├─ ClientWorld.js   # 스냅샷 적용, 엔티티 보관
      │  └─ interpolation.js # 서버 틱 추정, 위치 보간
      ├─ render/
      │  ├─ Renderer.js      # requestAnimationFrame 루프, 그리기 순서
      │  ├─ Camera.js        # 스크롤, 줌, 좌표 변환
      │  ├─ terrain.js       # 지형 청크를 오프스크린 캔버스에 캐시
      │  ├─ sprites.js
      │  └─ minimap.js
      ├─ input/
      │  ├─ Input.js         # 마우스·키보드 상태
      │  ├─ selection.js     # 드래그 박스 선택
      │  └─ orders.js        # 우클릭 대상 판정 → 명령
      └─ ui/                 # HUD는 DOM으로 Canvas 위에 겹친다
         ├─ hud.js
         ├─ commandCard.js
         └─ lobby.js
```

루트 `package.json`

```json
{
  "name": "rune-and-crown",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "server", "client"],
  "scripts": {
    "dev": "concurrently -n server,client \"npm run dev -w server\" \"npm run dev -w client\"",
    "build": "npm run build -w client",
    "test": "node --test"
  },
  "engines": { "node": ">=24" }
}
```

공용 코드는 워크스페이스 패키지로 가져온다: `import { UNITS } from '@rune/shared/data/units.js'`

---

## 4. 서버 게임 루프

### 틱 순서 (50ms마다)

1. **명령 적용** — 지난 틱 이후 받은 명령을 검증해 유닛 명령 큐에 넣는다
2. **경로 계산** — 길찾기 요청 큐를 틱당 예산(5ms) 안에서 처리
3. **이동** — 경로 추종 + 유닛 간 밀어내기
4. **채집·건설·생산**
5. **전투** — 대상 탐색, 공격 쿨다운, 피해 적용
6. **경제** — 마나 생산, 시장 시세 회복, 인구 계산
7. **정리** — 사망·파괴 엔티티 제거
8. **승리 판정**
9. **스냅샷** — 플레이어별 델타를 만들어 전송

### 고정 타임스텝

```js
const TICK_MS = 50;
const MAX_CATCH_UP = 5;
let next = performance.now();

function loop() {
  let steps = 0;
  while (performance.now() >= next && steps < MAX_CATCH_UP) {
    room.step();
    next += TICK_MS;
    steps++;
  }
  if (steps === MAX_CATCH_UP) next = performance.now(); // 너무 밀리면 따라잡기를 포기
  setTimeout(loop, Math.max(0, next - performance.now()));
}
```

### 엔티티

MVP는 `Map<id, entity>`에 평범한 객체를 담는다.

```js
{
  id, owner, type, x, y, hp,
  state,          // 7장 유닛 상태
  targetId,
  orders: [],     // Shift 예약 명령
  path: null,     // 웨이포인트 배열
  cooldown: 0,
  carry: null,    // { kind: 'gold', amount: 10 }
  dirty: 0        // 이번 틱에 바뀐 필드 비트마스크
}
```

---

## 5. 실시간 동기화

### 명령 한 번의 흐름

1. 우클릭하면 클라이언트가 대상을 판정한다: 적이면 공격, 자원이면 채집, 땅이면 이동. `game:cmd`를 보내고 이동 마커·효과음은 서버를 기다리지 않고 바로 보여준다.
2. 서버는 다음 틱에 명령을 검증하고 적용한다.
3. 서버는 매 틱 플레이어별 델타 스냅샷 `game:snap`을 보낸다.
4. 클라이언트는 스냅샷을 버퍼에 쌓고 **추정 서버 시간 − 100ms** 시점을 그린다. 이미 받은 두 스냅샷 사이 위치를 보간해 20Hz 데이터를 60fps로 부드럽게 보여준다.
5. 체감 지연 ≈ 왕복 지연 + 최대 50ms(틱 대기) + 100ms(보간). RTS는 유닛을 간접 조작하므로 클라이언트 예측은 쓰지 않는다.

### 소켓 이벤트 (`shared/src/protocol.js`)

| 방향 | 이벤트 | 내용 |
|---|---|---|
| C→S | `lobby:list` · `lobby:create` · `lobby:join` · `lobby:leave` · `lobby:ready` | 방 목록, 만들기, 입장, 나가기, 준비 (모두 ack로 응답) |
| C→S | `game:cmd` | `{ seq, type, unitIds, target, queue }` |
| C→S | `net:ping` · `game:surrender` | 지연 측정, 항복 |
| S→C | `lobby:update` | 방 목록 |
| S→C | `lobby:room` | 내가 들어간 방의 참가자·준비 상태 (나오면 `null`) |
| S→C | `game:countdown` | 시작 카운트다운 (`seconds`가 0이면 취소) |
| S→C | `session:replaced` | 같은 계정이 다른 곳에서 접속해 이 연결을 끊음 |
| S→C | `game:start` | 맵, 플레이어, 전체 상태 |
| S→C | `game:snap` | 틱 델타 스냅샷 |
| S→C | `game:reject` | 거부된 명령 `{ seq, reason }` → "자원이 부족합니다" 등 |
| S→C | `game:end` | 승자, 승리 유형, 통계 |

명령 타입: `move` `attackMove` `attack` `stop` `gather` `build` `train` `cancelTrain` `setRally` `ageUp` `trade` `toggleAbility`

### 스냅샷 포맷

```js
{
  t: 1234,                        // 서버 틱
  ack: 57,                        // 처리한 내 마지막 명령 seq
  me: [350, 220, 45, 18, 26],     // 금, 목재, 마나, 인구, 인구 상한 — 내 것만
  add: [[id, type, owner, x, y, hp, state]],
  upd: [[id, mask, ...바뀐 값]],    // mask: 위치 1 · 체력 2 · 상태 4 · 대상 8 · 진행도 16 · 운반 32
  del: [id],
  ev:  [[EV.ATTACK, attackerId, targetId], [EV.DEATH, id]]
}
```

- 좌표는 1/16타일 정수 (96타일 × 16 = 1536). 소수점 없이 짧다.
- 공격 모션, 투사체, 사망 효과는 상태가 아니라 **이벤트**로 보낸다.
- 상대의 자원과 생산 대기열은 보내지 않는다.
- 입장·재접속 때는 `game:start`로 전체 상태를 다시 보낸다.
- 대역폭이 커지면 `perMessageDeflate` 압축 → msgpack 파서 순서로 최적화한다.

### 클라이언트 보간

```js
const INTERP_DELAY_TICKS = 2; // 100ms

function updateDrawPositions(world) {
  const renderTick = estimateServerTick() - INTERP_DELAY_TICKS;
  for (const e of world.entities.values()) {
    const [a, b] = e.samplesAround(renderTick); // 위치 샘플 링 버퍼
    const k = b.t === a.t ? 1 : Math.min(1, Math.max(0, (renderTick - a.t) / (b.t - a.t)));
    e.drawX = a.x + (b.x - a.x) * k;
    e.drawY = a.y + (b.y - a.y) * k;
  }
}
```

`estimateServerTick()`은 마지막 스냅샷의 틱 + 받은 뒤 흐른 시간 ÷ 50ms로 계산하고, 값이 튀면 조금씩 보정한다.

### 재접속

- Firebase uid로 플레이어를 식별한다. 연결이 끊겨도 슬롯을 60초 유지한다 (승리 조건 3).
- 같은 uid로 다시 연결하면 방에 재입장하고 `game:start`로 전체 상태를 받는다.

---

## 6. A* 길찾기

### 내비게이션 그리드

- 96×96 `Uint8Array`: 0 통행 가능, 1 지형, 2 건물, 3 나무, 4 성문
- 건물 건설·파괴, 나무 고갈 때 해당 칸을 갱신하고 `navGrid.version`을 올린다
- 성문 칸은 A*에 넘긴 `playerId`가 주인일 때만 통행 가능
- 유닛은 그리드를 막지 않는다 (서로 밀어내기로 처리)

### 알고리즘

- 8방향 이동. 휴리스틱은 옥타일 거리 `(dx + dy) + (√2 − 2) × min(dx, dy)`
- 대각선은 양옆 두 칸이 모두 비어 있을 때만 (벽 모서리 끼기 방지)
- 열린 목록은 이진 힙. f가 같으면 h가 작은 쪽을 먼저 꺼내 탐색 칸을 줄인다
- g값·부모·방문 표시는 미리 할당한 타입 배열을 재사용한다 (탐색 번호 스탬프로 매번 초기화하지 않음)
- 목표에 닿을 수 없으면 휴리스틱이 가장 작았던 칸까지의 경로를 돌려준다
- 결과 경로는 유닛 반지름만큼 두께를 둔 시야선 검사로 꺾는 점을 줄인다 (스무딩)

### 서버에서의 운영

- **요청 큐 + 틱당 예산 5ms**: 50기를 한 번에 움직여도 틱이 밀리지 않는다. 남은 요청은 다음 틱에 처리한다 (1–2틱 지연은 체감되지 않는다).
- **목표 분산**: 여러 유닛에 같은 지점을 찍으면 클릭 지점 주변 빈 칸을 나선형으로 골라 한 칸씩 배정한다.
- **재탐색**: 다음 웨이포인트가 막히면 경로를 다시 요청한다.
- **비행 유닛** (그리폰 기수): A*를 건너뛰고 직선 이동.
- **건물·자원 대상**: 풋프린트 둘레의 통행 가능한 칸 중 가장 가까운 곳을 목표로 삼는다.
- **성벽에 막힘**: 적 경로가 목표에 닿지 않고 성벽에 붙으면 공격 이동 중인 유닛은 성벽을 공격 대상으로 삼는다.

### 이동과 충돌

- 유닛은 반지름을 가진 원이다. 웨이포인트를 향해 이동하면서 공간 해시(2타일 셀)로 주변 유닛을 찾아 밀어낸다.
- 목표 근처에서 이미 도착한 아군과 겹치면 그 자리에서 멈춘다 (도착 떨림 방지).

---

## 7. 유닛 상태

| 상태 | 코드 | 하는 일 | 다음 상태 |
|---|---|---|---|
| `idle` | 0 | 대기. 사거리 안에 적이 오면 자동 공격 | move, attack, gather, build |
| `move` | 1 | 경로를 따라 이동 | idle, attack (공격 이동 중 적 발견) |
| `attack` | 2 | 대상 추적 → 사거리 안이면 공격 | idle (대상 사망), move |
| `gather` | 3 | 자원으로 이동 → 채집 | return |
| `return` | 4 | 가장 가까운 반납 건물로 운반 | gather |
| `build` | 5 | 건설 현장으로 이동 → 건설 | idle |

---

## 8. Firebase

### 인증 흐름

1. 클라이언트가 `signInAnonymously()`로 로그인한다 (나중에 Google 계정을 연결).
2. ID 토큰을 Socket.IO 핸드셰이크에 담아 연결한다.
3. 서버는 `io.use()` 미들웨어에서 Admin SDK로 토큰을 검증하고 `socket.data.uid`에 저장한다. 실패하면 연결을 거부한다.

```js
// client/src/net/socket.js
const socket = io(import.meta.env.VITE_SERVER_URL, {
  auth: (cb) => { auth.currentUser.getIdToken().then((token) => cb({ token })); },
});

// server/src/net/auth.js
io.use(async (socket, next) => {
  try {
    const { uid } = await getAuth().verifyIdToken(socket.handshake.auth.token);
    socket.data.uid = uid;
    next();
  } catch {
    next(new Error('UNAUTHORIZED'));
  }
});
```

`auth`를 함수로 넘기면 재연결할 때마다 새 토큰을 받는다.

### Firestore 데이터 모델

| 경로 | 필드 | 쓰기 권한 |
|---|---|---|
| `users/{uid}` | nickname, createdAt, rating, wins, losses | nickname만 본인, 나머지는 서버 |
| `matches/{matchId}` | players[{uid, nickname, oath, result}], winner, victoryType, durationSec, startedAt, endedAt, gameVersion | 서버만 |

쓰기는 경기가 끝날 때 배치 한 번. 틱마다 쓰지 않는다.

### 보안 규칙 초안 (`firestore.rules`)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read: if request.auth != null;
      allow create: if request.auth.uid == uid
        && request.resource.data.keys().hasOnly(['nickname', 'createdAt'])
        && request.resource.data.nickname is string
        && request.resource.data.nickname.size() <= 16
        && request.resource.data.createdAt == request.time;
      allow update: if request.auth.uid == uid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['nickname'])
        && request.resource.data.nickname is string
        && request.resource.data.nickname.size() <= 16;
    }
    match /matches/{matchId} {
      allow read: if request.auth != null;
      allow write: if false; // 서버(Admin SDK)만 기록
    }
  }
}
```

---

## 9. 보안과 검증

- 모든 명령을 서버에서 검증한다: 유닛 소유권, 생존 여부, 명령 가능 유형(농노만 건설), 비용, 배치 가능한 칸, 인구
- 명령 속도 제한: 플레이어당 초당 20개 (토큰 버킷), `unitIds`는 최대 60개
- 페이로드 타입과 범위를 검사하고 모르는 필드는 무시한다
- 상대 자원과 생산 대기열은 스냅샷에서 뺀다. 전장의 안개를 넣으면 `visibility.js`에서 보이는 엔티티만 보낸다
- 서비스 계정 키는 Render 환경 변수에만 둔다. 저장소에 커밋하지 않는다

---

## 10. 배포와 환경 설정

### 환경 변수

| 위치 | 변수 | 예시 |
|---|---|---|
| `client/.env` | `VITE_SERVER_URL` | `http://localhost:3000` |
| `client/.env` | `VITE_FIREBASE_API_KEY` 외 웹 앱 설정 | Firebase 콘솔 → 프로젝트 설정 |
| `server/.env` | `PORT` | `3000` (Render에서는 자동 주입) |
| `server/.env` | `CLIENT_ORIGINS` | `http://localhost:5173,https://<사이트>.netlify.app` |
| `server/.env` | `FIREBASE_SERVICE_ACCOUNT` | 서비스 계정 JSON을 Base64로 인코딩한 값 |

### 파이프라인

1. GitHub `main` 브랜치에 push
2. **Netlify**가 `netlify.toml`대로 클라이언트를 빌드해 `client/dist`를 배포
3. **Render**가 서버를 자동 재배포
4. **Firestore 규칙**은 바꿀 때만 `firebase deploy --only firestore:rules`

`netlify.toml`

```toml
[build]
  command = "npm run build -w client"
  publish = "client/dist"

[build.environment]
  NODE_VERSION = "24"
```

Render 웹 서비스 설정

| 항목 | 값 |
|---|---|
| Root Directory | 비움 (저장소 루트) |
| Build Command | `npm ci` |
| Start Command | `npm run start -w server` |
| Health Check Path | `/health` |
| Region | Singapore |

### 로컬 개발

```bash
npm install
npm run dev
```

서버(`node --watch`, 3000번)와 클라이언트(Vite, 5173번)가 함께 뜬다.

---

## 11. 3단계 코드 로드맵

서버 권위 구조라 클라이언트는 처음부터 서버 상태만 그린다. 3-2부터는 서버가 매 틱 **전체 상태**를 보내는 단순한 방식으로 시작하고, 3-5에서 델타·보간·재접속으로 바꾼다.

| 단계 | 만들 것 | 완료 기준 |
|---|---|---|
| 3-1 기본 세팅 | 워크스페이스, Vite + Canvas 화면, 카메라·타일맵 렌더, Firebase 익명 로그인, 토큰 검증 소켓 연결, 로비 | 브라우저 두 개로 같은 방에 들어가고 서버 로그에 uid가 찍힌다 |
| 3-2 자원·건설 | shared 데이터 파일, 서버 틱 루프, 농노 채집·반납, 건물 배치 검증·건설, 오벨리스크 마나, 시장, HUD | 농노가 금·목재를 모으고 건물이 올라간다 |
| 3-3 생산·이동 | 생산 대기열, 인구, NavGrid·A*·스무딩·요청 큐, 드래그 선택, 우클릭 이동 | 유닛을 뽑아 장애물을 돌아 이동시킨다 |
| 3-4 전투 | 대상 탐색, 피해 공식·배율표, 공격 이동, 감시탑, 방패벽, 사망 처리, 정복 승리 | 상성대로 전투 결과가 나오고 경기가 끝난다 |
| 3-5 동기화 | 델타 스냅샷·dirty 마스크, 보간 버퍼, 공격·사망 이벤트, 재접속, 경기 결과 Firestore 저장 | 두 브라우저에서 같은 전투가 부드럽게 보인다 |
