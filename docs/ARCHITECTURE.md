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

1. **명령 적용** — 지난 틱 이후 받은 명령을 검증해 유닛에 넣는다
2. **이동** — 경로 요청을 틱당 예산(24회·8ms)만큼 계산하고 웨이포인트를 따라 이동
3. **밀어내기** — 겹친 유닛을 서로 떼어 놓는다
4. **전투** — 적 찾기, 사거리까지 쫓기, 공격 간격, 피해 적용
5. **정리** — 체력이 다한 유닛·건물 제거
6. **채집·건설·생산**
7. **경제** — 마나 생산, 시대 발전, 시장 시세 회복, 인구 계산
8. **승리 판정** — 왕관 몰락 카운트다운, 전멸, 항복·이탈
9. **스냅샷** — 플레이어별로 전송 (3-5에서 델타로 바꾼다)

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

명령 타입: `move` `attackMove` `attack` `stop` `gather` `returnCargo` `place` `construct` `cancelBuild` `train` `cancelTrain` `setRally` `ageUp` `cancelAgeUp` `trade` `toggleAbility` `surrender`

### 스냅샷 포맷 (`shared/src/snapshot.js`, `server/src/game/sync/snapshot.js`)

틱마다 **바뀐 것만** 보낸다. 서버는 지난 틱에 보낸 인코딩을 들고 있다가 이번 틱 인코딩과 비교해 마스크를 만든다.
(엔티티마다 dirty 비트를 다는 대신 인코딩을 비교한다 — 시스템 코드가 단순해지고 나가는 결과는 같다.)

```js
{
  t: 1234,                     // 서버 틱
  full: true,                  // 전체 상태일 때만 (첫 입장·재접속)
  players: [[slot, 시대, 왕관 몰락까지 남은 초, 패배 0|1]],
  addU: [[id, 종류, 주인, x16, y16, hp, 상태, 운반종류, 운반량, 플래그]],
  updU: [[id, 마스크, ...바뀐 값]],   // 마스크: 위치 1 · 체력 2 · 상태 4 · 운반 8 · 플래그 16
  addB: [[id, 종류, 주인, x, y, hp, 진행도, 플래그]],
  updB: [[id, 마스크, ...바뀐 값]],   // 마스크: 체력 1 · 진행도 2 · 플래그 4
  del:  [id],                  // 사라진 유닛·건물
  mines:[[금광id, 남은 양]],     // 0이면 다 캤다
  ev:   [[GAME_EVENT.ATTACK, 공격자, 대상], [GAME_EVENT.UNIT_DIED, id]],
  me:   [금, 목재, 마나, 인구, 상한, 시대, ...],  // 내 것만, 바뀐 틱에만
  own:  { q: 생산 대기열, r: 집결지 }            // 내 건물만, 바뀐 틱에만
}
```

- **빈 항목은 키째로 뺀다.** 아무도 움직이지 않는 틱에는 `{ t }`만 나간다.
- 좌표는 1/16타일 정수 (96타일 × 16 = 1536). 소수점 없이 짧다.
- 공격 모션, 투사체, 사망 효과는 상태가 아니라 **이벤트**로 보낸다.
- 상대의 자원과 생산 대기열은 보내지 않는다. `me`·`own`은 플레이어별 개인화 단계에서만 얹는다.
- 실측(2인, 유닛 8기 채취 중): 평균 **87B/틱**, 최대 476B, 같은 상황의 전체 스냅샷은 513B.
- 더 커지면 `perMessageDeflate`(1KB 이상 압축) → msgpack 파서 순서로 최적화한다.

### 클라이언트 보간 (`client/src/world/ClientWorld.js`)

화면은 **서버보다 2틱(=100ms) 뒤**를 그린다. 그만큼 늦게 보는 대신, 그릴 시점의 앞뒤 스냅샷이 이미 도착해 있어
두 위치를 잇기만 하면 된다. 위치를 쫓아가는 방식과 달리 속도가 일정해 보이고, 스냅샷 하나를 놓쳐도 튀지 않는다.

- 유닛마다 위치 표본 링 버퍼(최대 6개)를 둔다. 표본은 **위치가 바뀐 틱에만** 쌓인다(가만히 선 유닛은 공짜).
- `renderTick`은 프레임 시간만큼 흐르고, 목표(`마지막 서버 틱 − 2`)와 어긋난 만큼 ±20% 안에서 빠르거나 느리게 간다.
- 8틱 넘게 벌어지면(탭 비활성, 긴 끊김) 보정하지 않고 바로 목표로 건너뛴다.
- 표본이 하나뿐이거나 그릴 시점이 마지막 표본보다 뒤면 마지막 위치를 유지한다 — 서버 위치를 앞질러 예측하지 않는다.
  (예측은 되돌릴 때 유닛이 뒤로 미끄러져 보여서, 이 규모에서는 손해가 크다.)

### 재접속 (`server/src/net/lobby.js`)

- Firebase uid로 플레이어를 식별한다. 경기 중에 끊기면 슬롯을 **60초**(`RECONNECT_GRACE_SEC`) 지킨다.
- 끊긴 사이에도 경기는 계속 돈다. 그 플레이어에게는 스냅샷을 보내지 않고, 명령은 오지 않으니 유닛은 하던 일을 계속한다.
- 방에 남은 상대에게는 `connected: false`가 브로드캐스트되어 "상대의 연결이 끊겼습니다"가 뜬다.
- 같은 uid로 다시 붙으면 `game:resume` → 다음 틱에 `full: true` 스냅샷을 받아 처음부터 다시 맞춘다.
- 유예 시간이 지나면 패배(`VICTORY_REASON.LEFT`) 처리하고 방에서 뺀다. 상대가 이긴다.
- 대기실에서 끊긴 경우는 유예 없이 바로 방에서 나간다.

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

- **요청 큐 + 틱당 예산 (24회 · 8ms)**: 이동 명령의 경로는 큐에 쌓고 틱마다 예산만큼만 계산한다. 50기를 한 번에 움직여도 틱이 밀리지 않고, 남은 요청은 다음 틱에 처리한다. 채집·건설처럼 "닿을 수 있는지"로 다음 행동이 갈리는 명령은 바로 계산한다.
- **목표 분산**: 클릭 지점에서 걸어서 이어진 빈 칸을 BFS로 모아 유닛마다 한 칸씩 준다. 모여 있던 무리는 지금 대형을 유지한 채 옮기고, 흩어진 무리는 목표 주변으로 모인다.
- **재탐색**: 칸이 새로 막히면(건물 공사 시작) 남은 경로가 실제로 막힌 유닛만 경로를 다시 찾는다.
- **비행 유닛** (그리폰 기수): A*를 건너뛰고 직선 이동.
- **건물·자원 대상**: 풋프린트 둘레의 통행 가능한 칸 중 가장 가까운 곳을 목표로 삼는다.
- **성벽에 막힘**: 적 경로가 목표에 닿지 않고 성벽에 붙으면 공격 이동 중인 유닛은 성벽을 공격 대상으로 삼는다.

### 이동과 충돌

- 유닛은 반지름을 가진 원이다. 틱마다 공간 해시(2타일 셀)로 겹친 유닛을 찾아 겹친 거리의 60%씩 밀어낸다. 움직이는 유닛이 서 있는 유닛을 비켜 가게 한다 (움직이는 쪽 20%, 서 있는 쪽 80%).
- 밀려도 막힌 칸에는 들어가지 않는다. 축마다 따로 옮겨 벽을 따라 미끄러진다.
- 채집·건설·반납 중인 농노는 서로 겹쳐도 된다 (금광 앞 교통 체증 방지).
- 무리 이동은 유닛마다 목적지 칸이 달라서 도착한 뒤 한자리에 뭉치지 않는다.

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

### 전투 규칙 (`server/src/game/systems/combat.js`)

- **피해**: `shared/src/rules/combat.js`의 배율표와 공식. 근접은 몸과 몸 사이 0.4타일, 원거리는 사거리만큼 닿는다. 전투 마법사는 대상 주변 1.2타일에 같은 피해를 준다.
- **적 찾기**: 대기 중이거나 공격 이동 중인 병력이 0.2초마다 주변을 살핀다 (근접 5타일, 원거리는 사거리 + 2). 싸울 수 있는 유닛 → 농노 → 건물 순으로 노리고, 나를 때린 적이 가까우면 먼저 반격한다.
- **농노**는 스스로 싸우지 않는다. 공격 명령을 받았을 때만 싸운다.
- **쫓기**: 스스로 고른 적이 탐색 거리 + 4타일보다 멀어지면 포기한다. 공격 명령으로 찍은 적은 끝까지 쫓는다. 보이는 적에게는 직선으로, 가려진 적에게는 A*로 다가간다.
- **투사체**는 보여주기용이다. 피해는 공격 순간 들어가고, 클라이언트는 `ATTACK` 이벤트로 화살·마법 탄을 그린다.
- **승패** (`victory.js`): 완성된 영주관이 없으면 120초 카운트다운 → 그 안에 다시 완공하지 못하면 패배. 유닛·건물이 하나도 없으면 즉시 패배. 항복과 경기 중 이탈도 패배. 결과가 나면 `game:end`를 보내고 방은 대기 상태로 돌아간다.

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
| `users/{uid}` | nickname, createdAt, matches, wins, losses, lastPlayedAt | nickname만 본인, 전적은 서버 |
| `matches/{matchId}` | matchId, mapId, players[{slot, uid, nickname, defeated}], uids[], winnerSlot, reason, durationSec, startedAt, endedAt | 서버만 |

쓰기는 경기가 끝날 때 배치 한 번(`server/src/persistence/matches.js`), 경기당 1 + 인원 수. 틱마다 쓰지 않는다.
`matchId`는 `방id-시작시각`이라 같은 경기를 두 번 써도 덮어쓰기라 안전하다. `uids` 배열은 "내 경기만 보기"(array-contains) 색인용이다.
Firebase가 설정되지 않은 개발 모드에서는 저장을 건너뛴다(게임은 그대로 돌아간다).

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
| `server/.env` | `RECONNECT_GRACE_SEC` | `60` — 경기 중 끊긴 자리를 지켜 주는 시간 |

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

서버 권위 구조라 클라이언트는 처음부터 서버 상태만 그린다. 3-2~3-4는 매 틱 **전체 상태**를 보내는 단순한 방식으로 굴렸고, 3-5에서 델타·보간·재접속으로 바꿨다. **3단계 전체 완료.**

| 단계 | 만들 것 | 완료 기준 |
|---|---|---|
| 3-1 기본 세팅 | 워크스페이스, Vite + Canvas 화면, 카메라·타일맵 렌더, Firebase 익명 로그인, 토큰 검증 소켓 연결, 로비 | 브라우저 두 개로 같은 방에 들어가고 서버 로그에 uid가 찍힌다 |
| 3-2 자원·건설 | shared 데이터 파일, 서버 틱 루프, 농노 채집·반납, 건물 배치 검증·건설, 오벨리스크 마나, 시장, 시대 발전, HUD·명령 카드, 선택과 우클릭 명령, A* 핵심(NavGrid·A*·스무딩 — 채집에 필요해 앞당김) | 농노가 금·목재를 모으고 건물이 올라간다 |
| 3-3 생산·이동 | 생산 대기열·집결지, 인구 제한, 길찾기 요청 큐·틱당 예산, 그룹 이동(목표 분산), 유닛끼리 밀어내기 | 병력을 뽑아 무리 지어 장애물을 돌아 이동시킨다 |
| 3-4 전투 | 대상 탐색, 피해 공식·배율표, 공격 이동, 감시탑, 방패벽, 사망 처리, 정복 승리 | 상성대로 전투 결과가 나오고 경기가 끝난다 |
| 3-5 동기화 ✅ | 델타 스냅샷·필드 마스크, 보간 버퍼, 재접속 유예 60초, 경기 결과 Firestore 저장 | 두 브라우저에서 같은 전투가 부드럽게 보이고, 끊겼다 돌아와도 이어서 한다 |
