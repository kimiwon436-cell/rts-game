import { PLAYER_COLORS, TILE_SIZE } from '@rune/shared/constants.js';
import { BUILDINGS } from '@rune/shared/data/buildings.js';
import { AGES } from '@rune/shared/data/economy.js';
import { UNITS } from '@rune/shared/data/units.js';
import { loadMap } from '@rune/shared/map/maps/index.js';
import { TERRAIN, TERRAIN_NAMES, footprintCenter } from '@rune/shared/map/grid.js';
import { CMD, EV, GAME_EVENT, REJECT } from '@rune/shared/protocol.js';
import { PLACE, checkPlacement } from '@rune/shared/rules/placement.js';
import { missingResource } from '@rune/shared/rules/costs.js';
import { h } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { errorMessage } from '../ui/messages.js';
import { createCommandCard } from '../ui/commandCard.js';
import { ClientWorld } from '../world/ClientWorld.js';
import { Camera } from '../render/Camera.js';
import { Renderer } from '../render/Renderer.js';
import { Minimap } from '../render/minimap.js';
import { Input } from '../input/Input.js';

const PAN_SPEED = 1100; // 화면 픽셀/초
const DRAG_THRESHOLD = 5;
const WELL_SNAP_RADIUS = 4;
const NOT_ENOUGH = { gold: REJECT.NOT_ENOUGH_GOLD, wood: REJECT.NOT_ENOUGH_WOOD, mana: REJECT.NOT_ENOUGH_MANA };

/**
 * 게임 화면: 스냅샷을 받아 그리고, 선택·우클릭 명령·건물 배치를 서버에 보낸다.
 * 규칙 판정은 서버가 한다. 클라이언트의 배치 판정은 미리보기용이다.
 */
export function createGameView({ canvas, socket, mapId, players, me, onLeave }) {
  const map = loadMap(mapId);
  const mySlot = players.find((p) => p.uid === me.uid)?.slot ?? 0;

  const world = new ClientWorld(map, mySlot);
  const camera = new Camera(map.width * TILE_SIZE, map.height * TILE_SIZE);
  const renderer = new Renderer(canvas, world, camera, players);
  const minimap = new Minimap(world, camera);
  const input = new Input(canvas);
  const commandCard = createCommandCard({ onAction });
  const selection = renderer.selection;

  let seq = 0;
  let placing = null; // 배치 중인 건물 종류
  let press = null; // 왼쪽 버튼을 누른 위치 { x, y, shift }

  const send = (cmd) => socket.emit(EV.GAME_CMD, { seq: ++seq, ...cmd });
  const toTile = (sx, sy) => {
    const w = camera.screenToWorld(sx, sy);
    return { x: w.x / TILE_SIZE, y: w.y / TILE_SIZE };
  };

  // ---------- 서버 ----------

  const onSnapshot = (snap) => {
    world.applySnapshot(snap);
    for (const id of selection) {
      const alive = typeof id === 'string' ? world.mineAmounts.has(id) : world.units.has(id) || world.buildings.has(id);
      if (!alive) selection.delete(id);
    }
    if (placing && selectedWorkerIds().length === 0) cancelPlacing();
  };
  const onReject = ({ reason }) => toast(errorMessage(reason), { error: true });
  socket.on(EV.GAME_SNAP, onSnapshot);
  socket.on(EV.GAME_REJECT, onReject);

  world.onTreeFelled = (tile) => {
    renderer.terrain.invalidateTile(tile % map.width, Math.floor(tile / map.width));
    minimap.markTerrainDirty();
  };
  world.onEvent = (event) => {
    if (event[0] === GAME_EVENT.BUILT && event[2] === mySlot) {
      const building = world.buildings.get(event[1]);
      if (building) toast(`${BUILDINGS[building.type].name}을(를) 다 지었습니다.`);
    } else if (event[0] === GAME_EVENT.AGE_UP && event[1] === mySlot) {
      toast(`${AGES[event[2]].name}에 들어섰습니다.`);
    }
  };

  // ---------- 선택 ----------

  function setSelection(ids) {
    selection.clear();
    ids.forEach((id) => selection.add(id));
  }

  const selectedOwnUnits = () =>
    [...selection].map((id) => world.units.get(id)).filter((u) => u && world.isMine(u));

  function selectedWorkerIds() {
    return selectedOwnUnits()
      .filter((u) => UNITS[u.type].worker)
      .map((u) => u.id);
  }

  const selectionIsOwnUnits = () => selection.size > 0 && selectedOwnUnits().length === selection.size;

  function selectAt(t, shift) {
    const unit = world.unitAt(t.x, t.y);
    if (unit) {
      if (shift && world.isMine(unit) && selectionIsOwnUnits()) {
        if (selection.has(unit.id)) selection.delete(unit.id);
        else selection.add(unit.id);
      } else {
        setSelection([unit.id]);
      }
      return;
    }
    if (shift) return;
    const tx = Math.floor(t.x);
    const ty = Math.floor(t.y);
    const building = world.buildingAt(tx, ty);
    const mine = building ? null : world.mineAt(tx, ty);
    setSelection(building ? [building.id] : mine ? [mine.id] : []);
  }

  function selectBox(box, shift) {
    const a = toTile(box.x0, box.y0);
    const b = toTile(box.x1, box.y1);
    const ids = world.myUnitsInRect(a.x, a.y, b.x, b.y).map((u) => u.id);
    if (shift && selectionIsOwnUnits()) ids.push(...selection);
    if (ids.length || !shift) setSelection(ids);
  }

  // ---------- 명령 ----------

  function commandAt(t) {
    const units = selectedOwnUnits();
    if (!units.length) return;
    const tx = Math.floor(t.x);
    const ty = Math.floor(t.y);
    const workerIds = units.filter((u) => UNITS[u.type].worker).map((u) => u.id);

    if (workerIds.length) {
      const mine = world.mineAt(tx, ty);
      if (mine) {
        send({ type: CMD.GATHER, unitIds: workerIds, mineId: mine.id });
        renderer.addMarker(t.x, t.y, 'work');
        return;
      }
      if (world.terrainAt(tx, ty) === TERRAIN.TREE) {
        send({ type: CMD.GATHER, unitIds: workerIds, tile: ty * map.width + tx });
        renderer.addMarker(t.x, t.y, 'work');
        return;
      }
      const building = world.buildingAt(tx, ty);
      if (building && world.isMine(building)) {
        if (!building.complete) {
          send({ type: CMD.CONSTRUCT, unitIds: workerIds, buildingId: building.id });
          renderer.addMarker(t.x, t.y, 'work');
          return;
        }
        const accepts = BUILDINGS[building.type].dropoff ?? [];
        const carriers = units.filter((u) => u.carryAmount > 0 && accepts.includes(u.carryKind));
        if (carriers.length) {
          send({ type: CMD.RETURN_CARGO, unitIds: carriers.map((u) => u.id) });
          renderer.addMarker(t.x, t.y, 'work');
          return;
        }
      }
    }

    send({ type: CMD.MOVE, unitIds: units.map((u) => u.id), x: t.x, y: t.y });
    renderer.addMarker(t.x, t.y, 'move');
  }

  function onAction(action) {
    switch (action.kind) {
      case 'build':
        startPlacing(action.type);
        break;
      case 'stop':
        send({ type: CMD.STOP, unitIds: selectedOwnUnits().map((u) => u.id) });
        break;
      case 'ageUp':
        send({ type: CMD.AGE_UP });
        break;
      case 'cancelAgeUp':
        send({ type: CMD.CANCEL_AGE_UP });
        break;
      case 'cancelBuild':
        send({ type: CMD.CANCEL_BUILD, buildingId: action.id });
        break;
      case 'trade':
        send({ type: CMD.TRADE, resource: action.resource, action: action.action });
        break;
      default:
    }
  }

  // ---------- 건물 배치 ----------

  function startPlacing(type) {
    const missing = missingResource(world.me, BUILDINGS[type].cost);
    if (missing) {
      toast(errorMessage(NOT_ENOUGH[missing]), { error: true });
      return;
    }
    placing = type;
  }

  function cancelPlacing() {
    placing = null;
    renderer.ghost = null;
  }

  function updateGhost() {
    if (!placing || !input.mouse.inside) {
      renderer.ghost = null;
      return;
    }
    const def = BUILDINGS[placing];
    const t = toTile(input.mouse.x, input.mouse.y);
    let x = Math.round(t.x - def.size / 2);
    let y = Math.round(t.y - def.size / 2);
    if (def.onWell) {
      const well = nearestFreeWell(t);
      if (well) ({ x, y } = well);
    }
    const result = checkPlacement({
      type: placing,
      x,
      y,
      map,
      tiles: world.tiles,
      occupied: world.getOccupied(),
      isWellTaken: (id) => world.isWellTaken(id),
    });
    renderer.ghost = { type: placing, x, y, valid: result === PLACE.OK, reason: result };
  }

  function nearestFreeWell(t) {
    let best = null;
    let bestDistance = WELL_SNAP_RADIUS;
    for (const well of map.wells) {
      if (world.isWellTaken(well.id)) continue;
      const d = Math.hypot(well.x + well.w / 2 - t.x, well.y + well.h / 2 - t.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = well;
      }
    }
    return best;
  }

  function placeGhost(keepPlacing) {
    const ghost = renderer.ghost;
    if (!ghost) return;
    if (!ghost.valid) {
      toast(errorMessage(ghost.reason), { error: true });
      return;
    }
    const unitIds = selectedWorkerIds();
    if (!unitIds.length) {
      toast(errorMessage(REJECT.NO_WORKER), { error: true });
      cancelPlacing();
      return;
    }
    send({ type: CMD.PLACE, unitIds, building: ghost.type, x: ghost.x, y: ghost.y });
    const size = BUILDINGS[ghost.type].size;
    renderer.addMarker(ghost.x + size / 2, ghost.y + size / 2, 'place');
    if (!keepPlacing || missingResource(world.me, BUILDINGS[ghost.type].cost)) cancelPlacing();
  }

  // ---------- 입력 ----------

  input.handlers.down = (button, x, y, event) => {
    if (!world.ready) return;
    if (button === 0) {
      if (placing) placeGhost(event.shiftKey);
      else press = { x, y, shift: event.shiftKey };
    } else if (button === 2) {
      if (placing) cancelPlacing();
      else commandAt(toTile(x, y));
    }
  };
  input.handlers.move = (x, y) => {
    if (press && Math.hypot(x - press.x, y - press.y) > DRAG_THRESHOLD) {
      renderer.dragBox = { x0: press.x, y0: press.y, x1: x, y1: y };
    }
  };
  input.handlers.up = (button, x, y) => {
    if (button !== 0 || !press) return;
    const { shift } = press;
    const box = renderer.dragBox;
    press = null;
    renderer.dragBox = null;
    if (box) selectBox(box, shift);
    else selectAt(toTile(x, y), shift);
  };
  input.handlers.key = (event) => {
    if (event.code === 'Escape') {
      if (placing) cancelPlacing();
      else selection.clear();
      return;
    }
    if (commandCard.handleKey(event)) event.preventDefault();
  };

  // ---------- HUD ----------

  const playerTags = new Map();
  const versus = h('div', { class: 'versus' });
  players.forEach((player, i) => {
    if (i > 0) versus.append(h('span', { class: 'vs' }, 'VS'));
    const tag = h(
      'span',
      { class: player.uid === me.uid ? 'player-tag is-me' : 'player-tag' },
      h('i', { class: 'swatch', style: `--c: ${PLAYER_COLORS[player.slot]}` }),
      `P${player.slot + 1} ${player.nickname}`,
    );
    playerTags.set(player.uid, tag);
    versus.append(tag);
  });

  const resourceValue = () => h('span', { class: 'res-val' }, '—');
  const res = { gold: resourceValue(), wood: resourceValue(), mana: resourceValue(), pop: resourceValue(), age: h('span', { class: 'res-age' }, '—') };
  const resources = h(
    'div',
    { class: 'resources' },
    h('span', { class: 'res res-gold' }, h('b', { class: 'res-label' }, '금'), res.gold),
    h('span', { class: 'res res-wood' }, h('b', { class: 'res-label' }, '목재'), res.wood),
    h('span', { class: 'res res-mana' }, h('b', { class: 'res-label' }, '마나'), res.mana),
    h('span', { class: 'res res-pop' }, h('b', { class: 'res-label' }, '인구'), res.pop),
    res.age,
  );

  const ping = h('span', { class: 'mono' }, '— ms');
  const tileInfo = h('span', { class: 'mono' }, '—');
  const zoomInfo = h('span', { class: 'mono' }, '100%');
  const banner = h('div', { class: 'hud-banner', role: 'status', hidden: true });

  const el = h(
    'div',
    { class: 'hud' },
    h(
      'header',
      { class: 'hud-top' },
      resources,
      versus,
      h('div', { class: 'hud-right' }, ping, h('button', { class: 'btn btn-sm', type: 'button', onClick: onLeave }, '나가기')),
    ),
    banner,
    h('div', { class: 'hud-minimap' }, minimap.canvas),
    commandCard.el,
    h(
      'div',
      { class: 'hud-info' },
      h('span', {}, '타일 ', tileInfo),
      h('span', {}, '확대 ', zoomInfo),
      h('span', {}, '방향키·가장자리 이동 · 휠 확대'),
    ),
  );

  function updateHud() {
    const p = world.me;
    if (p) {
      res.gold.textContent = p.gold.toLocaleString('ko-KR');
      res.wood.textContent = p.wood.toLocaleString('ko-KR');
      res.mana.textContent = p.mana.toLocaleString('ko-KR');
      res.pop.textContent = `${p.pop}/${p.popCap}`;
      res.pop.classList.toggle('is-full', p.pop >= p.popCap);
      res.age.textContent = p.ageTarget
        ? `${AGES[p.ageTarget].name}로 발전 중 ${Math.floor(p.ageProgress * 100)}%`
        : AGES[p.age].name;
    }
    const t = renderer.hoverTile;
    tileInfo.textContent =
      t && t.x >= 0 && t.y >= 0 && t.x < map.width && t.y < map.height
        ? `${t.x}, ${t.y} · ${TERRAIN_NAMES[world.tiles[t.y * map.width + t.x]]}`
        : '—';
    zoomInfo.textContent = `${Math.round(camera.zoom * 100)}%`;
    commandCard.update({ world, selection, players });
  }

  // ---------- 루프 ----------

  canvas.hidden = false;
  renderer.resize();
  const keepCenter = footprintCenter(map.starts.find((s) => s.slot === mySlot).keep);
  camera.centerOn(keepCenter.x, keepCenter.y);

  const onResize = () => renderer.resize();
  window.addEventListener('resize', onResize);

  let rafId = 0;
  let lastTime = performance.now();
  let hudTimer = 0;

  function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    const [kx, ky] = input.keyAxis();
    const [ex, ey] = press ? [0, 0] : input.edgeAxis(camera.viewWidth, camera.viewHeight);
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

    world.updateDrawPositions(dt);
    updateGhost();
    if (input.mouse.inside) {
      const t = toTile(input.mouse.x, input.mouse.y);
      renderer.hoverTile = { x: Math.floor(t.x), y: Math.floor(t.y) };
    } else {
      renderer.hoverTile = null;
    }

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

  /** 방 상태가 바뀌면(상대가 나가면) HUD에 표시한다 */
  function updateRoom(room) {
    const present = new Set(room.players.map((p) => p.uid));
    let opponentLeft = false;
    for (const [uid, tag] of playerTags) {
      const gone = !present.has(uid);
      tag.classList.toggle('is-gone', gone);
      if (gone && uid !== me.uid) opponentLeft = true;
    }
    banner.textContent = '상대가 나갔습니다. 나가기를 눌러 로비로 돌아가세요.';
    banner.hidden = !opponentLeft;
  }

  return {
    el,
    updateRoom,
    setPing: (ms) => {
      ping.textContent = `${ms} ms`;
    },
    destroy() {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      socket.off(EV.GAME_SNAP, onSnapshot);
      socket.off(EV.GAME_REJECT, onReject);
      input.destroy();
      canvas.hidden = true;
    },
  };
}
