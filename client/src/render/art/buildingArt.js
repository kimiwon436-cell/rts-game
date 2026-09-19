// 건물 그림. 종류마다 스프라이트로 한 번 그리고(색·시대별), 깃발·연기·빛·불은 매 프레임 위에 그린다.
// - 기준점 (0,0)은 풋프린트의 왼쪽 위. 앞벽은 풋프린트 아래쪽, 지붕·탑은 위로 솟아 뒤 칸을 덮는다
// - 짓는 중: 터 → 기초와 비계 → 아래부터 차오르는 벽 (진행도만큼)
import { TILE_SIZE } from '@rune/shared/constants.js';
import { BUILDINGS } from '@rune/shared/data/buildings.js';
import {
  DARK_WOOD,
  GOLD,
  INK,
  IRON,
  LEATHER,
  LINEN,
  STEEL,
  TAU,
  WOOD,
  circle,
  curve,
  darken,
  ellipse,
  ellipsePath,
  fillPath,
  lighten,
  limb,
  line,
  lit,
  metal,
  mix,
  poly,
  polyPath,
  rect,
  rgba,
  round,
  seeded,
  tones,
  vertical,
  within,
} from './paint.js';
import { blit, glow, sprite } from './sprites.js';
import { wavingFlag } from './flag.js';

const S = TILE_SIZE;

const STONE = tones('#a39b8e');
const DARK_STONE = tones('#7d766b');
const PALE_STONE = tones('#c4bdb0');
const MARBLE = tones('#e2ddd2');
const BASALT = tones('#474d5a');
const PLASTER = tones('#e4d9c0');
const BEAM = tones('#4d3927');
const SLATE = tones('#5a6272');
const ROOF_RED = tones('#a14a3a');
const SHINGLE = tones('#6a4a33');
const THATCH = tones('#c9a157');
const ROOF_BLUE = tones('#3d56a8');
const DIRT = tones('#6f5c43');
const WINDOW_LIGHT = tones('#ffd98a');
const MAGIC = tones('#8fb8ff');

const palettes = new Map();
function palette(color) {
  let p = palettes.get(color);
  if (!p) {
    p = { color, team: tones(color), deep: tones(darken(color, 0.24)), pale: tones(lighten(color, 0.3)) };
    palettes.set(color, p);
  }
  return p;
}

// ---------- 공통 부품 ----------

/** 다져진 흙바닥 (건물이 땅에 붙어 보이게) */
function groundPlate(g, w, h, t = DIRT, inset = 2) {
  const x = inset;
  const y = inset + h * 0.08;
  const pw = w - inset * 2;
  const ph = h - inset * 2 - h * 0.08;
  g.save();
  g.globalAlpha = 0.85;
  rect(g, x, y, pw, ph, vertical(t), Math.min(10, w * 0.12));
  g.restore();
  const rand = seeded(w * 7 + h);
  for (let i = 0; i < w / 5; i++) {
    const px = x + 3 + rand() * (pw - 6);
    const py = y + ph * 0.5 + rand() * (ph * 0.5 - 3);
    ellipse(g, px, py, 1.2 + rand(), 0.8 + rand() * 0.5, rgba(i % 3 ? t.dark : t.lighter, 0.7));
  }
}

/** 돌벽: 엇갈린 돌 줄눈 */
function stoneWall(g, x, y, w, h, t = STONE, { block = 7, row = 4.4, seed = 1 } = {}) {
  rect(g, x, y, w, h, vertical(t));
  within(
    g,
    () => {
      g.beginPath();
      g.rect(x, y, w, h);
    },
    () => {
      const rand = seeded(seed * 131 + Math.round(w * 3 + h));
      for (let ry = y, i = 0; ry < y + h; ry += row, i++) {
        line(g, x, ry, x + w, ry, rgba(t.darker, 0.55), 0.55, 'butt');
        for (let rx = x + (i % 2 ? block / 2 : 0); rx < x + w; rx += block) {
          line(g, rx, ry, rx, ry + row, rgba(t.darker, 0.5), 0.5, 'butt');
          const k = rand();
          if (k > 0.72) rect(g, rx + 0.6, ry + 0.6, block - 1.2, row - 1.2, rgba(k > 0.86 ? t.lighter : t.dark, 0.35));
        }
      }
      // 위쪽 빛, 아래쪽 그늘
      rect(g, x, y, w, 1.6, rgba('#ffffff', 0.18));
      rect(g, x, y + h - 3, w, 3, rgba('#000000', 0.18));
    },
  );
}

/** 널빤지 벽 (세로 판자) */
function plankWall(g, x, y, w, h, t = WOOD, board = 4) {
  rect(g, x, y, w, h, vertical(t));
  within(
    g,
    () => {
      g.beginPath();
      g.rect(x, y, w, h);
    },
    () => {
      for (let bx = x + board; bx < x + w; bx += board) line(g, bx, y, bx, y + h, rgba(t.darker, 0.6), 0.55, 'butt');
      const rand = seeded(Math.round(x * 13 + y * 7 + w));
      for (let bx = x + board / 2; bx < x + w; bx += board) {
        if (rand() > 0.6) line(g, bx, y + rand() * h, bx, y + rand() * h, rgba(t.light, 0.35), 0.4);
      }
      rect(g, x, y + h - 3, w, 3, rgba('#000000', 0.2));
    },
  );
}

/** 회벽에 검은 나무 뼈대 */
function timberFrame(g, x, y, w, h, { beams = 4 } = {}) {
  rect(g, x, y, w, h, vertical(PLASTER));
  const step = w / beams;
  for (let i = 0; i <= beams; i++) rect(g, x + i * step - 0.9, y, 1.8, h, lit(BEAM));
  rect(g, x, y, w, 1.8, lit(BEAM));
  rect(g, x, y + h - 1.8, w, 1.8, lit(BEAM));
  for (let i = 0; i < beams; i += 2) line(g, x + i * step, y + h, x + (i + 1) * step, y, BEAM.base, 1.3);
}

/** 지붕 (앞쪽 경사면): 처마(아래)가 넓고 용마루(위)가 좁은 사다리꼴 + 기와 줄 */
function roof(g, x, y, w, h, t, { inset = w * 0.12, rows = 5, style = 'shingle', ridge = true } = {}) {
  const shape = () => polyPath(g, [[x, y + h], [x + w, y + h], [x + w - inset, y], [x + inset, y]]);
  shape();
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, t.light);
  gr.addColorStop(0.5, t.base);
  gr.addColorStop(1, t.dark);
  g.fillStyle = gr;
  g.fill();
  within(g, shape, () => {
    const rowH = h / rows;
    for (let i = 1; i <= rows; i++) {
      const ry = y + i * rowH;
      if (style === 'tile') {
        for (let tx = x + (i % 2 ? 2 : 0); tx < x + w; tx += 4) {
          g.beginPath();
          g.arc(tx + 2, ry - 0.6, 2, 0, Math.PI);
          g.strokeStyle = rgba(t.darker, 0.6);
          g.lineWidth = 0.6;
          g.stroke();
        }
      } else if (style === 'thatch') {
        const rand = seeded(Math.round(ry * 11 + x));
        for (let tx = x; tx < x + w; tx += 1.6) {
          line(g, tx, ry - rowH * (0.4 + rand() * 0.6), tx + 0.3, ry, rgba(rand() > 0.5 ? t.darker : t.lighter, 0.45), 0.5);
        }
      } else {
        line(g, x, ry, x + w, ry, rgba(t.darker, 0.6), 0.6, 'butt');
        for (let tx = x + (i % 2 ? 3 : 0); tx < x + w; tx += 6) line(g, tx, ry - rowH, tx, ry, rgba(t.darker, 0.45), 0.45, 'butt');
      }
    }
  });
  if (ridge) line(g, x + inset, y + 0.6, x + w - inset, y + 0.6, t.lighter, 1.4);
  line(g, x, y + h, x + w, y + h, rgba(INK, 0.5), 1);
}

function door(g, x, y, w, h, t = DARK_WOOD, { arch = true } = {}) {
  const path = () => {
    g.beginPath();
    g.moveTo(x, y + h);
    g.lineTo(x, y + (arch ? w / 2 : 0));
    if (arch) g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
    else g.lineTo(x + w, y);
    g.lineTo(x + w, y + h);
    g.closePath();
  };
  path();
  fillPath(g, lit(t), x, y, w, h);
  within(g, path, () => {
    for (let bx = x + 2.4; bx < x + w; bx += 2.4) line(g, bx, y, bx, y + h, rgba(t.darker, 0.7), 0.4, 'butt');
    for (const hy of [y + h * 0.35, y + h * 0.75]) rect(g, x, hy, w * 0.7, 1, rgba(IRON.dark, 0.9));
  });
  circle(g, x + w * 0.72, y + h * 0.58, 0.7, metal(GOLD));
}

/** 창: lit이면 따뜻한 불빛, 아니면 어두운 유리 */
function windowPane(g, x, y, w, h, { light = true, arch = false, color = WINDOW_LIGHT } = {}) {
  rect(g, x - 0.8, y - 0.8, w + 1.6, h + 1.6, lit(BEAM), arch ? w / 2 : 0.6);
  rect(g, x, y, w, h, light ? round(color) : lit(tones('#27303c')), arch ? w / 2 : 0.4);
  line(g, x + w / 2, y + 0.4, x + w / 2, y + h - 0.4, rgba(BEAM.base, 0.9), 0.6, 'butt');
  line(g, x + 0.4, y + h * 0.5, x + w - 0.4, y + h * 0.5, rgba(BEAM.base, 0.9), 0.6, 'butt');
}

/** 성가퀴 (성벽 위 톱니) */
function battlements(g, x, y, w, t = STONE, { merlon = 5, gap = 3.4, height = 4.2 } = {}) {
  rect(g, x, y, w, 2.4, vertical(t));
  for (let mx = x; mx + merlon <= x + w + 0.1; mx += merlon + gap) rect(g, mx, y - height, merlon, height + 0.4, vertical(t));
}

/** 둥근 탑: 가운데 cx, 아래 baseY에서 높이 h. roofH가 있으면 원뿔 지붕, 없으면 성가퀴 */
function roundTower(g, cx, baseY, r, h, t, { roofT = SLATE, roofH = 0, seed = 1, windows = true } = {}) {
  const top = baseY - h;
  const body = () => {
    g.beginPath();
    g.moveTo(cx - r, top);
    g.lineTo(cx - r, baseY - r * 0.3);
    g.ellipse(cx, baseY - r * 0.3, r, r * 0.3, 0, Math.PI, 0, true);
    g.lineTo(cx + r, top);
    g.closePath();
  };
  body();
  const gr = g.createLinearGradient(cx - r, 0, cx + r, 0);
  gr.addColorStop(0, t.light);
  gr.addColorStop(0.35, t.base);
  gr.addColorStop(1, t.darker);
  g.fillStyle = gr;
  g.fill();
  within(g, body, () => {
    const rand = seeded(seed * 71 + Math.round(cx));
    for (let y = top + 4, i = 0; y < baseY; y += 4.4, i++) {
      g.beginPath();
      g.ellipse(cx, y, r, r * 0.3, 0, 0, Math.PI);
      g.strokeStyle = rgba(t.darker, 0.45);
      g.lineWidth = 0.5;
      g.stroke();
      for (let k = -1; k <= 1; k++) {
        const bx = cx + (k + (i % 2 ? 0.5 : 0)) * r * 0.62;
        if (Math.abs(bx - cx) < r * 0.95) line(g, bx, y, bx, y + 4.4, rgba(t.darker, 0.4), 0.45, 'butt');
      }
      if (rand() > 0.7) ellipse(g, cx - r * 0.3, y + 2, r * 0.25, 1.4, rgba(t.lighter, 0.25));
    }
  });
  if (windows) {
    rect(g, cx - 1.2, top + h * 0.3, 2.4, 5, INK, 1);
    if (h > 40) rect(g, cx - 1.2, top + h * 0.62, 2.4, 5, INK, 1);
  }
  if (roofH) {
    poly(g, [[cx - r - 2.4, top + 1], [cx, top - roofH], [cx + r + 2.4, top + 1]], lit(roofT));
    within(
      g,
      () => polyPath(g, [[cx - r - 2.4, top + 1], [cx, top - roofH], [cx + r + 2.4, top + 1]]),
      () => {
        for (let k = 1; k < 5; k++) line(g, cx - r - 3, top + 1 - (roofH * k) / 5, cx + r + 3, top + 1 - (roofH * k) / 5, rgba(roofT.darker, 0.45), 0.5);
      },
    );
    ellipse(g, cx, top + 1.4, r + 2.4, 1.6, rgba(INK, 0.35));
  } else {
    ellipse(g, cx, top, r, r * 0.3, lit(t));
    for (const k of [-0.8, -0.2, 0.4]) rect(g, cx + k * r, top - 4, r * 0.4, 4.4, vertical(t));
  }
  return { top: top - roofH };
}

/** 걸린 깃발 (벽에 드리운 팀 색 천) */
function hangingBanner(g, x, y, w, h, team, { emblem = true } = {}) {
  rect(g, x - 1.2, y - 1, w + 2.4, 1.6, metal(GOLD), 0.6);
  const cloth = () => polyPath(g, [[x, y], [x + w, y], [x + w, y + h], [x + w / 2, y + h - w * 0.45], [x, y + h]]);
  cloth();
  fillPath(g, vertical(team), x, y, w, h);
  within(g, cloth, () => {
    rect(g, x + w * 0.62, y, w * 0.2, h, rgba(team.darker, 0.35));
    if (emblem) {
      circle(g, x + w / 2, y + h * 0.36, w * 0.24, round(GOLD));
      circle(g, x + w / 2, y + h * 0.36, w * 0.12, round(team));
    }
  });
}

function crate(g, x, y, s) {
  rect(g, x, y, s, s, lit(WOOD), 0.6);
  line(g, x + 0.8, y + 0.8, x + s - 0.8, y + s - 0.8, WOOD.darker, 0.6);
  line(g, x + s - 0.8, y + 0.8, x + 0.8, y + s - 0.8, WOOD.darker, 0.6);
  rect(g, x, y, s, s * 0.18, rgba(WOOD.lighter, 0.4), 0.4);
}

function barrel(g, x, y, w, h) {
  rect(g, x, y, w, h, lit(tones('#8a6036')), w * 0.35);
  for (const k of [0.2, 0.8]) line(g, x, y + h * k, x + w, y + h * k, IRON.dark, 0.8, 'butt');
  ellipse(g, x + w / 2, y + 0.8, w / 2 - 0.4, 1, rgba(tones('#8a6036').lighter, 0.6));
}

function sack(g, x, y, w, h) {
  ellipse(g, x + w / 2, y + h * 0.6, w / 2, h * 0.45, round(tones('#b89c6c')));
  line(g, x + w * 0.3, y + h * 0.18, x + w * 0.7, y + h * 0.18, LEATHER.dark, 0.7);
}

// ---------- 건물별 ----------

/** 영주관: 1 촌락(돌·나무 영주 저택) · 2 성채(성벽과 탑) · 3 왕성(푸른 지붕의 궁성) */
function drawKeep(g, w, h, p, age) {
  groundPlate(g, w, h, DIRT, 1);
  if (age <= 1) {
    // 뒤쪽 돌탑
    stoneWall(g, 8, -8, 30, 60, DARK_STONE, { seed: 2 });
    poly(g, [[3, -8], [23, -36], [43, -8]], lit(SLATE));
    rect(g, 20, 6, 4, 8, INK, 1.5);
    // 저택: 돌 1층, 나무 뼈대 2층, 지붕
    roof(g, 0, 6, w, 42, SLATE, { inset: 16, rows: 6 });
    rect(g, 96, -4, 10, 22, vertical(DARK_STONE));
    rect(g, 94.6, -6, 12.8, 3, vertical(STONE));
    timberFrame(g, 8, 46, 112, 32, { beams: 8 });
    for (const x of [22, 50, 72, 100]) windowPane(g, x, 54, 7, 9);
    stoneWall(g, 6, 78, 116, 44, STONE, { seed: 3 });
    for (const x of [16, 104]) windowPane(g, x, 88, 7, 10, { arch: true });
    door(g, 54, 90, 20, 32);
    rect(g, 50, 120, 28, 3, vertical(PALE_STONE), 1);
    hangingBanner(g, 32, 48, 9, 24, p.team);
    hangingBanner(g, 87, 48, 9, 24, p.team);
    return { flags: [{ x: 23, y: -36, h: 18 }], smoke: [{ x: 101, y: -8 }], label: -40 };
  }
  const royal = age >= 3;
  const stone = royal ? PALE_STONE : STONE;
  // 뒤쪽 모퉁이 탑
  for (const cx of [18, 110]) roundTower(g, cx, 66, 11, 62, stone, { roofT: royal ? ROOF_BLUE : SLATE, roofH: royal ? 22 : 0, seed: cx });
  // 가운데 큰 탑 (본성)
  const keepTop = royal ? -40 : -22;
  stoneWall(g, 36, keepTop, 56, 96 - keepTop - 22, stone, { seed: 5 });
  battlements(g, 34, keepTop, 60, stone);
  for (const y of royal ? [-24, -2, 20] : [-6, 16]) {
    windowPane(g, 46, y, 6, 9, { arch: true });
    windowPane(g, 76, y, 6, 9, { arch: true });
  }
  hangingBanner(g, 58, keepTop + 10, 12, 30, p.team);
  if (royal) {
    // 본성 위 첨탑
    roundTower(g, 64, keepTop - 2, 9, 22, stone, { roofT: ROOF_BLUE, roofH: 26, seed: 9, windows: false });
    rect(g, 34, keepTop + 3, 60, 1.6, metal(GOLD));
  }
  // 앞 성벽과 성문
  stoneWall(g, 4, 72, 120, 50, stone, { seed: 7 });
  battlements(g, 2, 72, 124, stone);
  if (royal) rect(g, 2, 74, 124, 1.4, metal(GOLD));
  const gate = () => {
    g.beginPath();
    g.moveTo(51, 122);
    g.lineTo(51, 96);
    g.arc(64, 96, 13, Math.PI, 0);
    g.lineTo(77, 122);
    g.closePath();
  };
  gate();
  g.fillStyle = '#1f1a16';
  g.fill();
  within(g, gate, () => {
    for (let x = 53; x < 77; x += 3.4) line(g, x, 82, x, 122, rgba(IRON.base, 0.9), 0.9, 'butt');
    for (let y = 88; y < 122; y += 4) line(g, 50, y, 78, y, rgba(IRON.base, 0.9), 0.9, 'butt');
  });
  // 앞 모퉁이 탑
  for (const cx of [14, 114]) roundTower(g, cx, 124, 13, 62, stone, { roofT: royal ? ROOF_BLUE : SLATE, roofH: royal ? 24 : 0, seed: cx + 3 });
  hangingBanner(g, 26, 82, 8, 20, p.team, { emblem: false });
  hangingBanner(g, 94, 82, 8, 20, p.team, { emblem: false });
  const flags = royal
    ? [{ x: 64, y: keepTop - 50, h: 18 }, { x: 14, y: 38, h: 14 }, { x: 114, y: 38, h: 14 }]
    : [{ x: 64, y: keepTop - 4, h: 22 }, { x: 14, y: 58, h: 14 }, { x: 114, y: 58, h: 14 }];
  return { flags, label: royal ? keepTop - 54 : keepTop - 8 };
}

/** 농가: 초가지붕 오두막, 작은 밭과 울타리, 건초 더미 */
function drawFarmstead(g, w, h, p) {
  groundPlate(g, w, h);
  // 밭
  rect(g, 2, 38, 22, 22, lit(tones('#5c4630')), 2);
  for (let y = 41; y < 58; y += 4) {
    line(g, 3, y, 23, y, rgba('#3e2f20', 0.8), 1);
    for (let x = 5; x < 23; x += 4) ellipse(g, x, y - 1.2, 1.2, 1.6, round(tones('#8fb34f')));
  }
  for (const [x1, y1, x2, y2] of [[1, 37, 25, 37], [1, 61, 25, 61], [25, 37, 25, 61]]) line(g, x1, y1, x2, y2, WOOD.light, 0.9);
  for (const [x, y] of [[1, 37], [13, 37], [25, 37], [25, 49], [1, 61], [13, 61], [25, 61]]) rect(g, x - 0.9, y - 2.6, 1.8, 3.4, lit(WOOD), 0.4);
  // 건초 더미
  ellipse(g, 9, 30, 7, 5.6, round(THATCH));
  // 오두막
  rect(g, 48, -2, 7, 16, vertical(DARK_STONE));
  roof(g, 16, 4, 48, 30, THATCH, { inset: 9, rows: 5, style: 'thatch' });
  timberFrame(g, 21, 33, 38, 25, { beams: 4 });
  door(g, 35, 43, 9, 15, p.deep, { arch: false });
  for (const x of [25, 49]) {
    windowPane(g, x, 40, 6, 6);
    rect(g, x - 2.6, 39.4, 2.2, 7.2, lit(p.team), 0.3);
    rect(g, x + 6.4, 39.4, 2.2, 7.2, lit(p.team), 0.3);
  }
  return { flags: [{ x: 19, y: 8, h: 12 }], smoke: [{ x: 51.5, y: -4 }] };
}

/** 보급 창고: 널빤지 창고, 큰 문 위 팀 색 차양, 상자·통·자루 */
function drawStorehouse(g, w, h, p) {
  groundPlate(g, w, h);
  roof(g, 2, 2, 60, 26, SHINGLE, { inset: 8, rows: 4 });
  // 도르래 들보와 매단 자루
  line(g, 32, 12, 32, 6, DARK_WOOD.dark, 1.6);
  plankWall(g, 6, 27, 52, 31, WOOD);
  rect(g, 28, 14, 8, 8, INK, 0.6);
  sack(g, 29, 18, 6, 7);
  // 큰 문
  rect(g, 21, 38, 22, 20, lit(DARK_WOOD), 0.6);
  line(g, 32, 38, 32, 58, INK, 0.8);
  for (const x of [21, 32]) {
    line(g, x + 0.6, 39, x + 10.4, 57, rgba(DARK_WOOD.lighter, 0.7), 0.9);
  }
  // 팀 색 차양 (줄무늬)
  poly(g, [[17, 31], [47, 31], [50, 37], [14, 37]], lit(p.team));
  within(
    g,
    () => polyPath(g, [[17, 31], [47, 31], [50, 37], [14, 37]]),
    () => {
      for (let x = 17; x < 50; x += 6) poly(g, [[x, 31], [x + 3, 31], [x + 3.6, 37], [x + 0.6, 37]], rgba(LINEN.base, 0.85));
    },
  );
  // 짐
  crate(g, 47, 46, 9);
  crate(g, 52, 51, 9);
  crate(g, 49, 38, 7);
  barrel(g, 5, 45, 7, 11);
  barrel(g, 11, 49, 7, 10);
  sack(g, 3, 54, 7, 6);
  return { flags: [{ x: 57, y: 6, h: 12 }] };
}

/** 병영: 돌 1층·나무 2층, 붉은 기와지붕, 문 양옆 팀 깃발, 창 걸이와 허수아비 */
function drawBarracks(g, w, h, p) {
  groundPlate(g, w, h);
  rect(g, 68, -6, 9, 22, vertical(DARK_STONE));
  rect(g, 66.6, -8, 11.8, 3, vertical(STONE));
  roof(g, 0, 0, w, 32, ROOF_RED, { inset: 12, rows: 6, style: 'tile' });
  timberFrame(g, 8, 30, 80, 20, { beams: 6 });
  for (const x of [18, 44, 70]) windowPane(g, x, 35, 7, 8);
  stoneWall(g, 6, 50, 84, 34, STONE, { seed: 11 });
  door(g, 38, 58, 20, 26);
  hangingBanner(g, 22, 52, 8, 22, p.team);
  hangingBanner(g, 66, 52, 8, 22, p.team);
  // 창 걸이 (오른쪽 앞)
  rect(g, 74, 84, 18, 2, lit(DARK_WOOD), 0.4);
  for (const x of [77, 82, 87]) {
    line(g, x, 92, x + 1.6, 66, WOOD.base, 1.1);
    poly(g, [[x + 0.6, 66.6], [x + 1.6, 62.4], [x + 2.6, 66.6]], metal(STEEL));
  }
  circle(g, 90, 80, 3.6, round(p.team));
  circle(g, 90, 80, 1.2, metal(STEEL));
  // 허수아비 (왼쪽 앞)
  line(g, 10, 93, 10, 72, WOOD.base, 1.6);
  line(g, 4, 78, 16, 78, WOOD.base, 1.4);
  ellipse(g, 10, 82, 4, 6, round(THATCH));
  circle(g, 10, 71, 3, round(tones('#d8c89a')));
  return { flags: [{ x: 48, y: 0, h: 16 }], smoke: [{ x: 72.5, y: -9 }] };
}

/** 마구간: 긴 헛간, 반문 사이로 내민 말 머리, 건초, 앞 울타리 */
function drawStables(g, w, h, p) {
  groundPlate(g, w, h);
  roof(g, 0, 8, w, 34, SHINGLE, { inset: 10, rows: 5 });
  // 건초 다락
  rect(g, 40, 2, 16, 14, lit(DARK_WOOD), 0.6);
  rect(g, 42, 5, 12, 10, INK, 0.4);
  ellipse(g, 48, 13, 6, 3.2, round(THATCH));
  plankWall(g, 4, 41, 88, 43, DARK_WOOD, 4.4);
  // 반문 셋, 두 칸에 말 머리
  const horses = [tones('#8c6443'), null, tones('#ebe6da')];
  [12, 40, 68].forEach((x, i) => {
    rect(g, x, 54, 18, 30, INK, 0.8);
    rect(g, x, 68, 18, 16, lit(WOOD), 0.6);
    line(g, x + 1, 69, x + 17, 83, rgba(WOOD.lighter, 0.7), 0.9);
    const coat = horses[i];
    if (coat) {
      ellipse(g, x + 9, 64, 4, 6, lit(coat));
      ellipse(g, x + 11, 67.4, 3.4, 2.4, lit(coat), 0.6);
      poly(g, [[x + 6.6, 58.6], [x + 7.4, 55], [x + 8.8, 58.4]], lit(coat));
      circle(g, x + 10.4, 62, 0.7, INK);
    }
  });
  // 울타리와 팀 색 담요
  for (const y of [89, 93]) line(g, 2, y, 94, y, WOOD.light, 1.1);
  for (let x = 4; x < 96; x += 11) rect(g, x - 1, 86, 2.2, 9, lit(WOOD), 0.4);
  rect(g, 60, 87, 14, 8, vertical(p.team), 0.6);
  rect(g, 60, 93, 14, 1.4, metal(GOLD));
  ellipse(g, 9, 84, 7.4, 5, round(THATCH));
  return { flags: [{ x: 88, y: 10, h: 14 }] };
}

/** 룬 오벨리스크: 계단 받침 위 검은 돌기둥, 빛나는 룬 */
function drawObelisk(g, w, h, p) {
  rect(g, 6, 46, 52, 13, vertical(DARK_STONE), 2);
  rect(g, 12, 39, 40, 9, vertical(STONE), 2);
  rect(g, 12, 45, 40, 2, vertical(p.team));
  // 기둥: 위로 좁아진다
  const shaft = [[22, 40], [42, 40], [37, -24], [27, -24]];
  poly(g, shaft, (gg, b) => {
    const gr = gg.createLinearGradient(b.x, 0, b.x + b.w, 0);
    gr.addColorStop(0, BASALT.light);
    gr.addColorStop(0.4, BASALT.base);
    gr.addColorStop(1, BASALT.darker);
    return gr;
  });
  poly(g, [[27, -24], [37, -24], [32, -34]], lit(tones('#5d6474')));
  // 룬
  const runes = [];
  for (let i = 0; i < 5; i++) {
    const y = -14 + i * 10.5;
    const x = 32;
    line(g, x - 2.2, y - 2.6, x + 2.2, y + 2.6, MAGIC.light, 0.9);
    line(g, x - 2.2, y + 2.6, x + 1, y - 0.4, MAGIC.light, 0.9);
    runes.push({ x, y, r: 7, color: 'rgba(140, 190, 255, 0.85)', pulse: true });
  }
  // 앞 모서리의 선돌
  for (const x of [6, 52]) poly(g, [[x, 58], [x + 6, 58], [x + 5, 44], [x + 1.4, 42.6]], lit(STONE));
  return { glow: [...runes, { x: 32, y: -34, r: 10, color: 'rgba(160, 205, 255, 0.9)', pulse: true }] };
}

/** 감시탑: 높은 돌탑, 나무 망루와 뾰족 지붕 */
function drawWatchtower(g, w, h, p) {
  groundPlate(g, w, h, DIRT, 6);
  // 몸통 (위로 조금 좁아진다)
  poly(g, [[16, 60], [48, 60], [45, -8], [19, -8]], vertical(STONE));
  within(
    g,
    () => polyPath(g, [[16, 60], [48, 60], [45, -8], [19, -8]]),
    () => stoneWall(g, 14, -8, 36, 68, STONE, { seed: 21, block: 6 }),
  );
  for (const y of [8, 28]) rect(g, 30.8, y, 2.4, 7, INK, 1);
  door(g, 27, 44, 10, 16);
  // 망루: 받침 까치발 + 널빤지 + 지붕
  for (const x of [15, 25, 39, 49]) line(g, x, -2, x + (x < 32 ? 3 : -3), -10, DARK_WOOD.dark, 1.4);
  plankWall(g, 11, -24, 42, 16, WOOD, 3.5);
  rect(g, 11, -24, 42, 2, lit(DARK_WOOD));
  for (const x of [18, 30, 42]) rect(g, x, -20, 3.4, 5, INK, 0.6);
  poly(g, [[6, -22], [32, -48], [58, -22]], lit(ROOF_RED));
  within(
    g,
    () => polyPath(g, [[6, -22], [32, -48], [58, -22]]),
    () => {
      for (let k = 1; k < 5; k++) line(g, 0, -22 - k * 5.2, 64, -22 - k * 5.2, rgba(ROOF_RED.darker, 0.5), 0.5);
    },
  );
  rect(g, 18, -8, 28, 2.4, vertical(p.team));
  return { flags: [{ x: 32, y: -48, h: 14 }] };
}

/** 마법사의 탑: 푸른 원뿔 지붕의 가는 탑, 빛나는 창, 떠 있는 수정 */
function drawMageTower(g, w, h, p) {
  groundPlate(g, w, h);
  // 오른쪽 부속 건물
  roof(g, 54, 36, 40, 18, ROOF_BLUE, { inset: 6, rows: 3 });
  stoneWall(g, 58, 53, 32, 32, PALE_STONE, { seed: 31 });
  windowPane(g, 70, 60, 8, 10, { arch: true, color: MAGIC });
  door(g, 64, 70, 9, 15);
  // 탑
  roundTower(g, 38, 88, 17, 108, PALE_STONE, { roofT: ROOF_BLUE, roofH: 42, seed: 3, windows: false });
  rect(g, 21, -22, 34, 3, vertical(p.team));
  rect(g, 21, -19.6, 34, 1, metal(GOLD));
  const windows = [];
  for (const y of [-2, 26, 54]) {
    windowPane(g, 35, y, 6, 10, { arch: true, color: MAGIC });
    windows.push({ x: 38, y: y + 5, r: 7, color: 'rgba(140, 190, 255, 0.7)', pulse: true });
  }
  door(g, 32, 72, 12, 16);
  // 지붕 꼭대기 금 장식
  line(g, 38, -64, 38, -72, GOLD.base, 1.2);
  circle(g, 38, -72.6, 1.6, round(GOLD));
  return { glow: windows, crystal: { x: 38, y: -84 } };
}

/** 시장: 팀 색 줄무늬 차양의 가판대 셋, 과일·천·항아리, 짐수레 */
function drawMarket(g, w, h, p) {
  groundPlate(g, w, h, tones('#8a7c66'), 2);
  const rand = seeded(97);
  for (let i = 0; i < 40; i++) ellipse(g, 6 + rand() * 84, 12 + rand() * 80, 2.4, 1.4, rgba(i % 2 ? '#9d8f78' : '#776a55', 0.55));
  const stall = (x, y, sw, goods) => {
    // 기둥
    for (const px of [x + 1, x + sw - 2]) rect(g, px, y, 1.6, 22, lit(DARK_WOOD));
    // 판매대
    rect(g, x - 1, y + 14, sw + 2, 10, lit(WOOD), 0.8);
    rect(g, x - 1, y + 14, sw + 2, 2, rgba(WOOD.lighter, 0.6));
    goods(x, y + 12);
    // 차양 (줄무늬)
    const awning = () => polyPath(g, [[x - 3, y + 6], [x + sw + 3, y + 6], [x + sw + 1, y - 4], [x - 1, y - 4]]);
    awning();
    fillPath(g, lit(p.team), x - 3, y - 4, sw + 6, 10);
    within(g, awning, () => {
      for (let sx = x - 3; sx < x + sw + 3; sx += 8) rect(g, sx, y - 4, 4, 10, rgba(LINEN.base, 0.92));
    });
    for (let sx = x - 3; sx < x + sw + 3; sx += 4) {
      g.beginPath();
      g.arc(sx + 2, y + 6, 2, 0, Math.PI);
      g.fillStyle = sx % 8 < 4 ? LINEN.dark : p.team.dark;
      g.fill();
    }
  };
  stall(8, 18, 32, (x, y) => {
    for (let i = 0; i < 4; i++) {
      const bx = x + 3 + i * 7.4;
      ellipse(g, bx + 2.4, y + 2.6, 3.4, 2, lit(tones('#9a6a38')));
      for (const [dx, c] of [[0.8, '#d0473b'], [2.6, '#e39a2e'], [4.2, '#8bb24a']]) circle(g, bx + dx, y + 1.2, 1.2, round(tones(c)));
    }
  });
  stall(56, 14, 32, (x, y) => {
    ['#6a4fa8', '#d0473b', '#3f8f6e', '#d9b44a'].forEach((c, i) => rect(g, x + 2 + i * 7.4, y - 2, 6, 5, lit(tones(c)), 2));
  });
  stall(30, 56, 34, (x, y) => {
    for (let i = 0; i < 4; i++) ellipse(g, x + 5 + i * 8, y + 0.4, 3, 3.6, round(tones(i % 2 ? '#b8683f' : '#c9a577')));
  });
  // 짐수레
  rect(g, 70, 70, 20, 10, lit(WOOD), 1);
  for (const [x, c] of [[72, '#b89c6c'], [78, '#a88c5c'], [84, '#b89c6c']]) ellipse(g, x + 2.6, 69, 3.2, 3, round(tones(c)));
  circle(g, 74, 82, 4.2, lit(DARK_WOOD));
  circle(g, 74, 82, 1.2, metal(IRON));
  line(g, 90, 76, 95, 72, DARK_WOOD.base, 1.4);
  return { flags: [{ x: 6, y: 16, h: 16 }] };
}

/** 맹세의 성소: 흰 대리석 계단과 기둥, 금 해 문장의 박공, 금빛 둥근 지붕, 빛나는 제단 */
function drawSanctum(g, w, h, p) {
  groundPlate(g, w, h, tones('#8f8672'), 1);
  // 뒤의 금빛 둥근 지붕과 첨탑
  const SUN = tones('#e2bc55');
  line(g, 64, -20, 64, -38, GOLD.dark, 1.6);
  circle(g, 64, -39, 2.6, round(GOLD));
  within(
    g,
    () => {
      g.beginPath();
      g.rect(30, -30, 68, 34);
    },
    () => ellipse(g, 64, 4, 30, 24, round(SUN)),
  );
  for (const k of [-0.5, 0, 0.5]) curve(g, 64 + k * 30, 4, 64 + k * 16, -14, 64, -20, rgba(SUN.darker, 0.5), 0.7);
  // 몸체와 박공
  rect(g, 20, 30, 88, 52, vertical(MARBLE));
  rect(g, 34, 40, 60, 42, lit(tones('#3a3431')));
  poly(g, [[12, 34], [64, 2], [116, 34]], lit(MARBLE));
  poly(g, [[22, 30], [64, 8], [106, 30]], lit(tones('#d4cdc0')));
  circle(g, 64, 21, 6, round(GOLD));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    line(g, 64 + Math.cos(a) * 6.8, 21 + Math.sin(a) * 6.8, 64 + Math.cos(a) * 9.4, 21 + Math.sin(a) * 9.4, GOLD.base, 1);
  }
  rect(g, 12, 33, 104, 3, vertical(MARBLE));
  // 제단과 팀 깃발
  rect(g, 57, 64, 14, 16, vertical(MARBLE), 1);
  rect(g, 57, 64, 14, 2, metal(GOLD));
  hangingBanner(g, 40, 40, 9, 26, p.team);
  hangingBanner(g, 79, 40, 9, 26, p.team);
  // 기둥 넷
  for (const x of [22, 45, 75, 98]) {
    rect(g, x, 36, 8, 46, (gg, b) => {
      const gr = gg.createLinearGradient(b.x, 0, b.x + b.w, 0);
      gr.addColorStop(0, MARBLE.lighter);
      gr.addColorStop(0.5, MARBLE.base);
      gr.addColorStop(1, MARBLE.darker);
      return gr;
    });
    for (const dx of [2, 4, 6]) line(g, x + dx, 38, x + dx, 80, rgba(MARBLE.darker, 0.4), 0.4, 'butt');
    rect(g, x - 1.4, 34, 10.8, 3, vertical(MARBLE), 0.6);
    rect(g, x - 1.4, 80, 10.8, 3, vertical(MARBLE), 0.6);
  }
  // 계단
  rect(g, 16, 82, 96, 8, vertical(MARBLE), 1);
  rect(g, 10, 89, 108, 9, vertical(tones('#d2ccc0')), 1);
  rect(g, 4, 97, 120, 12, vertical(tones('#c2bbae')), 1);
  for (const y of [90, 98]) line(g, 10, y, 118, y, rgba(INK, 0.25), 0.8);
  return {
    flags: [{ x: 8, y: 96, h: 30 }, { x: 120, y: 96, h: 30 }],
    glow: [{ x: 64, y: 60, r: 16, color: 'rgba(255, 214, 130, 0.85)', pulse: true }],
    flame: { x: 64, y: 63 },
  };
}

/** 조선소: 나무 부두, 배 짓는 헛간, 선대 위 배 뼈대, 기중기 */
function drawShipyard(g, w, h, p) {
  // 부두 널빤지
  rect(g, 2, 16, 92, 78, vertical(tones('#7d5b3a')), 2);
  within(
    g,
    () => {
      g.beginPath();
      g.rect(2, 16, 92, 78);
    },
    () => {
      for (let y = 20; y < 94; y += 5) line(g, 2, y, 94, y, rgba('#3e2a18', 0.6), 0.6, 'butt');
      const rand = seeded(55);
      for (let y = 17.5; y < 94; y += 5) for (let x = 4 + rand() * 20; x < 94; x += 18 + rand() * 12) line(g, x, y - 2.4, x, y + 2.4, rgba('#3e2a18', 0.5), 0.5, 'butt');
    },
  );
  for (const x of [4, 30, 56, 82]) rect(g, x, 90, 4, 6, lit(DARK_WOOD), 0.6);
  // 헛간
  roof(g, 2, 2, 52, 24, SHINGLE, { inset: 7, rows: 4 });
  plankWall(g, 6, 25, 44, 26, WOOD);
  rect(g, 16, 31, 24, 20, INK, 1);
  // 선대 위 배 뼈대
  curve(g, 40, 84, 64, 96, 90, 80, tones('#c69a64').dark, 2.4);
  for (let i = 0; i < 6; i++) {
    const x = 46 + i * 7.4;
    const base = 88 - Math.abs(i - 2.5) * 1.6;
    curve(g, x, base, x - 5, base - 12, x - 2, base - 24, tones('#c69a64').base, 1.4);
  }
  line(g, 42, 64, 88, 62, tones('#c69a64').base, 1.2);
  // 기중기
  line(g, 90, 92, 90, 8, DARK_WOOD.dark, 2.4);
  line(g, 90, 12, 60, 20, DARK_WOOD.dark, 1.8);
  line(g, 62, 20, 62, 40, rgba(LINEN.base, 0.9), 0.6);
  crate(g, 58, 40, 8);
  // 통과 목재
  barrel(g, 6, 70, 8, 11);
  for (let i = 0; i < 3; i++) rect(g, 16, 78 + i * 3.6, 22, 3.2, lit(WOOD), 1.4);
  return { flags: [{ x: 8, y: 6, h: 16 }] };
}

/** 그리폰 둥지: 이끼 낀 바위 봉우리, 나뭇가지 둥지와 알, 횃대 */
function drawAerie(g, w, h, p) {
  groundPlate(g, w, h, DIRT, 4);
  const ROCK = tones('#86817a');
  for (const [x, y, rx, ry] of [[24, 70, 22, 20], [70, 72, 22, 18], [48, 54, 30, 26], [30, 40, 16, 16], [66, 42, 18, 16]]) {
    ellipse(g, x, y, rx, ry, round(ROCK));
    ellipse(g, x - rx * 0.3, y - ry * 0.5, rx * 0.4, ry * 0.2, rgba(tones('#6f8a4f').base, 0.65));
  }
  for (const [x1, y1, x2, y2] of [[40, 60, 46, 76], [62, 52, 58, 66], [22, 64, 30, 72]]) line(g, x1, y1, x2, y2, rgba(ROCK.darker, 0.7), 0.8);
  // 둥지
  ellipse(g, 50, 26, 28, 11, round(tones('#7a5a3a')));
  const rand = seeded(77);
  for (let i = 0; i < 26; i++) {
    const a = rand() * TAU;
    const r1 = 12 + rand() * 12;
    line(g, 50 + Math.cos(a) * r1, 26 + Math.sin(a) * r1 * 0.4, 50 + Math.cos(a + 0.6) * (r1 + 8), 26 + Math.sin(a + 0.6) * (r1 + 8) * 0.4, rgba(i % 2 ? '#5b4127' : '#a07a4e', 0.9), 0.9);
  }
  ellipse(g, 50, 24, 18, 6, lit(tones('#4a3522')));
  for (const [x, y] of [[44, 22], [52, 21], [57, 24]]) ellipse(g, x, y, 3.2, 4, round(tones('#efe6d2')));
  // 횃대
  line(g, 14, 90, 14, 4, DARK_WOOD.dark, 2.4);
  line(g, 6, 18, 22, 18, DARK_WOOD.dark, 1.8);
  // 깃털 하나
  curve(g, 80, 88, 84, 84, 88, 86, tones('#e9e1cc').base, 1.6);
  return { flags: [{ x: 14, y: 4, h: 16 }] };
}

const ART = {
  keep: { top: 96, draw: drawKeep },
  farmstead: { top: 20, draw: drawFarmstead },
  storehouse: { top: 18, draw: drawStorehouse },
  barracks: { top: 28, draw: drawBarracks },
  stables: { top: 18, draw: drawStables },
  obelisk: { top: 44, draw: drawObelisk },
  watchtower: { top: 64, draw: drawWatchtower },
  mage_tower: { top: 90, draw: drawMageTower },
  market: { top: 30, draw: drawMarket },
  sanctum: { top: 44, draw: drawSanctum },
  shipyard: { top: 24, draw: drawShipyard },
  aerie: { top: 26, draw: drawAerie },
};

/** 그림이 있는 건물 종류 (테스트: 모든 건물에 그림이 있어야 한다) */
export const BUILDING_ART_TYPES = Object.freeze(Object.keys(ART));

// ---------- 금광 ----------

const MINE_ROCK = tones('#857c70');
const ORE = tones('#e2b53e');
const NUGGET_SPOTS = [[0, 0], [-6, 1.5], [6, 1.2], [-3, -3], [3.4, -3.2], [0, -6]];

function drawMine(g, w, h, nuggets) {
  groundPlate(g, w, h, tones('#6a5a46'), 4);
  const rocks = [
    [w * 0.5, h * 0.34, w * 0.34, h * 0.3],
    [w * 0.26, h * 0.46, w * 0.24, h * 0.26],
    [w * 0.74, h * 0.46, w * 0.24, h * 0.26],
    [w * 0.14, h * 0.72, w * 0.14, h * 0.15],
    [w * 0.86, h * 0.72, w * 0.14, h * 0.15],
  ];
  for (const [x, y, rx, ry] of rocks) {
    ellipse(g, x, y, rx, ry, round(MINE_ROCK));
    ellipse(g, x - rx * 0.35, y - ry * 0.45, rx * 0.35, ry * 0.18, rgba(MINE_ROCK.lighter, 0.35));
  }
  // 금맥
  const veins = [];
  for (const [x, y, len, a] of [[w * 0.32, h * 0.36, 14, 0.5], [w * 0.62, h * 0.28, 16, -0.4], [w * 0.8, h * 0.5, 10, 0.9], [w * 0.2, h * 0.54, 9, -0.7]]) {
    g.beginPath();
    for (let i = 0; i <= 4; i++) {
      const k = i / 4;
      const px = x + Math.cos(a) * len * k + (i % 2 ? 1.6 : -1.2);
      const py = y + Math.sin(a) * len * k;
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    g.strokeStyle = ORE.base;
    g.lineWidth = 1.6;
    g.stroke();
    g.strokeStyle = ORE.lighter;
    g.lineWidth = 0.6;
    g.stroke();
    veins.push({ x: x + Math.cos(a) * len * 0.5, y: y + Math.sin(a) * len * 0.5 });
  }
  // 갱도 입구: 나무 틀 안의 어둠
  const ex = w / 2;
  const ey = h * 0.66;
  g.beginPath();
  g.moveTo(ex - 11, ey + 16);
  g.lineTo(ex - 11, ey);
  g.arc(ex, ey, 11, Math.PI, 0);
  g.lineTo(ex + 11, ey + 16);
  g.closePath();
  g.fillStyle = '#16110d';
  g.fill();
  rect(g, ex - 14, ey - 6, 3.4, 23, lit(WOOD), 0.6);
  rect(g, ex + 10.6, ey - 6, 3.4, 23, lit(WOOD), 0.6);
  rect(g, ex - 16, ey - 10, 32, 4.4, lit(DARK_WOOD), 0.8);
  // 레일
  for (const dx of [-5, 5]) line(g, ex + dx, ey + 8, ex + dx * 1.6, h - 3, IRON.base, 1);
  for (let y = ey + 10; y < h - 2; y += 4) line(g, ex - 8, y, ex + 8, y, DARK_WOOD.base, 1.2, 'butt');
  // 금덩이 더미 (남은 만큼)
  for (const [dx, dy] of NUGGET_SPOTS.slice(0, nuggets)) {
    circle(g, ex + 20 + dx, h * 0.84 + dy, 3.2, round(ORE));
    circle(g, ex + 19 + dx, h * 0.84 + dy - 1, 1, 'rgba(255, 250, 220, 0.9)');
  }
  // 수레
  rect(g, ex - 33, h * 0.76, 16, 9, lit(WOOD), 1.4);
  if (nuggets > 2) for (const dx of [-29, -24, -20]) circle(g, ex + dx, h * 0.76, 2.4, round(ORE));
  for (const dx of [-30, -20]) {
    circle(g, ex + dx, h * 0.76 + 10, 2.6, lit(DARK_WOOD));
    circle(g, ex + dx, h * 0.76 + 10, 0.8, metal(IRON));
  }
  return { sparkles: veins };
}

/** 금광: 남은 양이 줄면 금덩이도 줄고, 금맥이 반짝인다 */
export function drawMineArt(ctx, mine, amount, initialAmount, t) {
  const w = mine.w * S;
  const h = mine.h * S;
  const nuggets = Math.max(1, Math.ceil((amount / initialAmount) * NUGGET_SPOTS.length));
  const entry = sprite(`mine:${mine.w}x${mine.h}:${nuggets}`, { x: -4, y: -4, w: w + 8, h: h + 8 }, (g) => drawMine(g, w, h, nuggets));
  const px = mine.x * S;
  const py = mine.y * S;
  blit(ctx, entry, px, py);
  entry.meta.sparkles.forEach((s, i) => {
    const k = Math.sin(t / 380 + i * 2.3 + mine.x);
    if (k > 0.55) glow(ctx, px + s.x, py + s.y, 6, 'rgba(255, 236, 160, 0.9)', (k - 0.55) / 0.45);
  });
}

// ---------- 그리기 ----------

function buildingSprite(type, color, age) {
  const art = ART[type];
  const size = BUILDINGS[type].size * S;
  const keyAge = type === 'keep' ? Math.min(3, Math.max(1, age)) : 1;
  return sprite(`b:${type}|${color}|${keyAge}`, { x: -6, y: -art.top, w: size + 12, h: size + art.top + 6 }, (g) => art.draw(g, size, size, palette(color), keyAge));
}

/** 굴뚝 연기: 세 덩이가 올라가며 퍼진다 */
function smoke(ctx, x, y, t, seed, dark = false) {
  for (let i = 0; i < 3; i++) {
    const k = ((t / 2400 + seed * 0.37 + i / 3) % 1 + 1) % 1;
    const r = 2.6 + k * 5;
    ctx.fillStyle = dark ? `rgba(40, 34, 30, ${0.55 * (1 - k)})` : `rgba(220, 216, 210, ${0.45 * (1 - k)})`;
    ctx.beginPath();
    ctx.arc(x + Math.sin(k * 5 + seed) * 3 + k * 5, y - k * 26, r, 0, TAU);
    ctx.fill();
  }
}

/** 불꽃 (다친 건물) */
function flame(ctx, x, y, t, seed, size = 1) {
  for (let i = 0; i < 3; i++) {
    const flick = 0.75 + 0.25 * Math.sin(t / 70 + seed * 3 + i * 2.1);
    const h = (7 + i * 2) * size * flick;
    const w = (3.4 - i * 0.6) * size;
    const dx = (i - 1) * 2.6 * size;
    ctx.fillStyle = ['rgba(255, 96, 40, 0.85)', 'rgba(255, 160, 60, 0.9)', 'rgba(255, 230, 140, 0.95)'][i];
    ctx.beginPath();
    ctx.moveTo(x + dx - w, y);
    ctx.quadraticCurveTo(x + dx - w * 0.6, y - h * 0.6, x + dx, y - h);
    ctx.quadraticCurveTo(x + dx + w * 0.6, y - h * 0.6, x + dx + w, y);
    ctx.closePath();
    ctx.fill();
  }
}

/** 터: 네 모서리 말뚝과 팀 색 줄 */
function drawSite(ctx, px, py, size, color) {
  ctx.fillStyle = 'rgba(96, 78, 52, 0.45)';
  ctx.fillRect(px + 3, py + 3, size - 6, size - 6);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(px + 4, py + 4, size - 8, size - 8);
  ctx.setLineDash([]);
  for (const [x, y] of [[px + 4, py + 4], [px + size - 4, py + 4], [px + 4, py + size - 4], [px + size - 4, py + size - 4]]) {
    ctx.fillStyle = '#5c4027';
    ctx.fillRect(x - 1.5, y - 7, 3, 8);
    ctx.fillStyle = '#8b6239';
    ctx.fillRect(x - 1.5, y - 7, 1.4, 8);
  }
}

/** 비계: 세로 기둥과 지금 쌓은 높이의 발판 */
function drawScaffold(ctx, px, py, size, topY) {
  ctx.lineCap = 'butt';
  ctx.strokeStyle = 'rgba(40, 28, 16, 0.9)';
  ctx.lineWidth = 3;
  const posts = size > 80 ? [0.08, 0.36, 0.64, 0.92] : [0.1, 0.5, 0.9];
  ctx.beginPath();
  for (const k of posts) {
    ctx.moveTo(px + size * k, py + size - 2);
    ctx.lineTo(px + size * k, topY - 4);
  }
  ctx.stroke();
  ctx.strokeStyle = '#a37a4c';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  // 발판 (지금 높이와 그 아래 한 층)
  for (const y of [topY, topY + (py + size - topY) / 2]) {
    ctx.fillStyle = 'rgba(40, 28, 16, 0.9)';
    ctx.fillRect(px + size * 0.04, y - 1.8, size * 0.92, 4);
    ctx.fillStyle = '#b88a58';
    ctx.fillRect(px + size * 0.04, y - 1.2, size * 0.92, 2.6);
  }
  // 대각 버팀대
  ctx.strokeStyle = 'rgba(120, 88, 52, 0.9)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(px + size * posts[0], py + size - 4);
  ctx.lineTo(px + size * posts[1], topY + 2);
  ctx.stroke();
}

/** 이름표를 붙일 높이 (건물 그림 꼭대기 위, 월드 px) */
export function buildingLabelY(b, color, age) {
  if (!ART[b.type]) return b.y * S - 8;
  const meta = buildingSprite(b.type, color, age).meta ?? {};
  return b.y * S + (meta.label ?? -8);
}

/**
 * 건물 하나를 그린다. age: 주인의 시대 (영주관 모습)
 * @returns {boolean} 그림이 있으면 true
 */
export function drawBuildingArt(ctx, b, color, t, age) {
  if (!ART[b.type]) return false;
  const px = b.x * S;
  const py = b.y * S;
  const size = b.size * S;

  if (!b.complete) {
    drawSite(ctx, px, py, size, color);
    if (!b.started) return true;
    const entry = buildingSprite(b.type, color, age);
    // 아래부터 차오른다: 처음에도 기초는 보이게
    const reveal = 0.18 + 0.82 * Math.max(0, Math.min(1, b.progress));
    const clipTop = 1 - reveal;
    blit(ctx, entry, px, py, { clipTop, alpha: 0.96 });
    const topY = py + entry.y + entry.h * clipTop;
    drawScaffold(ctx, px, py, size, Math.max(py + entry.y + 8, topY));
    return true;
  }

  const entry = buildingSprite(b.type, color, age);
  // 발밑 그림자 (오른쪽 아래로)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.beginPath();
  ctx.ellipse(px + size * 0.55, py + size - 2, size * 0.52, size * 0.1, 0, 0, TAU);
  ctx.fill();
  blit(ctx, entry, px, py);

  const meta = entry.meta ?? {};
  for (const light of meta.glow ?? []) {
    const pulse = light.pulse ? 0.7 + 0.3 * Math.sin(t / 420 + light.y * 0.2 + b.id) : 1;
    glow(ctx, px + light.x, py + light.y, light.r, light.color, pulse);
  }
  if (meta.crystal) {
    const bob = Math.sin(t / 600 + b.id) * 3;
    const cx = px + meta.crystal.x;
    const cy = py + meta.crystal.y + bob;
    glow(ctx, cx, cy, 12, 'rgba(140, 190, 255, 0.9)', 0.8 + 0.2 * Math.sin(t / 300));
    ctx.fillStyle = '#cfe2ff';
    ctx.strokeStyle = 'rgba(27, 21, 17, 0.9)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6);
    ctx.lineTo(cx + 3.4, cy);
    ctx.lineTo(cx, cy + 6);
    ctx.lineTo(cx - 3.4, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  if (meta.flame) flame(ctx, px + meta.flame.x, py + meta.flame.y, t, b.id, 0.8);
  for (const s of meta.smoke ?? []) smoke(ctx, px + s.x, py + s.y, t, b.id);
  (meta.flags ?? []).forEach((f, i) => wavingFlag(ctx, px + f.x, py + f.y, f.h, color, t, { seed: b.id + i * 3 }));

  // 다친 건물: 연기가 오르고, 많이 다치면 불이 붙는다
  const ratio = b.hp / BUILDINGS[b.type].hp;
  if (ratio < 0.6) {
    const rand = seeded(b.id * 17 + 3);
    const spots = ratio < 0.3 ? 3 : 1;
    for (let i = 0; i < spots; i++) {
      const fx = px + size * (0.2 + rand() * 0.6);
      const fy = py + size * (0.25 + rand() * 0.4);
      if (ratio < 0.35) flame(ctx, fx, fy, t, b.id + i, size > 80 ? 1.3 : 1);
      smoke(ctx, fx, fy - 6, t, b.id + i, true);
    }
  }
  return true;
}
