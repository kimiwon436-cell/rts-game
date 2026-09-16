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
};

export function drawUnit(ctx, u, color, t) {
  (UNIT_ART[u.type] ?? drawPeasant)(ctx, u, color, t);
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
