import { PLAYER_COLORS } from '@rune/shared/constants.js';
import { BUILDINGS, BUILD_MENU } from '@rune/shared/data/buildings.js';
import { AGES, MAX_AGE, RESOURCES, RESOURCE_NAMES } from '@rune/shared/data/economy.js';
import { MARKET, buyCost, sellGain } from '@rune/shared/data/market.js';
import { UNITS, WORKER } from '@rune/shared/data/units.js';
import { ABILITIES } from '@rune/shared/data/abilities.js';
import { garrisonOf } from '@rune/shared/rules/garrison.js';
import { OATHS } from '@rune/shared/data/oaths.js';
import { TICK_MS } from '@rune/shared/constants.js';
import { UNIT_STATE } from '@rune/shared/protocol.js';
import { missingResource } from '@rune/shared/rules/costs.js';
import { ARMOR_NAMES, ATTACK_TYPE_NAMES } from '@rune/shared/rules/combat.js';
import { h } from './dom.js';

const STATE_TEXT = {
  [UNIT_STATE.IDLE]: '대기 중',
  [UNIT_STATE.MOVE]: '이동 중',
  [UNIT_STATE.ATTACK]: '공격 중',
  [UNIT_STATE.GATHER]: '채집 중',
  [UNIT_STATE.RETURN]: '자원 운반 중',
  [UNIT_STATE.BUILD]: '건설 중',
};

/**
 * 선택한 대상의 정보와 명령 버튼 (화면 아래 가운데).
 * 버튼 구성이 바뀔 때만 DOM을 다시 만들고, 체력·진행도·상태 글자는 제자리에서 갱신한다.
 *
 * onAction으로 넘기는 값:
 * { kind: 'build', type } | { kind: 'stop' } | { kind: 'ageUp' } | { kind: 'cancelAgeUp' }
 * | { kind: 'cancelBuild', id } | { kind: 'trade', resource, action }
 */
export function createCommandCard({ onAction }) {
  const info = h('div', { class: 'cc-info' });
  const grid = h('div', { class: 'cc-grid' });
  const el = h('section', { class: 'command-card', 'aria-label': '선택한 대상과 명령' }, info, grid);

  let signature = '';
  let hotkeys = new Map();
  let refs = {};

  function update(view) {
    const model = describe(view);
    const next = JSON.stringify({ ...model, live: liveShape(model.live) });
    if (next !== signature) {
      signature = next;
      rebuild(model);
    }
    applyLive(model.live);
  }

  function rebuild(model) {
    hotkeys = new Map();
    refs = {};

    const rows = [
      h(
        'div',
        { class: 'cc-title-row' },
        model.color ? h('i', { class: 'swatch', style: `--c: ${model.color}` }) : null,
        h('strong', { class: 'cc-title' }, model.title),
      ),
    ];
    if (model.subtitle) rows.push(h('p', { class: 'cc-sub' }, model.subtitle));
    if (model.live.hp) {
      refs.hpFill = h('span', { class: 'meter-fill' });
      refs.hpText = h('span', { class: 'meter-text' });
      rows.push(h('div', { class: 'meter', role: 'img', 'aria-label': '체력' }, refs.hpFill, refs.hpText));
    }
    if (model.live.progress != null) {
      refs.progressFill = h('span', { class: 'meter-fill is-progress' });
      refs.progressText = h('span', { class: 'meter-text' });
      rows.push(h('div', { class: 'meter', role: 'img', 'aria-label': '진행도' }, refs.progressFill, refs.progressText));
    }
    if (model.queue?.length) {
      rows.push(
        h(
          'div',
          { class: 'cc-queue', role: 'group', 'aria-label': '생산 대기열. 누르면 취소' },
          ...model.queue.map(({ type, index }) =>
            h(
              'button',
              {
                class: 'cc-queue-item',
                type: 'button',
                title: `${UNITS[type].name} — 누르면 취소하고 비용을 돌려받습니다`,
                onClick: () => onAction({ kind: 'cancelTrain', buildingId: model.buildingId, index }),
              },
              UNITS[type].name.slice(0, 2),
            ),
          ),
        ),
      );
    }
    refs.text = h('p', { class: 'cc-text' });
    rows.push(refs.text);
    if (model.hint) rows.push(h('p', { class: 'cc-hint' }, model.hint));
    info.replaceChildren(...rows);

    grid.replaceChildren(...model.buttons.map(makeButton));
  }

  function makeButton(btn) {
    hotkeys.set(btn.key, btn);
    const costEntries = btn.cost ? RESOURCES.filter((r) => btn.cost[r]) : [];
    const tooltip = [
      `${btn.label} (${btn.key})`,
      costEntries.length ? costEntries.map((r) => `${RESOURCE_NAMES[r]} ${btn.cost[r]}`).join(' · ') : null,
      btn.need,
      btn.note,
    ]
      .filter(Boolean)
      .join('\n');
    return h(
      'button',
      {
        class: btn.short ? 'cc-btn is-short' : 'cc-btn',
        type: 'button',
        disabled: btn.disabled,
        title: tooltip,
        onClick: (event) => onAction({ ...btn.action, repeat: event.shiftKey ? 5 : 1 }),
      },
      h('span', { class: 'cc-key' }, btn.key),
      h('span', { class: 'cc-label' }, btn.label),
      costEntries.length
        ? h('span', { class: 'cc-cost' }, ...costEntries.map((r) => h('span', { class: `c-${r}` }, btn.cost[r])))
        : null,
      // 요구 조건(필요한 건물·시대)은 마우스를 올리지 않아도 늘 보이게 따로 적는다 (모바일에는 툴팁이 없다)
      btn.need ? h('span', { class: 'cc-need' }, btn.need) : null,
      btn.note && !costEntries.length && !btn.need ? h('span', { class: 'cc-note' }, btn.note) : null,
    );
  }

  function applyLive(live) {
    if (refs.hpFill && live.hp) {
      const [current, max] = live.hp;
      refs.hpFill.style.width = `${Math.max(0, Math.min(1, current / max)) * 100}%`;
      refs.hpText.textContent = `${current} / ${max}`;
    }
    if (refs.progressFill && live.progress != null) {
      refs.progressFill.style.width = `${live.progress * 100}%`;
      refs.progressText.textContent = `${live.progressLabel} ${Math.floor(live.progress * 100)}%`;
    }
    if (refs.text) refs.text.textContent = live.text ?? '';
  }

  /** 명령 단축키. 한글 입력 상태에서도 되도록 물리 키(e.code)로 판정한다 */
  function handleKey(event) {
    if (!event.code.startsWith('Key') || event.ctrlKey || event.metaKey || event.altKey) return false;
    const btn = hotkeys.get(event.code.slice(3));
    if (!btn || btn.disabled) return false;
    onAction({ ...btn.action, repeat: event.shiftKey ? 5 : 1 });
    return true;
  }

  return { el, update, handleKey };
}

const liveShape = (live) => ({ hp: Boolean(live.hp), progress: live.progress != null, progressLabel: live.progressLabel });

const ownerName = (players, slot) => {
  const player = players.find((p) => p.slot === slot);
  return player ? `P${slot + 1} ${player.nickname}` : `P${slot + 1}`;
};

/** 선택 상태를 화면에 그릴 모델로 바꾼다 */
function describe({ world, selection, players, touch = false }) {
  const ids = [...selection];
  if (ids.length === 0 || !world.ready) {
    return {
      title: '선택한 대상 없음',
      hint: touch
        ? '눌러서 선택 · 길게 누른 채 끌면 여러 유닛 · 끌어서 화면 이동 · 두 손가락으로 확대'
        : '클릭해서 선택, 드래그로 여러 유닛 선택, 우클릭으로 명령',
      buttons: [],
      live: {},
    };
  }

  if (typeof ids[0] === 'string') {
    const amount = world.mineAmounts.get(ids[0]) ?? 0;
    return {
      title: '금광',
      hint: touch ? '농노를 고른 채 금광을 누르면 캡니다' : '농노를 선택하고 금광을 우클릭하면 캡니다',
      buttons: [],
      live: { text: `남은 금 ${amount.toLocaleString('ko-KR')}` },
    };
  }

  const units = ids.map((id) => world.units.get(id)).filter(Boolean);
  if (units.length) return describeUnits(world, units, players, touch);
  const building = world.buildings.get(ids[0]);
  if (building) return describeBuilding(world, building, players, touch);
  return { title: '선택한 대상 없음', buttons: [], live: {} };
}

function describeUnits(world, units, players, touch) {
  const first = units[0];
  const def = UNITS[first.type];
  const model = {
    title:
      units.length === 1
        ? def.name
        : units.every((u) => u.type === first.type)
          ? `${def.name} ${units.length}기`
          : `유닛 ${units.length}기`,
    subtitle: ownerName(players, first.owner),
    color: PLAYER_COLORS[first.owner],
    buttons: [],
    live: units.length === 1 ? { hp: [first.hp, def.hp], text: unitStatus(first) } : { text: groupStatus(units) },
  };
  if (units.length === 1) model.hint = unitStats(def);
  if (!world.isMine(first)) return model;

  if (units.some((u) => UNITS[u.type].worker)) {
    const me = world.me;
    model.buttons = BUILD_MENU.map((type) => {
      const b = BUILDINGS[type];
      const locked = me.age < b.age;
      return {
        key: b.hotkey,
        label: b.name,
        cost: b.cost,
        disabled: locked,
        short: !locked && missingResource(me, b.cost) !== null,
        need: locked ? `${AGES[b.age].name} 필요` : null,
        note: b.coastal ? '바다와 이어진 물가에만' : null,
        action: { kind: 'build', type },
      };
    });
    model.hint = touch
      ? '건물을 고른 뒤 지을 곳을 누른 채 끌어 맞추고 떼기'
      : '건물을 고른 뒤 땅을 클릭 · Shift로 연달아 짓기 · Esc 취소';
  }
  // 농노가 섞여 있으면 A는 룬 오벨리스크 단축키라서 공격 이동은 병력만 골랐을 때 보여준다 (수송선만 골랐으면 없다)
  if (!units.some((u) => UNITS[u.type].worker) && units.some((u) => UNITS[u.type].attack)) {
    model.buttons.push({ key: 'A', label: '공격 이동', note: '가며 만난 적과 싸움', action: { kind: 'attackMove' } });
    if (units.length > 1) {
      model.hint = touch ? '누른 곳으로: 적은 공격, 땅은 이동 · 공격 이동 뒤 누르기' : '우클릭: 적은 공격, 땅은 이동 · A 뒤 클릭: 공격 이동';
    }
  }
  const guards = units.filter((u) => UNITS[u.type].ability === 'shieldWall');
  if (guards.length) {
    const allOn = guards.every((u) => u.shieldWall);
    model.buttons.push({
      key: 'F',
      label: allOn ? '방패벽 끄기' : '방패벽',
      note: '이속 −50% · 화살 −60%',
      action: { kind: 'shieldWall' },
    });
  }
  if (units.length === 1 && def.abilities) model.buttons.push(...abilityButtons(world, first, def));
  model.buttons.push({ key: 'H', label: '정지', action: { kind: 'stop' } });
  return model;
}

/** 궁극 유닛의 능력 버튼. 재사용 대기가 남아 있으면 초를 보여 주고 누르지 못하게 한다. */
function abilityButtons(world, unit, def) {
  const ready = world.cooldowns.get(unit.id) ?? {};
  return def.abilities
    .map((id) => {
      const ability = ABILITIES[id];
      const remain = Math.max(0, Math.ceil(((ready[id] ?? 0) - world.serverTick) * (TICK_MS / 1000)));
      if (id === 'unload' && !unit.extra) return null; // 태운 유닛이 없으면 숨긴다
      const rooting = id === 'root' && unit.flags & 16;
      return {
        key: ability.hotkey,
        label: id === 'root' && unit.rooted ? '뿌리 뽑기' : ability.name,
        note: remain ? `${remain}초 뒤` : rooting ? '전환 중' : ability.desc,
        disabled: remain > 0 || rooting,
        action:
          ability.kind === 'toggle'
            ? { kind: 'toggleAbility', ability: id }
            : ability.kind === 'point'
              ? { kind: 'castTarget', ability: id }
              : { kind: 'cast', ability: id },
      };
    })
    .filter(Boolean);
}

function unitStats(def) {
  const { attack } = def;
  const base = attack
    ? `공격 ${attack.damage} ${ATTACK_TYPE_NAMES[attack.type]} · 사거리 ${attack.range} · ${ARMOR_NAMES[def.armor]}`
    : `싸우지 않음 · ${def.garrison ? `${def.garrison.capacity}기 수송 · ` : ''}${ARMOR_NAMES[def.armor]}`;
  const naval = def.naval ? ' · 물 위로만 다님' : def.flying ? ' · 하늘을 난다 (근접 공격이 닿지 않음)' : '';
  return def.title ? `${def.title} · ${base}${naval}` : `${base}${naval}`;
}

function unitStatus(unit) {
  const state = STATE_TEXT[unit.state] ?? '';
  const extras = [];
  if (unit.channeling) extras.push('영창 중');
  if (unit.rooted) extras.push('뿌리내림');
  if (unit.stunned) extras.push('기절');
  if (unit.slowed) extras.push('둔화');
  const garrison = garrisonOf(unit.type);
  if (garrison) extras.push(`탑승 ${unit.extra}/${garrison.capacity}`);
  if (unit.carryKind && unit.carryAmount > 0) {
    extras.push(`${RESOURCE_NAMES[unit.carryKind]} ${unit.carryAmount}/${WORKER.carryCapacity}`);
  }
  return [state, ...extras].filter(Boolean).join(' · ');
}

function groupStatus(units) {
  const counts = new Map();
  for (const u of units) counts.set(u.state, (counts.get(u.state) ?? 0) + 1);
  return [...counts].map(([state, n]) => `${STATE_TEXT[state]} ${n}`).join(' · ');
}

function describeBuilding(world, b, players, touch) {
  const def = BUILDINGS[b.type];
  const age = world.ages.get(b.owner) ?? 1;
  const model = {
    title: b.type === 'keep' ? AGES[age].keepName : def.name,
    subtitle: ownerName(players, b.owner),
    color: PLAYER_COLORS[b.owner],
    buttons: [],
    live: { hp: [b.hp, def.hp] },
  };
  const mine = world.isMine(b);

  if (!b.complete) {
    model.live.progress = b.progress;
    model.live.progressLabel = b.started ? '건설 중' : '농노를 기다리는 중';
    if (mine) model.buttons.push({ key: 'C', label: '건설 취소', note: '남은 만큼 환불', action: { kind: 'cancelBuild', id: b.id } });
    return model;
  }

  model.hint = buildingHint(world, b, def);
  if (!mine) return model;
  const me = world.me;
  model.buildingId = b.id;

  // 맹세의 성소: 아직 맹세를 맺지 않았으면 셋 중 하나를 고른다
  if (def.oathAltar && !world.myOath()) {
    model.hint = '맹세는 한 경기에 한 번, 번복할 수 없습니다';
    model.buttons.push(
      ...Object.values(OATHS).map((oath, i) => ({
        key: ['Q', 'W', 'E'][i],
        label: oath.name,
        note: `${UNITS[oath.unit].name} · ${oath.summary}`,
        action: { kind: 'takeOath', oath: oath.id },
      })),
    );
    return model;
  }

  if (def.trains) {
    const keys = ['Q', 'W', 'E', 'R'];
    const trains = def.trains.filter((type) => !UNITS[type].oath || UNITS[type].oath === world.myOath());
    trains.forEach((type, i) => {
      const unit = UNITS[type];
      const locked = me.age < unit.age;
      model.buttons.push({
        key: keys[i],
        label: unit.name,
        cost: unit.cost,
        disabled: locked,
        short: !locked && missingResource(me, unit.cost) !== null,
        need: locked ? `${AGES[unit.age].name} 필요` : null,
        note: `${unit.trainTime}초 · 인구 ${unit.pop}`,
        action: { kind: 'train', buildingId: b.id, unit: type },
      });
    });
    const production = b.production;
    if (production) {
      const head = UNITS[production.types[0]].name;
      model.queue = production.types.map((type, index) => ({ type, index }));
      model.live.progress = production.progress;
      model.live.progressLabel = production.blocked ? `${head} · 인구 부족` : `${head} 생산 중`;
    }
    model.hint = [
      def.dropoff ? '금·목재 반납' : null,
      def.pop ? `인구 +${def.pop}` : null,
      touch ? '땅을 누르면 집결지' : '우클릭으로 집결지 · Shift로 5기씩',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  if (b.type === 'keep') {
    if (me.ageTarget) {
      if (model.live.progress == null) {
        model.live.progress = me.ageProgress;
        model.live.progressLabel = `${AGES[me.ageTarget].name}로 발전 중`;
      }
      model.buttons.push({ key: 'C', label: '발전 취소', note: '비용 전액 환불', action: { kind: 'cancelAgeUp' } });
    } else if (me.age < MAX_AGE) {
      const next = AGES[me.age + 1];
      let missingNote = null;
      const mark = (type) => `${BUILDINGS[type].name} ${world.hasCompleted(type) ? '✓' : '✗'}`;
      if (next.requires?.some((type) => !world.hasCompleted(type))) {
        missingNote = `필요: ${next.requires.map(mark).join(' · ')}`;
      }
      if (next.requiresAny) {
        const built = next.requiresAny.types.filter((type) => world.hasCompleted(type));
        if (built.length < next.requiresAny.count) {
          missingNote = `${next.requiresAny.count}종 필요: ${next.requiresAny.types.map(mark).join(' · ')}`;
        }
      }
      model.buttons.push({
        key: 'U',
        label: `${next.name}로 발전`,
        cost: next.cost,
        disabled: Boolean(missingNote),
        short: !missingNote && missingResource(me, next.cost) !== null,
        need: missingNote,
        note: `${next.time}초`,
        action: { kind: 'ageUp' },
      });
    }
  }

  if (b.type === 'market') {
    const trades = [
      ['Q', 'wood', 'buy'],
      ['W', 'wood', 'sell'],
      ['E', 'mana', 'buy'],
      ['R', 'mana', 'sell'],
    ];
    for (const [key, resource, action] of trades) {
      const price = me.market[resource];
      const buying = action === 'buy';
      const cost = buying ? { gold: buyCost(price) } : { [resource]: MARKET.lot };
      model.buttons.push({
        key,
        label: `${RESOURCE_NAMES[resource]} ${buying ? '사기' : '팔기'}`,
        cost,
        note: buying ? `${RESOURCE_NAMES[resource]} +${MARKET.lot}` : `금 +${sellGain(price)}`,
        short: missingResource(me, cost) !== null,
        action: { kind: 'trade', resource, action },
      });
    }
  }
  return model;
}

function buildingHint(world, b, def) {
  if (b.type === 'obelisk') {
    const well = world.map.wells.find((w) => w.x === b.x && w.y === b.y);
    return `마나 +${well?.rate ?? 0}/초`;
  }
  const parts = [];
  if (def.dropoff) parts.push('금·목재 반납');
  if (def.pop) parts.push(`인구 +${def.pop}`);
  if (def.trains && b.type !== 'keep') parts.push(`훈련: ${def.trains.map((t) => UNITS[t].name).join(', ')}`);
  if (def.attack) parts.push(`관통 ${def.attack.damage} · 사거리 ${def.attack.range}`);
  if (def.market) parts.push('금으로 목재·마나를 사고팝니다');
  return parts.join(' · ');
}
