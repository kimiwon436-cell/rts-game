import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io as connect } from 'socket.io-client';
import { CMD, EV, ERR, ROOM_STATUS, VICTORY_REASON } from '@rune/shared/protocol.js';
import { createGameServer } from '../src/app.js';

let server;
let url;
const sockets = [];

before(async () => {
  server = createGameServer({
    authMode: 'dev',
    clientOrigins: ['http://localhost'],
    countdownSec: 0.05,
    reconnectGraceSec: 0.4,
  });
  server.httpServer.listen(0);
  await once(server.httpServer, 'listening');
  url = `http://localhost:${server.httpServer.address().port}`;
});

after(async () => {
  sockets.forEach((s) => s.close());
  await server.close();
});

/**
 * 개발용 토큰으로 접속한다. 접속하자마자 오는 프로필 알림을 놓치지 않게 바로 기다리기 시작하고,
 * 프로필이 없으면(처음 접속) 이름으로 만든다.
 */
function player(name, token = `dev:${name}-test-0001`) {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, auth: { token } });
  socket.profileReady = once(socket, EV.SESSION_PROFILE).then(async ([profile]) => {
    if (profile) return profile;
    const res = await socket.emitWithAck(EV.PROFILE_CREATE, { nickname: name });
    if (!res.ok) throw new Error(`프로필을 만들지 못했습니다: ${res.error}`);
    return res.profile;
  });
  socket.profileReady.catch(() => {});
  sockets.push(socket);
  return socket;
}

/** 접속하고 프로필까지 준비되면 (로비 이벤트를 쓸 수 있으면) 돌려준다 */
async function connected(socket) {
  if (!socket.connected) await once(socket, 'connect');
  await socket.profileReady;
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
  assert.equal(created.room.players[0].team, 0);
  assert.equal(created.room.mode, '1v1');

  const list = await bob.emitWithAck(EV.LOBBY_LIST);
  assert.ok(list.rooms.some((r) => r.id === created.room.id && r.players === 1));

  const joined = await bob.emitWithAck(EV.LOBBY_JOIN, { roomId: created.room.id });
  assert.equal(joined.ok, true);
  assert.deepEqual(joined.room.players.map((p) => p.team), [0, 1], '사람이 적은 팀으로 들어간다');

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

  // 첫 스냅샷은 전체 상태(키프레임)다: 농노 4기씩, 영주관 1채씩, 시작 금 200
  const [snap] = await once(alice, EV.GAME_SNAP);
  assert.equal(snap.full, true);
  assert.equal(snap.addU.length, 8);
  assert.equal(snap.addB.length, 2);
  assert.equal(snap.me[0], 200);

  // 그 다음부터는 바뀐 것만 오는 델타다 (새로 생긴 유닛이 없으면 addU는 아예 오지 않는다)
  const [next] = await once(alice, EV.GAME_SNAP);
  assert.equal(next.full, undefined);
  assert.equal(next.addU, undefined);
  assert.ok(next.t > snap.t);
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

test('항복하면 두 플레이어에게 결과가 가고, 방은 다시 대기 상태가 된다', async () => {
  const frank = await connected(player('frank'));
  const gina = await connected(player('gina'));
  const { room } = await frank.emitWithAck(EV.LOBBY_CREATE, { name: '항복 시험' });
  await gina.emitWithAck(EV.LOBBY_JOIN, { roomId: room.id });

  const started = Promise.all([once(frank, EV.GAME_START), once(gina, EV.GAME_START)]);
  await frank.emitWithAck(EV.LOBBY_READY, { ready: true });
  await gina.emitWithAck(EV.LOBBY_READY, { ready: true });
  const [[start]] = await started;

  const ended = Promise.all([once(frank, EV.GAME_END), once(gina, EV.GAME_END)]);
  frank.emit(EV.GAME_CMD, { seq: 1, type: CMD.SURRENDER });
  const [[resultA], [resultB]] = await ended;

  assert.equal(resultA.winnerTeam, start.players.find((p) => p.nickname === 'gina').team);
  assert.equal(resultA.reason, VICTORY_REASON.SURRENDER);
  assert.deepEqual(resultA, resultB);
  const after = server.lobby.rooms.get(room.id);
  assert.equal(after.status, ROOM_STATUS.WAITING);
  assert.ok(after.players.every((p) => !p.ready));
});

/** 조건에 맞는 이벤트가 올 때까지 기다린다 (중간에 다른 브로드캐스트가 섞여 온다) */
function waitFor(socket, event, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`${event}를 기다리다 시간이 지났습니다`));
    }, timeoutMs);
    socket.on(event, handler);
  });
}

/** 두 사람이 한 방에서 경기를 시작한다. [소켓들, 방, 시작 정보]를 돌려준다 */
async function startMatch(nameA, nameB, roomName) {
  const a = await connected(player(nameA));
  const b = await connected(player(nameB));
  const { room } = await a.emitWithAck(EV.LOBBY_CREATE, { name: roomName });
  await b.emitWithAck(EV.LOBBY_JOIN, { roomId: room.id });
  const started = Promise.all([once(a, EV.GAME_START), once(b, EV.GAME_START)]);
  await a.emitWithAck(EV.LOBBY_READY, { ready: true });
  await b.emitWithAck(EV.LOBBY_READY, { ready: true });
  const [[start]] = await started;
  return { a, b, room, start };
}

test('경기 중에 끊겨도 유예 시간 안에 돌아오면 이어서 한다', async () => {
  const { a: hugo, b: iris, room } = await startMatch('hugo', 'iris', '재접속 시험');

  const offline = (d) => d?.players.find((p) => p.nickname === 'hugo')?.connected === false;
  const sawOffline = waitFor(iris, EV.LOBBY_ROOM, offline);
  hugo.disconnect();

  await sawOffline;
  assert.equal(server.lobby.rooms.get(room.id).status, ROOM_STATUS.PLAYING, '한 명이 끊겨도 경기는 계속된다');

  // 같은 계정으로 다시 접속한다
  const online = waitFor(iris, EV.LOBBY_ROOM, (d) => d?.players.find((p) => p.nickname === 'hugo')?.connected === true);
  const back = player('hugo');
  const [resume] = await once(back, EV.GAME_RESUME);
  assert.equal(resume.roomId, room.id);
  assert.equal(resume.mapId, 'duel01');

  // 돌아온 사람은 전체 상태를 다시 받는다
  const [snap] = await once(back, EV.GAME_SNAP);
  assert.equal(snap.full, true);
  assert.equal(snap.addU.length, 8);
  assert.ok(snap.t > 0, '경기는 그동안 계속 돌고 있었다');

  await online;

  back.emit(EV.GAME_CMD, { seq: 1, type: CMD.SURRENDER });
  await Promise.all([once(back, EV.GAME_END), once(iris, EV.GAME_END)]);
});

test('유예 시간 안에 돌아오지 않으면 진다', async () => {
  const { a: jack, b: kate, room } = await startMatch('jack', 'kate', '유예 시험');

  const ended = once(kate, EV.GAME_END);
  jack.disconnect();
  const [result] = await ended;

  assert.equal(result.reason, VICTORY_REASON.LEFT);
  assert.equal(result.winnerTeam, 1, '늦게 들어온 kate가 팀 1');
  assert.equal(server.lobby.rooms.get(room.id).players.length, 1);
});

test('2대2 방: 사람이 적은 팀으로 들어가고, 방장만 설정을 바꾸며, 2명씩 차고 모두 준비하면 시작한다', async () => {
  const [lina, mora, nell, otto] = await Promise.all(['lina', 'mora', 'nell', 'otto'].map((n) => connected(player(n))));
  const { room } = await lina.emitWithAck(EV.LOBBY_CREATE, { name: '팀전', mode: '2v2' });
  assert.equal(room.maxPlayers, 4);
  assert.equal(room.mapId, 'team01', '2대2 기본 맵');

  for (const socket of [mora, nell, otto]) await socket.emitWithAck(EV.LOBBY_JOIN, { roomId: room.id });
  const detail = server.lobby.detail(server.lobby.rooms.get(room.id));
  assert.deepEqual(
    Object.fromEntries(detail.players.map((p) => [p.nickname, p.team])),
    { lina: 0, mora: 1, nell: 0, otto: 1 },
  );

  assert.deepEqual(await mora.emitWithAck(EV.LOBBY_SETTINGS, { mapId: 'team01' }), { ok: false, error: ERR.NOT_HOST });
  assert.equal((await lina.emitWithAck(EV.LOBBY_SETTINGS, { mode: '1v1' })).error, ERR.ROOM_FULL, '4명인데 1대1로 줄일 수 없다');
  assert.equal((await lina.emitWithAck(EV.LOBBY_SETTINGS, { mapId: 'duel01' })).error, ERR.INVALID_SETTINGS, '모드에 맞지 않는 맵');
  assert.equal((await nell.emitWithAck(EV.LOBBY_TEAM, { team: 1 })).error, ERR.TEAM_FULL);

  const starts = Promise.all([lina, mora, nell, otto].map((s) => once(s, EV.GAME_START)));
  for (const socket of [lina, mora, nell, otto]) await socket.emitWithAck(EV.LOBBY_READY, { ready: true });
  const [[start]] = await starts;
  assert.equal(start.mode, '2v2');
  assert.deepEqual(
    start.players.map((p) => [p.slot, p.team, p.nickname]),
    [
      [0, 0, 'lina'],
      [1, 1, 'mora'],
      [2, 0, 'nell'],
      [3, 1, 'otto'],
    ],
    '짝수 슬롯은 팀 0, 먼저 들어온 사람이 앞 슬롯',
  );

  // 팀 1이 한 명만 항복하면 계속되고, 둘 다 항복해야 끝난다
  const ended = once(lina, EV.GAME_END);
  mora.emit(EV.GAME_CMD, { seq: 1, type: CMD.SURRENDER });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(server.lobby.rooms.get(room.id).status, ROOM_STATUS.PLAYING);
  otto.emit(EV.GAME_CMD, { seq: 1, type: CMD.SURRENDER });
  const [result] = await ended;
  assert.equal(result.winnerTeam, 0);
  assert.equal(result.players.length, 4);
});
