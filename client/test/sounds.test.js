// 사운드: 소리 목록(무엇을 넣을지)과 게임 사건 → 소리 연결. 소리 엔진은 가짜로 바꿔 무엇을 냈는지만 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNITS, UNIT_TYPES } from '@rune/shared/data/units.js';
import { BUILDINGS, BUILDING_TYPES } from '@rune/shared/data/buildings.js';
import { TERRAIN } from '@rune/shared/map/grid.js';
import { CMD, GAME_EVENT, REJECT } from '@rune/shared/protocol.js';
import { World } from '../../server/src/game/World.js';
import { stepWorld } from '../../server/src/game/Simulation.js';
import { SnapshotFeed } from '../../server/src/game/sync/snapshot.js';
import { ClientWorld } from '../src/world/ClientWorld.js';
import { ALARM_CASES, CHANNELS, SOUNDS, attackSoundOf, soundIdOf } from '../src/audio/soundList.js';
import { createGameSounds } from '../src/audio/gameSounds.js';
import { scanSounds } from '../scripts/check-sounds.mjs';

const SOUND_ROOT = fileURLToPath(new URL('../src/assets/sounds/', import.meta.url));
const DOC = fileURLToPath(new URL('../../docs/SOUNDS.md', import.meta.url));

/** 풀밭뿐인 시험 맵 (48×32) */
function flatMap() {
  const W = 48;
  const H = 32;
  return {
    id: 'sound-test',
    width: W,
    height: H,
    tiles: new Uint8Array(W * H).fill(TERRAIN.GRASS),
    starts: [
      { slot: 0, team: 0, keep: { x: 3, y: 3, w: 4, h: 4 } },
      { slot: 1, team: 1, keep: { x: 40, y: 24, w: 4, h: 4 } },
    ],
    goldMines: [],
    wells: [],
  };
}
const DUEL = [
  { uid: 'a', nickname: 'A', slot: 0, team: 0 },
  { uid: 'b', nickname: 'B', slot: 1, team: 1 },
];
const TEAMS = [
  { uid: 'a', nickname: 'A', slot: 0, team: 0 },
  { uid: 'b', nickname: 'B', slot: 1, team: 1 },
  { uid: 'c', nickname: 'C', slot: 2, team: 0 },
  { uid: 'd', nickname: 'D', slot: 3, team: 1 },
];

/** 무엇을 냈는지 적어 두는 가짜 소리 엔진. busy면 알람을 내지 못한다 (다른 알람이 나는 중) */
function fakeEngine() {
  const log = { play: [], alarm: [], music: [], loops: new Map(), loopIds: new Set() };
  const engine = {
    log,
    busy: false,
    play: (id, options = {}) => log.play.push({ id, ...options }),
    alarm: (id, options = {}) => {
      if (engine.busy) return false;
      log.alarm.push({ id, ...options });
      return true;
    },
    setLoops: (loops) => {
      log.loops = loops;
      for (const loop of loops.values()) log.loopIds.add(loop.id);
    },
    setMusic: (state) => {
      if (log.music.at(-1) !== state) log.music.push(state);
    },
    setView: () => {},
  };
  return engine;
}
const reasons = (engine) => engine.log.alarm.map((a) => a.reason);

/** 손으로 채운 클라이언트 월드와 소리 (시계는 손으로 돌린다) */
function handMade({ players = DUEL, alarms = true } = {}) {
  const world = new ClientWorld(flatMap(), 0, players);
  const engine = fakeEngine();
  const clock = { t: 100000 };
  const sounds = createGameSounds({ engine, world, alarms, now: () => clock.t });
  const unit = (id, type, owner, x, y) => {
    const u = { id, type, owner, x, y, drawX: x, drawY: y };
    world.units.set(id, u);
    return u;
  };
  const building = (id, type, owner, x, y, extra = {}) => {
    const b = { id, type, owner, x, y, size: BUILDINGS[type].size, complete: true, progress: 1, ...extra };
    world.buildings.set(id, b);
    return b;
  };
  /** 화면: 왼쪽 위 (0,0)–(16,12) */
  const view = { x: 0, y: 0, w: 16, h: 12 };
  return { world, engine, clock, sounds, unit, building, view };
}

// ---------- 소리 목록 ----------

test('소리 목록: 로비·게임 음악, 공격하는 유닛마다 공격 소리, 짓는 중·건설 완료·알람은 하나씩', () => {
  const attackers = UNIT_TYPES.filter((type) => UNITS[type].attack);
  for (const type of UNIT_TYPES) {
    assert.equal(Boolean(SOUNDS[`attack/${type}`]), Boolean(UNITS[type].attack), `${type} 공격 소리`);
  }
  for (const type of BUILDING_TYPES) {
    // 공격하는 건물은 유닛 공격 소리를 빌려 쓴다
    if (BUILDINGS[type].attack) assert.ok(SOUNDS[attackSoundOf(type)], `${type} 공격 소리 (${attackSoundOf(type)})`);
  }
  assert.ok(SOUNDS['bgm/lobby'].loop && SOUNDS['bgm/game'].loop, '음악은 되풀이한다');
  assert.ok(SOUNDS.construction.loop, '짓는 중 소리는 되풀이한다');
  assert.ok(SOUNDS.complete && !SOUNDS.complete.loop);
  assert.equal(SOUNDS.alarm.channel, 'alarm');
  assert.equal(Object.keys(SOUNDS).length, 2 + attackers.length + 3, '음악 2 + 공격 + 짓는 중·건설 완료·알람');
  for (const [kind, alarmCase] of Object.entries(ALARM_CASES)) {
    assert.ok(alarmCase.when && alarmCase.gap >= 0 && [1, 2, 3].includes(alarmCase.priority), kind);
  }
});

test('소리 이름은 파일 이름 규칙을 따르고, 문서와 폴더가 목록과 맞다', () => {
  const doc = readFileSync(DOC, 'utf8');
  for (const sound of Object.values(SOUNDS)) {
    assert.match(sound.id, /^([a-z0-9_]+\/)?[a-z0-9_]+$/, `${sound.id}: 영어 소문자·숫자·_ 만`);
    assert.doesNotMatch(sound.id, /_\d+$/, `${sound.id}: 끝의 _숫자는 여러 판 번호와 헷갈린다`);
    assert.ok(CHANNELS[sound.channel], `${sound.id}: 갈래 ${sound.channel}`);
    assert.ok(sound.when && sound.sound, `${sound.id}: 설명`);
    assert.ok(doc.includes(`\`${sound.id}.mp3\``), `${sound.id}가 docs/SOUNDS.md에 없다 — npm run sounds:doc -w client`);
  }
  for (const folder of ['bgm', 'attack']) {
    assert.ok(existsSync(join(SOUND_ROOT, folder, '.gitkeep')), `${folder}/ 폴더 — npm run sounds:doc -w client`);
  }
});

test('파일 이름에서 소리 id를 읽는다: 여러 판 번호와 확장자를 떼어 낸다', () => {
  assert.equal(soundIdOf('attack/pikeman.mp3'), 'attack/pikeman');
  assert.equal(soundIdOf('attack/pikeman_2.mp3'), 'attack/pikeman');
  assert.equal(soundIdOf('attack/royal_guard.mp3'), 'attack/royal_guard');
  assert.equal(soundIdOf('bgm\\game.MP3'), 'bgm/game');
  assert.equal(soundIdOf('alarm.mp3'), 'alarm');
  assert.equal(soundIdOf('construction_1.ogg'), 'construction');
  assert.equal(soundIdOf('notes.txt'), null);
});

test('파일 점검: 있는 소리를 세고, 목록에 없거나 형식이 틀린 파일을 알린다', () => {
  const root = mkdtempSync(join(tmpdir(), 'rune-sounds-'));
  const put = (path, bytes = 1024) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), Buffer.alloc(bytes));
  };
  try {
    put('attack/pikeman_1.mp3');
    put('attack/pikeman_2.mp3');
    put('bgm/lobby.ogg');
    put('complete.mp3', 400 * 1024);
    put('attack/pikemen.mp3'); // 오타
    put('notes.txt');
    put('README.md');
    const { found, unknown, warnings } = scanSounds(root);
    assert.equal(found.get('attack/pikeman'), 2);
    assert.equal(found.get('bgm/lobby'), 1);
    assert.equal(found.get('complete'), 1);
    assert.equal(found.size, 3);
    assert.equal(unknown.length, 2);
    assert.ok(unknown.some((line) => line.startsWith('attack/pikemen.mp3')));
    assert.ok(unknown.some((line) => line.startsWith('notes.txt')));
    assert.ok(warnings.some((line) => line.startsWith('bgm/lobby.ogg')), '.mp3가 아니다');
    assert.ok(warnings.some((line) => line.startsWith('complete.mp3')), '너무 크다');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- 사건 → 소리 ----------

test('경기 화면은 게임 음악을 튼다', () => {
  const { engine } = handMade();
  assert.deepEqual(engine.log.music, ['game']);
});

test('공격하면 공격한 유닛의 공격 소리가 그 자리에서 난다. 감시탑은 장궁병 소리를 쓴다', () => {
  const { sounds, engine, unit, building, view } = handMade();
  sounds.frame(0.016, view);
  unit(1, 'pikeman', 0, 5, 5);
  unit(2, 'knight', 1, 6, 5);
  building(3, 'watchtower', 1, 8, 8);
  sounds.onEvent([GAME_EVENT.ATTACK, 1, 2]);
  sounds.onEvent([GAME_EVENT.ATTACK, 3, 1]);
  sounds.onEvent([GAME_EVENT.ATTACK, 2, 1]);
  assert.deepEqual(
    engine.log.play.map((p) => p.id),
    ['attack/pikeman', 'attack/longbowman', 'attack/knight'],
  );
  assert.deepEqual(engine.log.play[0].at, { x: 5, y: 5 });
  assert.deepEqual(engine.log.play[1].at, { x: 9, y: 9 }, '건물은 가운데서');
});

test('화면 밖에서 우리 것이 맞으면 알람이 나고, 같은 경우는 12초에 한 번이다', () => {
  const { sounds, engine, clock, unit, building, view } = handMade();
  sounds.frame(0.016, view);
  unit(1, 'pikeman', 0, 30, 20); // 화면 밖
  unit(2, 'knight', 1, 31, 20);
  unit(3, 'longbowman', 0, 5, 5); // 화면 안
  building(4, 'barracks', 0, 30, 25);
  sounds.onEvent([GAME_EVENT.ATTACK, 2, 3]);
  assert.equal(engine.log.alarm.length, 0, '보고 있는 곳은 알람 없이');
  sounds.onEvent([GAME_EVENT.ATTACK, 2, 1]);
  sounds.onEvent([GAME_EVENT.ATTACK, 2, 1]);
  sounds.onEvent([GAME_EVENT.ATTACK, 2, 4]);
  assert.deepEqual(reasons(engine), ['under_attack', 'base_under_attack']);
  assert.ok(engine.log.alarm.every((a) => a.id === 'alarm' && a.priority === 2), '알람 소리는 하나');
  clock.t += 11000;
  sounds.onEvent([GAME_EVENT.ATTACK, 2, 1]);
  assert.equal(engine.log.alarm.length, 2);
  clock.t += 1500;
  sounds.onEvent([GAME_EVENT.ATTACK, 2, 1]);
  assert.equal(engine.log.alarm.length, 3);
  sounds.onEvent([GAME_EVENT.ATTACK, 3, 2]); // 우리가 친 것은 알람이 아니다
  assert.equal(engine.log.alarm.length, 3);
});

test('다른 알람이 나는 중이라 못 울린 경우는 간격을 기다리지 않고 다음에 울린다', () => {
  const { sounds, engine } = handMade();
  engine.busy = true;
  sounds.onReject(REJECT.NOT_ENOUGH_GOLD);
  assert.equal(engine.log.alarm.length, 0);
  engine.busy = false;
  sounds.onReject(REJECT.NOT_ENOUGH_GOLD);
  assert.deepEqual(reasons(engine), ['no_gold']);
});

test('안개 속에서 보이지 않는 적이 쏴도 공격받는 알람이 난다', () => {
  const { sounds, engine, unit, view } = handMade();
  sounds.frame(0.016, view);
  unit(1, 'peasant', 0, 30, 20);
  sounds.onEvent([GAME_EVENT.ATTACK, 999, 1]); // 999: 보이지 않는 적
  assert.deepEqual(engine.log.play, [], '보이지 않는 쪽의 공격 소리는 없다');
  assert.deepEqual(reasons(engine), ['under_attack']);
});

test('팀원이 화면 밖에서 맞으면 동맹 알람', () => {
  const { sounds, engine, unit, view } = handMade({ players: TEAMS });
  sounds.frame(0.016, view);
  unit(1, 'pikeman', 2, 30, 20); // 팀원
  unit(2, 'knight', 1, 31, 20);
  sounds.onEvent([GAME_EVENT.ATTACK, 2, 1]);
  assert.deepEqual(reasons(engine), ['ally_under_attack']);
});

test('명령이 거부되면 알람. 고칠 수 없는 거부는 조용하고, 연달아 눌러도 한 번', () => {
  const { sounds, engine, clock } = handMade();
  const rejects = [
    REJECT.NOT_ENOUGH_GOLD,
    REJECT.NOT_ENOUGH_WOOD,
    REJECT.NOT_ENOUGH_MANA,
    REJECT.BLOCKED,
    REJECT.QUEUE_FULL,
    REJECT.INVALID,
    REJECT.RATE_LIMITED,
  ];
  for (const reason of rejects) {
    sounds.onReject(reason);
    clock.t += 2000;
  }
  assert.deepEqual(reasons(engine), ['no_gold', 'no_wood', 'no_mana', 'cannot_build', 'denied']);
  assert.ok(engine.log.alarm.every((a) => a.id === 'alarm' && a.priority === 1), '거부 알람은 덜 급하다');
  sounds.onReject(REJECT.NOT_ENOUGH_GOLD);
  sounds.onReject(REJECT.NOT_ENOUGH_GOLD);
  assert.equal(engine.log.alarm.length, 6);
});

test('알림 사건: 시대 발전·맹세·왕관·패배·궁극 유닛·자원 받기', () => {
  const { sounds, engine } = handMade({ players: TEAMS });
  sounds.onEvent([GAME_EVENT.AGE_UP, 1, 2]); // 상대의 발전은 조용하다
  sounds.onEvent([GAME_EVENT.AGE_UP, 0, 2]);
  sounds.onEvent([GAME_EVENT.OATH_TAKEN, 1, 0]);
  sounds.onEvent([GAME_EVENT.CROWN_FALLING, 2]);
  sounds.onEvent([GAME_EVENT.CROWN_FALLING, 3]);
  sounds.onEvent([GAME_EVENT.CROWN_RESTORED, 2]);
  sounds.onEvent([GAME_EVENT.PLAYER_DEFEATED, 3]);
  sounds.onEvent([GAME_EVENT.PLAYER_DEFEATED, 2]);
  sounds.onEvent([GAME_EVENT.ULTIMATE_LOST, 1, 7]); // 적의 궁극 유닛
  sounds.onEvent([GAME_EVENT.ULTIMATE_LOST, 0, 7]);
  sounds.onEvent([GAME_EVENT.RESOURCES_SENT, 0, 2, 0, 100, 90]); // 내가 보낸 것
  sounds.onEvent([GAME_EVENT.RESOURCES_SENT, 2, 0, 0, 100, 90]);
  assert.deepEqual(reasons(engine), [
    'age_up',
    'oath',
    'crown_falling',
    'enemy_crown_falling',
    'crown_restored',
    'enemy_defeated',
    'ally_defeated',
    'ultimate_lost',
    'resources_received',
  ]);
  assert.equal(engine.log.alarm.find((a) => a.reason === 'crown_falling').priority, 3, '왕관은 가장 급하다');
});

test('1대1에서 상대가 쓰러지면 알람 없이 결과 화면이 알린다', () => {
  const { sounds, engine } = handMade();
  sounds.onEvent([GAME_EVENT.PLAYER_DEFEATED, 1]);
  assert.deepEqual(engine.log.alarm, []);
});

test('인구가 차서 생산이 멈추면 한 번 알리고, 풀렸다 다시 막히면 또 알린다', () => {
  const { world, sounds, engine, clock, view } = handMade();
  const step = () => {
    clock.t += 11000;
    sounds.frame(0.25, view);
  };
  world.queues = new Map([[5, { types: ['pikeman'], progress: 0, blocked: true }]]);
  step();
  step();
  assert.deepEqual(reasons(engine), ['no_pop']);
  world.queues = new Map([[5, { types: ['pikeman'], progress: 0.2, blocked: false }]]);
  step();
  world.queues = new Map([[5, { types: ['pikeman'], progress: 0, blocked: true }]]);
  step();
  assert.equal(engine.log.alarm.length, 2);
});

test('경기가 끝나면 공사 소리와 알람이 멈춘다 (음악은 이어진다)', () => {
  const { sounds, engine } = handMade();
  sounds.stop();
  assert.equal(engine.log.loops.size, 0);
  sounds.onReject(REJECT.NOT_ENOUGH_GOLD);
  assert.deepEqual(engine.log.alarm, []);
  assert.deepEqual(engine.log.music, ['game']);
});

test('리플레이(알람 끔)는 공격 소리만 내고 알람은 내지 않는다', () => {
  const { sounds, engine, unit, view } = handMade({ alarms: false });
  sounds.frame(0.016, view);
  unit(1, 'pikeman', 0, 30, 20);
  unit(2, 'knight', 1, 31, 20);
  sounds.onEvent([GAME_EVENT.ATTACK, 2, 1]);
  sounds.onEvent([GAME_EVENT.CROWN_FALLING, 0]);
  sounds.onReject(REJECT.NOT_ENOUGH_GOLD);
  assert.deepEqual(engine.log.play.map((p) => p.id), ['attack/knight']);
  assert.deepEqual(engine.log.alarm, []);
});

// ---------- 서버 시뮬레이션과 함께 ----------

test('짓는 동안 짓는 중 소리가 돌고, 다 지으면 건설 완료 소리가 나고 공사 소리가 멈춘다', () => {
  const world = new World(flatMap(), DUEL);
  for (const player of world.players) Object.assign(player, { gold: 5000, wood: 5000, mana: 5000 });
  world.units.clear();
  const feed = new SnapshotFeed(world);
  const client = new ClientWorld(flatMap(), 0, DUEL);
  const engine = fakeEngine();
  const clock = { t: 0 };
  const sounds = createGameSounds({ engine, world: client, now: () => clock.t });
  client.onEvent = (event, removed) => sounds.onEvent(event, removed);
  const view = { x: 0, y: 0, w: 30, h: 20 };
  let seq = 0;
  const tick = (commands = []) => {
    const { events } = stepWorld(world, commands.map((cmd) => ({ slot: 0, cmd: { seq: ++seq, ...cmd } })));
    feed.update(world, events);
    client.applySnapshot(feed.snapshotFor(world, 0));
    clock.t += 50;
    sounds.frame(0.05, view);
  };

  const builders = [world.spawnUnit('peasant', 0, 10.5, 10.5), world.spawnUnit('peasant', 0, 11.5, 10.5)];
  tick([{ type: CMD.PLACE, unitIds: builders.map((u) => u.id), building: 'farmstead', x: 12, y: 12 }]);
  const site = [...world.buildings.values()].find((b) => b.type === 'farmstead');
  assert.ok(site, '농가 터를 잡았다');

  let heard = false;
  for (let i = 0; i < 20 * 60 && !site.complete; i++) {
    tick();
    const loop = engine.log.loops.get(site.id);
    if (loop?.id === 'construction') {
      heard = true;
      assert.deepEqual(loop.at, { x: 13, y: 13 }, '공사 터 가운데서');
    }
  }
  assert.ok(site.complete, '농가를 다 지었다');
  assert.ok(heard, '짓는 동안 construction이 돌았다');
  assert.ok(engine.log.play.some((p) => p.id === 'complete' && !p.at), '건설 완료 소리는 어디서든 들린다');
  for (let i = 0; i < 10; i++) tick();
  assert.equal(engine.log.loops.size, 0, '다 지으면 공사 소리가 멈춘다');

  // 짓다 만 터는 조용하다
  const idle = world.spawnBuilding('barracks', 0, 20, 12);
  idle.started = true;
  for (let i = 0; i < 40; i++) tick();
  assert.equal(engine.log.loops.has(idle.id), false, '아무도 짓지 않는 터');
});

test('서버에서 난 싸움: 유닛별 공격 소리와 화면 밖 공격 알람', () => {
  const world = new World(flatMap(), DUEL);
  world.units.clear();
  const feed = new SnapshotFeed(world);
  const client = new ClientWorld(flatMap(), 0, DUEL);
  const engine = fakeEngine();
  const clock = { t: 0 };
  const sounds = createGameSounds({ engine, world: client, now: () => clock.t });
  client.onEvent = (event, removed) => sounds.onEvent(event, removed);
  const view = { x: 0, y: 0, w: 10, h: 8 }; // 싸움은 화면 밖
  const tick = () => {
    const { events } = stepWorld(world);
    feed.update(world, events);
    client.applySnapshot(feed.snapshotFor(world, 0));
    clock.t += 50;
    sounds.frame(0.05, view);
  };
  world.spawnUnit('longbowman', 0, 24.5, 16.5);
  world.spawnUnit('pikeman', 1, 27.5, 16.5);
  for (let i = 0; i < 20 * 5; i++) tick();
  const ids = new Set(engine.log.play.map((p) => p.id));
  assert.ok(ids.has('attack/longbowman'), '장궁병이 쐈다');
  assert.ok(ids.has('attack/pikeman'), '창병이 찔렀다');
  assert.deepEqual([...new Set(reasons(engine))], ['under_attack']);
});
