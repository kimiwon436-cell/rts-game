import { TILE_SIZE } from '@rune/shared/constants.js';
import { UNITS } from '@rune/shared/data/units.js';
import { UNIT_STATE } from '@rune/shared/protocol.js';

// 건물·유닛·금광의 임시 그림. 스프라이트가 생기면 이 파일만 바꾸면 된다.

const S = TILE_SIZE;
const TAU = Math.PI * 2;

/** 공중 유닛은 제 자리보다 이만큼 위에 그리고 발밑에 그림자를 둔다 (선택 고리·체력 막대·투사체도 같이 올린다) */
export const AIR_ALTITUDE = 22;
export const AIR_ALTITUDE_TILES = AIR_ALTITUDE / S;
export const altitudeOf = (type) => (UNITS[type]?.flying ? AIR_ALTITUDE : 0);

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function ellipse(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
}

function polygon(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

function flag(ctx, x, y, color) {
  ctx.fillStyle = '#3a342d';
  ctx.fillRect(x - 1, y, 2, 22);
  ctx.fillStyle = color;
  polygon(ctx, [[x + 1, y], [x + 18, y + 5], [x + 1, y + 10]]);
}

function baseShadow(ctx, px, py, size) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.fillRect(px + 8, py + size - 8, size - 10, 9);
}

// ---------- 금광 ----------

const NUGGETS = [
  [-14, -6, 5],
  [4, -11, 4],
  [14, 5, 5],
  [-3, 8, 4],
  [-19, 9, 3],
];

export function drawGoldMine(ctx, mine, amount, initialAmount) {
  const w = mine.w * S;
  const h = mine.h * S;
  const cx = mine.x * S + w / 2;
  const cy = mine.y * S + h / 2;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ellipse(ctx, cx, cy + h * 0.3, w * 0.46, h * 0.15);
  ctx.fillStyle = '#5e554b';
  ellipse(ctx, cx, cy + 6, w * 0.42, h * 0.34);
  ctx.fillStyle = '#716658';
  ellipse(ctx, cx - 10, cy - 2, w * 0.26, h * 0.24);
  ctx.fillStyle = '#7d7163';
  ellipse(ctx, cx + 12, cy + 4, w * 0.2, h * 0.18);

  // 남은 양이 줄면 금덩이도 줄어든다
  const visible = Math.max(1, Math.ceil((amount / initialAmount) * NUGGETS.length));
  for (const [ox, oy, r] of NUGGETS.slice(0, visible)) {
    ctx.fillStyle = '#d9a93a';
    circle(ctx, cx + ox, cy + oy, r);
    ctx.fillStyle = '#f5d67a';
    circle(ctx, cx + ox - r * 0.3, cy + oy - r * 0.3, r * 0.4);
  }
}

// ---------- 건물 ----------

const ART = {
  keep(ctx, px, py, size, color, t, age) {
    const cx = px + size / 2;
    const cy = py + size / 2;
    const castle = age >= 2;
    ctx.fillStyle = castle ? '#8a8378' : '#7d766c';
    ctx.fillRect(px + 6, py + 10, size - 12, size - 16);
    ctx.fillStyle = castle ? '#a19a8e' : '#948c80';
    ctx.fillRect(px + 6, py + 10, size - 12, 6);
    const tower = castle ? 28 : 22;
    ctx.fillStyle = castle ? '#736d63' : '#6a645b';
    for (const [ox, oy] of [[2, 4], [size - tower - 2, 4], [2, size - tower - 4], [size - tower - 2, size - tower - 4]]) {
      ctx.fillRect(px + ox, py + oy, tower, tower);
    }
    ctx.fillStyle = '#a39a8c';
    ctx.fillRect(cx - 22, cy - 24, 44, 42);
    ctx.fillStyle = '#b3aa9b';
    ctx.fillRect(cx - 22, cy - 24, 44, 6);
    ctx.fillStyle = '#4f4a43';
    ctx.fillRect(cx - 7, cy + 4, 14, 14);
    flag(ctx, cx, cy - 50, color);
    if (castle) flag(ctx, px + 14, py - 12, color);
  },

  farmstead(ctx, px, py, size, color) {
    ctx.fillStyle = '#6f5a36';
    for (let i = 0; i < 3; i++) ctx.fillRect(px + 4, py + size - 14 + i * 4, 18, 2); // 밭고랑
    ctx.fillStyle = '#8a6a45';
    ctx.fillRect(px + 16, py + 26, size - 22, size - 34);
    ctx.fillStyle = '#c09a52';
    polygon(ctx, [[px + 12, py + 28], [px + 16 + (size - 22) / 2, py + 8], [px + size - 2, py + 28]]);
    ctx.fillStyle = '#3e2f1e';
    ctx.fillRect(px + 34, py + size - 18, 8, 10);
    flag(ctx, px + 40, py - 6, color);
  },

  storehouse(ctx, px, py, size, color) {
    ctx.fillStyle = '#7a5a3a';
    ctx.fillRect(px + 6, py + 16, size - 12, size - 24);
    ctx.fillStyle = '#5a4028';
    ctx.fillRect(px + 2, py + 10, size - 4, 10);
    ctx.fillStyle = '#a37b4b';
    ctx.fillRect(px + 10, py + size - 20, 14, 12);
    ctx.fillRect(px + 28, py + size - 16, 12, 10);
    ctx.strokeStyle = '#6b4a2a';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 10.5, py + size - 19.5, 13, 11);
    flag(ctx, px + size - 12, py - 8, color);
  },

  barracks(ctx, px, py, size, color) {
    ctx.fillStyle = '#8e8578';
    ctx.fillRect(px + 8, py + 34, size - 16, size - 44);
    ctx.fillStyle = '#8a3b32';
    polygon(ctx, [[px + 2, py + 38], [px + 18, py + 12], [px + size - 18, py + 12], [px + size - 2, py + 38]]);
    ctx.fillStyle = '#4f4a43';
    ctx.fillRect(px + size / 2 - 9, py + size - 30, 18, 20);
    ctx.strokeStyle = '#d6d0c4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px + 16, py + size - 14);
    ctx.lineTo(px + 34, py + size - 40);
    ctx.moveTo(px + 34, py + size - 14);
    ctx.lineTo(px + 16, py + size - 40);
    ctx.stroke();
    flag(ctx, px + size - 20, py - 10, color);
  },

  stables(ctx, px, py, size, color) {
    ctx.fillStyle = '#6e4b2e';
    ctx.fillRect(px + 10, py + 20, size - 20, size - 40);
    ctx.fillStyle = '#50341f';
    polygon(ctx, [[px + 4, py + 24], [px + size / 2, py + 6], [px + size - 4, py + 24]]);
    ctx.fillStyle = '#2e2014';
    ctx.fillRect(px + size / 2 - 12, py + size - 44, 24, 24);
    ctx.fillStyle = '#a88a5a';
    for (let i = 0; i < 6; i++) ctx.fillRect(px + 6 + i * 16, py + size - 18, 3, 12);
    ctx.fillRect(px + 6, py + size - 14, size - 12, 3);
    flag(ctx, px + 16, py - 8, color);
  },

  obelisk(ctx, px, py, size, color, t) {
    const pulse = 0.5 + 0.5 * Math.sin(t / 500);
    ctx.fillStyle = '#3a3f49';
    ctx.fillRect(px + 12, py + size - 16, size - 24, 10);
    ctx.fillStyle = '#4a4f5a';
    polygon(ctx, [[px + 22, py + size - 14], [px + 27, py + 6], [px + 37, py + 6], [px + 42, py + size - 14]]);
    ctx.fillStyle = `rgba(150, 195, 255, ${0.45 + pulse * 0.45})`;
    ctx.fillRect(px + 31, py + 14, 2, size - 34);
    ctx.fillRect(px + 28, py + 24, 8, 2);
    ctx.fillStyle = color;
    ctx.fillRect(px + 14, py + size - 8, size - 28, 3);
  },

  aerie(ctx, px, py, size, color) {
    // 바위 봉우리 위의 둥지
    ctx.fillStyle = '#6a655e';
    polygon(ctx, [[px + 6, py + size - 6], [px + 18, py + 22], [px + 40, py + 14], [px + size - 8, py + size - 6]]);
    ctx.fillStyle = '#7f7a71';
    polygon(ctx, [[px + 18, py + 22], [px + 29, py + 8], [px + 40, py + 14]]);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(px + 10, py + size - 14, size - 20, 8);
    // 나뭇가지 둥지와 알
    ctx.fillStyle = '#7a5a3a';
    ellipse(ctx, px + 44, py + 34, 18, 9);
    ctx.strokeStyle = '#5d4327';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      stroke(ctx, px + 44 + Math.cos(a) * 8, py + 34 + Math.sin(a) * 4, px + 44 + Math.cos(a) * 19, py + 34 + Math.sin(a) * 10, '#5d4327', 1.5);
    }
    ctx.fillStyle = '#efe6d2';
    circle(ctx, px + 40, py + 32, 4);
    circle(ctx, px + 49, py + 33, 3.5);
    // 횃대와 깃발
    stroke(ctx, px + 16, py + size - 8, px + 16, py + 12, '#4a3520', 3);
    flag(ctx, px + 16, py + 4, color);
  },

  shipyard(ctx, px, py, size, color) {
    // 목조 부두 바닥
    ctx.fillStyle = '#6b4e32';
    ctx.fillRect(px + 3, py + 6, size - 6, size - 9);
    ctx.fillStyle = 'rgba(40, 26, 12, 0.35)';
    for (let k = 12; k < size - 4; k += 8) ctx.fillRect(px + 3, py + k, size - 6, 1);
    // 창고
    ctx.fillStyle = '#8a6a45';
    ctx.fillRect(px + 8, py + 26, 42, 32);
    ctx.fillStyle = '#5a3f28';
    polygon(ctx, [[px + 3, py + 28], [px + 29, py + 8], [px + 55, py + 28]]);
    ctx.fillStyle = '#2e2a25';
    ctx.fillRect(px + 23, py + 42, 12, 16);
    // 선대 위의 배 뼈대
    ctx.strokeStyle = '#b58a5a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px + 20, py + size - 16);
    ctx.quadraticCurveTo(px + 44, py + size - 2, px + 74, py + size - 18);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const rx = px + 28 + i * 11;
      ctx.beginPath();
      ctx.moveTo(rx, py + size - 12);
      ctx.lineTo(rx - 3, py + size - 30);
      ctx.stroke();
    }
    // 기중기
    stroke(ctx, px + size - 16, py + size - 8, px + size - 16, py + 14, '#4a3520', 3);
    stroke(ctx, px + size - 16, py + 14, px + size - 42, py + 22, '#4a3520', 2);
    stroke(ctx, px + size - 40, py + 22, px + size - 40, py + 38, 'rgba(230, 220, 200, 0.7)', 1);
    flag(ctx, px + 14, py - 6, color);
  },

  watchtower(ctx, px, py, size, color) {
    ctx.fillStyle = '#7d766c';
    ctx.fillRect(px + 18, py + 10, 28, size - 18);
    ctx.fillStyle = '#948c80';
    for (let i = 0; i < 4; i++) ctx.fillRect(px + 16 + i * 9, py + 4, 6, 8);
    ctx.fillStyle = '#2e2a25';
    ctx.fillRect(px + 29, py + 22, 6, 10);
    flag(ctx, px + 32, py - 18, color);
  },

  mage_tower(ctx, px, py, size, color, t) {
    const cx = px + size / 2;
    const pulse = 0.5 + 0.5 * Math.sin(t / 600);
    ctx.fillStyle = '#6f6a86';
    ctx.fillRect(cx - 20, py + 30, 40, size - 38);
    ctx.fillStyle = '#3f4796';
    polygon(ctx, [[cx - 28, py + 34], [cx, py - 4], [cx + 28, py + 34]]);
    ctx.fillStyle = `rgba(150, 195, 255, ${0.5 + pulse * 0.4})`;
    ctx.fillRect(cx - 5, py + 44, 10, 14);
    ctx.fillStyle = color;
    ctx.fillRect(cx - 20, py + size - 12, 40, 3);
  },

  market(ctx, px, py, size, color) {
    for (const [ox, oy, stripe] of [[6, 14, '#c9a53a'], [48, 40, '#a33b33']]) {
      ctx.fillStyle = '#8a6a45';
      ctx.fillRect(px + ox + 2, py + oy + 14, 38, 22);
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i % 2 ? '#efe6d2' : stripe;
        ctx.fillRect(px + ox + i * 8, py + oy, 8, 14);
      }
    }
    ctx.fillStyle = '#e2b53e';
    circle(ctx, px + 26, py + 38, 3);
    flag(ctx, px + 12, py - 8, color);
  },
};

/**
 * @param {object} b 건물 (ClientWorld)
 * @param {string} color 소유자 색
 * @param {number} t 시간(ms)
 * @param {number} age 소유자의 시대 (영주관 외형)
 */
export function drawBuilding(ctx, b, color, t, age) {
  const px = b.x * S;
  const py = b.y * S;
  const size = b.size * S;

  if (!b.complete) {
    ctx.fillStyle = 'rgba(120, 96, 64, 0.55)';
    ctx.fillRect(px + 2, py + 2, size - 4, size - 4);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(px + 3, py + 3, size - 6, size - 6);
    ctx.setLineDash([]);
    if (!b.started) return;
  }

  baseShadow(ctx, px, py, size);
  ctx.globalAlpha = b.complete ? 1 : 0.3 + 0.7 * b.progress;
  ART[b.type](ctx, px, py, size, color, t, age);
  ctx.globalAlpha = 1;

  if (!b.complete) {
    // 비계
    ctx.strokeStyle = 'rgba(92, 64, 36, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      ctx.moveTo(px + (size * i) / 4, py + 4);
      ctx.lineTo(px + (size * i) / 4, py + size - 4);
    }
    const top = py + size - (size - 8) * b.progress;
    ctx.moveTo(px + 4, top);
    ctx.lineTo(px + size - 4, top);
    ctx.stroke();
  }
}

// ---------- 유닛 ----------

/**
 * 배 몸통. 뱃머리가 f(1 오른쪽, -1 왼쪽) 쪽이고 물결에 조금 흔들린다. 움직이면 뒤로 물살 자국이 난다.
 * @returns {number} 흔들림을 더한 갑판 높이 y
 */
function shipHull(ctx, u, x, y, f, len, beam, t, hullColor = '#6b4a2c') {
  const yy = y + Math.sin(t / 420 + u.id) * 1.2;
  if (u.state === UNIT_STATE.MOVE || u.state === UNIT_STATE.ATTACK) {
    ctx.strokeStyle = 'rgba(225, 238, 255, 0.4)';
    ctx.lineWidth = 1.5;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x - f * len * 0.8, yy + beam * 0.25);
      ctx.lineTo(x - f * len * 1.45, yy + beam * (0.25 + side * 0.4));
      ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(8, 24, 40, 0.35)';
  ellipse(ctx, x, yy + beam * 0.5, len * 1.05, beam * 0.42);
  ctx.fillStyle = hullColor;
  polygon(ctx, [
    [x - f * len, yy - beam * 0.2],
    [x + f * len * 0.72, yy - beam * 0.2],
    [x + f * len * 1.05, yy - beam * 0.55],
    [x + f * len * 0.78, yy + beam * 0.42],
    [x - f * len * 0.86, yy + beam * 0.42],
  ]);
  ctx.fillStyle = 'rgba(255, 230, 190, 0.18)';
  ctx.fillRect(x - len * 0.9, yy - beam * 0.2, len * 1.65, 3);
  return yy;
}

/**
 * 공중 유닛 그리기 준비: 땅에 그림자를 깔고, 하늘에 뜬 자리와 날갯짓 위상을 돌려준다.
 * @returns {{ x: number, y: number, f: number, flap: number }}
 */
function flyer(ctx, u, t, flapMs = 260) {
  const x = u.drawX * S;
  const ground = u.drawY * S;
  const hover = Math.sin(t / 520 + u.id) * 2;
  const size = UNITS[u.type].radius * S * 0.8;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ellipse(ctx, x, ground + 8, size, size * 0.4);
  return { x, y: ground - AIR_ALTITUDE + hover, f: u.facing ?? 1, flap: Math.sin(t / flapMs + u.id) };
}

const AIR_ART = {
  falcon_scout(ctx, u, color, t) {
    const { x, y, f, flap } = flyer(ctx, u, t, 110);
    ctx.strokeStyle = '#8a7558'; // 긴 날개
    ctx.lineWidth = 2.5;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x, y - 1);
      ctx.quadraticCurveTo(x + side * 7, y - 4 - flap * 5, x + side * 13, y - 1 - flap * 7);
      ctx.stroke();
    }
    ctx.fillStyle = '#6b5a45';
    ellipse(ctx, x, y, 5.5, 3.5);
    ctx.fillStyle = color;
    ctx.fillRect(x - 2, y - 1.5, 4, 3); // 주인 표식
    ctx.fillStyle = '#e8d9a8';
    circle(ctx, x + f * 5, y - 2.5, 2.2);
    ctx.fillStyle = '#d8a13a';
    ctx.fillRect(x + f * 7, y - 3, 2, 1.5); // 부리
  },

  gryphon_rider(ctx, u, color, t) {
    const { x, y, f, flap } = flyer(ctx, u, t, 190);
    // 날개
    ctx.fillStyle = '#c9bda2';
    for (const side of [-1, 1]) {
      polygon(ctx, [
        [x, y - 2],
        [x + side * 16, y - 10 - flap * 7],
        [x + side * 20, y - 2 - flap * 4],
        [x + side * 8, y + 2],
      ]);
    }
    ctx.fillStyle = '#b08b52'; // 사자 몸
    ellipse(ctx, x, y + 1, 11, 6);
    ctx.fillStyle = '#d9cdb4'; // 독수리 머리
    circle(ctx, x + f * 10, y - 4, 4.5);
    ctx.fillStyle = '#d8a13a';
    polygon(ctx, [[x + f * 14, y - 4], [x + f * 19, y - 2.5], [x + f * 14, y - 1]]);
    // 기수
    ctx.fillStyle = color;
    circle(ctx, x - f * 2, y - 8, 4.5);
    ctx.fillStyle = '#9aa0a6';
    circle(ctx, x - f * 2, y - 14, 3.2);
    stroke(ctx, x - f * 2, y - 10, x + f * 12, y - 16, '#7a5634', 2); // 창
  },

  storm_wyvern(ctx, u, color, t) {
    const { x, y, f, flap } = flyer(ctx, u, t, 240);
    const spark = 0.5 + 0.5 * Math.sin(t / 180 + u.id);
    ctx.fillStyle = '#4a5570'; // 큰 날개
    for (const side of [-1, 1]) {
      polygon(ctx, [
        [x, y - 2],
        [x + side * 20, y - 14 - flap * 8],
        [x + side * 26, y - 1 - flap * 5],
        [x + side * 10, y + 3],
      ]);
    }
    ctx.fillStyle = '#5b6885'; // 몸통
    ellipse(ctx, x, y + 1, 13, 6.5);
    ctx.fillStyle = color;
    ctx.fillRect(x - 5, y - 4, 10, 3);
    ctx.fillStyle = '#6f7d9c'; // 머리와 꼬리
    ellipse(ctx, x + f * 13, y - 3, 5.5, 4);
    stroke(ctx, x - f * 12, y + 1, x - f * 24, y + 6, '#5b6885', 3);
    ctx.fillStyle = `rgba(150, 195, 255, ${0.4 + spark * 0.5})`; // 폭풍 기운
    circle(ctx, x + f * 18, y - 2, 3 + spark * 1.5);
  },
};

const SHIP_ART = {
  war_galley(ctx, u, color, t) {
    const { x, y, f } = frameOf(u, t);
    const deck = shipHull(ctx, u, x, y, f, 22, 16, t);
    const stroke_ = Math.sin(t / 160 + u.id) * (u.state === UNIT_STATE.MOVE ? 4 : 1);
    for (let i = -2; i <= 2; i++) {
      stroke(ctx, x + i * 7, deck + 4, x + i * 7 - f * 3 + stroke_, deck + 12, '#a07a4e', 1.5); // 오어
    }
    stroke(ctx, x - f * 2, deck, x - f * 2, deck - 32, '#4a3520', 2.5); // 돛대
    ctx.fillStyle = color;
    polygon(ctx, [[x - f * 2 - 12, deck - 30], [x - f * 2 + 12, deck - 30], [x - f * 2 + 10, deck - 10], [x - f * 2 - 10, deck - 10]]);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fillRect(x - f * 2 - 11, deck - 22, 22, 3);
  },

  transport_ship(ctx, u, color, t) {
    const { x, y, f } = frameOf(u, t);
    const deck = shipHull(ctx, u, x, y, f, 20, 22, t, '#72532f');
    ctx.fillStyle = '#9b7a4c'; // 짐칸
    ctx.fillRect(x - 12, deck - 12, 16, 10);
    ctx.fillStyle = '#86653e';
    ctx.fillRect(x + 2, deck - 9, 9, 7);
    ctx.strokeStyle = 'rgba(40, 26, 12, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 12, deck - 12, 16, 10);
    stroke(ctx, x + f * 8, deck - 2, x + f * 8, deck - 26, '#4a3520', 2);
    ctx.fillStyle = color;
    polygon(ctx, [[x + f * 8, deck - 25], [x + f * 20, deck - 14], [x + f * 8, deck - 10]]);
  },

  catapult_ship(ctx, u, color, t) {
    const { x, y, f } = frameOf(u, t);
    const deck = shipHull(ctx, u, x, y, f, 25, 19, t, '#5f4127');
    ctx.fillStyle = '#4a3520'; // 투석기 틀
    ctx.fillRect(x - 10, deck - 10, 20, 7);
    // 쏜 직후에는 팔이 앞으로 넘어가 있다
    const fired = u.state === UNIT_STATE.ATTACK && Math.sin(t / 300 + u.id) > 0.6;
    const armX = fired ? x + f * 16 : x - f * 14;
    const armY = fired ? deck - 26 : deck - 22;
    stroke(ctx, x, deck - 8, armX, armY, '#a07a4e', 3);
    ctx.fillStyle = '#6e6a62';
    circle(ctx, armX, armY, 3.5);
    ctx.fillStyle = color;
    ctx.fillRect(x - f * 20 - 3, deck - 16, 6, 12); // 뒤 깃발
  },
};

function drawPeasant(ctx, u, color, t) {
  const x = u.drawX * S;
  const y = u.drawY * S;
  const walking = u.state === UNIT_STATE.MOVE || u.state === UNIT_STATE.RETURN;
  const bob = walking ? Math.sin(t / 90 + u.id) * 1.5 : 0;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ellipse(ctx, x, y + 8, 8, 3.5);

  // 도구 휘두르기
  if (u.state === UNIT_STATE.GATHER || u.state === UNIT_STATE.BUILD) {
    const a = -1.2 + Math.sin(t / 130 + u.id) * 0.9;
    ctx.strokeStyle = '#6b4a2a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 5, y + 1);
    ctx.lineTo(x + 5 + Math.cos(a) * 11, y + 1 + Math.sin(a) * 11);
    ctx.stroke();
    ctx.fillStyle = '#b8bec6';
    circle(ctx, x + 5 + Math.cos(a) * 11, y + 1 + Math.sin(a) * 11, 2.2);
  }

  ctx.fillStyle = color;
  circle(ctx, x, y + bob, 7);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#e6c09a';
  circle(ctx, x, y - 7 + bob, 4.5);
  ctx.fillStyle = '#c8a45a';
  ellipse(ctx, x, y - 10 + bob, 6, 2.2);

  if (u.carryKind === 'gold' && u.carryAmount > 0) {
    ctx.fillStyle = '#e2b53e';
    ctx.fillRect(x - 11, y - 3 + bob, 6, 6);
  } else if (u.carryKind === 'wood' && u.carryAmount > 0) {
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(x - 10, y - 6 + bob, 4, 11);
  }
}

const SKIN = '#e6c09a';
const STEEL = '#b8bec6';

/** 그리는 위치와 걷기 흔들림, 바라보는 방향(1 오른쪽, -1 왼쪽) */
function frameOf(u, t, stride = 90) {
  const walking = u.state === UNIT_STATE.MOVE || u.state === UNIT_STATE.RETURN;
  return {
    x: u.drawX * S,
    y: u.drawY * S,
    bob: walking ? Math.sin(t / stride + u.id) * 1.5 : 0,
    f: u.facing ?? 1,
  };
}

function footShadow(ctx, x, y, rx) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ellipse(ctx, x, y + 8, rx, rx * 0.42);
}

function torso(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  circle(ctx, x, y, r);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function stroke(ctx, x1, y1, x2, y2, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

const UNIT_ART = {
  peasant: drawPeasant,

  pikeman(ctx, u, color, t) {
    const { x, y, bob, f } = frameOf(u, t);
    footShadow(ctx, x, y, 8);
    stroke(ctx, x + 7 * f, y + 9 + bob, x - 3 * f, y - 22 + bob, '#7a5634', 2);
    ctx.fillStyle = STEEL;
    polygon(ctx, [[x - 3 * f, y - 25 + bob], [x - 5.5 * f, y - 17 + bob], [x - 0.5 * f, y - 18 + bob]]);
    torso(ctx, x, y + bob, 7, color);
    ctx.fillStyle = SKIN;
    circle(ctx, x, y - 7 + bob, 4.3);
    ctx.fillStyle = '#9aa0a6';
    ellipse(ctx, x, y - 9.5 + bob, 5, 2.6);
  },

  longbowman(ctx, u, color, t) {
    const { x, y, bob, f } = frameOf(u, t);
    footShadow(ctx, x, y, 7.5);
    torso(ctx, x, y + bob, 6.5, color);
    ctx.fillStyle = SKIN;
    circle(ctx, x, y - 7 + bob, 4.2);
    ctx.fillStyle = '#3f6b3a';
    polygon(ctx, [[x - 5, y - 7 + bob], [x, y - 14 + bob], [x + 5, y - 7 + bob]]);
    const cx = x + 3 * f;
    const cy = y - 2 + bob;
    const start = f > 0 ? -1.1 : Math.PI - 1.1;
    ctx.strokeStyle = '#8b5a2b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 9, start, start + 2.2);
    ctx.stroke();
    stroke(ctx, cx + Math.cos(start) * 9, cy + Math.sin(start) * 9, cx + Math.cos(start + 2.2) * 9, cy + Math.sin(start + 2.2) * 9, 'rgba(240, 235, 220, 0.7)', 1);
  },

  scout_rider(ctx, u, color, t) {
    const { x, y, f } = frameOf(u, t);
    const gallop = u.state === UNIT_STATE.MOVE ? Math.sin(t / 60 + u.id) * 1.2 : 0;
    footShadow(ctx, x, y, 12);
    ctx.fillStyle = '#8a6a45';
    ellipse(ctx, x, y + 2 + gallop, 12, 6);
    ctx.fillStyle = '#6f5436';
    ellipse(ctx, x + 10 * f, y - 3 + gallop, 4.5, 3.5);
    torso(ctx, x - f, y - 6 + gallop, 5.5, color);
    ctx.fillStyle = SKIN;
    circle(ctx, x - f, y - 13 + gallop, 3.6);
  },

  knight(ctx, u, color, t) {
    const { x, y, f } = frameOf(u, t);
    const gallop = u.state === UNIT_STATE.MOVE ? Math.sin(t / 70 + u.id) * 1.2 : 0;
    footShadow(ctx, x, y, 14);
    ctx.fillStyle = '#d8d2c4';
    ellipse(ctx, x, y + 2 + gallop, 13.5, 6.5);
    ctx.fillStyle = color;
    ctx.fillRect(x - 10, y + gallop, 20, 4);
    ctx.fillStyle = '#c9c2b2';
    ellipse(ctx, x + 12 * f, y - 4 + gallop, 5, 3.8);
    stroke(ctx, x - 6 * f, y - 4 + gallop, x + 20 * f, y - 12 + gallop, '#7a5634', 2);
    torso(ctx, x - f, y - 7 + gallop, 6, '#aab1ba');
    ctx.fillStyle = color;
    ctx.fillRect(x - 3 - f, y - 8 + gallop, 6, 3);
    ctx.fillStyle = '#8d949c';
    circle(ctx, x - f, y - 14 + gallop, 4.2);
  },

  royal_guard(ctx, u, color, t) {
    const { x, y, bob, f } = frameOf(u, t, 120);
    footShadow(ctx, x, y, 9);
    torso(ctx, x, y + bob, 8, '#8d949c');
    ctx.fillStyle = color;
    ctx.fillRect(x - 2.5, y - 6 + bob, 5, 13);
    ctx.fillStyle = '#9aa0a6';
    circle(ctx, x, y - 8 + bob, 4.6);
    // 방패벽을 켜면 방패가 커지고 테두리가 두꺼워진다
    const wall = u.shieldWall;
    const shieldW = wall ? 12 : 9;
    const shieldH = wall ? 18 : 14;
    const shieldX = f > 0 ? x + 3 : x - 3 - shieldW;
    const shieldY = y - (wall ? 9 : 6) + bob;
    ctx.fillStyle = color;
    ctx.fillRect(shieldX, shieldY, shieldW, shieldH);
    ctx.strokeStyle = '#e2b53e';
    ctx.lineWidth = wall ? 2.5 : 1.5;
    ctx.strokeRect(shieldX + 0.75, shieldY + 0.75, shieldW - 1.5, shieldH - 1.5);
  },

  battlemage(ctx, u, color, t) {
    const { x, y, bob, f } = frameOf(u, t);
    const pulse = 0.5 + 0.5 * Math.sin(t / 250 + u.id);
    footShadow(ctx, x, y, 7.5);
    stroke(ctx, x + 7 * f, y + 8 + bob, x + 7 * f, y - 16 + bob, '#5a3d2a', 2);
    ctx.fillStyle = `rgba(150, 195, 255, ${0.6 + pulse * 0.4})`;
    circle(ctx, x + 7 * f, y - 18 + bob, 3 + pulse);
    ctx.fillStyle = color;
    polygon(ctx, [[x - 7, y + 8 + bob], [x, y - 6 + bob], [x + 7, y + 8 + bob]]);
    ctx.fillStyle = SKIN;
    circle(ctx, x, y - 7 + bob, 4);
    ctx.fillStyle = '#3f4796';
    polygon(ctx, [[x - 6, y - 8 + bob], [x + f, y - 20 + bob], [x + 6, y - 8 + bob]]);
  },

  // ---------- 맹세의 궁극 유닛 ----------

  solarion(ctx, u, color, t) {
    const { x, y, bob, f } = frameOf(u, t, 70);
    const glow = 0.55 + 0.45 * Math.sin(t / 320);
    footShadow(ctx, x, y + 2, 15);

    // 새벽의 오라
    ctx.strokeStyle = `rgba(246, 206, 110, ${0.25 + glow * 0.25})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y + 8, 26, 13, 0, 0, TAU);
    ctx.stroke();

    // 군마
    ctx.fillStyle = '#e8e2d4';
    ellipse(ctx, x, y - 6 + bob, 15, 9);
    ctx.fillStyle = '#d8d0bd';
    polygon(ctx, [[x + 13 * f, y - 10 + bob], [x + 21 * f, y - 16 + bob], [x + 19 * f, y - 4 + bob]]);
    ctx.fillStyle = '#3a342d';
    ctx.fillRect(x - 12, y + 1 + bob, 3, 9);
    ctx.fillRect(x + 8, y + 1 + bob, 3, 9);

    // 기사왕
    ctx.fillStyle = color;
    polygon(ctx, [[x - 9, y - 12 + bob], [x, y - 30 + bob], [x + 9, y - 12 + bob]]);
    ctx.fillStyle = '#f6ce6e';
    circle(ctx, x, y - 30 + bob, 5.5);
    polygon(ctx, [[x - 6, y - 34 + bob], [x - 4, y - 41 + bob], [x, y - 36 + bob], [x + 4, y - 41 + bob], [x + 6, y - 34 + bob]]); // 왕관
    stroke(ctx, x + 6 * f, y - 26 + bob, x + 24 * f, y - 34 + bob, '#f2efe6', 3); // 창
    ctx.fillStyle = `rgba(255, 236, 170, ${glow})`;
    circle(ctx, x + 25 * f, y - 35 + bob, 4);
  },

  etheria(ctx, u, color, t) {
    const { x, y, f } = frameOf(u, t);
    const float = Math.sin(t / 420 + u.id) * 3;
    const spin = t / 700;
    footShadow(ctx, x, y + 4, 9);

    // 주변을 도는 별
    for (let i = 0; i < 3; i++) {
      const a = spin + (i / 3) * TAU;
      ctx.fillStyle = `rgba(190, 205, 255, ${0.5 + 0.4 * Math.sin(spin * 2 + i)})`;
      circle(ctx, x + Math.cos(a) * 17, y - 18 + float + Math.sin(a) * 7, 2.6);
    }

    ctx.fillStyle = '#2b2f5c'; // 로브
    polygon(ctx, [[x - 11, y + 8 + float], [x - 5, y - 16 + float], [x + 5, y - 16 + float], [x + 11, y + 8 + float]]);
    ctx.fillStyle = color;
    polygon(ctx, [[x - 7, y + 6 + float], [x - 3, y - 12 + float], [x + 3, y - 12 + float], [x + 7, y + 6 + float]]);
    ctx.fillStyle = SKIN;
    circle(ctx, x, y - 19 + float, 4.2);
    ctx.fillStyle = '#8ea2ff'; // 별관
    polygon(ctx, [[x - 7, y - 21 + float], [x, y - 33 + float], [x + 7, y - 21 + float]]);
    stroke(ctx, x + 9 * f, y + 6 + float, x + 9 * f, y - 26 + float, '#6d5b3f', 2); // 지팡이
    const pulse = 0.55 + 0.45 * Math.sin(t / 240);
    ctx.fillStyle = `rgba(160, 190, 255, ${pulse})`;
    circle(ctx, x + 9 * f, y - 30 + float, 4.5 + pulse * 1.5);
  },

  arkanon(ctx, u, color, t) {
    const { x, y, bob } = frameOf(u, t, 160);
    const rooted = u.rooted;
    footShadow(ctx, x, y + 6, 26);

    if (rooted) {
      ctx.fillStyle = 'rgba(86, 116, 78, 0.75)'; // 뿌리
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        polygon(ctx, [
          [x + Math.cos(a) * 12, y + 8],
          [x + Math.cos(a) * 30, y + 12 + Math.sin(a) * 6],
          [x + Math.cos(a) * 14, y + 14],
        ]);
      }
    }

    ctx.fillStyle = '#4b6b52'; // 다리
    ellipse(ctx, x - 17, y + 6 + bob, 6, 4);
    ellipse(ctx, x + 17, y + 6 + bob, 6, 4);
    ctx.fillStyle = '#5d7f61'; // 머리
    ellipse(ctx, x + 22, y - 6 + bob, 8, 6);
    ctx.fillStyle = '#1d2a22';
    circle(ctx, x + 25, y - 8 + bob, 1.6);

    ctx.fillStyle = '#6b6152'; // 등껍질
    ellipse(ctx, x, y - 8 + bob, 24, 16);
    ctx.fillStyle = '#4a4436';
    for (let i = -1; i <= 1; i++) circle(ctx, x + i * 11, y - 10 + bob, 5);

    // 등 위의 성채
    ctx.fillStyle = '#8d8370';
    ctx.fillRect(x - 13, y - 34 + bob, 26, 16);
    ctx.fillStyle = color;
    ctx.fillRect(x - 13, y - 38 + bob, 26, 5);
    ctx.fillStyle = '#6f6656';
    for (let i = 0; i < 4; i++) ctx.fillRect(x - 13 + i * 7, y - 42 + bob, 4, 5);
    flag(ctx, x + 14, y - 52 + bob, color);
  },
};

export function drawUnit(ctx, u, color, t) {
  if (u.carried) return; // 등에 탄 유닛은 태운 쪽 위에 겹쳐 그리지 않는다
  if (u.buffed) drawAuraMark(ctx, u);
  (UNIT_ART[u.type] ?? SHIP_ART[u.type] ?? AIR_ART[u.type] ?? drawPeasant)(ctx, u, color, t);
  drawUnitStatus(ctx, u, t);
}

/** 새벽의 오라를 받는 아군 발밑 표시 */
function drawAuraMark(ctx, u) {
  const x = u.drawX * S;
  const y = u.drawY * S;
  ctx.strokeStyle = 'rgba(246, 206, 110, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(x, y + 8, 12, 6, 0, 0, TAU);
  ctx.stroke();
}

/** 기절·둔화·영창·탑승 같은 상태 표시 (공중 유닛은 뜬 높이에 맞춰 그린다) */
function drawUnitStatus(ctx, u, t) {
  const x = u.drawX * S;
  const y = u.drawY * S - altitudeOf(u.type);

  if (u.slowed) {
    ctx.fillStyle = 'rgba(140, 170, 255, 0.28)';
    circle(ctx, x, y - 4, 14);
  }
  if (u.stunned) {
    for (let i = 0; i < 3; i++) {
      const a = t / 220 + (i / 3) * TAU;
      ctx.fillStyle = 'rgba(255, 232, 150, 0.95)';
      circle(ctx, x + Math.cos(a) * 11, y - 34 + Math.sin(a) * 4, 2.4);
    }
  }
  if (u.channeling) {
    const total = 50; // 성좌 붕괴 2.5초 = 50틱
    const left = Math.max(0, Math.min(1, u.extra / total));
    ctx.fillStyle = 'rgba(10, 12, 16, 0.7)';
    ctx.fillRect(x - 16, y - 46, 32, 5);
    ctx.fillStyle = '#8ea2ff';
    ctx.fillRect(x - 16, y - 46, 32 * (1 - left), 5);
  }
  if (u.extra > 0 && !u.channeling) {
    ctx.font = '600 11px "IBM Plex Sans KR", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(10, 12, 16, 0.72)';
    ctx.fillRect(x + 14, y - 48, 20, 14);
    ctx.fillStyle = '#f2eee4';
    ctx.fillText(`${u.extra}`, x + 24, y - 37);
  }
}

/** 집결지 깃발과 건물에서 이어지는 점선 */
export function drawRally(ctx, building, rally, color) {
  const bx = (building.x + building.size / 2) * S;
  const by = (building.y + building.size / 2) * S;
  const rx = rally.x * S;
  const ry = rally.y * S;
  ctx.strokeStyle = 'rgba(240, 235, 220, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(rx, ry);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ellipse(ctx, rx, ry + 1, 5, 2);
  flag(ctx, rx, ry - 22, color);
}

/**
 * 전투 효과 하나를 그린다. 끝났으면 false를 돌려준다.
 * effect 좌표는 타일 단위 (ClientWorld.addCombatEffect)
 */
export function drawEffect(ctx, effect, now) {
  const t = (now - effect.start) / effect.duration;

  if (effect.kind === 'arrow') {
    if (t >= 1) return false;
    const x = (effect.from.x + (effect.to.x - effect.from.x) * t) * S;
    const y = (effect.from.y + (effect.to.y - effect.from.y) * t) * S - Math.sin(Math.PI * t) * 14;
    const angle = Math.atan2(effect.to.y - effect.from.y, effect.to.x - effect.from.x);
    stroke(ctx, x - Math.cos(angle) * 6, y - Math.sin(angle) * 6, x + Math.cos(angle) * 5, y + Math.sin(angle) * 5, '#efe3c6', 1.5);
    return true;
  }

  if (effect.kind === 'stone') {
    // 투석: 높이 포물선을 그리며 날아가 떨어진 자리에 흙먼지
    if (t < 1) {
      const x = (effect.from.x + (effect.to.x - effect.from.x) * t) * S;
      const y = (effect.from.y + (effect.to.y - effect.from.y) * t) * S - Math.sin(Math.PI * t) * 42;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ellipse(ctx, (effect.from.x + (effect.to.x - effect.from.x) * t) * S, (effect.from.y + (effect.to.y - effect.from.y) * t) * S + 4, 4, 2);
      ctx.fillStyle = '#77716a';
      circle(ctx, x, y, 4.5);
      return true;
    }
    if (t >= 1.5) return false;
    const k = (t - 1) / 0.5;
    ctx.fillStyle = `rgba(150, 128, 96, ${0.55 * (1 - k)})`;
    circle(ctx, effect.to.x * S, effect.to.y * S, 6 + Math.max(0.5, effect.splash) * S * k);
    return true;
  }

  if (effect.kind === 'bolt') {
    if (t < 1) {
      const x = (effect.from.x + (effect.to.x - effect.from.x) * t) * S;
      const y = (effect.from.y + (effect.to.y - effect.from.y) * t) * S - 6;
      ctx.fillStyle = 'rgba(140, 190, 255, 0.35)';
      circle(ctx, x, y, 7);
      ctx.fillStyle = '#cfe2ff';
      circle(ctx, x, y, 3.5);
      return true;
    }
    if (t >= 1.5) return false;
    const k = (t - 1) / 0.5; // 착탄 후 범위 피해 고리
    ctx.strokeStyle = `rgba(150, 195, 255, ${1 - k})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(effect.to.x * S, effect.to.y * S, 4 + Math.max(0.5, effect.splash) * S * k, 0, TAU);
    ctx.stroke();
    return true;
  }

  if (t >= 1) return false;
  const x = effect.x * S;
  const y = effect.y * S;

  if (effect.kind === 'slash') {
    ctx.strokeStyle = `rgba(255, 250, 235, ${1 - t})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y - 4, 9 + t * 3, -2.4, -0.6);
    ctx.stroke();
    return true;
  }

  if (effect.kind === 'charge') {
    if (t >= 1) return false;
    const fade = 1 - t;
    ctx.strokeStyle = `rgba(255, 224, 150, ${0.75 * fade})`;
    ctx.lineWidth = 10 * fade + 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(effect.from.x * S, effect.from.y * S);
    ctx.lineTo(effect.to.x * S, effect.to.y * S);
    ctx.stroke();
    ctx.lineCap = 'butt';
    return true;
  }

  if (effect.kind === 'starfallCast') {
    if (t >= 1) return false;
    const r = effect.radius * S;
    ctx.strokeStyle = `rgba(150, 175, 255, ${0.5 + 0.4 * Math.sin(now / 90)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = `rgba(120, 150, 255, ${0.08 + 0.12 * t})`;
    circle(ctx, x, y, r * t);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + now / 800;
      const d = r * (1 - t);
      ctx.fillStyle = 'rgba(210, 225, 255, 0.9)';
      circle(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d - 40 * (1 - t), 2.5);
    }
    return true;
  }

  if (effect.kind === 'starfallHit') {
    if (t >= 1) return false;
    const r = effect.radius * S;
    ctx.fillStyle = `rgba(190, 210, 255, ${0.55 * (1 - t)})`;
    circle(ctx, x, y, r * (0.6 + t * 0.4));
    ctx.strokeStyle = `rgba(255, 255, 255, ${1 - t})`;
    ctx.lineWidth = 3 * (1 - t) + 1;
    ctx.beginPath();
    ctx.arc(x, y, r * (0.7 + t * 0.5), 0, TAU);
    ctx.stroke();
    return true;
  }

  if (effect.kind === 'ward') {
    if (t >= 1) return false;
    const r = effect.radius * S;
    ctx.strokeStyle = `rgba(150, 190, 255, ${0.45 * (1 - t) + 0.2})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = `rgba(120, 160, 255, ${0.12 * (1 - t)})`;
    circle(ctx, x, y, r);
    return true;
  }

  if (effect.kind === 'rootBurst') {
    if (t >= 1) return false;
    ctx.strokeStyle = `rgba(126, 192, 138, ${1 - t})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y + 8, 20 + t * 26, 0, TAU);
    ctx.stroke();
    return true;
  }

  if (effect.kind === 'death') {
    ctx.fillStyle = `rgba(70, 62, 56, ${0.55 * (1 - t)})`;
    circle(ctx, x - 3, y, 6 + t * 9);
    circle(ctx, x + 4, y - 3, 4 + t * 7);
    return true;
  }

  if (effect.kind === 'rubble') {
    const half = (effect.size * S) / 2;
    ctx.fillStyle = `rgba(52, 46, 40, ${0.75 * (1 - t)})`;
    ctx.fillRect(x - half + 4, y - half + 4, half * 2 - 8, half * 2 - 8);
    ctx.fillStyle = `rgba(150, 140, 125, ${0.45 * (1 - t)})`;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      circle(ctx, x + Math.cos(a) * half * 0.6 * (0.5 + t), y + Math.sin(a) * half * 0.5 * (0.5 + t) - t * 14, 8 + t * 14);
    }
    return true;
  }

  return false;
}

const RING_COLORS = {
  mine: 'rgba(120, 230, 140, 0.95)',
  ally: 'rgba(240, 205, 100, 0.95)', // 팀원
  enemy: 'rgba(240, 120, 110, 0.95)',
};

/** relation: 'mine' | 'ally' | 'enemy' */
export function drawSelectionRing(ctx, x, y, rx, relation) {
  ctx.strokeStyle = RING_COLORS[relation] ?? RING_COLORS.enemy;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, rx * 0.5, 0, 0, TAU);
  ctx.stroke();
}

export function drawHealthBar(ctx, cx, y, width, ratio) {
  const w = Math.round(width);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.fillRect(cx - w / 2 - 1, y - 1, w + 2, 5);
  ctx.fillStyle = ratio > 0.6 ? '#62c27f' : ratio > 0.3 ? '#e2b53e' : '#e0574c';
  ctx.fillRect(cx - w / 2, y, w * Math.max(0, Math.min(1, ratio)), 3);
}

export function drawLabel(ctx, text, x, y, color) {
  ctx.font = '600 13px "IBM Plex Sans KR", "Malgun Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const width = ctx.measureText(text).width + 14;
  ctx.fillStyle = 'rgba(10, 12, 16, 0.78)';
  ctx.fillRect(x - width / 2, y - 20, width, 20);
  ctx.fillStyle = color;
  ctx.fillRect(x - width / 2, y - 20, 3, 20);
  ctx.fillStyle = '#f2eee4';
  ctx.fillText(text, x + 1, y - 3);
}
