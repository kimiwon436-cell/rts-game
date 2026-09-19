// 스프라이트: 유닛·건물 그림을 처음 쓸 때 한 번 그려 오프스크린 캔버스에 담아 두고, 매 프레임에는 복사만 한다.
// 그래서 그림을 공들여 그려도(그라디언트·외곽선) 경기 중 비용은 그림 한 장 복사다.
// - 해상도: 월드 1px = RES px (확대해도 뭉개지지 않게)
// - 외곽선: 다 그린 뒤 실루엣 둘레에 짙은 선을 두른다 (작은 크기에서도 모양이 또렷하게)
import { INK, TAU } from './paint.js';

export const RES = 2;
const PAD = 3; // 외곽선이 들어갈 여백 (스프라이트 px)
const MAX_SPRITES = 2500; // 넘으면 비우고 다시 그린다 (색·동작이 아주 많을 때 메모리 상한)

const cache = new Map();

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

/** 실루엣 둘레에 width(스프라이트 px) 굵기의 선을 두른 새 캔버스 */
function outlined(source, width, color) {
  const out = makeCanvas(source.width, source.height);
  const o = out.getContext('2d');
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    o.drawImage(source, Math.cos(a) * width, Math.sin(a) * width);
  }
  o.globalCompositeOperation = 'source-in';
  o.fillStyle = color;
  o.fillRect(0, 0, out.width, out.height);
  o.globalCompositeOperation = 'source-over';
  o.drawImage(source, 0, 0);
  return out;
}

/**
 * 스프라이트를 꺼낸다. 없으면 draw로 그려 담는다.
 * @param {string} key 모양이 같으면 같은 열쇠 (종류·색·동작·프레임)
 * @param {{ x: number, y: number, w: number, h: number }} box 기준점(0,0)에서 본 그림 영역 (월드 px)
 * @param {(g: CanvasRenderingContext2D) => void} draw 기준점 좌표계로 그린다
 * @param {{ outline?: number }} [options] outline: 외곽선 굵기 (월드 px, 0이면 없음)
 */
export function sprite(key, box, draw, { outline = 1 } = {}) {
  let entry = cache.get(key);
  if (entry) return entry;
  if (cache.size >= MAX_SPRITES) cache.clear();
  const w = Math.ceil(box.w * RES) + PAD * 2;
  const h = Math.ceil(box.h * RES) + PAD * 2;
  let canvas = makeCanvas(w, h);
  const g = canvas.getContext('2d');
  g.setTransform(RES, 0, 0, RES, PAD - box.x * RES, PAD - box.y * RES);
  g.lineJoin = 'round';
  const meta = draw(g); // 그림이 알려 주는 자리 (빛나는 곳 등, 기준점 좌표)
  if (outline) canvas = outlined(canvas, outline * RES, INK);
  entry = { canvas, x: box.x - PAD / RES, y: box.y - PAD / RES, w: w / RES, h: h / RES, meta };
  cache.set(key, entry);
  return entry;
}

/**
 * 스프라이트를 (x, y)에 그린다. flip이면 좌우를 뒤집는다 (왼쪽을 볼 때).
 * clipTop: 위에서부터 이만큼(0–1)은 그리지 않는다 (짓는 중인 건물이 아래부터 차오른다)
 */
export function blit(ctx, entry, x, y, { flip = false, alpha = 1, clipTop = 0 } = {}) {
  if (alpha !== 1) ctx.globalAlpha = alpha;
  if (clipTop > 0) {
    const skip = Math.min(entry.h, entry.h * clipTop);
    const sy = skip * RES;
    ctx.drawImage(entry.canvas, 0, sy, entry.canvas.width, entry.canvas.height - sy, x + entry.x, y + entry.y + skip, entry.w, entry.h - skip);
  } else if (flip) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(-1, 1);
    ctx.drawImage(entry.canvas, entry.x, entry.y, entry.w, entry.h);
    ctx.restore();
  } else {
    ctx.drawImage(entry.canvas, x + entry.x, y + entry.y, entry.w, entry.h);
  }
  if (alpha !== 1) ctx.globalAlpha = 1;
}

/** 부드러운 발밑 그림자 (크기별로 한 장) */
export function shadow(ctx, x, y, rx, ry, alpha = 0.34) {
  const key = `shadow:${Math.round(rx * 2)}:${Math.round(ry * 2)}`;
  const entry = sprite(
    key,
    { x: -rx - 2, y: -ry - 2, w: rx * 2 + 4, h: ry * 2 + 4 },
    (g) => {
      g.save();
      g.scale(1, ry / rx);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx + 1.5);
      gr.addColorStop(0, 'rgba(0, 0, 0, 1)');
      gr.addColorStop(0.55, 'rgba(0, 0, 0, 0.75)');
      gr.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(0, 0, rx + 1.5, 0, TAU);
      g.fill();
      g.restore();
    },
    { outline: 0 },
  );
  blit(ctx, entry, x, y, { alpha });
}

/** 빛 번짐 (마법 구슬·룬). 'lighter'로 더해 그린다. 색·크기별로 한 장 */
export function glow(ctx, x, y, radius, color, alpha = 1) {
  const r = Math.max(2, Math.round(radius));
  const entry = sprite(
    `glow:${color}:${r}`,
    { x: -r, y: -r, w: r * 2, h: r * 2 },
    (g) => {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
      gr.addColorStop(0, color);
      gr.addColorStop(0.35, color.replace(/[\d.]+\)$/, '0.45)'));
      gr.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.fill();
    },
    { outline: 0 },
  );
  const previous = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  blit(ctx, entry, x, y, { alpha });
  ctx.globalCompositeOperation = previous;
}

/** 이미 그려 둔 스프라이트 (없으면 null) */
export const cachedSprite = (key) => cache.get(key) ?? null;
export const spriteCount = () => cache.size;
export const clearSprites = () => cache.clear();
