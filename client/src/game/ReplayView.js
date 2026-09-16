import { PLAYER_COLORS, TILE_SIZE } from '@rune/shared/constants.js';
import { BUILDINGS } from '@rune/shared/data/buildings.js';
import { AGES } from '@rune/shared/data/economy.js';
import { UNITS } from '@rune/shared/data/units.js';
import { OATHS, OATH_IDS } from '@rune/shared/data/oaths.js';
import { loadMap } from '@rune/shared/map/maps/index.js';
import { footprintCenter } from '@rune/shared/map/grid.js';
import { GAME_EVENT, VICTORY_REASON } from '@rune/shared/protocol.js';
import { h } from '../ui/dom.js';
import { ClientWorld } from '../world/ClientWorld.js';
import { Camera } from '../render/Camera.js';
import { Renderer } from '../render/Renderer.js';
import { Minimap } from '../render/minimap.js';
import { Input } from '../input/Input.js';
import { TouchControls, isCoarsePointer } from '../input/TouchControls.js';
import { REPLAY_SPEEDS, ReplayPlayer } from './ReplayPlayer.js';

const PAN_SPEED = 1100;

const formatTime = (seconds) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const REASON_TEXT = {
  [VICTORY_REASON.CONQUEST]: '왕관 몰락',
  [VICTORY_REASON.ANNIHILATION]: '전멸',
  [VICTORY_REASON.SURRENDER]: '항복',
  [VICTORY_REASON.LEFT]: '이탈',
};

/**
 * 리플레이 화면. 녹화한 스냅샷을 ReplayPlayer로 재생하고, 게임 화면과 같은 렌더러로 그린다.
 * 명령은 보낼 수 없고 카메라 이동·확대와 대상 살펴보기만 된다.
 */
export function createReplayView({ canvas, replay, onExit }) {
  const map = loadMap(replay.mapId);
  const players = replay.players;
  const world = new ClientWorld(map, replay.mySlot, players);
  const camera = new Camera(map.width * TILE_SIZE, map.height * TILE_SIZE);
  const renderer = new Renderer(canvas, world, camera, players);
  const minimap = new Minimap(world, camera);
  const input = new Input(canvas);
  const selection = renderer.selection;
  const nameOf = (slot) => players.find((p) => p.slot === slot)?.nickname ?? `P${slot + 1}`;

  world.onTreeFelled = (tile) => {
    renderer.terrain.invalidateTile(tile % map.width, Math.floor(tile / map.width));
    minimap.markTerrainDirty();
  };
  const redrawTerrain = () => {
    renderer.terrain.invalidateAll();
    minimap.markTerrainDirty();
  };
  world.onTerrainReset = redrawTerrain;
  world.onEvent = (event) => {
    if (event[0] === GAME_EVENT.OATH_TAKEN) {
      const oath = OATHS[OATH_IDS[event[2]]];
      showBanner(`${nameOf(event[1])} 왕국이 ${oath.name}를 맺었습니다`);
    }
  };

  const player = new ReplayPlayer(replay, world);
  player.onRewind = redrawTerrain;

  // ---------- HUD ----------

  const res = {
    gold: h('span', { class: 'res-val' }, '0'),
    wood: h('span', { class: 'res-val' }, '0'),
    mana: h('span', { class: 'res-val' }, '0'),
    pop: h('span', { class: 'res-val' }, '0/0'),
    age: h('span', { class: 'res-age' }, ''),
  };
  const resources = h(
    'div',
    { class: 'resources', title: '녹화한 사람의 자원입니다' },
    h('span', { class: 'replay-badge' }, '리플레이'),
    h('span', { class: 'res res-gold' }, h('b', { class: 'res-label' }, '금'), res.gold),
    h('span', { class: 'res res-wood' }, h('b', { class: 'res-label' }, '목재'), res.wood),
    h('span', { class: 'res res-mana' }, h('b', { class: 'res-label' }, '마나'), res.mana),
    h('span', { class: 'res res-pop' }, h('b', { class: 'res-label' }, '인구'), res.pop),
    res.age,
  );
  const tags = new Map();
  const versus = h('div', { class: 'versus' });
  [0, 1].forEach((team, i) => {
    if (i > 0) versus.append(h('span', { class: 'vs' }, 'VS'));
    for (const p of players.filter((player) => (player.team ?? player.slot) === team)) {
      const label = h('span', {}, `P${p.slot + 1} ${p.nickname}${p.slot === replay.mySlot ? ' (시점)' : ''}`);
      tags.set(p.slot, label);
      versus.append(h('span', { class: 'player-tag' }, h('i', { class: 'swatch', style: `--c: ${PLAYER_COLORS[p.slot]}` }), label));
    }
  });
  const closeButton = h('button', { class: 'btn btn-sm', type: 'button', onClick: () => onExit() }, '나가기');

  const banner = h('div', { class: 'hud-banner', role: 'status', hidden: true });
  let bannerTimer = null;
  function showBanner(text) {
    banner.textContent = text;
    banner.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      banner.hidden = true;
    }, 5000);
  }

  const info = h('section', { class: 'replay-info', 'aria-live': 'polite', hidden: true });

  // ---------- 재생 막대 ----------

  const playButton = h('button', { class: 'rp-btn rp-play', type: 'button', title: '재생 / 일시정지 (Space)' }, '일시정지');
  const seek = h('input', {
    class: 'rp-seek',
    type: 'range',
    min: 0,
    max: player.durationSec.toFixed(2),
    step: 0.05,
    value: 0,
    'aria-label': '재생 위치',
  });
  const time = h('span', { class: 'rp-time mono' }, `00:00 / ${formatTime(player.durationSec)}`);
  const speedButtons = REPLAY_SPEEDS.map((speed) =>
    h(
      'button',
      {
        class: 'rp-speed',
        type: 'button',
        'aria-pressed': speed === player.speed ? 'true' : 'false',
        onClick: () => setSpeed(speed),
      },
      `${speed}×`,
    ),
  );
  const jump = (seconds) => player.seekSeconds(player.positionSec + seconds);
  const bar = h(
    'div',
    { class: 'replay-bar', role: 'group', 'aria-label': '리플레이 재생' },
    h('button', { class: 'rp-btn', type: 'button', title: '처음으로 (Home)', onClick: () => player.seek(player.firstTick) }, '처음'),
    h('button', { class: 'rp-btn', type: 'button', title: '10초 뒤로 (,)', onClick: () => jump(-10) }, '−10초'),
    playButton,
    h('button', { class: 'rp-btn', type: 'button', title: '10초 앞으로 (.)', onClick: () => jump(10) }, '+10초'),
    seek,
    time,
    h('div', { class: 'rp-speeds', role: 'group', 'aria-label': '재생 속도' }, ...speedButtons),
  );

  playButton.addEventListener('click', () => player.togglePlay());
  // 끌기 중에는 매 입력마다 되감지 않고 프레임마다 한 번만 옮긴다
  let pendingSeek = null;
  seek.addEventListener('input', () => {
    pendingSeek = Number(seek.value);
  });

  function setSpeed(speed) {
    player.setSpeed(speed);
    speedButtons.forEach((button, i) => button.setAttribute('aria-pressed', REPLAY_SPEEDS[i] === speed ? 'true' : 'false'));
  }

  const el = h(
    'div',
    { class: isCoarsePointer() ? 'hud is-replay is-touch' : 'hud is-replay' },
    h('header', { class: 'hud-top' }, resources, versus, h('div', { class: 'hud-right' }, closeButton)),
    h('div', { class: 'hud-banners' }, banner),
    h('div', { class: 'hud-minimap' }, minimap.canvas),
    info,
    bar,
  );

  // ---------- 입력: 살펴보기와 카메라 ----------

  const inspectAt = (x, y) => {
    const w = camera.screenToWorld(x, y);
    const tx = w.x / TILE_SIZE;
    const ty = w.y / TILE_SIZE;
    const unit = world.unitAt(tx, ty);
    const building = unit ? null : world.buildingAt(Math.floor(tx), Math.floor(ty));
    selection.clear();
    if (unit) selection.add(unit.id);
    else if (building) selection.add(building.id);
  };
  input.handlers.down = (button, x, y) => {
    if (button === 0) inspectAt(x, y);
  };
  const touch = new TouchControls(canvas, {
    onTap: inspectAt,
    onPan: (dx, dy) => camera.pan(-dx, -dy),
    onZoom: (direction, x, y) => camera.zoomAt(direction, x, y),
  });
  input.handlers.key = (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      player.togglePlay();
    } else if (event.code === 'Home') {
      player.seek(player.firstTick);
    } else if (event.code === 'Comma') {
      jump(-10);
    } else if (event.code === 'Period') {
      jump(10);
    } else if (/^Digit[1-5]$/.test(event.code)) {
      setSpeed(REPLAY_SPEEDS[Number(event.code.slice(5)) - 1]);
    } else if (event.code === 'Escape') {
      selection.clear();
    }
  };

  function updateInfo() {
    const id = [...selection][0];
    const unit = world.units.get(id);
    const building = unit ? null : world.buildings.get(id);
    const target = unit ?? building;
    if (!target) {
      selection.clear();
      info.hidden = true;
      return;
    }
    const def = unit ? UNITS[unit.type] : BUILDINGS[building.type];
    const title = building?.type === 'keep' ? AGES[world.ages.get(building.owner) ?? 1].keepName : def.name;
    const status = [];
    if (unit?.rooted) status.push('뿌리내림');
    if (unit?.channeling) status.push('영창 중');
    if (unit?.stunned) status.push('기절');
    if (unit?.slowed) status.push('둔화');
    if (building && !building.complete) status.push(`건설 ${Math.floor(building.progress * 100)}%`);
    const rows = [
      h('strong', {}, title),
      h('span', { class: 'replay-info-sub' }, `P${target.owner + 1} ${nameOf(target.owner)}`),
      h('span', { class: 'mono' }, `체력 ${Math.max(0, target.hp)} / ${def.hp}`),
    ];
    if (status.length) rows.push(h('span', { class: 'replay-info-sub' }, status.join(' · ')));
    info.replaceChildren(...rows); // replaceChildren은 null을 "null" 글자로 넣으므로 걸러서 넘긴다
    info.hidden = false;
  }

  function updateHud() {
    const me = world.me;
    if (me) {
      res.gold.textContent = me.gold.toLocaleString('ko-KR');
      res.wood.textContent = me.wood.toLocaleString('ko-KR');
      res.mana.textContent = me.mana.toLocaleString('ko-KR');
      res.pop.textContent = `${me.pop}/${me.popCap}`;
      res.age.textContent = AGES[me.age]?.name ?? '';
    }
    for (const p of players) {
      const oath = world.oathOf(p.slot);
      const pov = p.slot === replay.mySlot ? ' (시점)' : '';
      const text = `P${p.slot + 1} ${p.nickname}${pov}${oath ? ` · ${OATHS[oath].name}` : ''}`;
      if (tags.get(p.slot).textContent !== text) tags.get(p.slot).textContent = text;
    }
    playButton.textContent = player.playing ? '일시정지' : player.ended ? '다시 보기' : '재생';
    if (document.activeElement !== seek) seek.value = player.positionSec.toFixed(2);
    time.textContent = `${formatTime(player.positionSec)} / ${formatTime(player.durationSec)}`;
    if (selection.size) updateInfo();
    else info.hidden = true;

    if (player.ended && replay.result && banner.hidden) {
      const { reason } = replay.result;
      // 예전 리플레이(1대1)는 winner(슬롯)를, 지금은 winnerTeam을 담는다
      const winnerTeam = replay.result.winnerTeam ?? (replay.result.winner != null ? world.teamOf(replay.result.winner) : null);
      const winners = players.filter((p) => (p.team ?? p.slot) === winnerTeam).map((p) => p.nickname).join('·');
      showBanner(winnerTeam == null ? '경기 종료' : `${winners} 승리 · ${REASON_TEXT[reason] ?? reason}`);
    }
  }

  // ---------- 루프 ----------

  canvas.hidden = false;
  renderer.resize();
  const start = map.starts.find((s) => s.slot === replay.mySlot) ?? map.starts[0];
  const keepCenter = footprintCenter(start.keep);
  camera.centerOn(keepCenter.x, keepCenter.y);
  const onResize = () => renderer.resize();
  window.addEventListener('resize', onResize);

  let rafId = 0;
  let lastTime = performance.now();
  let hudTimer = 0;

  function frame(now) {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    const [kx, ky] = input.keyAxis();
    const [ex, ey] = input.edgeAxis(camera.viewWidth, camera.viewHeight);
    const mx = Math.sign(kx + ex);
    const my = Math.sign(ky + ey);
    if (mx || my) {
      const length = Math.hypot(mx, my);
      camera.pan((mx / length) * PAN_SPEED * dt, (my / length) * PAN_SPEED * dt);
    }
    const pan = input.consumePan();
    if (pan.x || pan.y) camera.pan(-pan.x, -pan.y);
    const wheel = input.consumeWheel();
    if (wheel) camera.zoomAt(wheel, input.mouse.x, input.mouse.y);

    if (pendingSeek != null) {
      player.seekSeconds(pendingSeek);
      pendingSeek = null;
    }
    player.advance(dt);
    world.interpolateAt(player.renderTick);

    renderer.draw(now);
    minimap.draw(now);

    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.1;
      updateHud();
    }
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  return {
    el,
    destroy() {
      cancelAnimationFrame(rafId);
      clearTimeout(bannerTimer);
      window.removeEventListener('resize', onResize);
      input.destroy();
      touch.destroy();
      canvas.hidden = true;
    },
  };
}
