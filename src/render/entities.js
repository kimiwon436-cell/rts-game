import { TILE_SIZE } from '@rune/shared/constants.js';
import { UNITS } from '@rune/shared/data/units.js';
import { AIR_ALTITUDE, drawUnitArt } from './art/unitArt.js';
import { buildingLabelY, drawBuildingArt, drawMineArt } from './art/buildingArt.js';
import { wavingFlag } from './art/flag.js';

// 월드 위에 그리는 것들: 유닛·건물·금광(그림은 art/), 상태 표시, 전투 효과, 선택 고리·체력 막대·이름표.

const S = TILE_SIZE;
const TAU = Math.PI * 2;

export { AIR_ALTITUDE, buildingLabelY };
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

function stroke(ctx, x1, y1, x2, y2, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export function drawGoldMine(ctx, mine, amount, initialAmount, t = performance.now()) {
  drawMineArt(ctx, mine, amount, initialAmount, t);
}

/**
 * @param {object} b 건물 (ClientWorld)
 * @param {string} color 소유자 색
 * @param {number} t 시간(ms)
 * @param {number} age 소유자의 시대 (영주관 외형)
 */
export function drawBuilding(ctx, b, color, t, age) {
  drawBuildingArt(ctx, b, color, t, age);
}

// ---------- 유닛 ----------

export function drawUnit(ctx, u, color, t) {
  if (u.carried) return; // 등에 탄 유닛은 태운 쪽 위에 겹쳐 그리지 않는다
  if (u.buffed) drawAuraMark(ctx, u);
  drawUnitArt(ctx, u, color, t);
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
  wavingFlag(ctx, rx, ry + 1, 22, color, performance.now(), { seed: building.id });
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

  if (effect.kind === 'storm') {
    // 폭풍 비룡: 번개 구슬이 떨어져 터지며 사방으로 번개가 튄다
    if (t < 1) {
      const x = (effect.from.x + (effect.to.x - effect.from.x) * t) * S;
      const y = (effect.from.y + (effect.to.y - effect.from.y) * t) * S - Math.sin(Math.PI * t) * 18;
      ctx.fillStyle = 'rgba(130, 180, 255, 0.35)';
      circle(ctx, x, y, 8);
      ctx.fillStyle = '#e4efff';
      circle(ctx, x, y, 3.8);
      ctx.strokeStyle = 'rgba(190, 220, 255, 0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = now / 60 + i * 2.1;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6);
        ctx.lineTo(x + Math.cos(a + 0.5) * 9, y + Math.sin(a + 0.5) * 9);
      }
      ctx.stroke();
      return true;
    }
    if (t >= 1.5) return false;
    const k = (t - 1) / 0.5;
    const cx = effect.to.x * S;
    const cy = effect.to.y * S;
    const r = 6 + Math.max(0.5, effect.splash) * S * k;
    ctx.fillStyle = `rgba(150, 200, 255, ${0.35 * (1 - k)})`;
    circle(ctx, cx, cy, r);
    ctx.strokeStyle = `rgba(220, 235, 255, ${1 - k})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + effect.start;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55 + 2);
      ctx.lineTo(cx + Math.cos(a + 0.3) * r, cy + Math.sin(a + 0.3) * r);
    }
    ctx.stroke();
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

  if (effect.kind === 'dismantle') {
    const half = (effect.size * S) / 2;
    ctx.fillStyle = `rgba(196, 176, 140, ${0.5 * (1 - t)})`;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.4;
      circle(ctx, x + Math.cos(a) * half * (0.3 + t * 0.7), y + Math.sin(a) * half * 0.45 * (0.3 + t * 0.7) - t * 10, 7 + t * 12);
    }
    // 돌려받은 금화가 위로 튄다
    for (let i = 0; i < 5; i++) {
      const k = Math.min(1, t * 1.4 + i * 0.04);
      const px = x + (i - 2) * half * 0.22;
      const py = y - half * 0.2 - Math.sin(Math.PI * k) * 26 - i * 2;
      ctx.fillStyle = `rgba(242, 196, 70, ${1 - t})`;
      circle(ctx, px, py, 2.6);
      ctx.fillStyle = `rgba(255, 244, 200, ${1 - t})`;
      circle(ctx, px - 0.8, py - 0.8, 0.9);
    }
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
