// 게임 속 사건을 소리로 바꾼다. 소리 엔진은 밖에서 받는다 (Node 테스트에서는 가짜 엔진을 넣는다).
// 어떤 소리가 언제 나는지는 soundList.js의 '언제'와 ALARM_CASES와 같다.
import { UNITS } from '@rune/shared/data/units.js';
import { BUILDINGS } from '@rune/shared/data/buildings.js';
import { GAME_EVENT, REJECT } from '@rune/shared/protocol.js';
import { ALARM_CASES, attackSoundOf } from './soundList.js';

const MONEY_REJECTS = Object.freeze({
  [REJECT.NOT_ENOUGH_GOLD]: 'no_gold',
  [REJECT.NOT_ENOUGH_WOOD]: 'no_wood',
  [REJECT.NOT_ENOUGH_MANA]: 'no_mana',
});
const PLACE_REJECTS = new Set([
  REJECT.BLOCKED,
  REJECT.OUT_OF_BOUNDS,
  REJECT.NEEDS_WELL,
  REJECT.WELL_TAKEN,
  REJECT.ON_WELL,
  REJECT.NEEDS_COAST,
]);
/** 사람이 고칠 수 없는 거부(잘못된 명령·너무 잦은 명령)는 소리 없이 넘긴다 */
const SILENT_REJECTS = new Set([REJECT.INVALID, REJECT.RATE_LIMITED]);

/** 공사 터는 진행도가 이 시간 안에 올랐으면 "짓는 중"이다 (아무도 짓지 않는 터는 조용하다) */
const BUILDING_ACTIVE_MS = 1200;
const CONSTRUCTION_CHECK_SEC = 0.25;
const QUEUE_CHECK_SEC = 0.2;

/** 유닛은 그리는 자리, 건물은 가운데 (타일) */
const positionOf = (entity) =>
  entity.size ? { x: entity.x + entity.size / 2, y: entity.y + entity.size / 2 } : { x: entity.drawX ?? entity.x, y: entity.drawY ?? entity.y };

/**
 * @param {object} p
 * @param {{ play: Function, alarm: Function, setLoops: Function, setMusic: Function, setView: Function }} p.engine
 *   alarm은 소리를 냈으면 true (더 급하거나 같은 알람이 나는 중이라 못 냈으면 false — 그 경우는 다음에 다시 울린다)
 * @param {import('../world/ClientWorld.js').ClientWorld} p.world
 * @param {boolean} [p.alarms] 알람을 낼지 (리플레이는 공격·건물 소리와 음악만)
 * @param {() => number} [p.now] ms 시계 (테스트용)
 */
export function createGameSounds({ engine, world, alarms = true, now = () => performance.now() }) {
  const lastAlarm = new Map(); // 알람 경우 → 마지막으로 울린 시각
  const building = new Map(); // 짓고 있는 건물 id → { progress, changedAt }
  const blocked = new Set(); // 인구가 모자라 멈춘 내 생산처
  let ended = false;
  let view = null;
  let constructionTimer = 0;
  let queueTimer = 0;
  const teamGame = world.startTeams.size > 2;
  const myTeam = () => world.teamOf(world.mySlot);
  const isMine = (entity) => entity?.owner === world.mySlot;
  const isAlly = (entity) => Boolean(entity) && !isMine(entity) && world.teamOf(entity.owner) === myTeam();
  const onScreen = ({ x, y }) => Boolean(view) && x >= view.x && x <= view.x + view.w && y >= view.y && y <= view.y + view.h;

  /** 알람 한 번. kind: ALARM_CASES의 경우 (소리는 모두 같은 alarm이다) */
  function alarm(kind) {
    if (!alarms || ended) return;
    const { gap, priority } = ALARM_CASES[kind];
    const t = now();
    if (t - (lastAlarm.get(kind) ?? -Infinity) < gap) return;
    if (engine.alarm('alarm', { priority, reason: kind })) lastAlarm.set(kind, t);
  }

  const find = (id, removed) => world.units.get(id) ?? world.buildings.get(id) ?? removed.get(id) ?? null;

  function onAttack(event, removed) {
    const attacker = find(event[1], removed);
    const target = find(event[2], removed);
    if (attacker && (UNITS[attacker.type] ?? BUILDINGS[attacker.type])?.attack) {
      engine.play(attackSoundOf(attacker.type), { at: positionOf(attacker) });
    }
    if (!target) return;
    // 공격한 쪽이 안 보이면(안개 속에서 쏘면) 적이다: 우리 팀 것은 늘 보인다
    const hostile = attacker ? world.teamOf(attacker.owner) !== myTeam() : true;
    if (!hostile || onScreen(positionOf(target))) return;
    if (isMine(target)) alarm(target.size ? 'base_under_attack' : 'under_attack');
    else if (isAlly(target)) alarm('ally_under_attack');
  }

  /** 서버 스냅샷의 사건 하나. removed: 이번 스냅샷에서 사라진 유닛·건물 (쓰러진 자리·종류) */
  function onEvent(event, removed = new Map()) {
    switch (event[0]) {
      case GAME_EVENT.ATTACK:
        onAttack(event, removed);
        break;
      case GAME_EVENT.BUILT: {
        const done = world.buildings.get(event[1]);
        building.delete(event[1]);
        // 내 건물이 다 지어지면 화면 어디에 있든 들린다 (알림을 겸한다)
        if (done && event[2] === world.mySlot && !ended) engine.play('complete');
        break;
      }
      case GAME_EVENT.MINE_DEPLETED: {
        const mine = world.map.goldMines.find((m) => m.id === event[1]);
        if (!mine) break;
        const cx = mine.x + mine.w / 2;
        const cy = mine.y + mine.h / 2;
        const mining = [...world.units.values()].some(
          (u) => isMine(u) && u.carryKind === 'gold' && Math.hypot((u.drawX ?? u.x) - cx, (u.drawY ?? u.y) - cy) < 10,
        );
        if (mining) alarm('mine_depleted');
        break;
      }
      case GAME_EVENT.AGE_UP:
        if (event[1] === world.mySlot) alarm('age_up');
        break;
      case GAME_EVENT.OATH_TAKEN:
        alarm('oath');
        break;
      case GAME_EVENT.CROWN_FALLING:
        alarm(world.teamOf(event[1]) === myTeam() ? 'crown_falling' : 'enemy_crown_falling');
        break;
      case GAME_EVENT.CROWN_RESTORED:
        if (world.teamOf(event[1]) === myTeam()) alarm('crown_restored');
        break;
      case GAME_EVENT.PLAYER_DEFEATED:
        // 1대1에서는 곧 경기가 끝나 결과 화면이 알리고, 내가 쓰러진 것도 화면이 알린다
        if (!teamGame || event[1] === world.mySlot) break;
        alarm(world.teamOf(event[1]) === myTeam() ? 'ally_defeated' : 'enemy_defeated');
        break;
      case GAME_EVENT.ULTIMATE_LOST:
        if (event[1] === world.mySlot) alarm('ultimate_lost');
        break;
      case GAME_EVENT.RESOURCES_SENT:
        if (event[2] === world.mySlot) alarm('resources_received');
        break;
      default:
    }
  }

  /** 명령이 거부됐다 (서버가 거부했거나, 보내기 전에 화면이 막았다) */
  function onReject(reason) {
    if (SILENT_REJECTS.has(reason)) return;
    if (MONEY_REJECTS[reason]) alarm(MONEY_REJECTS[reason]);
    else if (PLACE_REJECTS.has(reason)) alarm('cannot_build');
    else alarm('denied');
  }

  /** 지금 짓고 있는(진행도가 오르는) 공사 터마다 짓는 중 소리. 화면 가운데에 가까운 것부터 */
  function construction() {
    const t = now();
    const sites = [];
    for (const b of world.buildings.values()) {
      if (b.complete) {
        building.delete(b.id);
        continue;
      }
      const seen = building.get(b.id);
      if (!seen) {
        building.set(b.id, { progress: b.progress, changedAt: -Infinity });
        continue;
      }
      if (b.progress !== seen.progress) {
        if (b.progress > seen.progress) seen.changedAt = t; // 줄었으면 리플레이를 되감은 것
        seen.progress = b.progress;
      }
      if (t - seen.changedAt > BUILDING_ACTIVE_MS) continue;
      const at = positionOf(b);
      const distance = view ? Math.hypot(at.x - (view.x + view.w / 2), at.y - (view.y + view.h / 2)) : 0;
      sites.push({ key: b.id, at, distance });
    }
    for (const id of building.keys()) if (!world.buildings.has(id)) building.delete(id);
    sites.sort((a, b) => a.distance - b.distance);
    engine.setLoops(new Map(sites.map(({ key, at }) => [key, { id: 'construction', at }])));
  }

  /** 인구가 모자라 생산이 멈춘 순간 */
  function watchQueues() {
    for (const [id, queue] of world.queues) {
      if (queue.blocked && !blocked.has(id)) {
        blocked.add(id);
        alarm('no_pop');
      } else if (!queue.blocked) {
        blocked.delete(id);
      }
    }
  }

  /** 틱마다가 아니라 화면 프레임마다 부른다. nextView: 화면에 보이는 영역 (타일) */
  function frame(dt, nextView) {
    view = nextView;
    engine.setView(view);
    if (ended) return;
    constructionTimer -= dt;
    queueTimer -= dt;
    if (constructionTimer <= 0) {
      constructionTimer = CONSTRUCTION_CHECK_SEC;
      construction();
    }
    if (queueTimer <= 0) {
      queueTimer = QUEUE_CHECK_SEC;
      watchQueues();
    }
  }

  /** 경기가 끝났거나 화면을 떠난다: 공사 소리와 알람을 멈춘다 (게임 음악은 결과 화면에서도 이어지고, 로비로 가면 로비 음악) */
  function stop() {
    ended = true;
    engine.setLoops(new Map());
  }

  engine.setMusic('game');
  return { onEvent, onReject, frame, stop };
}
