import { PLAYER_COLORS, TILE_SIZE } from '@rune/shared/constants.js';
import { BUILDINGS } from '@rune/shared/data/buildings.js';
import { AGES } from '@rune/shared/data/economy.js';
import { UNITS } from '@rune/shared/data/units.js';
import { ABILITIES, GARRISON } from '@rune/shared/data/abilities.js';
import { OATHS, OATH_IDS } from '@rune/shared/data/oaths.js';
import { loadMap } from '@rune/shared/map/maps/index.js';
import { TERRAIN, TERRAIN_NAMES, footprintCenter } from '@rune/shared/map/grid.js';
import { CMD, EV, GAME_EVENT, REJECT, VICTORY_REASON } from '@rune/shared/protocol.js';
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
import { TouchControls, isCoarsePointer } from '../input/TouchControls.js';
import { downloadReplay } from './replayFile.js';

const PAN_SPEED = 1100; // 화면 픽셀/초
const DRAG_THRESHOLD = 5;
const WELL_SNAP_RADIUS = 4;
const NOT_ENOUGH = { gold: REJECT.NOT_ENOUGH_GOLD, wood: REJECT.NOT_ENOUGH_WOOD, mana: REJECT.NOT_ENOUGH_MANA };

/** 경기가 끝난 이유. team이면 "상대 팀" / "우리 팀" 기준으로 말한다 (마지막으로 진 사람의 이유다) */
function endReason(reason, won, team) {
  const them = team ? '상대 팀이' : '상대가';
  const us = team ? '우리 팀이' : '';
  switch (reason) {
    case VICTORY_REASON.SURRENDER:
      return won ? `${them} 항복했습니다` : `${us} 항복했습니다`.trim();
    case VICTORY_REASON.LEFT:
      return won ? `${them} 경기를 떠났습니다` : '경기를 떠났습니다';
    case VICTORY_REASON.ANNIHILATION:
      return won ? `${them} 가진 유닛과 건물을 모두 무너뜨렸습니다` : '유닛과 건물을 모두 잃었습니다';
    default:
      return won ? `${them} 제한 시간 안에 영주관을 다시 세우지 못했습니다` : '제한 시간 안에 영주관을 다시 세우지 못했습니다';
  }
}

/**
 * 게임 화면: 스냅샷을 받아 그리고, 선택·우클릭 명령·건물 배치를 서버에 보낸다.
 * 규칙 판정은 서버가 한다. 클라이언트의 배치 판정은 미리보기용이다.
 */
export function createGameView({ canvas, socket, mapId, players, me, recorder, onLeave, onReturnToRoom }) {
  const map = loadMap(mapId);
  const mySlot = players.find((p) => p.uid === me.uid)?.slot ?? 0;

  const world = new ClientWorld(map, mySlot, players);
  const myTeam = players.find((p) => p.slot === mySlot)?.team ?? mySlot;
  const teamGame = players.length > 2;
  const camera = new Camera(map.width * TILE_SIZE, map.height * TILE_SIZE);
  const renderer = new Renderer(canvas, world, camera, players);
  const minimap = new Minimap(world, camera);
  const input = new Input(canvas);
  const touchMode = isCoarsePointer();
  const commandCard = createCommandCard({ onAction });
  const selection = renderer.selection;

  let seq = 0;
  let placing = null; // 배치 중인 건물 종류
  let targeting = false; // 공격 이동 지점을 고르는 중 (A 뒤 클릭)
  let casting = null; // 능력 쓸 지점을 고르는 중 { ability, unitIds }
  let ended = false;
  let press = null; // 왼쪽 버튼을 누른 위치 { x, y, shift }
  let lastClick = { time: 0, unitId: null }; // 더블클릭 판정

  const send = (cmd) => socket.emit(EV.GAME_CMD, { seq: ++seq, ...cmd });
  const toTile = (sx, sy) => {
    const w = camera.screenToWorld(sx, sy);
    return { x: w.x / TILE_SIZE, y: w.y / TILE_SIZE };
  };

  // ---------- 서버 ----------

  const onSnapshot = (snap) => {
    recorder?.add(snap);
    world.applySnapshot(snap);
    for (const id of selection) {
      const alive = typeof id === 'string' ? world.mineAmounts.has(id) : world.units.has(id) || world.buildings.has(id);
      if (!alive || world.units.get(id)?.carried) selection.delete(id); // 쓰러졌거나 등에 탔다
    }
    if (placing && selectedWorkerIds().length === 0) cancelPlacing();
    if (targeting && selectedOwnUnits().length === 0) targeting = false;
  };
  // Shift로 5기를 한꺼번에 명령하면 같은 거부가 여러 번 올 수 있어 잠깐 동안 한 번만 알린다
  let lastReject = { reason: null, at: 0 };
  const onReject = ({ reason }) => {
    const now = performance.now();
    if (reason === lastReject.reason && now - lastReject.at < 1000) return;
    lastReject = { reason, at: now };
    toast(errorMessage(reason), { error: true });
  };
  const onEnd = (result) => showResult(result);
  // 내 연결이 끊긴 동안은 화면이 멈춘다. 소켓이 스스로 다시 붙고, 붙으면 서버가 GAME_RESUME으로 이어 준다.
  const onOffline = () => {
    netBanner.textContent = '서버와 연결이 끊겼습니다. 다시 연결하는 중…';
    netBanner.hidden = false;
  };
  const onOnline = () => {
    netBanner.hidden = true;
  };
  socket.on(EV.GAME_SNAP, onSnapshot);
  socket.on(EV.GAME_REJECT, onReject);
  socket.on(EV.GAME_END, onEnd);
  socket.on('disconnect', onOffline);
  socket.on('connect', onOnline);

  world.onTreeFelled = (tile) => {
    renderer.terrain.invalidateTile(tile % map.width, Math.floor(tile / map.width));
    minimap.markTerrainDirty();
  };
  world.onTerrainReset = () => {
    renderer.terrain.invalidateAll();
    minimap.markTerrainDirty();
  };
  world.onEvent = (event) => {
    if (event[0] === GAME_EVENT.BUILT && event[2] === mySlot) {
      const building = world.buildings.get(event[1]);
      if (building) toast(`${BUILDINGS[building.type].name}을(를) 다 지었습니다.`);
    } else if (event[0] === GAME_EVENT.AGE_UP && event[1] === mySlot) {
      toast(`${AGES[event[2]].name}에 들어섰습니다.`);
    } else if (event[0] === GAME_EVENT.OATH_TAKEN) {
      // 맹세는 전역 공지다: 상대도 대비할 시간을 준다
      const oath = OATHS[OATH_IDS[event[2]]];
      const who = event[1] === mySlot ? '내' : `${playerName(event[1])}의`;
      announce(`${who} 왕국이 ${oath.name}를 맺었습니다 — ${UNITS[oath.unit].name}`);
    } else if (event[0] === GAME_EVENT.PLAYER_DEFEATED && teamGame && !ended) {
      const slot = event[1];
      const who = slot === mySlot ? '내가' : `${playerName(slot)}이(가)`;
      const side = slot === mySlot ? '' : world.teamOf(slot) === myTeam ? ' (우리 팀)' : ' (상대 팀)';
      toast(`${who} 쓰러졌습니다${side}. 기지가 무너집니다.`, { error: world.teamOf(slot) === myTeam });
    } else if (event[0] === GAME_EVENT.ULTIMATE_REVIVED) {
      const unit = world.units.get(event[1]);
      if (event[2] === mySlot) toast(`${UNITS[unit?.type ?? 'solarion'].name}이(가) 다시 일어섰습니다.`);
    } else if (event[0] === GAME_EVENT.ULTIMATE_LOST) {
      const name = UNITS[event[2]]?.name ?? '궁극 유닛';
      if (event[1] === mySlot) toast(`${name}이(가) 쓰러졌습니다.`, { error: true });
      else toast(`적의 ${name}을(를) 쓰러뜨렸습니다.`);
    }
  };

  const playerName = (slot) => players.find((p) => p.slot === slot)?.nickname ?? `P${slot + 1}`;

  /** 양쪽 모두에게 크게 알리는 공지 (맹세 선언) */
  function announce(text) {
    banner.textContent = text;
    banner.hidden = false;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      banner.hidden = true;
    }, 6000);
  }
  let announceTimer = null;

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

  /** 그 지점의 적 유닛이나 적 건물 */
  function enemyAt(t) {
    const unit = world.unitAt(t.x, t.y);
    if (unit && world.isEnemy(unit)) return unit;
    const building = world.buildingAt(Math.floor(t.x), Math.floor(t.y));
    return building && world.isEnemy(building) ? building : null;
  }

  /** 공격 이동: 적을 찍으면 그 적을 공격, 땅을 찍으면 가며 만나는 적과 싸운다 */
  function attackMoveAt(t) {
    const unitIds = selectedOwnUnits().map((u) => u.id);
    if (!unitIds.length) return;
    const enemy = enemyAt(t);
    if (enemy) send({ type: CMD.ATTACK, unitIds, targetId: enemy.id });
    else send({ type: CMD.ATTACK_MOVE, unitIds, x: t.x, y: t.y });
    renderer.addMarker(t.x, t.y, 'attack');
  }

  /** 내 생산 건물 하나만 골랐으면 그 건물 */
  function selectedProductionBuilding() {
    if (selection.size !== 1) return null;
    const building = world.buildings.get([...selection][0]);
    return building && world.isMine(building) && BUILDINGS[building.type].trains ? building : null;
  }

  function setRallyAt(building, t) {
    const tx = Math.floor(t.x);
    const ty = Math.floor(t.y);
    const cmd = { type: CMD.SET_RALLY, buildingId: building.id, x: t.x, y: t.y };
    const mine = world.mineAt(tx, ty);
    if (mine) cmd.mineId = mine.id;
    else if (world.terrainAt(tx, ty) === TERRAIN.TREE) cmd.tile = ty * map.width + tx;
    send(cmd);
    renderer.addMarker(t.x, t.y, cmd.mineId || cmd.tile !== undefined ? 'work' : 'move');
  }

  /** 화면에 보이는 내 유닛 중 같은 종류를 모두 고른다 (더블클릭) */
  function selectSameTypeOnScreen(type, shift) {
    const view = camera.visibleRect();
    const ids = world
      .myUnitsInRect(view.x / TILE_SIZE, view.y / TILE_SIZE, (view.x + view.w) / TILE_SIZE, (view.y + view.h) / TILE_SIZE)
      .filter((u) => u.type === type)
      .map((u) => u.id);
    if (shift && selectionIsOwnUnits()) ids.push(...selection);
    setSelection(ids);
  }

  function commandAt(t) {
    const building = selectedProductionBuilding();
    if (building) {
      setRallyAt(building, t);
      return;
    }
    const units = selectedOwnUnits();
    if (!units.length) return;

    // 내 아르카논을 우클릭하면 등에 탄다
    const friend = world.unitAt(t.x, t.y);
    if (friend && world.isMine(friend) && UNITS[friend.type].garrison && units.some((u) => u.id !== friend.id)) {
      const riders = units.filter((u) => GARRISON.allow.includes(u.type)).map((u) => u.id);
      if (riders.length) {
        send({ type: CMD.BOARD, unitIds: riders, targetId: friend.id });
        renderer.addMarker(t.x, t.y, 'work');
        return;
      }
    }

    const enemy = enemyAt(t);
    if (enemy) {
      send({ type: CMD.ATTACK, unitIds: units.map((u) => u.id), targetId: enemy.id });
      renderer.addMarker(t.x, t.y, 'attack');
      return;
    }
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
      case 'train':
        for (let i = 0; i < (action.repeat ?? 1); i++) {
          send({ type: CMD.TRAIN, buildingId: action.buildingId, unit: action.unit });
        }
        break;
      case 'cancelTrain':
        send({ type: CMD.CANCEL_TRAIN, buildingId: action.buildingId, index: action.index });
        break;
      case 'attackMove':
        cancelPlacing();
        targeting = true;
        if (touchMode) toast('공격 이동 — 갈 곳을 누르세요');
        break;
      case 'shieldWall':
        send({ type: CMD.TOGGLE_ABILITY, unitIds: selectedOwnUnits().map((u) => u.id), ability: 'shieldWall' });
        break;
      case 'toggleAbility':
        send({ type: CMD.TOGGLE_ABILITY, unitIds: selectedOwnUnits().map((u) => u.id), ability: action.ability });
        break;
      case 'cast':
        send({ type: CMD.USE_ABILITY, unitIds: selectedOwnUnits().map((u) => u.id), ability: action.ability });
        break;
      case 'castTarget': {
        // 땅을 찍어 쓰는 능력: 다음 클릭 지점으로 보낸다
        const ids = selectedOwnUnits()
          .filter((u) => UNITS[u.type].abilities?.includes(action.ability))
          .map((u) => u.id);
        if (!ids.length) break;
        cancelPlacing();
        targeting = false;
        casting = { ability: action.ability, unitIds: ids };
        toast(`${ABILITIES[action.ability].name} — 쓸 곳을 ${touchMode ? '누르세요' : '클릭하세요 (Esc 취소)'}`);
        break;
      }
      case 'takeOath':
        send({ type: CMD.TAKE_OATH, oath: action.oath });
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
    targeting = false;
    casting = null;
    placing = type;
    if (touchMode) toast(`${BUILDINGS[type].name} — 지을 곳을 누른 채 끌어 맞추고 손을 떼세요`);
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
    if (!world.ready || ended) return;
    if (button === 0) {
      if (casting) {
        const t = toTile(x, y);
        send({ type: CMD.USE_ABILITY, unitIds: casting.unitIds, ability: casting.ability, x: t.x, y: t.y });
        renderer.addMarker(t.x, t.y, 'attack');
        casting = null;
      } else if (targeting) {
        attackMoveAt(toTile(x, y));
        if (!event.shiftKey) targeting = false;
      } else if (placing) {
        placeGhost(event.shiftKey);
      } else {
        press = { x, y, shift: event.shiftKey };
      }
    } else if (button === 2) {
      if (casting) casting = null;
      else if (targeting) targeting = false;
      else if (placing) cancelPlacing();
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
    if (box) {
      selectBox(box, shift);
      return;
    }
    const t = toTile(x, y);
    const unit = world.unitAt(t.x, t.y);
    const now = performance.now();
    if (unit && world.isMine(unit) && unit.id === lastClick.unitId && now - lastClick.time < 350) {
      selectSameTypeOnScreen(unit.type, shift);
      lastClick = { time: 0, unitId: null };
    } else {
      selectAt(t, shift);
      lastClick = { time: now, unitId: unit?.id ?? null };
    }
  };
  // ---------- 터치 ----------
  // 탭 하나로 고르기와 명령을 함께 한다: 내 것을 누르면 고르고, 병력을 고른 채 다른 곳을 누르면 명령한다.

  let touchBox = null;
  const touch = new TouchControls(canvas, {
    onTap: (x, y) => tapAt(x, y),
    onDoubleTap: (x, y) => {
      const t = toTile(x, y);
      const unit = world.unitAt(t.x, t.y);
      if (unit && world.isMine(unit) && !casting && !targeting && !placing) selectSameTypeOnScreen(unit.type, false);
      else tapAt(x, y);
    },
    onPan: (dx, dy) => camera.pan(-dx, -dy),
    onZoom: (direction, x, y) => camera.zoomAt(direction, x, y),
    onBox: (phase, x, y) => {
      if (!world.ready || ended) return;
      if (phase === 'start') {
        touchBox = { x0: x, y0: y, x1: x, y1: y };
      } else if (touchBox && phase === 'move') {
        touchBox.x1 = x;
        touchBox.y1 = y;
      } else if (touchBox && phase === 'end') {
        if (Math.hypot(touchBox.x1 - touchBox.x0, touchBox.y1 - touchBox.y0) > DRAG_THRESHOLD) selectBox(touchBox, false);
        touchBox = null;
      } else {
        touchBox = null;
      }
      renderer.dragBox = touchBox ? { ...touchBox } : null;
    },
    // 건물을 놓는 중이면 손가락을 따라 미리보기가 움직이고, 떼는 자리에 짓는다
    dragsGhost: () => Boolean(placing) && world.ready && !ended,
    onGhost: (phase, x, y) => {
      input.mouse.x = x;
      input.mouse.y = y - (touchMode ? 48 : 0); // 손가락에 가려지지 않게 조금 위에 보여 준다
      input.mouse.inside = phase === 'start' || phase === 'move';
      if (phase === 'end') {
        input.mouse.inside = true;
        updateGhost();
        placeGhost(false);
        input.mouse.inside = false;
      }
    },
  });

  function tapAt(x, y) {
    if (!world.ready || ended) return;
    const t = toTile(x, y);
    if (casting) {
      send({ type: CMD.USE_ABILITY, unitIds: casting.unitIds, ability: casting.ability, x: t.x, y: t.y });
      renderer.addMarker(t.x, t.y, 'attack');
      casting = null;
      return;
    }
    if (targeting) {
      attackMoveAt(t);
      targeting = false;
      return;
    }

    const own = selectedOwnUnits();
    const unit = world.unitAt(t.x, t.y);
    const building = unit ? null : world.buildingAt(Math.floor(t.x), Math.floor(t.y));

    if (unit && world.isMine(unit)) {
      // 내 아르카논을 누르면 고른 병력이 등에 탄다
      const boarding = UNITS[unit.type].garrison && own.some((u) => u.id !== unit.id && GARRISON.allow.includes(u.type));
      if (boarding) commandAt(t);
      else selectAt(t, false);
      return;
    }
    if (building && world.isMine(building)) {
      // 농노를 고른 채 짓다 만 건물·반납할 건물을 누르면 일을 시킨다
      const accepts = BUILDINGS[building.type].dropoff ?? [];
      const workers = own.filter((u) => UNITS[u.type].worker);
      const helps = workers.length && (!building.complete || workers.some((u) => u.carryAmount > 0 && accepts.includes(u.carryKind)));
      if (helps) commandAt(t);
      else selectAt(t, false);
      return;
    }
    if (own.length || selectedProductionBuilding()) {
      commandAt(t); // 적은 공격, 금광·나무는 채집, 땅은 이동, 생산 건물이면 집결지
      return;
    }
    selectAt(t, false);
  }

  /** 터치 화면의 빠른 선택 버튼 */
  function selectArmy() {
    const ids = [...world.units.values()]
      .filter((u) => world.isMine(u) && !u.carried && !UNITS[u.type].worker)
      .map((u) => u.id);
    if (!ids.length) toast('고를 병력이 없습니다.');
    setSelection(ids);
  }

  function selectIdleWorkers() {
    const idle = [...world.units.values()].filter((u) => world.isMine(u) && UNITS[u.type].worker && u.state === 0);
    if (!idle.length) {
      toast('쉬고 있는 농노가 없습니다.');
      return;
    }
    setSelection(idle.map((u) => u.id));
    const first = idle[0];
    camera.centerOn(first.drawX * TILE_SIZE, first.drawY * TILE_SIZE);
  }

  function cancelMode() {
    casting = null;
    targeting = false;
    cancelPlacing();
  }

  input.handlers.key = (event) => {
    if (ended) return;
    if (event.code === 'Escape') {
      if (casting) casting = null;
      else if (targeting) targeting = false;
      else if (placing) cancelPlacing();
      else selection.clear();
      return;
    }
    if (commandCard.handleKey(event)) event.preventDefault();
  };

  // ---------- HUD ----------

  // 우리 팀을 왼쪽에, 상대 팀을 오른쪽에
  const playerTags = new Map();
  const versus = h('div', { class: 'versus' });
  [myTeam, 1 - myTeam].forEach((team, i) => {
    if (i > 0) versus.append(h('span', { class: 'vs' }, 'VS'));
    for (const player of players.filter((p) => (p.team ?? p.slot) === team)) {
      const tag = h(
        'span',
        { class: player.uid === me.uid ? 'player-tag is-me' : 'player-tag' },
        h('i', { class: 'swatch', style: `--c: ${PLAYER_COLORS[player.slot]}` }),
        `P${player.slot + 1} ${player.nickname}`,
      );
      playerTags.set(player.uid, tag);
      versus.append(tag);
    }
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
  const netBanner = h('div', { class: 'hud-banner is-danger', role: 'status', hidden: true });
  const crownBanner = h('div', { class: 'hud-banner', role: 'status', hidden: true });

  const surrenderConfirm = h(
    'div',
    { class: 'confirm', role: 'dialog', 'aria-label': '항복 확인', hidden: true },
    h('p', {}, '항복하면 바로 패배합니다.'),
    h(
      'div',
      { class: 'confirm-actions' },
      h('button', { class: 'btn btn-sm', type: 'button', onClick: () => { surrenderConfirm.hidden = true; } }, '계속 싸우기'),
      h(
        'button',
        {
          class: 'btn btn-sm btn-danger',
          type: 'button',
          onClick: () => {
            surrenderConfirm.hidden = true;
            send({ type: CMD.SURRENDER });
          },
        },
        '항복',
      ),
    ),
  );
  const surrenderButton = h(
    'button',
    { class: 'btn btn-sm', type: 'button', onClick: () => { surrenderConfirm.hidden = !surrenderConfirm.hidden; } },
    '항복',
  );

  // 터치 화면용 도구: Esc·드래그 선택을 대신한다
  const cancelModeButton = h('button', { class: 'touch-btn is-cancel', type: 'button', hidden: true, onClick: () => cancelMode() }, '취소');
  const touchTools = touchMode
    ? h(
        'div',
        { class: 'touch-tools', role: 'group', 'aria-label': '빠른 선택' },
        cancelModeButton,
        h('button', { class: 'touch-btn', type: 'button', onClick: () => selectArmy() }, '병력 전체'),
        h('button', { class: 'touch-btn', type: 'button', onClick: () => selectIdleWorkers() }, '쉬는 농노'),
      )
    : null;

  const resultPanel = h('div', { class: 'result-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': '경기 결과' });
  const resultOverlay = h('div', { class: 'result-overlay', hidden: true }, resultPanel);

  async function saveReplay(event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const bytes = await downloadReplay(recorder.build());
      toast(`리플레이를 저장했습니다 (${Math.max(1, Math.round(bytes / 1024))} KB). 로비에서 열어 볼 수 있습니다.`);
    } catch (err) {
      console.error('[리플레이 저장 실패]', err);
      toast('리플레이를 저장하지 못했습니다.', { error: true });
    } finally {
      button.disabled = false;
    }
  }

  function showResult(result) {
    ended = true;
    cancelPlacing();
    targeting = false;
    renderer.attackCursor = null;
    surrenderConfirm.hidden = true;
    surrenderButton.disabled = true;

    recorder?.finish(result);
    const won = result.winnerTeam === myTeam;
    const minutes = Math.floor(result.durationSec / 60);
    const seconds = String(result.durationSec % 60).padStart(2, '0');
    resultPanel.replaceChildren(
      h('p', { class: won ? 'result-kicker is-win' : 'result-kicker' }, won ? '승리' : '패배'),
      h('h2', { class: 'result-title' }, won ? '왕관을 지켰습니다' : '왕관을 잃었습니다'),
      h('p', { class: 'result-reason' }, `${endReason(result.reason, won, teamGame)} · 경기 시간 ${minutes}분 ${seconds}초`),
      teamGame
        ? h(
            'ul',
            { class: 'result-teams' },
            ...[0, 1].map((team) =>
              h(
                'li',
                { class: team === result.winnerTeam ? 'is-winner' : '' },
                h('strong', {}, team === myTeam ? '우리 팀' : '상대 팀'),
                ' ',
                result.players
                  .filter((p) => p.team === team)
                  .map((p) => p.nickname)
                  .join(' · '),
              ),
            ),
          )
        : null,
      h(
        'div',
        { class: 'result-actions' },
        h('button', { class: 'btn', type: 'button', onClick: onLeave }, '로비로'),
        recorder ? h('button', { class: 'btn', type: 'button', onClick: saveReplay }, '리플레이 저장') : null,
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => onReturnToRoom?.() }, '대기실로 (재대결)'),
      ),
    );
    resultOverlay.hidden = false;
  }

  const el = h(
    'div',
    { class: touchMode ? 'hud is-touch' : 'hud' },
    h(
      'header',
      { class: 'hud-top' },
      resources,
      versus,
      h('div', { class: 'hud-right' }, ping, surrenderButton, surrenderConfirm),
    ),
    h('div', { class: 'hud-banners' }, crownBanner, netBanner, banner),
    h('div', { class: 'hud-minimap' }, minimap.canvas),
    touchTools,
    touchMode ? h('p', { class: 'rotate-hint' }, '가로로 돌리면 더 넓게 볼 수 있습니다') : null,
    commandCard.el,
    h(
      'div',
      { class: 'hud-info' },
      h('span', {}, '타일 ', tileInfo),
      h('span', {}, '확대 ', zoomInfo),
      h('span', {}, '방향키·가장자리 이동 · 휠 확대'),
    ),
    resultOverlay,
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

    // 맺은 맹세는 서로에게 공개된다
    for (const player of players) {
      const oath = world.oathOf(player.slot);
      const tag = playerTags.get(player.uid);
      if (!tag || tag.dataset.oath === (oath ?? '')) continue;
      tag.dataset.oath = oath ?? '';
      tag.lastChild.textContent = `P${player.slot + 1} ${player.nickname}${oath ? ` · ${OATHS[oath].name}` : ''}`;
    }

    // 왕관 몰락 카운트다운: 내 것이 급하고, 없으면 상대 것을 보여준다
    const mine = world.publicPlayers.get(mySlot);
    const others = [...world.publicPlayers.values()].filter((p) => p.slot !== mySlot && p.collapseSeconds != null && !p.defeated);
    const ally = others.find((p) => p.team === myTeam);
    const rival = others.find((p) => p.team !== myTeam);
    if (!ended && mine?.collapseSeconds != null) {
      crownBanner.textContent = `왕관 몰락까지 ${mine.collapseSeconds}초 — 영주관을 다시 지으세요`;
      crownBanner.className = 'hud-banner is-danger';
      crownBanner.hidden = false;
    } else if (!ended && ally) {
      crownBanner.textContent = `팀원 ${playerName(ally.slot)}의 왕관 몰락까지 ${ally.collapseSeconds}초`;
      crownBanner.className = 'hud-banner is-danger';
      crownBanner.hidden = false;
    } else if (!ended && rival) {
      crownBanner.textContent = `${teamGame ? `${playerName(rival.slot)}의 ` : '상대 '}왕관 몰락까지 ${rival.collapseSeconds}초`;
      crownBanner.className = 'hud-banner';
      crownBanner.hidden = false;
    } else {
      crownBanner.hidden = true;
    }

    commandCard.update({ world, selection, players, touch: touchMode });
    cancelModeButton.hidden = !(casting || targeting || placing);
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
    renderer.attackCursor = targeting && input.mouse.inside ? toTile(input.mouse.x, input.mouse.y) : null;
    renderer.castCursor =
      casting && input.mouse.inside ? { ...toTile(input.mouse.x, input.mouse.y), ability: casting.ability } : null;
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
    const present = new Map(room.players.map((p) => [p.uid, p]));
    let message = '';
    for (const [uid, tag] of playerTags) {
      const player = present.get(uid);
      const offline = player ? player.connected === false : true;
      tag.classList.toggle('is-gone', offline);
      if (uid === me.uid || !offline) continue;
      message = player ? '상대의 연결이 끊겼습니다. 돌아오기를 기다리는 중…' : '상대가 경기를 떠났습니다.';
    }
    banner.textContent = message;
    banner.hidden = !message;
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
      socket.off(EV.GAME_END, onEnd);
      socket.off('disconnect', onOffline);
      socket.off('connect', onOnline);
      input.destroy();
      touch.destroy();
      canvas.hidden = true;
    },
  };
}
