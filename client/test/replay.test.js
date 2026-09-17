// 리플레이: 파일 입출력, 재생·되감기, 전체 스냅샷의 베인 나무
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap } from '@rune/shared/map/maps/index.js';
import { TERRAIN } from '@rune/shared/map/grid.js';
import { CMD } from '@rune/shared/protocol.js';
import { World } from '../../server/src/game/World.js';
import { stepWorld } from '../../server/src/game/Simulation.js';
import { SnapshotFeed } from '../../server/src/game/sync/snapshot.js';
import { ClientWorld } from '../src/world/ClientWorld.js';
import { ReplayPlayer } from '../src/game/ReplayPlayer.js';
import { createRecorder, decodeReplay, encodeReplay, replayFileName } from '../src/game/replayFile.js';

const PLAYERS = [
  { uid: 'secret-uid-1', nickname: '새벽기사', slot: 0 },
  { uid: 'secret-uid-2', nickname: '폭풍', slot: 1 },
];
const MY_SLOT = 0;

/** 우리 팀에게 보이는 나무 한 칸 (안개 속에서 베인 나무는 볼 때까지 스냅샷에 오지 않는다) */
const visibleTree = (world) => world.tiles.findIndex((t, i) => t === TERRAIN.TREE && world.vision.isTileVisible(world.teamOf(MY_SLOT), i));

/** 서버를 돌려 녹화본을 만든다. 중간 틱의 서버 상태도 함께 돌려준다. */
function recordMatch({ ticks = 400, checkpointTick = 200 } = {}) {
  const world = new World(loadMap('duel01'), PLAYERS);
  const feed = new SnapshotFeed(world);
  const recorder = createRecorder({ mapId: 'duel01', players: PLAYERS, mySlot: MY_SLOT });
  let tree = -1;
  let checkpoint = null;

  for (let i = 0; i < ticks; i++) {
    const commands = [];
    if (i === 1) {
      const peasants = [...world.units.values()].filter((u) => u.owner === MY_SLOT);
      commands.push({ slot: MY_SLOT, cmd: { seq: 1, type: CMD.MOVE, unitIds: peasants.map((u) => u.id), x: 40, y: 60 } });
    }
    if (i === 250) {
      tree = visibleTree(world);
      world.fellTree(tree); // 중간 지점 뒤에 나무가 베인다
    }
    const { events } = stepWorld(world, commands);
    feed.update(world, events);
    const snap = i === 0 ? feed.full(world, MY_SLOT) : feed.snapshotFor(world, MY_SLOT);
    recorder.add(snap);
    if (world.tick === checkpointTick) checkpoint = captureServer(world);
  }
  return { world, recorder, tree, checkpoint, final: captureServer(world) };
}

// 스냅샷의 t는 한 틱을 진행한 뒤의 world.tick이다
const captureServer = (world) => ({
  tick: world.tick,
  units: new Map(
    [...world.units.values()]
      .filter((u) => world.isVisibleTo(world.teamOf(MY_SLOT), u)) // 녹화한 사람의 시점: 안개 속 적은 없다
      .map((u) => [u.id, { x: u.x, y: u.y, hp: Math.ceil(u.hp) }]),
  ),
  tiles: Uint8Array.from(world.tiles),
});

function assertMatches(client, expected) {
  assert.equal(client.units.size, expected.units.size);
  for (const [id, server] of expected.units) {
    const mirror = client.units.get(id);
    assert.ok(mirror, `유닛 ${id}이 없다`);
    assert.ok(Math.abs(mirror.x - server.x) < 0.04 && Math.abs(mirror.y - server.y) < 0.04, `유닛 ${id} 위치`);
    assert.equal(mirror.hp, server.hp);
  }
  assert.deepEqual(client.tiles, expected.tiles, '지형(베인 나무)이 같다');
}

test('리플레이 파일은 gzip으로 줄고, 다시 읽으면 그대로다 (uid는 담지 않는다)', async () => {
  const { recorder } = recordMatch({ ticks: 120 });
  recorder.finish({ winner: 0, reason: 'surrender', durationSec: 6 });
  const replay = recorder.build();

  assert.equal(JSON.stringify(replay).includes('secret-uid'), false, 'uid가 파일에 없다');
  const blob = await encodeReplay(replay);
  assert.ok(blob.size < JSON.stringify(replay).length / 3, `압축된다 (${blob.size}B)`);

  const back = await decodeReplay(blob);
  assert.equal(back.snapshots.length, 120);
  assert.deepEqual(back.players, [
    { nickname: '새벽기사', slot: 0, team: 0 },
    { nickname: '폭풍', slot: 1, team: 1 },
  ]);
  assert.equal(back.result.reason, 'surrender');
  assert.match(replayFileName(back), /^rune-\d{4}-\d{2}-\d{2}-\d{4}-새벽기사-vs-폭풍\.rcr$/);
});

test('리플레이가 아닌 파일은 거부한다', async () => {
  await assert.rejects(decodeReplay(new Blob(['{"hello":1}'])), /리플레이 파일이 아닙니다/);
  await assert.rejects(decodeReplay(new Blob(['not json'])), /읽을 수 없습니다/);
});

test('끝까지 재생하면 서버의 마지막 상태와 같고, 되감으면 그 시점으로 돌아간다', () => {
  const { recorder, checkpoint, final, tree } = recordMatch();
  const world = new ClientWorld(loadMap('duel01'), MY_SLOT);
  const player = new ReplayPlayer(recorder.build(), world);
  let rewinds = 0;
  player.onRewind = () => rewinds++;

  // 8배속으로 끝까지 (틱당 50ms × 400틱 = 20초 → 8배속 2.5초)
  player.setSpeed(8);
  for (let i = 0; i < 200 && !player.ended; i++) player.advance(1 / 60);
  assert.equal(player.ended, true);
  assert.equal(player.playing, false, '끝나면 멈춘다');
  assertMatches(world, final);
  assert.equal(world.tiles[tree], TERRAIN.GRASS, '나무가 베인 뒤다');

  // 중간으로 되감기: 베였던 나무도 되살아나야 한다
  player.seek(checkpoint.tick);
  assert.equal(rewinds, 1);
  assertMatches(world, checkpoint);
  assert.equal(world.tiles[tree], TERRAIN.TREE, '되감으면 나무가 돌아온다');
  assert.equal(world.effects.length, 0, '탐색 중에는 효과를 쌓지 않는다');

  // 앞으로 감기는 되감지 않고 이어서 적용한다
  player.seek(player.lastTick);
  assert.equal(rewinds, 1);
  assertMatches(world, final);
});

test('끝난 리플레이에서 재생을 누르면 처음부터 다시 튼다', () => {
  const { recorder } = recordMatch({ ticks: 60 });
  const player = new ReplayPlayer(recorder.build(), new ClientWorld(loadMap('duel01'), MY_SLOT));
  player.seek(player.lastTick);
  player.playing = false;
  player.togglePlay();
  assert.equal(player.playing, true);
  assert.equal(player.tick, player.firstTick);
});

test('전체 스냅샷에는 이미 베인 나무가 실린다 (재접속 화면에 나무가 되살아나지 않는다)', () => {
  const world = new World(loadMap('duel01'), PLAYERS);
  const feed = new SnapshotFeed(world);
  stepWorld(world);
  const tree = visibleTree(world);
  const hidden = world.tiles.findIndex((t, i) => t === TERRAIN.TREE && !world.vision.isTileVisible(0, i));
  world.fellTree(tree);
  world.fellTree(hidden);
  const { events } = stepWorld(world);
  feed.update(world, events);

  const full = feed.full(world, MY_SLOT);
  assert.deepEqual(full.felled, [tree], '안개 속에서 베인 나무는 아직 모른다');

  const client = new ClientWorld(loadMap('duel01'), MY_SLOT);
  let resets = 0;
  client.onTerrainReset = () => resets++;
  client.applySnapshot(full);
  assert.equal(client.tiles[tree], TERRAIN.GRASS);
  assert.equal(resets, 1, '지형을 다시 그리게 한다');
});
