import { TILE_SIZE } from '@rune/shared/constants.js';
import { UNIT_STATE } from '@rune/shared/protocol.js';

// 건물·유닛·금광의 임시 그림. 스프라이트가 생기면 이 파일만 바꾸면 된다.

const S = TILE_SIZE;
const TAU = Math.PI * 2;

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

export function drawUnit(ctx, u, color, t) {
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

export function drawSelectionRing(ctx, x, y, rx, mine) {
  ctx.strokeStyle = mine ? 'rgba(120, 230, 140, 0.95)' : 'rgba(240, 120, 110, 0.95)';
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
