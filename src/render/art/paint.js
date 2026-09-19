// 그림 도구: 색 계산, 모양, 재질(음영).
// 유닛·건물 그림은 한 번 그려 스프라이트로 담아 두므로(sprites.js) 그라디언트를 아끼지 않는다.
// 빛은 왼쪽 위에서 온다: 왼쪽 위가 밝고 오른쪽 아래가 어둡다.

export const TAU = Math.PI * 2;

const parse = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

/** 두 색을 섞는다 (t = 0이면 a, 1이면 b) */
export const mix = (a, b, t) => {
  const x = parse(a);
  const y = parse(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
};
export const lighten = (c, t) => mix(c, '#ffffff', t);
export const darken = (c, t) => mix(c, '#000000', t);
export const rgba = (hex, a) => {
  const [r, g, b] = parse(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/** 한 색의 명암 다섯 단계 */
export function tones(base, spread = 1) {
  return {
    base,
    light: lighten(base, 0.26 * spread),
    lighter: lighten(base, 0.5 * spread),
    dark: darken(base, 0.26 * spread),
    darker: darken(base, 0.48 * spread),
  };
}

// ---------- 자주 쓰는 재질 ----------

export const SKIN = tones('#e8c09a');
export const STEEL = tones('#b3bcc6');
export const IRON = tones('#858f9a');
export const GOLD = tones('#dcae3c');
export const LEATHER = tones('#8a5a33');
export const WOOD = tones('#8b6239');
export const DARK_WOOD = tones('#5e412a');
export const LINEN = tones('#e6dcc3');
export const HAIR = tones('#5b3d26');
export const INK = '#1b1511'; // 외곽선·눈

/** 팀 색 명암. 팀 색은 옷·망토·방패·말 덮개·돛·깃발에 크게 쓴다 */
export const teamTones = (color) => tones(color, 1.05);

// ---------- 모양 ----------

export function ellipsePath(g, x, y, rx, ry, rotation = 0) {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rotation, 0, TAU);
}

export function polyPath(g, points) {
  g.beginPath();
  points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
}

export function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

/** 경로의 바깥 상자 (재질 그라디언트의 기준) */
const box = (x, y, w, h) => ({ x, y, w, h });

// ---------- 재질: (g, 상자) => 칠 ----------

/** 평평한 면: 왼쪽 위 → 오른쪽 아래로 밝음에서 어둠 */
export const lit = (t) => (g, b) => {
  const gr = g.createLinearGradient(b.x, b.y, b.x + b.w * 0.55, b.y + b.h);
  gr.addColorStop(0, t.light);
  gr.addColorStop(0.5, t.base);
  gr.addColorStop(1, t.dark);
  return gr;
};

/** 위에서 아래로만 (벽·옷자락) */
export const vertical = (t) => (g, b) => {
  const gr = g.createLinearGradient(0, b.y, 0, b.y + b.h);
  gr.addColorStop(0, t.light);
  gr.addColorStop(0.55, t.base);
  gr.addColorStop(1, t.dark);
  return gr;
};

/** 둥근 면 (머리·몸통·방패·등껍질): 왼쪽 위에 하이라이트 */
export const round = (t) => (g, b) => {
  const cx = b.x + b.w * 0.36;
  const cy = b.y + b.h * 0.3;
  const r = Math.max(b.w, b.h) * 0.9;
  const gr = g.createRadialGradient(cx, cy, r * 0.04, cx, cy, r);
  gr.addColorStop(0, t.lighter);
  gr.addColorStop(0.32, t.base);
  gr.addColorStop(1, t.darker);
  return gr;
};

/** 쇠: 가운데 위쪽에 밝은 띠가 지나간다 */
export const metal = (t = STEEL) => (g, b) => {
  const gr = g.createLinearGradient(b.x, b.y, b.x + b.w * 0.4, b.y + b.h);
  gr.addColorStop(0, t.light);
  gr.addColorStop(0.28, t.lighter);
  gr.addColorStop(0.5, t.base);
  gr.addColorStop(1, t.darker);
  return gr;
};

function paintOf(g, paint, b) {
  return typeof paint === 'function' ? paint(g, b) : paint;
}

/** 지금 경로를 칠한다 (x, y, w, h: 재질 그라디언트의 기준 상자) */
export function fillPath(g, paint, x, y, w, h) {
  g.fillStyle = paintOf(g, paint, box(x, y, w, h));
  g.fill();
}

// ---------- 칠하기 ----------

export function ellipse(g, x, y, rx, ry, paint, rotation = 0) {
  ellipsePath(g, x, y, rx, ry, rotation);
  g.fillStyle = paintOf(g, paint, box(x - rx, y - ry, rx * 2, ry * 2));
  g.fill();
}

export function circle(g, x, y, r, paint) {
  ellipse(g, x, y, r, r, paint);
}

export function poly(g, points, paint) {
  polyPath(g, points);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  g.fillStyle = paintOf(g, paint, box(x, y, Math.max(...xs) - x, Math.max(...ys) - y));
  g.fill();
}

export function rect(g, x, y, w, h, paint, r = 0) {
  if (r) roundRectPath(g, x, y, w, h, r);
  else {
    g.beginPath();
    g.rect(x, y, w, h);
  }
  g.fillStyle = paintOf(g, paint, box(x, y, w, h));
  g.fill();
}

/** 선 (창대·활시위·끈) */
export function line(g, x1, y1, x2, y2, color, width = 1, cap = 'round') {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = cap;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

/** 굵은 막대 (팔·다리·자루): 밝은 쪽과 어두운 쪽이 있는 원통 */
export function limb(g, x1, y1, x2, y2, width, t) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  let nx = -(y2 - y1) / len;
  let ny = (x2 - x1) / len;
  if (nx + ny > 0) {
    // 빛이 오는 왼쪽 위를 향하게
    nx = -nx;
    ny = -ny;
  }
  const o1 = width * 0.14;
  const o2 = width * 0.26;
  line(g, x1, y1, x2, y2, t.dark, width);
  line(g, x1 + nx * o1, y1 + ny * o1, x2 + nx * o1, y2 + ny * o1, t.base, width * 0.6);
  line(g, x1 + nx * o2, y1 + ny * o2, x2 + nx * o2, y2 + ny * o2, t.light, width * 0.2);
}

/** 곡선 (활·밧줄·꼬리) */
export function curve(g, x1, y1, cx, cy, x2, y2, color, width = 1) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x1, y1);
  g.quadraticCurveTo(cx, cy, x2, y2);
  g.stroke();
}

/** 이미 그린 모양 안에만 그린다 (clipPath를 그리는 함수 → 안쪽을 그리는 함수) */
export function within(g, clipPath, draw) {
  g.save();
  clipPath();
  g.clip();
  draw();
  g.restore();
}

/** 윗면 가장자리의 빛 (모양 위쪽에 얇은 밝은 호) */
export function rim(g, x, y, rx, ry, color = 'rgba(255, 255, 255, 0.45)', width = 0.8) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, Math.PI * 1.08, Math.PI * 1.72);
  g.stroke();
}

/** 결정론적 난수 (같은 그림이 늘 같게) */
export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}
