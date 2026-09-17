// 팀원에게 자원 보내기: 같은 팀에게만, 수수료를 떼고 도착하고, 상대 팀은 알 수 없다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap } from '@rune/shared/map/maps/index.js';
import { TRIBUTE, tributeReceived } from '@rune/shared/data/economy.js';
import { CMD, EV, GAME_EVENT, REJECT } from '@rune/shared/protocol.js';
import { World } from '../src/game/World.js';
import { stepWorld } from '../src/game/Simulation.js';
import { Match } from '../src/game/Match.js';
import { sanitizeCommand } from '../src/game/systems/commands.js';
import { defeatPlayer } from '../src/game/systems/victory.js';

const PLAYERS_2V2 = [
  { uid: 'a', nickname: 'A', slot: 0, team: 0 },
  { uid: 'b', nickname: 'B', slot: 1, team: 1 },
  { uid: 'c', nickname: 'C', slot: 2, team: 0 },
  { uid: 'd', nickname: 'D', slot: 3, team: 1 },
];
let seq = 0;
const send = (world, slot, fields) =>
  stepWorld(world, [{ slot, cmd: sanitizeCommand({ seq: ++seq, type: CMD.SEND_RESOURCES, ...fields }) }]);

test('팀원에게 보내면 보낸 만큼 줄고, 수수료를 뗀 만큼 도착한다', () => {
  const world = new World(loadMap('team01'), PLAYERS_2V2);
  world.players[0].gold = 1000;
  world.players[2].gold = 50;

  const { rejects, events } = send(world, 0, { to: 2, resource: 'gold', amount: 500 });
  assert.deepEqual(rejects, []);
  assert.equal(tributeReceived(500), 450, `수수료 ${TRIBUTE.fee * 100}%`);
  assert.equal(world.players[0].gold, 500);
  assert.equal(world.players[2].gold, 500);
  assert.deepEqual(
    events.find((e) => e[0] === GAME_EVENT.RESOURCES_SENT),
    [GAME_EVENT.RESOURCES_SENT, 0, 2, 0, 500, 450],
  );
  assert.equal(world.players[1].gold, 200, '상대의 자원은 그대로다');
});

test('상대·자신·쓰러진 팀원에게는 못 보내고, 가진 것보다 많이 보낼 수 없다', () => {
  const world = new World(loadMap('team01'), PLAYERS_2V2);
  const reason = (slot, fields) => send(world, slot, fields).rejects[0]?.reason ?? null;

  assert.equal(reason(0, { to: 1, resource: 'gold', amount: 100 }), REJECT.INVALID_TARGET, '상대 팀');
  assert.equal(reason(0, { to: 0, resource: 'gold', amount: 100 }), REJECT.INVALID_TARGET, '자기 자신');
  assert.equal(reason(0, { to: 9, resource: 'gold', amount: 100 }), REJECT.INVALID_TARGET, '없는 슬롯');
  assert.equal(reason(0, { resource: 'gold', amount: 100 }), REJECT.INVALID_TARGET, '받는 사람 없음');
  assert.equal(reason(0, { to: 2, resource: 'wood', amount: 500 }), REJECT.NOT_ENOUGH_WOOD, '목재는 200뿐');
  assert.equal(reason(0, { to: 2, resource: 'pop', amount: 10 }), REJECT.INVALID, '자원이 아닌 것');
  assert.equal(reason(0, { to: 2, resource: 'gold', amount: 0 }), REJECT.INVALID);
  assert.equal(reason(0, { to: 2, resource: 'gold', amount: -50 }), REJECT.INVALID);
  assert.equal(reason(0, { to: 2, resource: 'gold', amount: TRIBUTE.max + 1 }), REJECT.INVALID);
  assert.equal(sanitizeCommand({ seq: 1, type: CMD.SEND_RESOURCES, to: 2, resource: 'gold', amount: 1.5 }), null, '소수는 모양부터 틀렸다');
  assert.deepEqual([world.players[0].gold, world.players[0].wood, world.players[2].gold], [200, 200, 200], '거부된 명령은 아무것도 옮기지 않는다');

  defeatPlayer(world, world.players[2], 'surrender');
  assert.equal(reason(0, { to: 2, resource: 'gold', amount: 100 }), REJECT.INVALID_TARGET, '쓰러진 팀원');
  assert.equal(reason(2, { to: 0, resource: 'gold', amount: 100 }), REJECT.INVALID_TARGET, '쓰러진 사람은 보내지도 못한다');

  const duel = new World(loadMap('duel01'), [
    { uid: 'x', nickname: 'X', slot: 0 },
    { uid: 'y', nickname: 'Y', slot: 1 },
  ]);
  assert.equal(send(duel, 0, { to: 1, resource: 'gold', amount: 100 }).rejects[0]?.reason, REJECT.INVALID_TARGET, '1대1에는 팀원이 없다');
});

test('보낸 기록과 팀원 자원은 같은 팀에게만 간다', () => {
  const inbox = new Map(PLAYERS_2V2.map((p) => [p.uid, []]));
  const match = new Match({
    roomId: 'r',
    mapId: 'team01',
    mode: '2v2',
    players: PLAYERS_2V2,
    getSocket: (uid) => ({
      emit: (event, payload) => {
        if (event === EV.GAME_SNAP) inbox.get(uid).push(payload);
      },
    }),
  });
  match.step(); // 첫 틱: 모두 전체 상태를 받는다
  assert.deepEqual(inbox.get('a')[0].allies, [[2, 200, 200, 0]], '전체 상태에 팀원 자원이 들어 있다');
  assert.deepEqual(inbox.get('d')[0].allies, [[1, 200, 200, 0]]);

  match.enqueue('a', { seq: 1, type: CMD.SEND_RESOURCES, to: 2, resource: 'wood', amount: 100 });
  for (let i = 0; i < 20; i++) match.step();

  const sentEvents = (uid) => inbox.get(uid).flatMap((snap) => snap.ev ?? []).filter((e) => e[0] === GAME_EVENT.RESOURCES_SENT);
  assert.equal(sentEvents('a').length, 1);
  assert.equal(sentEvents('c').length, 1, '받은 팀원');
  assert.equal(sentEvents('b').length, 0, '상대 팀은 모른다');
  assert.equal(sentEvents('d').length, 0);

  const lastAllies = (uid) => inbox.get(uid).filter((snap) => snap.allies).at(-1).allies;
  assert.deepEqual(lastAllies('a'), [[2, 200, 290, 0]], '0.5초 안에 팀원 자원이 새로 온다');
  assert.deepEqual(lastAllies('c'), [[0, 200, 100, 0]]);
  for (const uid of ['b', 'd']) {
    for (const snap of inbox.get(uid)) for (const [slot] of snap.allies ?? []) assert.equal(slot % 2, 1, '상대 팀 자원은 오지 않는다');
  }
});

test('1대1 스냅샷에는 팀원 자원 항목이 없다', () => {
  const players = [
    { uid: 'x', nickname: 'X', slot: 0 },
    { uid: 'y', nickname: 'Y', slot: 1 },
  ];
  const snaps = [];
  const match = new Match({ roomId: 'r', mapId: 'duel01', players, getSocket: () => ({ emit: (_e, payload) => snaps.push(payload) }) });
  for (let i = 0; i < 21; i++) match.step();
  assert.ok(snaps.every((snap) => !('allies' in snap)));
});
