// 가입 흐름: 닉네임 규칙, 프로필 저장소, 소켓으로 닉네임 정하기, 닉네임 확인 HTTP
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io as connect } from 'socket.io-client';
import { EV, ERR } from '@rune/shared/protocol.js';
import { NICKNAME_ERROR, validateNickname } from '@rune/shared/rules/nickname.js';
import { createGameServer } from '../src/app.js';
import { DEFAULT_RATING, MemoryProfileStore, ProfileError } from '../src/persistence/profiles.js';

let server;
let url;
const sockets = [];

before(async () => {
  server = createGameServer({ authMode: 'dev', clientOrigins: ['http://localhost:5173'], countdownSec: 0.05 });
  server.httpServer.listen(0);
  await once(server.httpServer, 'listening');
  url = `http://localhost:${server.httpServer.address().port}`;
});

after(async () => {
  sockets.forEach((s) => s.close());
  await server.close();
});

function open(token, extraAuth = {}) {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, auth: { token, ...extraAuth } });
  sockets.push(socket);
  const profile = once(socket, EV.SESSION_PROFILE).then(([p]) => p);
  return { socket, profile };
}

test('닉네임 규칙: 2~12자, 한글·영문·숫자·밑줄, 사칭 단어 금지', () => {
  assert.equal(validateNickname('새벽기사').ok, true);
  assert.equal(validateNickname('Knight_07').ok, true);
  assert.equal(validateNickname('기').reason, NICKNAME_ERROR.TOO_SHORT);
  assert.equal(validateNickname('가나다라마바사아자차카타').ok, true, '12자까지');
  assert.equal(validateNickname('가나다라마바사아자차카타파').reason, NICKNAME_ERROR.TOO_LONG);
  assert.equal(validateNickname('새벽 기사').reason, NICKNAME_ERROR.INVALID_CHARS);
  assert.equal(validateNickname('<script>').reason, NICKNAME_ERROR.INVALID_CHARS);
  assert.equal(validateNickname('진짜관리자').reason, NICKNAME_ERROR.RESERVED);
  assert.equal(validateNickname('Sigma').ok, true, '짧은 영어 금지어(gm)가 섞인 이름은 괜찮다');
});

test('프로필 저장소: 닉네임은 대소문자를 무시하고 한 사람만 쓴다', async () => {
  const store = new MemoryProfileStore();
  const knight = await store.create('uid-1', 'Knight');
  assert.equal(knight.nickname, 'Knight');
  assert.equal(knight.ratings['1v1'], DEFAULT_RATING);

  await assert.rejects(store.create('uid-2', 'KNIGHT'), (err) => err instanceof ProfileError && err.code === NICKNAME_ERROR.TAKEN);
  await assert.rejects(store.create('uid-1', 'Another'), (err) => err.code === 'PROFILE_EXISTS');
  assert.equal(await store.isAvailable('knight'), false);
  assert.equal(await store.isAvailable('Paladin'), true);

  await store.create('uid-2', 'Paladin');
  await store.applyRatings([
    { uid: 'uid-2', mode: '1v1', rating: 1016, won: true },
    { uid: 'uid-1', mode: '1v1', rating: 984, won: false },
  ]);
  const board = await store.leaderboard('1v1');
  assert.deepEqual(board.map((p) => [p.nickname, p.ratings['1v1'], p.ranked['1v1'].wins]), [
    ['Paladin', 1016, 1],
    ['Knight', 984, 0],
  ]);
});

test('처음 접속하면 닉네임부터 정해야 로비를 쓸 수 있다', async () => {
  const { socket, profile } = open('dev:newcomer-0001', { nickname: '사칭하려는이름' });
  assert.equal(await profile, null, '프로필이 없다고 알려 준다 (핸드셰이크의 닉네임은 무시한다)');

  // 닉네임을 정하기 전에는 로비 이벤트에 답하지 않는다
  await assert.rejects(socket.timeout(200).emitWithAck(EV.LOBBY_LIST));

  const invalid = await socket.emitWithAck(EV.PROFILE_CREATE, { nickname: '공 백' });
  assert.deepEqual(invalid, { ok: false, error: ERR.NICKNAME_INVALID, reason: NICKNAME_ERROR.INVALID_CHARS });

  const announced = once(socket, EV.SESSION_PROFILE);
  const created = await socket.emitWithAck(EV.PROFILE_CREATE, { nickname: '새내기' });
  assert.equal(created.ok, true);
  assert.equal(created.profile.nickname, '새내기');
  const [pushed] = await announced;
  assert.equal(pushed.nickname, '새내기');

  const list = await socket.emitWithAck(EV.LOBBY_LIST);
  assert.equal(list.ok, true, '이제 로비를 쓸 수 있다');
  assert.deepEqual(await socket.emitWithAck(EV.PROFILE_CREATE, { nickname: '다른이름' }), {
    ok: false,
    error: ERR.PROFILE_EXISTS,
  });

  // 같은 닉네임은 다른 계정이 쓸 수 없다
  const other = open('dev:latecomer-0001');
  assert.equal(await other.profile, null);
  assert.deepEqual(await other.socket.emitWithAck(EV.PROFILE_CREATE, { nickname: '새내기' }), {
    ok: false,
    error: ERR.NICKNAME_TAKEN,
  });

  // 다시 접속하면 저장된 닉네임으로 바로 로비에 들어간다
  socket.close();
  const again = open('dev:newcomer-0001');
  assert.equal((await again.profile).nickname, '새내기');
});

test('닉네임 확인 HTTP: 가입 화면에서 미리 알려 준다 (허용한 출처만 CORS)', async () => {
  const check = async (name, origin) => {
    const res = await fetch(`${url}/api/nickname?name=${encodeURIComponent(name)}`, { headers: origin ? { origin } : {} });
    return { status: res.status, cors: res.headers.get('access-control-allow-origin'), body: await res.json() };
  };
  await server.profiles.create('uid-http', '이미있음');

  assert.deepEqual((await check('빈이름')).body, { available: true });
  assert.deepEqual((await check('이미있음')).body, { available: false, reason: NICKNAME_ERROR.TAKEN });
  assert.deepEqual((await check('a')).body, { available: false, reason: NICKNAME_ERROR.TOO_SHORT });

  assert.equal((await check('빈이름', 'http://localhost:5173')).cors, 'http://localhost:5173');
  assert.equal((await check('빈이름', 'https://evil.example')).cors, null);
});
