import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io as connect } from 'socket.io-client';
import { EV, ERR, ROOM_STATUS } from '@rune/shared/protocol.js';
import { createGameServer } from '../src/app.js';

let server;
let url;
const sockets = [];

before(async () => {
  server = createGameServer({ authMode: 'dev', clientOrigins: ['http://localhost'], countdownSec: 0.05 });
  server.httpServer.listen(0);
  await once(server.httpServer, 'listening');
  url = `http://localhost:${server.httpServer.address().port}`;
});

after(async () => {
  sockets.forEach((s) => s.close());
  await new Promise((resolve) => server.io.close(resolve));
});

function player(name, token = `dev:${name}-test-0001`) {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, auth: { token, nickname: name } });
  sockets.push(socket);
  return socket;
}

async function connected(socket) {
  if (!socket.connected) await once(socket, 'connect');
  return socket;
}

test('형식이 맞지 않는 토큰은 연결을 거부한다', async () => {
  const socket = player('intruder', 'not-a-token');
  const [err] = await once(socket, 'connect_error');
  assert.equal(err.message, ERR.UNAUTHORIZED);
});

test('두 명이 같은 방에 들어가 준비하면 게임이 시작된다', async () => {
  const alice = await connected(player('alice'));
  const bob = await connected(player('bob'));

  const created = await alice.emitWithAck(EV.LOBBY_CREATE, { name: '  첫 번째 방  ' });
  assert.equal(created.ok, true);
  assert.equal(created.room.name, '첫 번째 방');
  assert.equal(created.room.players[0].slot, 0);

  const list = await bob.emitWithAck(EV.LOBBY_LIST);
  assert.ok(list.rooms.some((r) => r.id === created.room.id && r.players === 1));

  const joined = await bob.emitWithAck(EV.LOBBY_JOIN, { roomId: created.room.id });
  assert.equal(joined.ok, true);
  assert.deepEqual(joined.room.players.map((p) => p.slot), [0, 1]);

  const carol = await connected(player('carol'));
  const full = await carol.emitWithAck(EV.LOBBY_JOIN, { roomId: created.room.id });
  assert.deepEqual(full, { ok: false, error: ERR.ROOM_FULL });

  const aliceStart = once(alice, EV.GAME_START);
  const bobStart = once(bob, EV.GAME_START);
  await alice.emitWithAck(EV.LOBBY_READY, { ready: true });
  await bob.emitWithAck(EV.LOBBY_READY, { ready: true });

  const [[startA], [startB]] = await Promise.all([aliceStart, bobStart]);
  assert.equal(startA.mapId, 'duel01');
  assert.deepEqual(startA, startB);
  assert.deepEqual(startA.players.map((p) => p.nickname), ['alice', 'bob']);
  assert.equal(server.lobby.rooms.get(created.room.id).status, ROOM_STATUS.PLAYING);
});

test('마지막 사람이 나가면 방이 사라진다', async () => {
  const dave = await connected(player('dave'));
  const { room } = await dave.emitWithAck(EV.LOBBY_CREATE, {});
  assert.equal(room.name, 'dave의 방');
  assert.deepEqual(await dave.emitWithAck(EV.LOBBY_LEAVE), { ok: true });
  assert.equal(server.lobby.rooms.has(room.id), false);
});

test('같은 계정으로 다시 접속하면 이전 소켓이 끊긴다', async () => {
  const first = await connected(player('erin'));
  const replaced = once(first, EV.SESSION_REPLACED);
  await connected(player('erin'));
  await replaced;
});
