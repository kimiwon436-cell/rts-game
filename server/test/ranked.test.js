// 랭킹전: 대기열 → 매칭 → 자동 시작 → 레이팅 반영 → 순위표
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io as connect } from 'socket.io-client';
import { CMD, EV, ERR } from '@rune/shared/protocol.js';
import { createGameServer } from '../src/app.js';

let server;
let url;
const sockets = [];

before(async () => {
  server = createGameServer({
    authMode: 'dev',
    clientOrigins: ['http://localhost'],
    countdownSec: 0.4,
    matchIntervalMs: 30,
    random: () => 0, // 맵을 늘 첫 번째로
  });
  server.httpServer.listen(0);
  await once(server.httpServer, 'listening');
  url = `http://localhost:${server.httpServer.address().port}`;
});

after(async () => {
  sockets.forEach((s) => s.close());
  await server.close();
});

async function player(name) {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, auth: { token: `dev:${name}-ranked-01` } });
  sockets.push(socket);
  const [profile] = await once(socket, EV.SESSION_PROFILE);
  if (!profile) {
    const res = await socket.emitWithAck(EV.PROFILE_CREATE, { nickname: name });
    assert.equal(res.ok, true, `${name} 프로필`);
  }
  return socket;
}

/** 조건에 맞는 이벤트가 올 때까지 */
const waitFor = (socket, event, predicate = () => true, timeoutMs = 4000) =>
  new Promise((resolve, reject) => {
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

test('1대1 랭킹전: 둘이 대기열에 들어가면 매칭되어 자동으로 시작하고, 끝나면 레이팅이 바뀐다', async () => {
  const ruby = await player('ruby');
  const saga = await player('saga');

  const found = Promise.all([waitFor(ruby, EV.RANKED_FOUND), waitFor(saga, EV.RANKED_FOUND)]);
  const started = Promise.all([waitFor(ruby, EV.GAME_START), waitFor(saga, EV.GAME_START)]);
  assert.equal((await ruby.emitWithAck(EV.RANKED_JOIN, { mode: '1v1' })).ok, true);
  assert.equal((await saga.emitWithAck(EV.RANKED_JOIN, { mode: '1v1' })).ok, true);

  const [foundRuby] = await found;
  assert.deepEqual(foundRuby, { mode: '1v1', mapId: 'duel01' });
  assert.equal(server.lobby.summaries().length, 0, '랭킹전 방은 목록에 보이지 않는다');
  const [start] = await started;
  assert.equal(start.ranked, true);

  // 랭킹전 방에는 끼어들 수 없다
  const peeker = await player('peek');
  assert.deepEqual(await peeker.emitWithAck(EV.LOBBY_JOIN, { roomId: start.roomId }), { ok: false, error: ERR.ROOM_NOT_WAITING });

  const results = Promise.all([waitFor(ruby, EV.RANKED_RESULT), waitFor(saga, EV.RANKED_RESULT)]);
  const rubyProfile = waitFor(ruby, EV.SESSION_PROFILE, (p) => p?.ratings['1v1'] !== 1000);
  saga.emit(EV.GAME_CMD, { seq: 1, type: CMD.SURRENDER });
  const [result] = await results;
  const byName = Object.fromEntries(result.changes.map((c) => [c.nickname, c]));
  assert.deepEqual([byName.ruby.after, byName.ruby.delta, byName.ruby.won], [1024, 24, true], '처음 10판은 K=48');
  assert.deepEqual([byName.saga.after, byName.saga.delta], [976, -24]);
  const updated = await rubyProfile;
  assert.equal(updated.ratings['1v1'], 1024);
  assert.deepEqual(updated.ranked['1v1'], { wins: 1, losses: 0 });

  // 랭킹전은 재대결 없이 방이 닫힌다
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(server.lobby.roomOfUid.has('dev:ruby-ranked-01'), false);

  const board = await ruby.emitWithAck(EV.RANKED_LEADERBOARD, { mode: '1v1' });
  assert.equal(board.ok, true);
  assert.deepEqual(board.entries.slice(0, 2).map((e) => [e.rank, e.nickname, e.rating, e.me]), [
    [1, 'ruby', 1024, true],
    [2, 'peek', 1000, false],
  ]);
  const sagaBoard = await saga.emitWithAck(EV.RANKED_LEADERBOARD, { mode: '1v1' });
  assert.deepEqual(sagaBoard.me, { rank: 3, rating: 976, wins: 0, losses: 1 });
});

test('방에 있으면 대기열에 못 들어가고, 방을 만들면 대기열에서 빠진다', async () => {
  const tony = await player('tony');
  const umi = await player('umi');
  await tony.emitWithAck(EV.LOBBY_CREATE, { name: '연습' });
  assert.deepEqual(await tony.emitWithAck(EV.RANKED_JOIN, { mode: '1v1' }), { ok: false, error: ERR.IN_ROOM });

  assert.equal((await umi.emitWithAck(EV.RANKED_JOIN, { mode: '2v2' })).ok, true);
  const left = waitFor(umi, EV.RANKED_STATUS, (s) => s === null);
  await umi.emitWithAck(EV.LOBBY_CREATE, { name: '다른 방' });
  await left;
  assert.equal(server.matchmaker.entryOf.has(`dev:umi-ranked-01`), false);
});

test('시작 전에 한 명이 나가면 매칭이 깨지고, 남은 사람은 다시 대기열로 돌아간다', async () => {
  const vera = await player('vera');
  const wren = await player('wren');
  const both = Promise.all([waitFor(vera, EV.LOBBY_ROOM, (r) => r?.ranked), waitFor(wren, EV.LOBBY_ROOM, (r) => r?.ranked)]);
  await vera.emitWithAck(EV.RANKED_JOIN, { mode: '1v1' });
  await wren.emitWithAck(EV.RANKED_JOIN, { mode: '1v1' });
  await both;

  const cancelled = waitFor(vera, EV.RANKED_STATUS, (s) => s?.cancelled);
  const requeued = waitFor(vera, EV.RANKED_STATUS, (s) => s && !s.cancelled);
  await wren.emitWithAck(EV.LOBBY_LEAVE); // 카운트다운 중에 나간다
  await cancelled;
  await requeued;
  assert.equal(server.matchmaker.entryOf.get('dev:vera-ranked-01')?.mode, '1v1');
  assert.equal(server.lobby.roomOfUid.has('dev:vera-ranked-01'), false);
});

test('2대2 랭킹전: 네 명을 레이팅 합이 같도록 두 팀으로 나눈다', async () => {
  const names = ['xena', 'yuki', 'zara', 'able'];
  const sockets4 = [];
  for (const name of names) sockets4.push(await player(name));
  const ratings = { xena: 1000, yuki: 1040, zara: 1080, able: 1120 };
  for (const name of names) server.profiles.users.get(`dev:${name}-ranked-01`).ratings['2v2'] = ratings[name];
  // 소켓의 프로필은 접속할 때 읽은 값이라, 바꾼 레이팅이 대기열에 반영되도록 다시 접속한다
  for (const socket of sockets4) socket.close();
  const fresh = [];
  for (const name of names) fresh.push(await player(name));

  const starts = Promise.all(fresh.map((s) => waitFor(s, EV.GAME_START)));
  for (const socket of fresh) await socket.emitWithAck(EV.RANKED_JOIN, { mode: '2v2' });
  const [start] = await starts;
  assert.equal(start.mode, '2v2');
  assert.equal(start.mapId, 'team01');
  const teamOf = Object.fromEntries(start.players.map((p) => [p.nickname, p.team]));
  const sum = (team) => names.filter((n) => teamOf[n] === team).reduce((s, n) => s + ratings[n], 0);
  assert.equal(sum(0), sum(1), `팀 레이팅 합이 같다 (${sum(0)} 대 ${sum(1)})`);

  const ended = waitFor(fresh[0], EV.GAME_END);
  for (const [i, name] of names.entries()) {
    if (teamOf[name] === 1) fresh[i].emit(EV.GAME_CMD, { seq: 1, type: CMD.SURRENDER });
  }
  assert.equal((await ended).winnerTeam, 0);
});
