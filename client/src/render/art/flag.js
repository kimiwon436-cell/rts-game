// 펄럭이는 팀 깃발. 바람에 움직여야 하니 스프라이트로 담지 않고 매 프레임 그린다 (깃발은 몇 개뿐이라 가볍다).
import { TAU } from './paint.js';

/**
 * 깃대 아래 끝이 (x, y), 높이 h. 제비꼬리 깃발이 flip이면 왼쪽으로 날린다.
 * @param {{ flip?: boolean, width?: number, seed?: number }} [options] seed: 깃발마다 물결이 어긋나게
 */
export function wavingFlag(ctx, x, y, h, color, t, { flip = false, width = h * 0.72, seed = 0 } = {}) {
  const dir = flip ? -1 : 1;
  const top = y - h;
  const cloth = Math.max(4, h * 0.42);
  const wave = (k, phase) => Math.sin(t / 190 + seed * 1.7 + k * 4.2 + phase) * 1.5 * k;

  ctx.lineCap = 'round';
  ctx.strokeStyle = '#2b221a';
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, top - 1.5);
  ctx.stroke();

  const n = 6;
  ctx.beginPath();
  ctx.moveTo(x, top);
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    ctx.lineTo(x + dir * width * k, top + wave(k, 0));
  }
  ctx.lineTo(x + dir * width * 0.8, top + cloth / 2 + wave(0.8, 0.3)); // 제비꼬리
  for (let i = n; i >= 0; i--) {
    const k = i / n;
    ctx.lineTo(x + dir * width * k, top + cloth + wave(k, 0.6));
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // 주름: 물결의 골마다 그늘, 윗단에 빛
  for (let i = 1; i < n; i += 2) {
    const k = i / n;
    const shade = 0.12 + 0.12 * Math.sin(t / 190 + seed * 1.7 + k * 4.2);
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.max(0, shade)})`;
    ctx.fillRect(x + dir * width * (k - 0.08) - (dir < 0 ? width * 0.16 : 0), top - 3, width * 0.16, cloth + 6);
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.fillRect(x - (dir < 0 ? width : 0), top - 3, width, 3.6);
  ctx.restore();
  ctx.strokeStyle = 'rgba(27, 21, 17, 0.9)';
  ctx.lineWidth = 0.9;
  ctx.stroke();

  ctx.fillStyle = '#e2b53e';
  ctx.beginPath();
  ctx.arc(x, top - 1.8, 1.5, 0, TAU);
  ctx.fill();
}
