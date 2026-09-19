// 유닛 그림. 종류마다 스프라이트 상자와 그리는 함수를 둔다 (sprites.js가 한 번 그려 담아 둔다).
// - 모든 그림은 오른쪽을 본다. 왼쪽을 볼 때는 뒤집는다.
// - 기준점 (0,0): 땅 유닛은 발 사이 가운데, 배는 물 위 가운데, 공중 유닛은 몸 가운데
// - 동작: idle(서 있음) · walk 0–3(걷기) · ready(싸울 자세) · strike 0–2(친 순간부터) · work 0–2(농노 일)
import { TILE_SIZE } from '@rune/shared/constants.js';
import { UNITS } from '@rune/shared/data/units.js';
import { UNIT_STATE } from '@rune/shared/protocol.js';
import {
  DARK_WOOD,
  GOLD,
  HAIR,
  INK,
  IRON,
  LEATHER,
  LINEN,
  SKIN,
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
  rim,
  round,
  tones,
  vertical,
  within,
} from './paint.js';
import { blit, cachedSprite, glow, shadow, sprite } from './sprites.js';
import { wavingFlag } from './flag.js';

const S = TILE_SIZE;
/** 공중 유닛은 제 자리보다 이만큼 위에 그린다 (선택 고리·체력 막대·투사체도 같이 올린다) */
export const AIR_ALTITUDE = 22;
const FOOT = 8; // 땅 유닛의 발은 유닛 자리보다 이만큼 아래 (선택 고리·체력 막대와 맞춘다)

const STRIKE_MS = 360; // 친 순간부터 거두기까지
const STEP = [0.95, 0, -0.95, 0]; // 걷기 프레임별 보폭
const BOB = [0, -0.8, 0, -0.8]; // 걷기 프레임별 몸 들썩임

const STRAW = tones('#d4b064');
const HOOD_GREEN = tones('#4b7a3e');
const MAGE_HAT = tones('#3f4796');
const BEARD = tones('#e9e4da');
const HORSE_BROWN = tones('#8c6443');
const HORSE_GREY = tones('#d2ccbf');
const HORSE_WHITE = tones('#ebe6da');
const MANE_DARK = tones('#3d2a1c');
const MANE_LIGHT = tones('#cfc6b4');
const HOOF = '#2b231d';

// ---------- 팀 색 ----------

const palettes = new Map();
function palette(color) {
  let p = palettes.get(color);
  if (!p) {
    p = {
      color,
      team: tones(color),
      deep: tones(darken(color, 0.24)),
      pale: tones(lighten(color, 0.3)),
      muted: tones(mix(color, '#86705a', 0.3)),
    };
    palettes.set(color, p);
  }
  return p;
}

/** 조금 어두운 판 (몸 뒤쪽의 팔·다리) */
const dim = (t, k = 0.2) => tones(darken(t.base, k));

// ---------- 사람 ----------

/** 사람 뼈대. 발 사이 가운데가 (ox, oy) */
function rig({ step = 0, bob = 0, lean = 0, ox = 0, oy = 0 } = {}) {
  return {
    step,
    bob,
    lean,
    ox,
    oy,
    hip: oy - 6.6 + bob,
    shoulder: oy - 15.8 + bob,
    hx: ox + 0.8 + lean,
    hy: oy - 20.6 + bob,
    sb: [ox - 2.5 + lean * 0.6, oy - 14.9 + bob],
    sf: [ox + 2.6 + lean * 0.6, oy - 14.7 + bob],
    ff: [ox + 1.8 + 2.4 * step, oy + (step > 0.3 ? -0.9 : 0)],
    fb: [ox - 1.6 - 2.4 * step, oy + (step < -0.3 ? -0.9 : 0)],
  };
}

function boot(g, [x, y], t) {
  rect(g, x - 1.5, y - 2.9, 3.8, 2.9, lit(t), 1.1);
}

function legs(g, r, trousers, boots) {
  limb(g, r.ox - 1.3, r.hip, r.fb[0] - 0.1, r.fb[1] - 2.1, 2.7, dim(trousers));
  boot(g, r.fb, dim(boots));
  limb(g, r.ox + 1.4, r.hip, r.ff[0], r.ff[1] - 2.1, 2.7, trousers);
  boot(g, r.ff, boots);
}

/** 몸통 (옷·갑옷): 어깨가 둥글고 아래로 조금 퍼진다. length: 허리 아래로 내려오는 길이 */
function torsoPath(g, r, { width = 9.6, length = 2.8, flare = 0.9 } = {}) {
  const top = r.shoulder - 1.4;
  const bottom = r.hip + length;
  const cx = r.ox + r.lean * 0.5;
  const x0 = cx - width / 2;
  const x1 = cx + width / 2;
  g.beginPath();
  g.moveTo(x0 + 0.3, top + 3.2);
  g.bezierCurveTo(x0 + 0.1, top + 0.3, x0 + 2.2, top - 0.3, cx, top - 0.3);
  g.bezierCurveTo(x1 - 2.2, top - 0.3, x1 - 0.1, top + 0.3, x1 - 0.3, top + 3.2);
  g.lineTo(x1 + flare, bottom);
  g.quadraticCurveTo(cx, bottom + 1.2, x0 - flare, bottom);
  g.closePath();
  return { x: x0 - flare, y: top, w: width + flare * 2, h: bottom - top };
}

function torso(g, r, paint, options) {
  const b = torsoPath(g, r, options);
  fillPath(g, paint, b.x, b.y, b.w, b.h);
  return b;
}

/** 몸통 안에만 그린다 (무늬·주름) */
function onTorso(g, r, options, draw) {
  within(g, () => torsoPath(g, r, options), draw);
}

function belt(g, r, t = LEATHER, buckle = GOLD) {
  const cx = r.ox + r.lean * 0.5;
  rect(g, cx - 5.1, r.hip - 1.8, 10.2, 1.8, lit(t), 0.5);
  rect(g, cx + 1.2, r.hip - 2, 1.9, 2.2, metal(buckle), 0.3);
}

function head(g, r, skin = SKIN) {
  circle(g, r.hx, r.hy, 4.3, round(skin));
  circle(g, r.hx + 2.4, r.hy - 0.2, 0.62, INK);
  circle(g, r.hx + 2.3, r.hy + 1.7, 0.9, 'rgba(208, 108, 88, 0.3)');
}

/** 머리카락: 머리의 뒤쪽 위를 덮는다 */
function hair(g, r, t = HAIR) {
  within(
    g,
    () => ellipsePath(g, r.hx, r.hy, 4.35, 4.35),
    () => ellipse(g, r.hx - 1.9, r.hy - 2.1, 4.3, 3.9, lit(t)),
  );
}

function arm(g, from, hand, sleeve, glove = SKIN, width = 2.5) {
  limb(g, from[0], from[1], hand[0], hand[1], width, sleeve);
  circle(g, hand[0], hand[1], 1.35, round(glove));
}

// ---------- 무기·도구 ----------

function spear(g, x1, y1, x2, y2, { shaft = WOOD, width = 1.5, blade = 4.8, tip = STEEL, tassel = null } = {}) {
  limb(g, x1, y1, x2, y2, width, shaft);
  const a = Math.atan2(y2 - y1, x2 - x1);
  g.save();
  g.translate(x2, y2);
  g.rotate(a);
  if (tassel) ellipse(g, -0.9, 1, 1.2, 1.7, round(tassel));
  poly(g, [[-0.8, -1.2], [blade * 0.45, -1.7], [blade, 0], [blade * 0.45, 1.7], [-0.8, 1.2]], metal(tip));
  line(g, -0.2, -0.3, blade * 0.8, -0.1, 'rgba(255, 255, 255, 0.55)', 0.4);
  g.restore();
}

/** 곧은 칼. angle: 칼끝 방향 */
function sword(g, hx, hy, angle, { length = 9.5, blade = STEEL, guard = GOLD } = {}) {
  g.save();
  g.translate(hx, hy);
  g.rotate(angle);
  rect(g, -2.4, -0.75, 2.6, 1.5, lit(LEATHER), 0.4);
  circle(g, -2.6, 0, 0.95, round(guard));
  rect(g, -0.2, -2.3, 1.2, 4.6, metal(guard), 0.3);
  poly(g, [[1, -0.95], [length, -0.55], [length + 1.8, 0], [length, 0.55], [1, 0.95]], metal(blade));
  line(g, 1.3, -0.25, length + 0.8, -0.1, 'rgba(255, 255, 255, 0.6)', 0.35);
  g.restore();
}

/** 휜 칼 (척후 기병) */
function saber(g, hx, hy, angle) {
  g.save();
  g.translate(hx, hy);
  g.rotate(angle);
  rect(g, -2.2, -0.7, 2.4, 1.4, lit(LEATHER), 0.4);
  curve(g, -0.2, -1.6, 1.2, 0, -0.2, 1.6, GOLD.base, 0.8);
  g.beginPath();
  g.moveTo(0.6, -0.8);
  g.quadraticCurveTo(6, -1.4, 11, -3.6);
  g.lineTo(10.6, -2.3);
  g.quadraticCurveTo(6, 0.4, 0.6, 0.8);
  g.closePath();
  fillPath(g, metal(STEEL), 0.6, -3.6, 10.4, 4.4);
  g.restore();
}

/** 연 모양 방패 */
function kiteShield(g, x, y, w, h, team, { trim = GOLD, emblem = 'crown' } = {}) {
  const path = () => {
    g.beginPath();
    g.moveTo(x - w / 2, y - h * 0.4);
    g.quadraticCurveTo(x, y - h * 0.56, x + w / 2, y - h * 0.4);
    g.bezierCurveTo(x + w / 2, y + h * 0.06, x + w * 0.22, y + h * 0.32, x, y + h / 2);
    g.bezierCurveTo(x - w * 0.22, y + h * 0.32, x - w / 2, y + h * 0.06, x - w / 2, y - h * 0.4);
    g.closePath();
  };
  path();
  fillPath(g, round(team), x - w / 2, y - h / 2, w, h);
  path();
  g.strokeStyle = trim.base;
  g.lineWidth = 0.9;
  g.stroke();
  if (emblem === 'crown') {
    const s = w / 8;
    poly(
      g,
      [
        [x - 2.3 * s, y + 0.9 * s],
        [x - 2.3 * s, y - 1.3 * s],
        [x - 1.1 * s, y - 0.2 * s],
        [x, y - 1.9 * s],
        [x + 1.1 * s, y - 0.2 * s],
        [x + 2.3 * s, y - 1.3 * s],
        [x + 2.3 * s, y + 0.9 * s],
      ],
      metal(trim),
    );
  } else if (emblem === 'cross') {
    line(g, x, y - h * 0.3, x, y + h * 0.3, trim.light, w * 0.13);
    line(g, x - w * 0.3, y - h * 0.08, x + w * 0.3, y - h * 0.08, trim.light, w * 0.13);
  }
  rim(g, x, y, w * 0.4, h * 0.4, 'rgba(255, 255, 255, 0.35)', 0.7);
}

/** 활. (gx, gy)가 손잡이. 활대는 앞(+x)으로 휜다. pull: 시위를 당긴 자리 */
function longbow(g, gx, gy, { half = 12.5, bend = 3.4, pull = null } = {}) {
  const tx = gx - bend;
  curve(g, tx, gy - half, gx + bend, gy, tx, gy + half, DARK_WOOD.darker, 2.1);
  curve(g, tx, gy - half, gx + bend - 0.3, gy, tx, gy + half, WOOD.base, 1.3);
  curve(g, tx - 0.3, gy - half + 0.8, gx + bend - 1, gy, tx - 0.3, gy + half - 0.8, WOOD.lighter, 0.35);
  const [sx, sy] = pull ?? [tx, gy];
  line(g, tx, gy - half, sx, sy, 'rgba(242, 234, 214, 0.95)', 0.45, 'butt');
  line(g, sx, sy, tx, gy + half, 'rgba(242, 234, 214, 0.95)', 0.45, 'butt');
  rect(g, gx - 0.4, gy - 1.3, 1.6, 2.6, lit(LEATHER), 0.4);
}

function arrow(g, x1, y1, x2, y2) {
  line(g, x1, y1, x2, y2, WOOD.light, 0.75);
  const a = Math.atan2(y2 - y1, x2 - x1);
  g.save();
  g.translate(x2, y2);
  g.rotate(a);
  poly(g, [[0, -0.9], [2.2, 0], [0, 0.9]], metal(STEEL));
  g.restore();
  g.save();
  g.translate(x1, y1);
  g.rotate(a);
  poly(g, [[-0.6, 0], [1.8, -1.1], [2.6, 0], [1.8, 1.1]], '#efe8d6');
  g.restore();
}

function quiver(g, x, y) {
  g.save();
  g.translate(x, y);
  g.rotate(-0.38);
  for (const [dx, c] of [[-1.2, '#efe8d6'], [0.5, '#c9453b'], [2, '#efe8d6']]) {
    line(g, dx, -6.4, dx, -3, WOOD.light, 0.6);
    poly(g, [[dx - 0.9, -8], [dx + 0.9, -8], [dx + 0.6, -5.8], [dx - 0.6, -5.8]], c);
  }
  rect(g, -2.3, -4, 4.9, 9.2, lit(LEATHER), 1.3);
  line(g, -2.3, -2.5, 2.6, -2.5, LEATHER.darker, 0.5);
  g.restore();
}

/**
 * 농노 도구. (hx, hy)가 손, angle이 자루 방향(손에서 머리 쪽).
 * 휘두르는 쪽이 +y (시계 방향으로 내려친다)
 */
function tool(g, kind, hx, hy, angle) {
  g.save();
  g.translate(hx, hy);
  g.rotate(angle);
  limb(g, -2.6, 0, 9.4, 0, 1.3, WOOD);
  if (kind === 'axe') {
    poly(g, [[7.4, -0.9], [9.4, -0.9], [10.6, 3.4], [7.7, 3.8], [7.4, 1]], metal(STEEL));
    rect(g, 7.5, -2.1, 1.8, 1.4, metal(IRON), 0.3);
  } else if (kind === 'hammer') {
    rect(g, 7.2, -2.4, 3.2, 4.8, metal(IRON), 0.6);
  } else {
    g.beginPath();
    g.moveTo(7.8, -3.9);
    g.quadraticCurveTo(10, 0.2, 7.6, 5);
    g.lineTo(8.8, 4.8);
    g.quadraticCurveTo(11.1, 0.2, 9.1, -3.6);
    g.closePath();
    fillPath(g, metal(IRON), 7.6, -3.9, 3.5, 8.9);
  }
  g.restore();
}

// ---------- 말 ----------

// 다리 각도 [윗다리, 아랫다리] (수직에서 앞으로 +, 라디안): 앞 가까운 · 앞 먼 · 뒤 가까운 · 뒤 먼
const HORSE_IDLE = [[0.06, 0], [-0.06, 0], [0.04, 0], [-0.08, 0]];
const GALLOP = [
  [[0.7, 0.25], [0.42, 0.12], [-0.62, -0.18], [-0.4, -0.1]],
  [[0.12, -0.75], [-0.18, -0.1], [0.22, 0.55], [0.38, 0.2]],
  [[-0.36, -0.08], [-0.5, -0.2], [0.55, 0.3], [0.4, 0.14]],
  [[0.38, -0.85], [0.12, -0.45], [-0.2, 0.02], [0.02, 0.1]],
];
const GALLOP_LIFT = [0, -1.1, 0, -0.6];

function horseLeg(g, x, y, [a1, a2], t) {
  const kx = x + Math.sin(a1) * 4.9;
  const ky = y + Math.cos(a1) * 4.9;
  const hx = kx + Math.sin(a2) * 4.6;
  const hy = ky + Math.cos(a2) * 4.6;
  limb(g, x, y, kx, ky, 3, t);
  limb(g, kx, ky, hx, hy, 2.1, t);
  rect(g, hx - 1.3, hy - 0.8, 2.8, 1.7, HOOF, 0.5);
}

function horseBodyPath(g, lift) {
  g.beginPath();
  g.moveTo(-13.2, -12.4 + lift);
  g.bezierCurveTo(-13.4, -16.4 + lift, -9, -17.6 + lift, -4, -16.8 + lift);
  g.bezierCurveTo(0, -16.2 + lift, 3, -16.9 + lift, 6, -17.4 + lift);
  g.bezierCurveTo(10.5, -17.4 + lift, 12.6, -14.2 + lift, 12, -11.4 + lift);
  g.bezierCurveTo(11.4, -8.4 + lift, 9, -7.8 + lift, 6.5, -8.2 + lift);
  g.bezierCurveTo(2, -7.2 + lift, -3, -7.2 + lift, -8.5, -8 + lift);
  g.bezierCurveTo(-11.6, -8.4 + lift, -13.2, -9.8 + lift, -13.2, -12.4 + lift);
  g.closePath();
}

/**
 * 말 (오른쪽을 본다, 발굽이 y≈0). frame: 걷기 0–3, null이면 서 있다.
 * look: { coat, mane, caparison(팀 색 덮개), trim, chanfron(쇠 투구) }
 * 돌려주는 값: 안장 자리의 들썩임 (탄 사람을 같이 올린다)
 */
function horse(g, frame, look) {
  const legsA = frame == null ? HORSE_IDLE : GALLOP[frame];
  const lift = frame == null ? 0 : GALLOP_LIFT[frame];
  const coat = look.coat;
  const far = dim(coat, 0.22);
  // 먼 쪽 다리
  horseLeg(g, 6.2, -10 + lift, legsA[1], far);
  horseLeg(g, -8.2, -10.4 + lift, legsA[3], far);
  // 꼬리
  curve(g, -12.4, -14.4 + lift, -17.6, -12, -16.4, -3.6 + lift, look.mane.dark, 3.2);
  curve(g, -12.6, -14.6 + lift, -17, -12.4, -15.8, -4.8 + lift, look.mane.base, 1.6);
  // 몸통
  horseBodyPath(g, lift);
  fillPath(g, lit(coat), -13.4, -17.6 + lift, 26, 10.4);
  within(
    g,
    () => horseBodyPath(g, lift),
    () => {
      ellipse(g, -1, -7.8 + lift, 12, 2.4, rgba(coat.darker, 0.35));
      ellipse(g, -2, -16.6 + lift, 10, 1.6, rgba(coat.lighter, 0.4));
    },
  );
  // 덮개 (기사·솔라리온)
  if (look.caparison) {
    const hem = -6.4 + lift;
    const cap = () => {
      g.beginPath();
      g.moveTo(-12.8, -14.6 + lift);
      g.bezierCurveTo(-9, -17.6 + lift, 2, -17.4 + lift, 7.2, -17.2 + lift);
      g.lineTo(11.2, -13 + lift);
      g.lineTo(11, hem);
      for (let x = 11; x > -12.5; x -= 3.4) g.quadraticCurveTo(x - 1.7, hem + 1.6, x - 3.4, hem);
      g.lineTo(-13.4, -10 + lift);
      g.closePath();
    };
    cap();
    fillPath(g, lit(look.caparison), -13.4, -17.6 + lift, 25, 12);
    within(g, cap, () => {
      rect(g, -14, hem - 1.6, 26, 1.6, metal(look.trim ?? GOLD));
      circle(g, -1.5, -12 + lift, 2.3, round(look.trim ?? GOLD));
      circle(g, -1.5, -12 + lift, 1.3, round(look.caparison));
    });
  }
  // 가까운 쪽 다리
  horseLeg(g, 7, -9.8 + lift, legsA[0], coat);
  horseLeg(g, -7.4, -10.2 + lift, legsA[2], coat);
  // 목과 머리
  poly(g, [[4.6, -16.6 + lift], [10.8, -26.4 + lift], [15, -23.4 + lift], [11.6, -11.6 + lift]], lit(coat));
  ellipse(g, 16, -22.8 + lift, 4.9, 2.5, lit(coat), 0.62);
  if (look.chanfron) ellipse(g, 16.2, -23.1 + lift, 3.9, 1.6, metal(look.chanfron), 0.62);
  circle(g, 15.1, -24 + lift, 0.55, INK);
  circle(g, 19.3, -20.4 + lift, 0.45, rgba(coat.darker, 0.9));
  poly(g, [[12.4, -26.4 + lift], [12.9, -29.2 + lift], [14.2, -26.2 + lift]], lit(coat));
  // 갈기
  poly(
    g,
    [[4.2, -17.4 + lift], [7.6, -22 + lift], [10.2, -26.8 + lift], [12.6, -27 + lift], [9.6, -21.4 + lift], [6.6, -16.8 + lift]],
    lit(look.mane),
  );
  // 고삐
  line(g, 18, -21.4 + lift, 8.4, -17.6 + lift, LEATHER.darker, 0.5);
  return lift;
}

/** 말 탄 사람 뼈대: 엉덩이가 안장에 닿는다 */
const riderRig = (lift, lean = 0) => rig({ ox: -0.6, oy: -10.6 + lift, lean });

/** 말 탄 사람의 보이는 다리 하나 */
function riderLeg(g, r, trousers, boots) {
  limb(g, r.ox + 0.4, r.hip + 0.4, r.ox + 3.4, r.hip + 4.4, 2.8, trousers);
  limb(g, r.ox + 3.4, r.hip + 4.4, r.ox + 2.9, r.hip + 8.6, 2.5, trousers);
  boot(g, [r.ox + 3.1, r.hip + 10.4], boots);
  line(g, r.ox + 1.6, r.hip + 10.6, r.ox + 5, r.hip + 10.6, IRON.base, 0.7);
}

// ---------- 동작 ----------

/** 보폭·들썩임 */
const walkOf = (pose) => (pose.kind === 'walk' ? { step: STEP[pose.frame], bob: BOB[pose.frame] } : { step: 0, bob: 0 });

// ---------- 유닛별 그림 ----------

/** 농노: 밀짚모자, 팀 색이 도는 흙빛 옷. 일할 때 도끼(나무)·곡괭이(금)·망치(건설) */
function drawPeasant(g, pose, p, v) {
  const { step, bob } = walkOf(pose);
  const r = rig({ step, bob, lean: pose.kind === 'work' || pose.kind === 'strike' ? 0.6 : 0 });
  const tunic = p.muted;
  const trousers = tones('#6b5237');
  const boots = tones('#4a3526');
  // 일·공격: 도구를 머리 위에서 앞 아래로 내려친다
  const swing = pose.kind === 'work' || pose.kind === 'strike';
  const swingFrame = pose.kind === 'strike' ? [1, 2, 2][pose.frame] : pose.frame;
  const SWING = [
    { hand: [-0.8, -23.6], angle: -2.3 },
    { hand: [5.4, -19.8], angle: -0.55 },
    { hand: [7.4, -11.2], angle: 0.55 },
  ];
  const toolKind = pose.kind === 'strike' ? 'pick' : v.tool;

  if (v.carry === 'gold') {
    ellipse(g, r.ox - 4.8, r.hip - 5.4, 3.4, 4, round(tones('#9c8058')));
    for (const [dx, dy] of [[-5.6, -8.6], [-4, -9.2], [-4.9, -7.7]]) circle(g, r.ox + dx, r.hip + dy, 1.1, round(GOLD));
    line(g, r.ox - 6.6, r.hip - 8, r.ox - 3.2, r.hip - 8, LEATHER.darker, 0.6);
  }
  const backHand = swing ? [SWING[swingFrame].hand[0] - 2.2, SWING[swingFrame].hand[1] + 1.2] : [r.ox - 2.8 - step * 1.2, r.hip - 1.6];
  arm(g, r.sb, backHand, dim(tunic));
  legs(g, r, trousers, boots);
  torso(g, r, lit(tunic));
  onTorso(g, r, {}, () => {
    poly(g, [[r.ox - 1.6, r.shoulder - 1.6], [r.ox + 1.8, r.shoulder - 1.6], [r.ox + 0.4, r.shoulder + 2.2]], lit(LINEN));
  });
  belt(g, r, LEATHER, IRON);
  head(g, r);
  hair(g, r);
  // 밀짚모자
  ellipse(g, r.hx - 0.4, r.hy - 3.9, 3.7, 2.7, round(STRAW));
  ellipse(g, r.hx - 0.2, r.hy - 2.5, 6.4, 1.9, lit(STRAW));
  line(g, r.hx - 3.5, r.hy - 3, r.hx + 2.9, r.hy - 3, STRAW.darker, 0.7);
  if (v.carry === 'wood') {
    for (const [dy, len] of [[0, 11], [-2.4, 9.5]]) {
      g.save();
      g.translate(r.ox - 2.4, r.shoulder - 1.4 + dy);
      g.rotate(-0.32);
      rect(g, -len / 2, -1.2, len, 2.4, lit(WOOD), 1.2);
      ellipse(g, len / 2, 0, 0.9, 1.2, round(tones('#d3aa70')));
      g.restore();
    }
  }
  if (swing) {
    const { hand, angle } = SWING[swingFrame];
    tool(g, toolKind, hand[0], hand[1], angle);
    arm(g, r.sf, hand, tunic);
  } else {
    arm(g, r.sf, [r.ox + 3.6 + step * 1.2, r.hip - 1.8], tunic);
  }
}

/** 창병: 쇠 모자, 누빈 팀 색 옷, 긴 창 */
function drawPikeman(g, pose, p) {
  const { step, bob } = walkOf(pose);
  const thrust = pose.kind === 'strike' ? [5, 2.6, 0.8][pose.frame] : 0;
  const fighting = pose.kind === 'ready' || pose.kind === 'strike';
  const r = rig({ step, bob, lean: fighting ? 0.8 + thrust * 0.15 : 0 });
  const trousers = tones('#5d4a36');
  const boots = tones('#43322a');
  // 창: 서 있을 때 세우고, 걸을 때 어깨에 기대고, 싸울 때 앞으로 겨눈다
  let pike;
  let hands;
  if (fighting) {
    pike = [-9 + thrust, -11.2, 19 + thrust, -15.6];
    hands = [[-1.6 + thrust, -12.4], [5 + thrust, -13.4]];
  } else if (pose.kind === 'walk') {
    pike = [7.6, -1.4 + bob, -7.4, -31 + bob];
    hands = [[r.ox - 1, r.hip - 1.4], [4.6, -10.2 + bob]];
  } else {
    pike = [6.4, 1.4, 0.2, -33.4];
    hands = [[r.ox - 2.6, r.hip - 1.4], [5.1, -9.6]];
  }
  arm(g, r.sb, hands[0], dim(p.team));
  if (!fighting) spear(g, ...pike, { tassel: p.team, blade: 5 });
  legs(g, r, trousers, boots);
  torso(g, r, lit(p.team));
  onTorso(g, r, {}, () => {
    for (const x of [-2.6, 0.2, 3]) line(g, r.ox + x + r.lean * 0.5, r.shoulder - 2, r.ox + x + r.lean * 0.5, r.hip + 3, rgba(p.team.darker, 0.55), 0.55);
  });
  belt(g, r);
  head(g, r);
  // 쇠 모자: 둥근 정수리 + 넓은 챙
  within(
    g,
    () => {
      g.beginPath();
      g.rect(r.hx - 8, r.hy - 12, 16, 10.6);
    },
    () => ellipse(g, r.hx - 0.3, r.hy - 2.2, 4.4, 3.8, metal(STEEL)),
  );
  ellipse(g, r.hx - 0.2, r.hy - 1.5, 6.4, 1.7, metal(IRON));
  if (fighting) spear(g, ...pike, { tassel: p.team, blade: 5 });
  arm(g, r.sf, hands[1], p.team);
}

/** 장궁병: 초록 두건, 팀 색 옷, 등에 화살통, 큰 활 */
function drawLongbowman(g, pose, p) {
  const { step, bob } = walkOf(pose);
  const r = rig({ step, bob });
  const trousers = tones('#5f4d38');
  const boots = tones('#46352a');
  const aim = pose.kind === 'ready' || pose.kind === 'strike';
  quiver(g, r.ox - 4.4, r.shoulder + 3.2);
  // 당기는 손 (뒷손): 겨눌 때 시위를 뺨까지, 쏜 뒤에는 뒤로 풀린다
  const drawHand = aim
    ? pose.kind === 'ready'
      ? [1.4, -15.6]
      : [[-0.8, -16.2], [-3.2, -19.4], [2.8, -15.4]][pose.frame]
    : [r.ox - 2.6 - step, r.hip - 1.6];
  arm(g, r.sb, drawHand, dim(p.team));
  legs(g, r, trousers, boots);
  torso(g, r, lit(p.team));
  belt(g, r);
  // 두건: 머리를 감싸고 얼굴만 열려 있다
  ellipse(g, r.hx - 0.7, r.hy - 0.5, 5, 5, round(HOOD_GREEN));
  poly(g, [[r.hx - 4.6, r.hy + 0.4], [r.hx - 7.6, r.hy + 5.6], [r.hx - 3.2, r.hy + 3.2]], lit(HOOD_GREEN));
  ellipse(g, r.hx + 1.6, r.hy + 0.6, 2.7, 3.2, round(SKIN));
  circle(g, r.hx + 2.6, r.hy + 0.1, 0.6, INK);
  poly(g, [[r.ox - 4.4, r.shoulder - 0.8], [r.ox + 4.6, r.shoulder - 0.8], [r.ox + 3.4, r.shoulder + 2.4], [r.ox - 3.8, r.shoulder + 2.6]], lit(HOOD_GREEN));
  // 활
  if (aim) {
    const released = pose.kind === 'strike';
    const grip = [9.6, -15];
    longbow(g, grip[0], grip[1], { half: 12.2, bend: 3.2, pull: released ? null : drawHand });
    if (!released) arrow(g, drawHand[0] - 0.6, drawHand[1] + 0.1, grip[0] + 4.6, grip[1] + 0.3);
    if (released && pose.frame === 2) arrow(g, drawHand[0] - 0.6, drawHand[1], drawHand[0] + 7, drawHand[1] + 0.2);
    arm(g, r.sf, grip, p.team);
  } else {
    const grip = [r.ox + 6.4 + step, r.hip - 5.6];
    longbow(g, grip[0], grip[1], { half: 12.6, bend: 3 });
    arm(g, r.sf, grip, p.team);
  }
}

/** 왕실 근위병: 판금 갑옷 위 팀 색 겉옷, 금 볏 투구, 큰 방패와 한손검. 방패벽이면 방패를 세우고 웅크린다 */
function drawRoyalGuard(g, pose, p, v) {
  const { step, bob } = walkOf(pose);
  const wall = v.wall;
  const r = rig({ step: wall ? 0 : step, bob: wall ? 1.3 : bob, lean: wall ? 0.9 : 0 });
  const greaves = tones('#9aa3ad');
  const boots = tones('#555c64');
  const fighting = pose.kind === 'ready' || pose.kind === 'strike';
  // 칼 (뒷손): 싸울 때 방패 위로 치켜들었다가 앞으로 내려친다
  const swordPose = fighting
    ? pose.kind === 'ready'
      ? { hand: [-1.6, -19.8], angle: -2.2 }
      : [{ hand: [6.4, -18.4], angle: -0.2 }, { hand: [5.2, -15.6], angle: 0.35 }, { hand: [1.4, -18.6], angle: -1.2 }][pose.frame]
    : { hand: [r.ox - 3 - step, r.hip - 2], angle: 1.25 };
  if (!fighting) sword(g, swordPose.hand[0], swordPose.hand[1], swordPose.angle, { length: 8 });
  arm(g, r.sb, swordPose.hand, tones('#8d96a0'), tones('#6f7780'));
  legs(g, r, greaves, boots);
  torso(g, r, metal(STEEL), { width: 10.4, length: 2 });
  // 팀 색 겉옷 (가슴에서 무릎까지 앞자락)
  onTorso(g, r, { width: 10.4, length: 2 }, () => {
    rect(g, r.ox - 3.2 + r.lean * 0.5, r.shoulder - 2, 6.4, 14, vertical(p.team));
    line(g, r.ox - 3.2 + r.lean * 0.5, r.shoulder - 2, r.ox - 3.2 + r.lean * 0.5, r.hip + 3, GOLD.base, 0.6);
    line(g, r.ox + 3.2 + r.lean * 0.5, r.shoulder - 2, r.ox + 3.2 + r.lean * 0.5, r.hip + 3, GOLD.base, 0.6);
  });
  belt(g, r, tones('#3d2c22'), GOLD);
  // 투구: 둥근 쇠투구 + 금 볏 + 눈구멍
  ellipse(g, r.hx - 0.2, r.hy - 0.4, 4.7, 4.9, metal(STEEL));
  rect(g, r.hx + 0.6, r.hy - 1, 4, 1.1, INK, 0.4);
  g.beginPath();
  g.ellipse(r.hx - 0.4, r.hy - 1, 4.4, 5.2, 0, Math.PI * 1.1, Math.PI * 1.95);
  g.strokeStyle = GOLD.base;
  g.lineWidth = 1.4;
  g.stroke();
  if (fighting) sword(g, swordPose.hand[0], swordPose.hand[1], swordPose.angle, { length: 8.6 });
  // 방패 (앞손)
  const shield = wall ? { x: 6.8, y: -9.6, w: 10.4, h: 17 } : { x: 6.2, y: -11.8 + bob, w: 8.4, h: 13.2 };
  kiteShield(g, shield.x, shield.y, shield.w, shield.h, p.team);
  circle(g, shield.x - 2.6, shield.y - 1, 1.3, round(tones('#7d858e')));
}

/** 전투 마법사: 팀 색 긴 옷, 파란 뾰족 모자, 흰 수염, 끝에 파란 구슬이 달린 지팡이 */
function drawBattlemage(g, pose, p) {
  const { step, bob } = walkOf(pose);
  const cast = pose.kind === 'ready' || pose.kind === 'strike';
  const r = rig({ step: step * 0.6, bob, lean: cast ? 0.6 : 0 });
  const robeOpts = { width: 10.2, length: 6.4, flare: 2 + Math.abs(step) * 0.6 };
  // 지팡이: 서 있을 때 곧게, 겨눌 때 앞으로 기울이고, 쏠 때 내민다
  const staff = cast
    ? pose.kind === 'ready'
      ? { hand: [6.4, -14.2], top: [11.6, -28.6], foot: [3.6, -6] }
      : [{ hand: [8.6, -15], top: [17.4, -26], foot: [3.8, -8.6] }, { hand: [7.6, -14.6], top: [14.6, -27.4], foot: [3.6, -7.4] }, { hand: [6.8, -14.4], top: [12.4, -28.4], foot: [3.6, -6.4] }][pose.frame]
    : { hand: [r.ox + 6 + step * 0.8, -12.4 + bob], top: [r.ox + 6.6 + step * 0.8, -30 + bob], foot: [r.ox + 5.8 + step * 0.8, 0.6] };
  arm(g, r.sb, [r.ox - 3 - step, r.hip - 2.6], dim(p.team), SKIN, 2.9);
  // 옷자락 아래로 발끝만
  boot(g, r.fb, dim(tones('#3d2f28')));
  boot(g, r.ff, tones('#3d2f28'));
  torso(g, r, lit(p.team), robeOpts);
  onTorso(g, r, robeOpts, () => {
    rect(g, r.ox - 8, r.hip + robeOpts.length - 1.8, 16, 2.2, lit(MAGE_HAT));
    line(g, r.ox + 0.6, r.shoulder - 1, r.ox + 0.6, r.hip + 6, rgba(p.team.darker, 0.5), 0.6);
  });
  line(g, r.ox - 4.8, r.hip - 1.2, r.ox + 5, r.hip - 1.6, LINEN.dark, 0.9);
  head(g, r);
  // 흰 수염
  poly(g, [[r.hx + 0.2, r.hy + 1.1], [r.hx + 4.1, r.hy + 1.2], [r.hx + 2.2, r.hy + 6.6], [r.hx - 0.9, r.hy + 3.2]], lit(BEARD));
  // 뾰족 모자: 챙 + 뒤로 꺾인 뿔 + 금띠
  poly(g, [[r.hx - 3.9, r.hy - 3.1], [r.hx + 3.9, r.hy - 3.1], [r.hx + 0.2, r.hy - 11.2], [r.hx - 4.4, r.hy - 13.4], [r.hx - 1.4, r.hy - 10.4]], lit(MAGE_HAT));
  rect(g, r.hx - 3.8, r.hy - 4.4, 7.6, 1.3, metal(GOLD), 0.4);
  ellipse(g, r.hx, r.hy - 3, 6.2, 1.6, lit(MAGE_HAT));
  // 지팡이
  limb(g, staff.foot[0], staff.foot[1], staff.top[0], staff.top[1], 1.5, DARK_WOOD);
  circle(g, staff.top[0], staff.top[1], 2.4, round(tones('#8fb8ff')));
  circle(g, staff.top[0] - 0.7, staff.top[1] - 0.8, 0.8, 'rgba(255, 255, 255, 0.85)');
  curve(g, staff.top[0] - 2.2, staff.top[1] + 1.8, staff.top[0], staff.top[1] + 3.2, staff.top[0] + 2.2, staff.top[1] + 1.8, GOLD.base, 0.8);
  arm(g, r.sf, staff.hand, p.team, SKIN, 2.9);
  return { glow: [{ x: staff.top[0], y: staff.top[1], r: pose.kind === 'strike' && pose.frame === 0 ? 11 : 6.5, color: 'rgba(140, 190, 255, 0.9)', pulse: true }] };
}

/** 척후 기병: 갈색 말, 가죽 모자에 팀 색 깃털과 망토, 휜 칼 */
function drawScoutRider(g, pose, p) {
  const frame = pose.kind === 'walk' ? pose.frame : pose.kind === 'strike' ? 3 : null;
  const cloakBack = pose.kind === 'walk' ? -12.5 : -10.6;
  const lift = horse(g, frame, { coat: HORSE_BROWN, mane: MANE_DARK });
  const r = riderRig(lift, pose.kind === 'strike' ? 0.8 : 0);
  // 망토 (뒤로 날린다)
  poly(g, [[r.ox - 3.4, r.shoulder - 0.6], [r.ox + 1.8, r.shoulder - 0.6], [cloakBack + 1, r.hip + 2.4], [cloakBack - 1.6, r.hip - 0.4]], lit(p.team));
  const blade = pose.kind === 'strike'
    ? [{ hand: [8.4, -24.6], angle: 0.5 }, { hand: [7.2, -21.8], angle: 1.05 }, { hand: [4, -26.6], angle: -0.6 }][pose.frame]
    : pose.kind === 'ready'
      ? { hand: [2.4, -33.6 + lift], angle: -1.9 }
      : { hand: [5.2, -22.4 + lift], angle: 0.9 };
  arm(g, r.sb, [r.ox + 3.4, r.hip - 3.4], dim(tones('#7b5a3a')));
  riderLeg(g, r, tones('#5a4632'), tones('#3e2d22'));
  torso(g, r, lit(tones('#8a6844')), { width: 9, length: 1.6 });
  onTorso(g, r, { width: 9, length: 1.6 }, () => rect(g, r.ox - 1.2, r.shoulder - 2, 2.4, 11, lit(p.team)));
  belt(g, r);
  head(g, r);
  hair(g, r, tones('#6b4a2c'));
  // 가죽 모자와 깃털
  within(g, () => { g.beginPath(); g.rect(r.hx - 7, r.hy - 10, 14, 8.2); }, () => ellipse(g, r.hx - 0.4, r.hy - 1.6, 4.6, 4, lit(LEATHER)));
  ellipse(g, r.hx - 0.2, r.hy - 1.8, 5.4, 1.2, lit(LEATHER));
  curve(g, r.hx - 2, r.hy - 3, r.hx - 5.4, r.hy - 7.6, r.hx - 8.4, r.hy - 6.4, p.team.base, 1.6);
  saber(g, blade.hand[0], blade.hand[1], blade.angle);
  arm(g, r.sf, blade.hand, tones('#8a6844'));
}

/** 기사: 팀 색 덮개를 쓴 회색 말, 판금 갑옷, 팀 색 깃털 투구, 깃발 달린 랜스 */
function drawKnight(g, pose, p) {
  const frame = pose.kind === 'walk' ? pose.frame : pose.kind === 'strike' ? 3 : null;
  const lift = horse(g, frame, { coat: HORSE_GREY, mane: MANE_LIGHT, caparison: p.team, trim: GOLD, chanfron: STEEL });
  const r = riderRig(lift, pose.kind === 'strike' ? 1.2 : 0);
  // 랜스: 서 있으면 비스듬히 세우고, 걸으면 앞으로 눕히고, 싸우면 옆구리에 끼고 찌른다
  const lance = pose.kind === 'strike'
    ? [[-3, -21 + lift, 34, -22], [-5, -20.6 + lift, 31, -21.6], [-7, -20.4 + lift, 28.6, -21.4]][pose.frame]
    : pose.kind === 'ready'
      ? [-8, -20.2 + lift, 28, -21.4]
      : pose.kind === 'walk'
        ? [-6, -17.4 + lift, 22, -34 + lift]
        : [-4.6, -16.6 + lift, 16.4, -41];
  const [lx1, ly1, lx2, ly2] = lance;
  const hand = [lx1 + (lx2 - lx1) * 0.3, ly1 + (ly2 - ly1) * 0.3];
  // 방패 (먼 쪽 팔, 몸 뒤로 모서리만 보인다)
  kiteShield(g, r.ox - 3.6, r.hip - 5.6, 7, 9.4, p.team, { emblem: 'cross' });
  riderLeg(g, r, tones('#8e97a1'), tones('#5b636b'));
  torso(g, r, metal(STEEL), { width: 10, length: 1.4 });
  onTorso(g, r, { width: 10, length: 1.4 }, () => rect(g, r.ox - 2.6, r.shoulder - 2, 5.2, 12, vertical(p.team)));
  belt(g, r, tones('#3d2c22'));
  // 큰 투구: 원통형, 눈구멍, 팀 색 깃털
  curve(g, r.hx - 1.2, r.hy - 4.4, r.hx - 4.8, r.hy - 10.4, r.hx - 9, r.hy - 8.2, p.team.dark, 2.6);
  curve(g, r.hx - 1.2, r.hy - 4.6, r.hx - 4.6, r.hy - 10.2, r.hx - 8.6, r.hy - 8.6, p.team.light, 1.2);
  rect(g, r.hx - 3.9, r.hy - 4.8, 8.2, 8.8, metal(STEEL), 2.2);
  rect(g, r.hx + 0.2, r.hy - 1.2, 4.1, 1, INK, 0.3);
  line(g, r.hx + 2.4, r.hy + 0.6, r.hx + 2.4, r.hy + 3.2, rgba(INK, 0.5), 0.4);
  spear(g, lx1, ly1, lx2, ly2, { width: 1.9, blade: 5.6, shaft: tones('#9a7048') });
  // 창끝 아래 작은 팀 색 깃발
  const a = Math.atan2(ly2 - ly1, lx2 - lx1);
  const fx = lx2 - Math.cos(a) * 4;
  const fy = ly2 - Math.sin(a) * 4;
  poly(g, [[fx, fy], [fx - Math.cos(a) * 5.6, fy - Math.sin(a) * 5.6], [fx - Math.cos(a) * 4 + 2.8, fy - Math.sin(a) * 4 + 3.4]], lit(p.team));
  arm(g, r.sf, hand, tones('#9aa3ad'), tones('#6f7780'), 2.8);
}

// ---------- 궁극 유닛 ----------

const HOLY = tones('#efe8d4');
const SUN_GOLD = tones('#e8c25a');

/** 솔라리온: 금빛 덮개의 흰 군마, 금빛 판금과 왕관, 팀 색 망토, 빛나는 성창 (크게 그린다) */
function drawSolarion(g, pose, p) {
  const k = 1.28;
  const frame = pose.kind === 'walk' ? pose.frame : pose.kind === 'strike' ? 3 : null;
  g.save();
  g.scale(k, k);
  const lift = horse(g, frame, { coat: HORSE_WHITE, mane: tones('#eadcb4'), caparison: p.team, trim: SUN_GOLD, chanfron: SUN_GOLD });
  const r = riderRig(lift, pose.kind === 'strike' ? 1.2 : 0);
  // 망토: 어깨에서 뒤로 크게 날린다
  const cape = pose.kind === 'walk' ? -15 : -12.4;
  poly(g, [[r.ox - 3.6, r.shoulder - 1], [r.ox + 1.6, r.shoulder - 1], [cape + 2.4, r.hip + 5.6], [cape - 1.6, r.hip + 3], [cape - 0.4, r.hip - 1]], lit(p.team));
  const lance = pose.kind === 'strike'
    ? [[-3, -21 + lift, 33, -21.6], [-5, -20.6 + lift, 30.4, -21.4], [-7, -20.4 + lift, 28, -21.2]][pose.frame]
    : pose.kind === 'ready'
      ? [-8, -20.2 + lift, 27, -21.2]
      : pose.kind === 'walk'
        ? [-6, -17.4 + lift, 21, -34 + lift]
        : [-4.4, -16.4 + lift, 15.2, -41];
  const [lx1, ly1, lx2, ly2] = lance;
  riderLeg(g, r, tones('#d9c486'), tones('#a8873a'));
  torso(g, r, metal(SUN_GOLD), { width: 10.4, length: 1.6 });
  onTorso(g, r, { width: 10.4, length: 1.6 }, () => {
    rect(g, r.ox - 2.4, r.shoulder - 2, 4.8, 12, vertical(HOLY));
    circle(g, r.ox + r.lean * 0.5, r.shoulder + 3.4, 1.6, round(SUN_GOLD));
  });
  // 투구와 왕관
  rect(g, r.hx - 3.8, r.hy - 4.6, 8, 8.6, metal(HOLY), 2.4);
  rect(g, r.hx + 0.4, r.hy - 1, 3.9, 1, INK, 0.3);
  poly(
    g,
    [[r.hx - 3.8, r.hy - 4.2], [r.hx - 3.8, r.hy - 7.4], [r.hx - 1.9, r.hy - 5.6], [r.hx, r.hy - 8.4], [r.hx + 1.9, r.hy - 5.6], [r.hx + 3.9, r.hy - 7.4], [r.hx + 3.9, r.hy - 4.2]],
    metal(SUN_GOLD),
  );
  spear(g, lx1, ly1, lx2, ly2, { width: 2, blade: 6.4, shaft: HOLY, tip: SUN_GOLD });
  arm(g, r.sf, [lx1 + (lx2 - lx1) * 0.3, ly1 + (ly2 - ly1) * 0.3], SUN_GOLD, tones('#b8943e'), 2.9);
  g.restore();
  return { glow: [{ x: lx2 * k, y: ly2 * k, r: pose.kind === 'strike' && pose.frame === 0 ? 14 : 9, color: 'rgba(255, 226, 150, 0.95)', pulse: true }] };
}

const NIGHT_ROBE = tones('#2b3066');
const SILVER_HAIR = tones('#e1e5f0');
const STAR = tones('#a9bcff');

/** 에테리아: 떠 있는 대마법사. 밤하늘 옷에 팀 색 앞자락, 은빛 머리, 별 관, 별 수정 지팡이 */
function drawEtheria(g, pose, p) {
  const k = 1.12;
  const cast = pose.kind === 'ready' || pose.kind === 'strike';
  g.save();
  g.scale(k, k);
  const r = rig({ bob: 0, lean: cast ? 0.5 : 0, oy: -3 });
  const sway = pose.kind === 'walk' ? [1.2, 0, -1.2, 0][pose.frame] : 0;
  // 은빛 머리가 등 뒤로 흘러내린다
  poly(g, [[r.hx - 3.6, r.hy - 2.4], [r.hx - 7.4, r.hy + 5], [r.hx - 8.8 + sway, r.hy + 12.6], [r.hx - 3, r.hy + 8], [r.hx - 1, r.hy + 1]], lit(SILVER_HAIR));
  // 옷: 어깨에서 발끝까지, 끝자락은 뒤로 흩날린다
  const robe = () => {
    g.beginPath();
    g.moveTo(r.ox - 4.6, r.shoulder + 1.6);
    g.bezierCurveTo(r.ox - 4.6, r.shoulder - 1.6, r.ox + 4.6, r.shoulder - 1.6, r.ox + 4.8, r.shoulder + 1.6);
    g.lineTo(r.ox + 6.2, r.oy - 2);
    g.quadraticCurveTo(r.ox + 1, r.oy + 0.6, r.ox - 4, r.oy - 0.8);
    g.quadraticCurveTo(r.ox - 8 + sway, r.oy + 1.4, r.ox - 11 + sway, r.oy - 0.4);
    g.quadraticCurveTo(r.ox - 7, r.oy - 4, r.ox - 5.6, r.shoulder + 5);
    g.closePath();
  };
  arm(g, r.sb, cast ? [r.ox - 4.4, r.shoulder - 3.6] : [r.ox - 4, r.hip - 1.2], dim(NIGHT_ROBE), SKIN, 3);
  robe();
  fillPath(g, lit(NIGHT_ROBE), r.ox - 11, r.shoulder - 1.6, 17, r.oy - r.shoulder + 3);
  within(g, robe, () => {
    poly(g, [[r.ox - 0.6, r.shoulder - 1], [r.ox + 3.4, r.shoulder - 1], [r.ox + 4.6, r.oy], [r.ox - 1.6, r.oy]], vertical(p.team));
    line(g, r.ox - 0.6, r.shoulder - 1, r.ox - 1.6, r.oy, GOLD.base, 0.6);
    for (const [sx, sy] of [[-4, -8], [-7, -3], [-2.4, -13], [-5.6, -12]]) circle(g, r.ox + sx, r.oy + sy, 0.45, 'rgba(230, 236, 255, 0.9)');
  });
  head(g, r);
  hair(g, r, SILVER_HAIR);
  // 별 관
  for (const [dx, h] of [[-2.2, 2.6], [0.2, 3.8], [2.4, 2.6]]) poly(g, [[r.hx + dx - 0.9, r.hy - 3.4], [r.hx + dx, r.hy - 3.4 - h], [r.hx + dx + 0.9, r.hy - 3.4]], metal(STAR));
  // 지팡이: 끝에 초승달과 별 수정
  const staff = cast
    ? pose.kind === 'strike' && pose.frame === 0
      ? { foot: [3.4, -4], top: [15, -33], hand: [8.6, -18] }
      : { foot: [2.8, -3], top: [12.6, -34], hand: [7.4, -18.4] }
    : { foot: [r.ox + 6.4, r.oy - 0.4], top: [r.ox + 7.8, r.oy - 33], hand: [r.ox + 6.9, r.shoulder + 3] };
  limb(g, staff.foot[0], staff.foot[1], staff.top[0], staff.top[1], 1.5, tones('#6d5b3f'));
  curve(g, staff.top[0] - 3, staff.top[1] - 2.4, staff.top[0] - 3.6, staff.top[1] + 2.6, staff.top[0] + 0.6, staff.top[1] + 2.4, GOLD.base, 1);
  poly(
    g,
    [[staff.top[0], staff.top[1] - 3.4], [staff.top[0] + 1, staff.top[1] - 1], [staff.top[0] + 3.4, staff.top[1]], [staff.top[0] + 1, staff.top[1] + 1], [staff.top[0], staff.top[1] + 3.4], [staff.top[0] - 1, staff.top[1] + 1], [staff.top[0] - 3.4, staff.top[1]], [staff.top[0] - 1, staff.top[1] - 1]],
    round(STAR),
  );
  arm(g, r.sf, staff.hand, p.team, SKIN, 3);
  g.restore();
  return { glow: [{ x: staff.top[0] * k, y: staff.top[1] * k, r: pose.kind === 'strike' && pose.frame === 0 ? 14 : 8, color: 'rgba(170, 195, 255, 0.95)', pulse: true }] };
}

const SHELL = tones('#5d7650');
const TURTLE_SKIN = tones('#7c8e67');
const FORT_STONE = tones('#9a9284');
const FORT_ROOF = tones('#56607a');

function turtleLeg(g, x, y, swing, t) {
  const fx = x + swing;
  limb(g, x, y - 4, fx, y + 5.4, 7.4, t);
  for (const dx of [-2, 0.2, 2.4]) circle(g, fx + dx, y + 6.2, 1.2, round(tones('#d8d0bc')));
}

/** 아르카논: 등에 성채를 진 고대 거북. 등껍질의 룬이 빛난다. 뿌리내리면 발밑에 뿌리가 퍼진다 */
function drawArkanon(g, pose, p, v) {
  const walk = pose.kind === 'walk' ? pose.frame : null;
  const swing = walk == null ? [0, 0, 0, 0] : [[2.4, -1.8, -2, 1.6], [0.6, 0, 0, 0.4], [-2, 1.8, 2.2, -1.6], [0, 0.6, 0.4, 0]][walk];
  const slam = pose.kind === 'strike' ? [-3.6, -1.6, -0.4][pose.frame] : pose.kind === 'ready' ? -1.2 : 0;
  const lift = walk == null ? 0 : [0, -0.8, 0, -0.8][walk];
  // 뿌리 (뿌리내렸을 때)
  if (v.rooted) {
    for (const [x, dir] of [[-22, -1], [-10, -0.6], [14, 0.6], [26, 1]]) {
      curve(g, x, -1, x + dir * 6, 3, x + dir * 12, 2.4, tones('#5a4a32').dark, 2.2);
      curve(g, x, -1, x + dir * 4, 4, x + dir * 5, 6, tones('#6d7f4e').base, 1.4);
    }
  }
  // 먼 쪽 다리
  turtleLeg(g, 13, -6 + lift, swing[1], dim(TURTLE_SKIN, 0.25));
  turtleLeg(g, -15, -6 + lift, swing[3], dim(TURTLE_SKIN, 0.25));
  // 꼬리
  poly(g, [[-23, -7 + lift], [-31, -3.6 + lift], [-22, -3 + lift]], lit(TURTLE_SKIN));
  // 목과 머리 (내려찍을 때 앞으로 숙인다)
  const hx = 32;
  const hy = -11 + lift - slam * 1.4;
  poly(g, [[18, -12 + lift], [hx - 3, hy - 4], [hx - 2, hy + 3.6], [18, -4 + lift]], lit(TURTLE_SKIN));
  ellipse(g, hx, hy, 6.6, 4.6, round(TURTLE_SKIN), 0.12);
  poly(g, [[hx + 4.6, hy - 1.4], [hx + 8.4, hy + 0.8], [hx + 4.4, hy + 2.8]], lit(tones('#c9b98f')));
  circle(g, hx + 1.8, hy - 1.8, 0.95, '#f0d36a');
  circle(g, hx + 2, hy - 1.8, 0.45, INK);
  line(g, hx - 2.2, hy - 3.6, hx + 3.2, hy - 3.2, TURTLE_SKIN.darker, 1.1);
  // 등껍질: 둥근 지붕과 테두리
  const shell = () => {
    g.beginPath();
    g.moveTo(-27, -6 + lift);
    g.bezierCurveTo(-27, -30 + lift, 25, -30 + lift, 25, -6 + lift);
    g.closePath();
  };
  shell();
  fillPath(g, round(SHELL), -27, -30 + lift, 52, 24);
  within(g, shell, () => {
    const plates = [[-15, -12], [-2, -15], [11, -12], [-9, -22], [5, -22]];
    for (const [x, y] of plates) {
      ellipsePath(g, x, y + lift, 6.4, 5);
      g.strokeStyle = rgba(SHELL.darker, 0.8);
      g.lineWidth = 1;
      g.stroke();
      ellipse(g, x - 1.2, y - 1.4 + lift, 3.4, 2, rgba(SHELL.lighter, 0.25));
    }
    for (const [x, y] of plates) {
      line(g, x - 2, y + lift, x + 2, y + lift, '#9fe8dc', 0.8);
      line(g, x, y - 2 + lift, x, y + 2 + lift, '#9fe8dc', 0.8);
    }
  });
  rect(g, -28, -8 + lift, 54, 4, lit(tones('#b3a579')), 2);
  // 가까운 쪽 다리
  turtleLeg(g, 15, -4 + lift, swing[0], TURTLE_SKIN);
  turtleLeg(g, -13, -4 + lift, swing[2], TURTLE_SKIN);
  // 등 위의 성채
  const base = -26 + lift;
  rect(g, -13, base - 13, 25, 14, vertical(FORT_STONE));
  for (let x = -13; x < 12; x += 5) rect(g, x, base - 16, 3, 3.4, lit(FORT_STONE));
  for (const y of [base - 9, base - 4.6]) line(g, -13, y, 12, y, rgba(FORT_STONE.darker, 0.5), 0.5);
  rect(g, -2.4, base - 7, 4.8, 7, INK, 2);
  rect(g, 6, base - 10, 2, 3, '#f3cf7d', 0.6);
  // 탑과 뾰족 지붕
  rect(g, -17, base - 21, 8, 22, vertical(FORT_STONE));
  poly(g, [[-18.4, base - 21], [-13, base - 31], [-7.6, base - 21]], lit(FORT_ROOF));
  rect(g, -14.2, base - 16, 2.2, 3.4, '#f3cf7d', 0.6);
  rect(g, -18, base - 2, 31, 2.6, vertical(p.team));
  return {
    glow: [
      { x: -15, y: -12 + lift, r: 6, color: 'rgba(120, 220, 210, 0.55)', pulse: true },
      { x: -2, y: -15 + lift, r: 6, color: 'rgba(120, 220, 210, 0.55)', pulse: true },
      { x: 11, y: -12 + lift, r: 6, color: 'rgba(120, 220, 210, 0.55)', pulse: true },
    ],
    flag: { x: -13, y: base - 31, h: 12 },
  };
}

// ---------- 배 ----------

const HULL = tones('#6d4b2d');
const HULL_DARK = tones('#57391f');
const SAIL_EDGE = tones('#ede3c8');

/** 배 몸통: 기준점이 물 위 가운데. 뱃머리가 오른쪽 */
function hullShape(g, { stern, bow, deck, keel, sternH, bowH }) {
  g.beginPath();
  g.moveTo(stern, deck - sternH);
  g.quadraticCurveTo(stern + 6, deck, stern + 10, deck);
  g.lineTo(bow - 10, deck);
  g.quadraticCurveTo(bow - 3, deck, bow, deck - bowH);
  g.quadraticCurveTo(bow - 4, keel, bow - 16, keel + 1.4);
  g.lineTo(stern + 14, keel + 1.4);
  g.quadraticCurveTo(stern + 2, keel, stern, deck - sternH);
  g.closePath();
}

function drawHull(g, shape, wood, stripe) {
  hullShape(g, shape);
  fillPath(g, lit(wood), shape.stern, shape.deck - Math.max(shape.sternH, shape.bowH), shape.bow - shape.stern, shape.keel - shape.deck + 8);
  within(g, () => hullShape(g, shape), () => {
    for (let y = shape.deck + 2.4; y < shape.keel + 2; y += 2.6) line(g, shape.stern, y, shape.bow, y, rgba(wood.darker, 0.55), 0.5);
    if (stripe) rect(g, shape.stern, shape.deck + 1.6, shape.bow - shape.stern, 1.8, vertical(stripe));
  });
  line(g, shape.stern + 8, shape.deck - 0.4, shape.bow - 8, shape.deck - 0.4, wood.lighter, 1);
}

/** 네모 돛. (x, top)에서 아래로 h, 오른쪽으로 부푼다 */
function squareSail(g, x, top, w, h, team, bulge = 2.4) {
  const sail = () => {
    g.beginPath();
    g.moveTo(x - w / 2, top);
    g.lineTo(x + w / 2, top);
    g.quadraticCurveTo(x + w / 2 + bulge, top + h / 2, x + w / 2 - 0.6, top + h);
    g.lineTo(x - w / 2 + 0.8, top + h);
    g.quadraticCurveTo(x - w / 2 + bulge * 0.7, top + h / 2, x - w / 2, top);
    g.closePath();
  };
  sail();
  fillPath(g, lit(team), x - w / 2, top, w + bulge, h);
  within(g, sail, () => {
    rect(g, x - w, top + h * 0.34, w * 2, h * 0.22, rgba(SAIL_EDGE.base, 0.85));
    line(g, x + 1, top, x + 2, top + h, rgba(team.darker, 0.35), 0.7);
  });
}

/** 전투 갤리: 긴 배, 노, 난간의 방패, 팀 색 돛, 궁수 */
function drawWarGalley(g, pose, p) {
  const shape = { stern: -33, bow: 35, deck: -5, keel: 4, sternH: 6, bowH: 9 };
  const row = pose.kind === 'walk' ? [0.72, 0.95, 1.2, 0.95][pose.frame] : 1.25;
  // 돛대와 돛
  line(g, -2, -5, -2, -42, DARK_WOOD.dark, 1.8);
  line(g, -16, -38, 12, -38, DARK_WOOD.dark, 1.3);
  squareSail(g, -2, -38, 26, 19, p.team, 3);
  drawHull(g, shape, HULL, null);
  // 궁수 둘 (난간 뒤)
  for (const x of [-14, 9]) {
    circle(g, x, -9, 2, round(SKIN));
    within(g, () => { g.beginPath(); g.rect(x - 3, -13, 6, 3.6); }, () => circle(g, x, -9.2, 2.3, metal(STEEL)));
  }
  // 난간의 방패
  [-22, -14, -6, 2, 10, 18].forEach((x, i) => {
    circle(g, x, -6.4, 2.3, round(i % 2 ? p.team : WOOD));
    circle(g, x - 0.3, -6.6, 0.7, metal(STEEL));
  });
  // 노
  for (const x of [-19, -11, -3, 5, 13, 21]) {
    const ex = x - Math.cos(row) * 11;
    const ey = -1.4 + Math.sin(row) * 11;
    line(g, x, -1.4, ex, ey, WOOD.light, 1.1);
    circle(g, x, -1.4, 0.9, INK);
  }
  // 뱃머리 장식
  curve(g, 35, -14, 39, -18, 36.4, -20, HULL.base, 1.8);
}

/** 수송선: 불룩한 배, 짐, 작은 팀 색 돛 */
function drawTransport(g, pose, p) {
  const shape = { stern: -26, bow: 27, deck: -8, keel: 4.4, sternH: 7, bowH: 6 };
  line(g, 0, -8, 0, -38, DARK_WOOD.dark, 1.7);
  line(g, -10, -34.6, 10, -34.6, DARK_WOOD.dark, 1.2);
  line(g, 0, -38, 25, -14, rgba(LINEN.dark, 0.7), 0.5);
  line(g, 0, -38, -24, -14, rgba(LINEN.dark, 0.7), 0.5);
  squareSail(g, 0, -34.6, 19, 15, p.team, 2.4);
  // 짐: 상자와 통
  rect(g, -18, -14, 7, 6, lit(WOOD), 0.6);
  line(g, -18, -11, -11, -11, WOOD.darker, 0.5);
  rect(g, 5, -13, 6, 5, lit(WOOD), 0.6);
  ellipse(g, 14.6, -11.4, 2.6, 3.4, lit(tones('#8a6238')));
  line(g, 12, -12.4, 17.2, -12.4, IRON.dark, 0.5);
  drawHull(g, shape, tones('#77542f'), null);
  // 고물 망루
  rect(g, -26, -16, 9, 3, lit(WOOD), 0.6);
  for (const x of [-25, -21.6, -18.2]) line(g, x, -16, x, -13.4, WOOD.darker, 0.7);
}

/** 투석 전함: 무거운 배 위의 투석기. 쏘면 팔이 앞으로 넘어간다 */
function drawCatapultShip(g, pose, p) {
  const shape = { stern: -33, bow: 34, deck: -6, keel: 4.6, sternH: 8, bowH: 6 };
  // 고물 깃대
  line(g, -28, -14, -28, -34, DARK_WOOD.dark, 1.3);
  poly(g, [[-28, -34], [-19, -31], [-28, -27]], lit(p.team));
  drawHull(g, shape, HULL_DARK, p.team);
  for (const x of [-20, 0, 20]) line(g, x, -5, x, 3, IRON.dark, 0.9);
  // 투석기 틀
  rect(g, -11, -11, 20, 4, lit(DARK_WOOD), 0.6);
  poly(g, [[-5, -7], [-1, -21], [3, -7]], lit(WOOD));
  line(g, -8, -7, -1, -19, DARK_WOOD.dark, 1.2);
  // 던지는 팔: 겨눔(뒤로 젖힘) → 쏨(앞으로) → 되돌림
  const arm = pose.kind === 'strike' ? [[12, -29, false], [2, -31, false], [-10, -22, false]][pose.frame] : [-15, -10, true];
  const [ax, ay, loaded] = arm;
  limb(g, -1, -17, ax, ay, 2.2, WOOD);
  ellipse(g, ax, ay, 2.6, 1.8, lit(DARK_WOOD));
  if (loaded) circle(g, ax, ay - 1.8, 2.3, round(tones('#8a847a')));
  circle(g, -1, -17, 1.3, metal(IRON));
}

// ---------- 하늘 ----------

/** 깃털 날개. root에서 뻗고, frame(0 위 · 1 가운데 · 2 아래 · 3 가운데)에 따라 끝이 오르내린다 */
function featherWing(g, root, frames, frame, coverts, primaries, scale = 1) {
  const [wrist, tip] = frames[frame];
  const wx = root[0] + wrist[0] * scale;
  const wy = root[1] + wrist[1] * scale;
  const tx = root[0] + tip[0] * scale;
  const ty = root[1] + tip[1] * scale;
  const back = [root[0] - 5 * scale, root[1] + 1.6 * scale];
  const wing = () => {
    g.beginPath();
    g.moveTo(root[0] + 1.6 * scale, root[1] - 0.6 * scale);
    g.quadraticCurveTo((root[0] + wx) / 2, (root[1] + wy) / 2 - 2 * scale, wx, wy);
    g.lineTo(tx, ty);
    // 뒷전: 깃털 끝이 톱니처럼
    const n = 4;
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const px = tx + (back[0] - tx) * k;
      const py = ty + (back[1] - ty) * k;
      g.lineTo(px + (i % 2 ? 1.2 : 0) * scale, py + (i % 2 ? 1.6 : 0) * scale);
    }
    g.closePath();
  };
  wing();
  const minX = Math.min(root[0], wx, tx, back[0]);
  const minY = Math.min(root[1], wy, ty, back[1]);
  fillPath(g, lit(primaries), minX, minY, Math.max(root[0], wx, tx) - minX, Math.max(root[1], wy, ty, back[1]) - minY);
  within(g, wing, () => {
    // 날개 앞쪽(덮깃)은 몸 색
    g.beginPath();
    g.moveTo(root[0] + 2 * scale, root[1]);
    g.lineTo(wx, wy);
    g.lineTo((wx + tx) / 2, (wy + ty) / 2 + 2 * scale);
    g.lineTo(back[0], back[1] - 1 * scale);
    g.closePath();
    fillPath(g, lit(coverts), minX, minY, 30, 30);
    for (let i = 1; i < 4; i++) {
      const k = i / 4;
      line(g, wx + (tx - wx) * k, wy + (ty - wy) * k, back[0] + (tx - back[0]) * k * 0.3, back[1] + (ty - back[1]) * k * 0.3, rgba(primaries.darker, 0.5), 0.5);
    }
  });
}

const FALCON = tones('#8a6c4c');
const FALCON_WING = [
  [[-1, -8], [-6, -13.5]],
  [[-3, -5.5], [-10, -6]],
  [[-2, 3], [-6, 7.6]],
  [[-3.5, -3], [-10.5, -3.4]],
];

/** 매 정찰병: 팀 색 매 두건을 쓴 매 */
function drawFalcon(g, pose, p) {
  const f = pose.frame;
  featherWing(g, [3.4, -3.4], FALCON_WING, f, dim(FALCON, 0.2), dim(tones('#b59a76'), 0.2), 1);
  poly(g, [[-4.4, -0.6], [-10.4, -2.4], [-10.8, 1.8], [-4.4, 1.6]], lit(tones('#7a5d40')));
  ellipse(g, 0, 0, 5.4, 3.2, lit(FALCON));
  ellipse(g, 0.8, 1.2, 3.6, 1.6, rgba('#e7d8b8', 0.8));
  circle(g, 4.8, -1.8, 2.6, round(tones('#d9c7a2')));
  within(g, () => ellipsePath(g, 4.8, -1.8, 2.65, 2.65), () => ellipse(g, 4, -3, 3, 2.4, lit(p.team)));
  poly(g, [[4.2, -4.3], [4.8, -6.4], [5.4, -4.2]], lit(p.team));
  poly(g, [[6.9, -2.4], [8.7, -1.4], [7.4, -0.5], [7.2, -1.2]], lit(tones('#e2b53e')));
  line(g, -0.6, 2.8, -2.6, 5.6, p.team.base, 0.8);
  featherWing(g, [1.6, -2], FALCON_WING, f, FALCON, tones('#c8b08a'), 1.05);
}

const GRYPHON_BODY = tones('#b8904f');
const GRYPHON_HEAD = tones('#ece4d0');
const GRYPHON_WING = [
  [[-2, -17], [-10, -25]],
  [[-6, -11], [-18, -11]],
  [[-4, 3], [-12, 11]],
  [[-7, -8], [-19, -7]],
];

/** 그리폰 기수: 흰 독수리 머리·금빛 사자 몸의 그리폰, 팀 색 망토를 두른 기수와 창 */
function drawGryphon(g, pose, p) {
  const f = pose.kind === 'strike' ? 2 : pose.frame;
  featherWing(g, [3, -6], GRYPHON_WING, f, dim(GRYPHON_BODY, 0.24), dim(GRYPHON_HEAD, 0.22), 0.95);
  // 꼬리
  curve(g, -11, 0, -17, -1, -19.6, -5.4, GRYPHON_BODY.dark, 1.8);
  ellipse(g, -20, -6, 1.8, 2.4, lit(tones('#5c4128')), 0.4);
  // 뒷다리와 몸
  ellipse(g, -7.6, 3, 4.6, 4, lit(GRYPHON_BODY));
  limb(g, -8.6, 5, -11, 8.4, 2.2, GRYPHON_BODY);
  ellipse(g, -1, 1, 11, 5.6, lit(GRYPHON_BODY));
  ellipse(g, 0, 4.4, 8, 1.8, rgba(GRYPHON_BODY.lighter, 0.35));
  // 앞발 (독수리 발톱)
  limb(g, 6.6, 3, 8.4, 8.2, 1.9, tones('#d8a93e'));
  for (const dx of [-0.8, 0.6, 1.8]) line(g, 8.4, 8.2, 8.4 + dx, 9.8, INK, 0.6);
  // 안장 담요 (팀 색)
  poly(g, [[-6, -4.4], [3, -4.8], [3.6, 1], [-6.4, 1.6]], lit(p.team));
  // 기수
  const spearPose = pose.kind === 'strike'
    ? [[-6, -13, 17, 6], [-6, -14, 16, 1], [-7, -15, 15, -8]][pose.frame]
    : pose.kind === 'ready'
      ? [-9, -10, 16, -12]
      : [-9, -6, 13, -24];
  limb(g, -2.6, -6.4, -1.8, -12.6, 5.4, p.team);
  circle(g, -1.4, -15.6, 2.8, round(SKIN));
  within(g, () => { g.beginPath(); g.rect(-5, -20, 8, 4.8); }, () => circle(g, -1.6, -15.8, 3.1, metal(STEEL)));
  circle(g, -0.2, -15.4, 0.45, INK);
  poly(g, [[-4.4, -12.4], [-0.6, -12.6], [-9, -6.4], [-10.6, -8]], lit(p.team));
  spear(g, spearPose[0], spearPose[1], spearPose[2], spearPose[3], { width: 1.2, blade: 4 });
  circle(g, spearPose[0] + (spearPose[2] - spearPose[0]) * 0.42, spearPose[1] + (spearPose[3] - spearPose[1]) * 0.42, 1.2, round(SKIN));
  // 가까운 날개
  featherWing(g, [1.4, -4.4], GRYPHON_WING, f, GRYPHON_BODY, GRYPHON_HEAD, 1);
  // 독수리 머리
  circle(g, 10.4, -3.6, 4.3, round(GRYPHON_HEAD));
  poly(g, [[12.6, -5], [16.8, -4], [16.4, -1.6], [13.8, -1.2], [12.8, -2.2]], lit(tones('#e2b53e')));
  circle(g, 11.6, -4.8, 0.7, INK);
  for (const dy of [-2, 0, 2]) line(g, 6.8, -3.6 + dy, 5.2, -2.2 + dy * 1.2, rgba(GRYPHON_HEAD.dark, 0.9), 0.7);
}

const WYVERN = tones('#56627f');
const WYVERN_MEMBRANE = tones('#3a4460');
const WYVERN_WING = [
  { wrist: [-2, -20], tips: [[-14, -28], [-20, -20], [-18, -10]] },
  { wrist: [-8, -12], tips: [[-22, -14], [-26, -6], [-18, 0]] },
  { wrist: [-6, 4], tips: [[-16, 14], [-10, 16], [-4, 10]] },
  { wrist: [-9, -9], tips: [[-23, -10], [-26, -3], [-17, 2]] },
];

/** 박쥐 날개 (비룡): 손가락 뼈 사이에 막이 있다 */
function batWing(g, root, frame, membrane, bone, scale = 1) {
  const { wrist, tips } = WYVERN_WING[frame];
  const P = ([x, y]) => [root[0] + x * scale, root[1] + y * scale];
  const w = P(wrist);
  const ts = tips.map(P);
  const back = P([-9, 2]);
  const wing = () => {
    g.beginPath();
    g.moveTo(root[0], root[1]);
    g.lineTo(w[0], w[1]);
    g.lineTo(ts[0][0], ts[0][1]);
    let prev = ts[0];
    for (const t of [...ts.slice(1), back]) {
      const mx = (prev[0] + t[0]) / 2;
      const my = (prev[1] + t[1]) / 2;
      // 막은 뼈 사이에서 안으로 처진다
      g.quadraticCurveTo(mx + (w[0] - mx) * 0.3, my + (w[1] - my) * 0.3, t[0], t[1]);
      prev = t;
    }
    g.closePath();
  };
  wing();
  const xs = [root[0], w[0], back[0], ...ts.map((t) => t[0])];
  const ys = [root[1], w[1], back[1], ...ts.map((t) => t[1])];
  fillPath(g, lit(membrane), Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  limb(g, root[0], root[1], w[0], w[1], 2 * scale, bone);
  for (const t of ts) line(g, w[0], w[1], t[0], t[1], bone.light, 0.9 * scale);
}

/** 폭풍 비룡: 푸른 잿빛 비룡. 입에 폭풍 구슬, 등에 팀 색 안장 */
function drawWyvern(g, pose, p) {
  const f = pose.kind === 'strike' ? 1 : pose.frame;
  const lunge = pose.kind === 'strike' ? [3, 1.6, 0.6][pose.frame] : 0;
  batWing(g, [3, -5], f, dim(WYVERN_MEMBRANE, 0.25), dim(WYVERN, 0.2), 0.95);
  // 꼬리
  curve(g, -10, 2, -20, 8, -30, 5, WYVERN.dark, 3.2);
  curve(g, -10, 1.4, -20, 7, -29, 4.4, WYVERN.base, 1.6);
  poly(g, [[-29, 2.4], [-35, 5], [-29, 7.6], [-31, 5]], lit(WYVERN));
  // 몸과 뒷다리
  ellipse(g, -2, 1, 12, 6, lit(WYVERN));
  ellipse(g, -1, 4.2, 9, 2, rgba('#9ea9c4', 0.6));
  limb(g, -6, 4, -8, 9, 2.4, WYVERN);
  // 안장 (팀 색)
  poly(g, [[-7, -4.8], [1.6, -5.2], [2.4, 0], [-7.6, 0.8]], lit(p.team));
  line(g, -2, -5, -2, 5, LEATHER.dark, 0.7);
  // 목과 머리
  const hx = 18 + lunge;
  const hy = -7 + lunge * 0.6;
  curve(g, 7, -1, 12, -6, hx - 2, hy + 1, WYVERN.dark, 5.4);
  curve(g, 7, -1.6, 12, -6.6, hx - 2, hy + 0.4, WYVERN.base, 3.4);
  poly(g, [[hx - 3, hy - 3], [hx + 6, hy - 1.4], [hx + 7.6, hy + 1.2], [hx + 3, hy + 1], [hx + 6.4, hy + 3.2], [hx - 2, hy + 3.4]], lit(WYVERN));
  poly(g, [[hx - 1, hy - 2.6], [hx - 6, hy - 6.6], [hx - 2.6, hy - 1.4]], lit(tones('#c9c3b2')));
  circle(g, hx + 1.6, hy - 0.8, 0.8, '#ffe07a');
  batWing(g, [1.6, -4], f, WYVERN_MEMBRANE, WYVERN, 1);
  return { glow: [{ x: hx + 6.6, y: hy + 1.9, r: pose.kind === 'strike' && pose.frame === 0 ? 13 : 7, color: 'rgba(150, 200, 255, 0.95)', pulse: true }] };
}

// ---------- 표 ----------

const ART = {
  peasant: {
    box: { x: -16, y: -36, w: 36, h: 40 },
    shadow: [7, 2.8],
    walkMs: 560,
    variant: (u, pose) => {
      const carry = u.carryAmount > 0 ? u.carryKind : null;
      const tool = u.state === UNIT_STATE.BUILD ? 'hammer' : u.carryKind === 'wood' ? 'axe' : 'pick';
      return { carry, tool: pose.kind === 'work' ? tool : null };
    },
    draw: drawPeasant,
  },
  pikeman: { box: { x: -16, y: -44, w: 48, h: 48 }, shadow: [7.5, 3], walkMs: 560, draw: drawPikeman },
  longbowman: { box: { x: -15, y: -34, w: 34, h: 38 }, shadow: [7, 2.8], walkMs: 560, draw: drawLongbowman },
  royal_guard: {
    box: { x: -16, y: -36, w: 34, h: 40 },
    shadow: [8, 3.2],
    walkMs: 640,
    variant: (u) => ({ wall: Boolean(u.shieldWall) }),
    draw: drawRoyalGuard,
  },
  battlemage: { box: { x: -14, y: -40, w: 36, h: 44 }, shadow: [7.5, 3], walkMs: 640, draw: drawBattlemage },
  scout_rider: { box: { x: -22, y: -44, w: 46, h: 48 }, shadow: [13, 3.8], walkMs: 440, draw: drawScoutRider },
  knight: { box: { x: -22, y: -52, w: 66, h: 56 }, shadow: [14, 4.2], walkMs: 480, draw: drawKnight },
  solarion: { box: { x: -25, y: -62, w: 78, h: 68 }, shadow: [18, 5], walkMs: 480, under: auraRing, draw: drawSolarion },
  etheria: { box: { x: -17, y: -48, w: 40, h: 52 }, shadow: [8, 3], walkMs: 900, float: 2.4, over: orbitStars, draw: drawEtheria },
  arkanon: {
    box: { x: -38, y: -60, w: 82, h: 70 },
    shadow: [30, 7],
    walkMs: 1200,
    variant: (u) => ({ rooted: Boolean(u.rooted) }),
    draw: drawArkanon,
  },
  war_galley: { ship: true, box: { x: -38, y: -46, w: 80, h: 58 }, hull: [34, 7], walkMs: 900, draw: drawWarGalley },
  transport_ship: { ship: true, box: { x: -30, y: -42, w: 60, h: 50 }, hull: [27, 7], walkMs: 900, draw: drawTransport },
  catapult_ship: { ship: true, box: { x: -36, y: -40, w: 74, h: 48 }, hull: [34, 7], walkMs: 900, draw: drawCatapultShip },
  falcon_scout: { air: true, box: { x: -15, y: -20, w: 28, h: 30 }, shadow: [7, 2.6], flapMs: 300, draw: drawFalcon },
  gryphon_rider: { air: true, box: { x: -26, y: -34, w: 50, h: 46 }, shadow: [13, 4], flapMs: 520, draw: drawGryphon },
  storm_wyvern: { air: true, box: { x: -38, y: -36, w: 72, h: 52 }, shadow: [18, 5], flapMs: 640, draw: drawWyvern },
};

/** 솔라리온 발밑의 새벽의 오라 */
function auraRing(ctx, x, y, t) {
  const pulse = 0.55 + 0.45 * Math.sin(t / 320);
  ctx.strokeStyle = `rgba(246, 206, 110, ${0.22 + pulse * 0.25})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x, y, 30, 14, 0, 0, TAU);
  ctx.stroke();
}

/** 에테리아 둘레를 도는 별 */
function orbitStars(ctx, x, y, t, u) {
  const spin = t / 700 + u.id;
  for (let i = 0; i < 3; i++) {
    const a = spin + (i / 3) * TAU;
    const front = Math.sin(a) > 0;
    ctx.fillStyle = `rgba(200, 214, 255, ${front ? 0.95 : 0.45})`;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * 17, y - 24 + Math.sin(a) * 6, front ? 2.4 : 1.8, 0, TAU);
    ctx.fill();
  }
}

// ---------- 그리기 ----------

/** 이 유닛이 지금 어떤 동작인가 */
function poseOf(u, t, art) {
  const since = t - (u.attackAt ?? -1e9);
  if (since >= 0 && since < STRIKE_MS) return { kind: 'strike', frame: Math.min(2, Math.floor((since / STRIKE_MS) * 3)) };
  const walking = u.still != null ? u.still < 8 : u.state === UNIT_STATE.MOVE || u.state === UNIT_STATE.RETURN;
  if (walking) return { kind: 'walk', frame: Math.floor((((t + u.id * 137) % art.walkMs) / art.walkMs) * 4) };
  if (u.state === UNIT_STATE.ATTACK) return { kind: 'ready', frame: 0 };
  if (u.state === UNIT_STATE.GATHER || u.state === UNIT_STATE.BUILD) {
    const phase = ((t + u.id * 97) % 700) / 700;
    return { kind: 'work', frame: phase < 0.45 ? 0 : phase < 0.6 ? 1 : 2 };
  }
  return { kind: 'idle', frame: 0 };
}

const variantKey = (v) => (v ? Object.values(v).join(',') : '');

// 새 그림은 한 프레임에 몇 장까지만 그린다 (큰 싸움이 처음 벌어질 때 한꺼번에 몰려 끊기지 않게).
// 넘치면 이미 그려 둔 서 있는 그림으로 대신하고, 다음 프레임에 마저 그린다
const NEW_SPRITES_PER_FRAME = 6;
let budgetFrame = -1;
let budget = 0;

function spriteOf(u, color, art, pose, v, t) {
  const tail = variantKey(v);
  const key = `${u.type}|${color}|${pose.kind}${pose.frame}|${tail}`;
  const cached = cachedSprite(key);
  if (cached) return cached;
  if (budgetFrame !== t) {
    budgetFrame = t;
    budget = NEW_SPRITES_PER_FRAME;
  }
  if (budget <= 0) {
    const stand = cachedSprite(`${u.type}|${color}|${art.air ? 'fly0' : 'idle0'}|${tail}`);
    if (stand) return stand;
  }
  budget--;
  return sprite(key, art.box, (g) => art.draw(g, pose, palette(color), v));
}

/** 공중 유닛: 날갯짓은 쉬지 않는다 */
function flyPose(u, t, art) {
  const since = t - (u.attackAt ?? -1e9);
  const frame = Math.floor((((t + u.id * 97) % art.flapMs) / art.flapMs) * 4);
  if (since >= 0 && since < STRIKE_MS) return { kind: 'strike', frame: Math.min(2, Math.floor((since / STRIKE_MS) * 3)) };
  return { kind: u.state === UNIT_STATE.ATTACK ? 'ready' : 'fly', frame };
}

/** 배가 지나간 물살 */
function wake(ctx, x, y, dir, len) {
  ctx.strokeStyle = 'rgba(225, 238, 255, 0.4)';
  ctx.lineWidth = 1.5;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x - dir * len * 0.7, y + 3);
    ctx.lineTo(x - dir * len * 1.35, y + 3 + side * 5);
    ctx.stroke();
  }
}

function drawGlows(ctx, entry, x, y, flip, t, u) {
  for (const light of entry.meta?.glow ?? []) {
    const pulse = light.pulse ? 0.75 + 0.25 * Math.sin(t / 260 + u.id) : 1;
    glow(ctx, x + (flip ? -light.x : light.x), y + light.y, light.r, light.color, pulse);
  }
}

/** 그림이 있는 유닛 종류 (테스트: 모든 유닛에 그림이 있어야 한다) */
export const UNIT_ART_TYPES = Object.freeze(Object.keys(ART));

/** 이 유닛이 지금 보여 줄 동작 { kind, frame } */
export function unitPose(u, t) {
  const art = ART[u.type];
  if (!art) return null;
  return art.air ? flyPose(u, t, art) : poseOf(u, t, art);
}

/** 유닛을 (u.drawX, u.drawY) 자리에 그린다. 그린 그림이 있으면 true */
export function drawUnitArt(ctx, u, color, t) {
  const art = ART[u.type];
  if (!art) return false;
  const pose = art.air ? flyPose(u, t, art) : poseOf(u, t, art);
  const v = art.variant?.(u, pose) ?? null;
  const entry = spriteOf(u, color, art, pose, v, t);
  const x = u.drawX * S;
  const flip = (u.facing ?? 1) < 0;

  if (art.air) {
    shadow(ctx, x, u.drawY * S + FOOT, art.shadow[0], art.shadow[1], 0.26);
    const y = u.drawY * S - AIR_ALTITUDE + Math.sin(t / 520 + u.id) * 2;
    blit(ctx, entry, x, y, { flip });
    drawGlows(ctx, entry, x, y, flip, t, u);
    return true;
  }

  if (art.ship) {
    const y = u.drawY * S + 2 + Math.sin(t / 420 + u.id) * 1.2;
    if (pose.kind === 'walk') wake(ctx, x, y, flip ? -1 : 1, art.hull[0]);
    ctx.fillStyle = 'rgba(8, 24, 40, 0.32)';
    ctx.beginPath();
    ctx.ellipse(x, y + 3, art.hull[0] * 1.02, art.hull[1] * 0.6, 0, 0, TAU);
    ctx.fill();
    blit(ctx, entry, x, y, { flip });
    return true;
  }

  const ground = u.drawY * S + FOOT;
  const y = art.float ? ground - 3 + Math.sin(t / 420 + u.id) * art.float : ground;
  art.under?.(ctx, x, ground, t, u);
  shadow(ctx, x, ground - 0.5, art.shadow[0], art.shadow[1]);
  blit(ctx, entry, x, y, { flip });
  drawGlows(ctx, entry, x, y, flip, t, u);
  const flag = entry.meta?.flag;
  if (flag) wavingFlag(ctx, x + (flip ? -flag.x : flag.x), y + flag.y, flag.h, color, t, { flip, seed: u.id });
  art.over?.(ctx, x, y, t, u);
  return true;
}
