// 서버 한 틱 벤치마크: 3대3 대규모 전투에서 틱 하나에 드는 시간을 단계별로 잰다.
// 실행: npm run bench -w server   (BENCH_SECONDS=120 처럼 길이를 바꿀 수 있다)
// 결과는 기계마다 다르다. 같은 기계에서 고치기 전후를 비교한다.
//
// 틱 하나 = 시뮬레이션(stepWorld) + 팀별 스냅샷(feed.update) + 플레이어별 스냅샷(snapshotFor)
//          + 직렬화(Socket.IO가 보낼 때 하는 JSON.stringify와 같은 일)
import { createHash } from 'node:crypto';
import { loadMap } from '@rune/shared/map/maps/index.js';
import { CMD, GAME_EVENT } from '@rune/shared/protocol.js';
import { World } from '../src/game/World.js';
import { stepWorld } from '../src/game/Simulation.js';
import { SnapshotFeed } from '../src/game/sync/snapshot.js';
import { sanitizeCommand } from '../src/game/systems/commands.js';

const SECONDS = Number(process.env.BENCH_SECONDS ?? 60);
const ARMY = ['pikeman', 'pikeman', 'longbowman', 'longbowman', 'knight', 'royal_guard', 'battlemage', 'scout_rider'];
const PER_PLAYER = 45; // 플레이어당 병력 (농노 별도)
const WORKERS = 12;
const TICKS = SECONDS * 20;

const players = Array.from({ length: 6 }, (_, slot) => ({ uid: `p${slot}`, nickname: `P${slot + 1}`, slot, team: slot % 2 }));
const world = new World(loadMap('team02'), players);
const feed = new SnapshotFeed(world);
const center = { x: world.width / 2, y: world.height / 2 };
if (process.env.BENCH_DETERMINISTIC) {
  // 경로 계산의 틱당 시간 예산(8ms)은 기계 사정에 따라 처리 개수가 달라져 결과가 흔들린다.
  // 고치기 전후의 결과(stateHash)를 비교할 때는 개수 예산만 쓴다.
  const processPathQueue = world.processPathQueue.bind(world);
  world.processPathQueue = (maxCount) => processPathQueue(maxCount, Infinity);
}
const keepOf = (slot) => [...world.buildings.values()].find((b) => b.owner === slot && b.type === 'keep');

let seq = 0;
let queue = [];
const order = (slot, cmd) => queue.push({ slot, cmd: sanitizeCommand({ seq: ++seq, unitIds: [], ...cmd }) });

/** 모자란 병력을 본진에서 채우고 모두 가운데로 공격 이동시킨다 (10초마다) */
function reinforce() {
  for (const player of world.players) {
    const keep = keepOf(player.slot);
    if (!keep) continue;
    const army = [...world.units.values()].filter((u) => u.owner === player.slot && u.type !== 'peasant');
    for (let i = army.length; i < PER_PLAYER; i++) army.push(world.spawnUnitNear(ARMY[i % ARMY.length], player.slot, keep, center));
    for (let i = 0; i < army.length; i += 30) {
      order(player.slot, { type: CMD.ATTACK_MOVE, unitIds: army.slice(i, i + 30).map((u) => u.id), x: center.x, y: center.y });
    }
  }
}

// 준비: 자원을 넉넉히, 농노 12기씩 가장 가까운 금광으로
for (const player of world.players) {
  Object.assign(player, { gold: 99999, wood: 99999, mana: 99999, age: 2 });
  const keep = keepOf(player.slot);
  const mine = [...world.mines.values()].sort(
    (a, b) => Math.hypot(a.x - keep.x, a.y - keep.y) - Math.hypot(b.x - keep.x, b.y - keep.y),
  )[0];
  const workers = [...world.units.values()].filter((u) => u.owner === player.slot);
  while (workers.length < WORKERS) workers.push(world.spawnUnitNear('peasant', player.slot, keep, center));
  order(player.slot, { type: CMD.GATHER, unitIds: workers.map((u) => u.id), mineId: mine.id });
}
reinforce();

const phases = { sim: [], team: [], player: [], serialize: [], total: [] };
// 최적화가 결과를 바꾸지 않았는지 보려고 해시한다 (BENCH_DETERMINISTIC일 때 같은 코드면 늘 같은 값)
// - simHash: 모든 틱의 이벤트와 끝 상태 (게임 진행이 같은가)
// - snapshotHash: 모든 틱에 나간 스냅샷 (보내는 내용이 같은가 — 형식을 바꾸면 달라진다)
const simDigest = createHash('sha256');
const snapshotDigest = createHash('sha256');
const counts = { attacks: 0, deaths: 0, bytes: 0, messages: 0, units: 0 };

for (let tick = 0; tick < TICKS; tick++) {
  if (tick > 0 && tick % 200 === 0) reinforce();
  const commands = queue;
  queue = [];

  const t0 = performance.now();
  const { events } = stepWorld(world, commands);
  const t1 = performance.now();
  feed.update(world, events);
  const t2 = performance.now();
  const snaps = players.map((p) => feed.snapshotFor(world, p.slot));
  const t3 = performance.now();
  let bytes = 0;
  for (const snap of snaps) {
    const json = JSON.stringify(snap);
    bytes += json.length;
    snapshotDigest.update(json);
  }
  const t4 = performance.now();

  phases.sim.push(t1 - t0);
  phases.team.push(t2 - t1);
  phases.player.push(t3 - t2);
  phases.serialize.push(t4 - t3);
  phases.total.push(t4 - t0);
  counts.bytes += bytes;
  counts.messages += snaps.length;
  counts.units += world.units.size;
  simDigest.update(JSON.stringify(events));
  for (const event of events) {
    if (event[0] === GAME_EVENT.ATTACK) counts.attacks++;
    else if (event[0] === GAME_EVENT.UNIT_DIED) counts.deaths++;
  }
}

const round = (value) => Math.round(value * 1000) / 1000;
function stats(times, warmup = 100) {
  const sample = times.slice(warmup); // JIT가 자리 잡기 전의 처음 5초는 뺀다
  const sorted = [...sample].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const avg = sample.reduce((sum, t) => sum + t, 0) / sample.length;
  return { avg: round(avg), p50: round(at(0.5)), p99: round(at(0.99)), max: round(sorted.at(-1)) };
}

const total = stats(phases.total);
console.log(
  JSON.stringify(
    {
      scenario: `3대3 team02 · 플레이어당 병력 ${PER_PLAYER} + 농노 ${WORKERS} · ${SECONDS}초`,
      battle: {
        avgUnits: Math.round(counts.units / TICKS),
        attacksPerSec: Math.round(counts.attacks / SECONDS),
        deaths: counts.deaths,
      },
      tickMs: total,
      phaseAvgMs: Object.fromEntries(Object.entries(phases).map(([name, times]) => [name, stats(times).avg])),
      budgetUsedPercent: round((total.avg / 50) * 100),
      snapshotBytesPerPlayerPerTick: Math.round(counts.bytes / counts.messages),
      heapMB: Math.round(process.memoryUsage().heapUsed / 1048576),
      simHash: simDigest.update(JSON.stringify([...world.units.values()].map((u) => [u.id, u.x, u.y, u.hp]))).digest('hex').slice(0, 16),
      snapshotHash: snapshotDigest.digest('hex').slice(0, 16),
    },
    null,
    2,
  ),
);
