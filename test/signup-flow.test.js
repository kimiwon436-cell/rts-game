// 가입 → 닉네임 → 로비 → (브라우저를 닫았다 다시 열기) → 바로 로비. 실제 클라이언트 인증 모듈과 실제 서버로 확인한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io } from 'socket.io-client';
import { EV } from '@rune/shared/protocol.js';
import { createGameServer } from '../../server/src/app.js';
import { createDevAuth } from '../src/auth.js';

let server;
let url;
const sockets = [];

before(async () => {
  server = createGameServer({ authMode: 'dev', clientOrigins: ['http://localhost:5173'] });
  server.httpServer.listen(0);
  await once(server.httpServer, 'listening');
  url = `http://localhost:${server.httpServer.address().port}`;
});

after(async () => {
  sockets.forEach((s) => s.close());
  await server.close();
});

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

/** main.js가 하는 것처럼: 세션의 토큰으로 접속하고 첫 프로필 알림을 받는다 */
async function connectWith(session) {
  const token = await session.getToken();
  const socket = io(url, { transports: ['websocket'], forceNew: true, auth: { token } });
  sockets.push(socket);
  const [profile] = await once(socket, EV.SESSION_PROFILE);
  return { socket, profile };
}

const nextSession = (auth) => new Promise((resolve) => {
  const stop = auth.onChange((session) => {
    stop();
    resolve(session);
  });
});

test('가입한 계정은 닉네임을 정한 뒤 로비에 들어가고, 다시 열면 로그인과 닉네임이 그대로다', async () => {
  const storage = memoryStorage();
  const auth = createDevAuth(storage);
  const session = await auth.signUp('newbie01', 'dummy-pass-2468');

  // 첫 접속: 프로필이 없으니 가입 폼에서 고른 닉네임을 예약한다
  const first = await connectWith(session);
  assert.equal(first.profile, null);
  const created = await first.socket.emitWithAck(EV.PROFILE_CREATE, { nickname: '새벽기사' });
  assert.equal(created.ok, true);
  assert.equal((await first.socket.emitWithAck(EV.LOBBY_LIST)).ok, true);
  first.socket.close();

  // 브라우저를 닫았다 다시 연다: 같은 저장소로 인증을 새로 만든다
  const reopened = createDevAuth(storage);
  const restored = await nextSession(reopened);
  assert.equal(restored?.uid, session.uid, '로그인이 유지된다');

  const second = await connectWith(restored);
  assert.equal(second.profile?.nickname, '새벽기사', '닉네임을 다시 묻지 않는다');
  assert.equal((await second.socket.emitWithAck(EV.LOBBY_LIST)).ok, true);
});

test('로그아웃하고 다른 계정으로 가입하면, 앞 사람의 닉네임은 쓸 수 없다', async () => {
  const storage = memoryStorage();
  const auth = createDevAuth(storage);
  await auth.signOut();
  const other = await auth.signUp('second01', 'dummy-pass-1357');
  const { socket, profile } = await connectWith(other);
  assert.equal(profile, null);
  const taken = await socket.emitWithAck(EV.PROFILE_CREATE, { nickname: '새벽기사' });
  assert.equal(taken.ok, false);
  assert.equal(taken.error, 'NICKNAME_TAKEN');
});
