// 개발용 그림 확인 화면 (/gallery.html). 게임과 같은 그리기 함수로 유닛·건물을 늘어놓는다.
// ?view=scene|units|buildings  ?zoom=1.5  ?colors=0,1  ?t=1234 (시간을 멈춰 같은 그림을 다시 본다)
import { PLAYER_COLORS, TILE_SIZE } from '@rune/shared/constants.js';
import { UNITS, UNIT_TYPES } from '@rune/shared/data/units.js';
import { BUILDINGS, BUILDING_TYPES } from '@rune/shared/data/buildings.js';
import { TERRAIN } from '@rune/shared/map/grid.js';
import { UNIT_STATE } from '@rune/shared/protocol.js';
import { TerrainCache } from '../render/terrain.js';
import { drawBuilding, drawEffect, drawGoldMine, drawSelectionRing, drawUnit } from '../render/entities.js';

const S = TILE_SIZE;
const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'scene';
const zoom = Number(params.get('zoom') ?? 1);
const colors = (params.get('colors') ?? '0,1').split(',').map(Number);
const frozen = params.has('t') ? Number(params.get('t')) : null;
const only = params.get('types')?.split(',') ?? null; // 이 종류만 (유닛·건물 표)
const cellSize = Number(params.get('cell') ?? 96); // 유닛 표 칸 너비

const nav = document.getElementById('nav');
for (const [name, label] of [['scene', '전투 장면'], ['units', '유닛'], ['buildings', '건물']]) {
  const link = document.createElement('a');
  link.href = `?view=${name}&zoom=${name === 'scene' ? 1 : 1.5}`;
  link.textContent = label;
  if (name === view) link.style.fontWeight = '700';
  nav.append(link);
}
nav.append(`배율 ${zoom} · 색 ${colors.join(',')}${frozen != null ? ` · 멈춘 시간 ${frozen}` : ''}`);

const canvas = document.getElementById('gallery');
const ctx = canvas.getContext('2d');

/** 풀밭 맵 (가장자리 오른쪽은 물, 여기저기 나무·흙) */
function makeMap(w, h) {
  const tiles = new Uint8Array(w * h).fill(TERRAIN.GRASS);
  const set = (x, y, t) => {
    if (x >= 0 && y >= 0 && x < w && y < h) tiles[y * w + x] = t;
  };
  for (let y = 0; y < h; y++) for (let x = w - 4; x < w; x++) set(x, y, TERRAIN.WATER);
  for (let y = 0; y < h; y++) set(w - 5, y, y % 7 === 3 ? TERRAIN.DIRT : TERRAIN.GRASS);
  for (const [x, y] of [[1, 1], [2, 1], [1, 2], [3, 2], [2, 3], [1, 4], [0, 5], [1, 6], [24, 1], [25, 2], [23, 2], [24, 3]]) set(x, y, TERRAIN.TREE);
  for (let x = 6; x < 20; x++) set(x, 11, TERRAIN.DIRT);
  for (let y = 5; y < 18; y++) set(13, y, TERRAIN.DIRT);
  set(4, 16, TERRAIN.ROCK);
  set(5, 16, TERRAIN.ROCK);
  set(4, 17, TERRAIN.ROCK);
  return { id: 'gallery', width: w, height: h, tiles, goldMines: [], wells: [], starts: [] };
}

let nextId = 1;
const unit = (type, owner, x, y, extra = {}) => ({
  id: nextId++,
  type,
  owner,
  x,
  y,
  drawX: x,
  drawY: y,
  facing: 1,
  state: UNIT_STATE.IDLE,
  hp: UNITS[type].hp,
  carryKind: null,
  carryAmount: 0,
  ...extra,
});
const building = (type, owner, x, y, extra = {}) => ({
  id: nextId++,
  type,
  owner,
  x,
  y,
  size: BUILDINGS[type].size,
  complete: true,
  started: true,
  progress: 1,
  hp: BUILDINGS[type].hp,
  ...extra,
});

/** 캔버스 크기를 맞춘다 (바뀔 때만) */
function setup(width, height) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(width * zoom * dpr);
  const h = Math.round(height * zoom * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${width * zoom}px`;
    canvas.style.height = `${height * zoom}px`;
  }
  return dpr;
}

/** 그리다 실패하면 빨간 상자로 알린다 (한 번만 로그) */
const failed = new Set();
function safe(draw, key, x, y, w = S, h = S) {
  try {
    draw();
  } catch (err) {
    ctx.fillStyle = 'rgba(220, 40, 40, 0.8)';
    ctx.fillRect(x, y, w, h);
    if (!failed.has(key)) {
      failed.add(key);
      console.error(`[그림 실패] ${key}`, err);
    }
  }
}

function label(text, x, y) {
  ctx.font = '600 11px "IBM Plex Sans KR", "Malgun Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(232, 226, 212, 0.85)';
  ctx.fillText(text, x, y);
}

// ---------- 유닛 표 ----------

const UNIT_COLUMNS = [
  { name: '서 있음', make: (u) => u, dt: 0 },
  { name: '걷기 1', make: (u) => ({ ...u, state: UNIT_STATE.MOVE }), dt: 0 },
  { name: '걷기 2', make: (u) => ({ ...u, state: UNIT_STATE.MOVE }), dt: 90 },
  { name: '걷기 3', make: (u) => ({ ...u, state: UNIT_STATE.MOVE }), dt: 180 },
  { name: '걷기 4', make: (u) => ({ ...u, state: UNIT_STATE.MOVE }), dt: 270 },
  { name: '공격 1', make: (u, t) => ({ ...u, state: UNIT_STATE.ATTACK, attackAt: t - 40 }), dt: 0 },
  { name: '공격 2', make: (u, t) => ({ ...u, state: UNIT_STATE.ATTACK, attackAt: t - 130 }), dt: 0 },
  { name: '공격 3', make: (u, t) => ({ ...u, state: UNIT_STATE.ATTACK, attackAt: t - 260 }), dt: 0 },
  { name: '왼쪽', make: (u) => ({ ...u, facing: -1 }), dt: 0 },
  {
    name: '특수',
    make: (u) => {
      if (u.type === 'peasant') return { ...u, state: UNIT_STATE.GATHER, carryKind: 'gold', carryAmount: 5 };
      if (u.type === 'royal_guard') return { ...u, shieldWall: true };
      if (u.type === 'arkanon') return { ...u, rooted: true };
      if (u.type === 'solarion') return { ...u, buffed: true };
      return { ...u, state: UNIT_STATE.MOVE, facing: -1 };
    },
    dt: 45,
  },
];

function drawUnitsTable(t) {
  const cellW = cellSize;
  const types = UNIT_TYPES.filter((type) => !only || only.includes(type));
  const width = 70 + UNIT_COLUMNS.length * cellW;
  const rows = colors.flatMap((color) => types.map((type) => ({ type, color, h: (UNITS[type].radius > 0.5 ? 104 : 72) * Math.min(1, cellW / 80) })));
  const height = 40 + rows.reduce((sum, r) => sum + r.h, 0);
  const dpr = setup(width, height);
  ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, 0, 0);
  ctx.fillStyle = '#4d7a3a';
  ctx.fillRect(0, 0, width, height);
  UNIT_COLUMNS.forEach((col, i) => label(col.name, 70 + i * cellW + cellW / 2, 24));
  let y = 40;
  for (const row of rows) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.fillRect(0, y, width, 1);
    ctx.textAlign = 'left';
    label(UNITS[row.type].name, 34, y + row.h / 2 + 4);
    UNIT_COLUMNS.forEach((col, i) => {
      const cx = 70 + i * cellW + cellW / 2;
      const cy = y + row.h * 0.55;
      const base = unit(row.type, row.color, cx / S, cy / S, { id: 7 });
      const cellT = t + col.dt;
      safe(() => drawUnit(ctx, col.make(base, cellT), PLAYER_COLORS[row.color], cellT), row.type, cx - 12, cy - 20, 24, 30);
    });
    y += row.h;
  }
}

// ---------- 건물 표 ----------

let grassCache = null;

function drawBuildingsTable(t) {
  const columns = [
    { name: '완성', make: (b) => b },
    { name: '짓는 중 35%', make: (b) => ({ ...b, complete: false, progress: 0.35 }) },
    { name: '짓는 중 75%', make: (b) => ({ ...b, complete: false, progress: 0.75 }) },
    { name: '다른 색', make: (b) => ({ ...b, owner: colors[1] ?? 1 }) },
    { name: '많이 다침', make: (b) => ({ ...b, hp: BUILDINGS[b.type].hp * 0.25 }) },
  ];
  const cellW = 5.5 * S;
  const width = 120 + columns.length * cellW;
  const types = [...BUILDING_TYPES, 'keep@2', 'keep@3'].filter((key) => !only || only.includes(key.split('@')[0]));
  const heights = types.map((key) => (BUILDINGS[key.split('@')[0]].size + 2.2) * S);
  const height = 40 + heights.reduce((a, b) => a + b, 0) + 3 * S;
  const dpr = setup(width, height);
  if (!grassCache) {
    const map = makeMap(Math.ceil(width / S), Math.ceil(height / S));
    map.tiles.fill(TERRAIN.GRASS);
    grassCache = new TerrainCache(map);
  }
  ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, 0, 0);
  grassCache.draw(ctx, { x: 0, y: 0, w: width, h: height });
  columns.forEach((col, i) => label(col.name, 120 + i * cellW + cellW / 2, 24));
  let y = 40;
  types.forEach((key, row) => {
    const [type, ageText] = key.split('@');
    const age = Number(ageText ?? 1);
    const size = BUILDINGS[type].size;
    label(`${BUILDINGS[type].name}${ageText ? ` (${age}시대)` : ''}`, 58, y + heights[row] / 2 + 4);
    columns.forEach((col, i) => {
      const bx = (120 + i * cellW + (cellW - size * S) / 2) / S;
      const by = (y + 1.4 * S) / S;
      const b = col.make(building(type, colors[0], bx, by));
      safe(() => drawBuilding(ctx, b, PLAYER_COLORS[b.owner], t, age), type, bx * S, by * S, size * S, size * S);
    });
    y += heights[row];
  });
  drawGoldMine(ctx, { id: 'm', x: 120 / S + 0.7, y: y / S + 0.4, w: 3, h: 3 }, 3000, 3000, t);
}

// ---------- 전투 장면 ----------

const scene = (() => {
  const map = makeMap(34, 22);
  const buildings = [
    building('keep', 0, 2, 7),
    building('barracks', 0, 7, 3),
    building('farmstead', 0, 7, 14),
    building('storehouse', 0, 3, 18),
    building('watchtower', 0, 11, 16),
    building('mage_tower', 1, 22, 13),
    building('stables', 1, 18, 3),
    building('market', 1, 16, 17),
    building('sanctum', 1, 24, 4, { complete: false, progress: 0.55 }),
    building('farmstead', 1, 21, 9, { hp: 120 }),
  ];
  const units = [
    unit('peasant', 0, 6.5, 12.2, { state: UNIT_STATE.BUILD }),
    unit('peasant', 0, 9.2, 13.6, { state: UNIT_STATE.RETURN, carryKind: 'wood', carryAmount: 10 }),
    unit('peasant', 0, 5.1, 16.4, { state: UNIT_STATE.MOVE, carryKind: 'gold', carryAmount: 10 }),
    unit('pikeman', 0, 13.2, 9.4, { state: UNIT_STATE.ATTACK }),
    unit('pikeman', 0, 12.6, 10.4, { state: UNIT_STATE.MOVE }),
    unit('longbowman', 0, 11.2, 8.4, { state: UNIT_STATE.ATTACK }),
    unit('longbowman', 0, 10.8, 10.2),
    unit('knight', 0, 14.4, 7.6, { state: UNIT_STATE.MOVE }),
    unit('royal_guard', 0, 13.9, 11.4, { shieldWall: true }),
    unit('battlemage', 0, 10.4, 12.2, { state: UNIT_STATE.ATTACK }),
    unit('solarion', 0, 9.2, 6.4, { buffed: true }),
    unit('scout_rider', 1, 15.8, 9.1, { state: UNIT_STATE.ATTACK, facing: -1 }),
    unit('pikeman', 1, 16.4, 10.6, { state: UNIT_STATE.ATTACK, facing: -1 }),
    unit('knight', 1, 17.2, 8.1, { state: UNIT_STATE.ATTACK, facing: -1 }),
    unit('royal_guard', 1, 16.9, 12.1, { facing: -1 }),
    unit('etheria', 1, 20.2, 11.2, { state: UNIT_STATE.ATTACK, facing: -1 }),
    unit('arkanon', 1, 19.4, 15.6, { facing: -1 }),
    unit('gryphon_rider', 1, 14.8, 5.4, { state: UNIT_STATE.MOVE, facing: -1 }),
    unit('storm_wyvern', 1, 18.8, 6.2, { state: UNIT_STATE.MOVE, facing: -1 }),
    unit('falcon_scout', 0, 5.2, 4.6, { state: UNIT_STATE.MOVE }),
    unit('war_galley', 1, 31.5, 9, { state: UNIT_STATE.MOVE, facing: -1 }),
    unit('transport_ship', 0, 31.8, 15.5),
    unit('catapult_ship', 1, 31.2, 19.6, { state: UNIT_STATE.ATTACK, facing: -1 }),
  ];
  return { map, terrain: new TerrainCache(map), buildings, units };
})();

function drawScene(t) {
  const width = scene.map.width * S;
  const height = scene.map.height * S;
  const dpr = setup(width, height);
  ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, 0, 0);
  scene.terrain.draw(ctx, { x: 0, y: 0, w: width, h: height });
  drawGoldMine(ctx, { id: 'm', x: 1, y: 12, w: 3, h: 3 }, 2000, 3000, t);
  for (const b of [...scene.buildings].sort((a, b) => a.y + a.size - (b.y + b.size))) {
    safe(() => drawBuilding(ctx, b, PLAYER_COLORS[b.owner], t, b.type === 'keep' ? 2 : 1), b.type, b.x * S, b.y * S, b.size * S, b.size * S);
  }
  const sel = scene.units[3];
  drawSelectionRing(ctx, sel.drawX * S, sel.drawY * S + 7, UNITS[sel.type].radius * S + 2, 'mine');
  for (const u of [...scene.units].sort((a, b) => a.drawY - b.drawY)) {
    // 공격 중인 유닛은 0.9초마다 휘두른다
    const attacking = u.state === UNIT_STATE.ATTACK ? { attackAt: t - ((t + u.id * 170) % 900) } : {};
    safe(() => drawUnit(ctx, { ...u, ...attacking }, PLAYER_COLORS[u.owner], t), u.type, u.drawX * S - 12, u.drawY * S - 20, 24, 30);
  }
  const arrowT = (t % 700) / 700;
  drawEffect(ctx, { kind: 'arrow', from: { x: 11.2, y: 8.2 }, to: { x: 15.8, y: 9 }, start: t - arrowT * 400, duration: 400 }, t);
}

function frame(now) {
  const t = frozen ?? now;
  if (view === 'units') drawUnitsTable(t);
  else if (view === 'buildings') drawBuildingsTable(t);
  else drawScene(t);
  if (frozen == null) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
