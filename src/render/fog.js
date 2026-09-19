/**
 * 전장의 안개 그림. 1타일 = 1픽셀 캔버스에 칸마다 어둡기를 칠해 두고, 월드와 미니맵 위에 늘려 그린다.
 * 늘릴 때 부드럽게 보간되어 시야 경계가 번진 듯 보인다.
 * - 지금 보이는 칸: 투명
 * - 본 적 있는 칸: 반쯤 어둡게 (지형과 마지막으로 본 건물이 비친다)
 * - 한 번도 못 본 칸: 더 어둡게
 */
const FOG_RGB = [6, 8, 12];
export const FOG_ALPHA = Object.freeze({ visible: 0, explored: 125, unexplored: 205 });
const REBUILD_MS = 100;

export class FogLayer {
  constructor(map) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = map.width;
    this.canvas.height = map.height;
    this.ctx = this.canvas.getContext('2d');
    this.image = this.ctx.createImageData(map.width, map.height);
    const data = this.image.data;
    for (let i = 0; i < map.width * map.height; i++) {
      data[i * 4] = FOG_RGB[0];
      data[i * 4 + 1] = FOG_RGB[1];
      data[i * 4 + 2] = FOG_RGB[2];
      data[i * 4 + 3] = FOG_ALPHA.unexplored;
    }
    this.version = -1;
    this.builtAt = -Infinity;
  }

  /** 시야가 바뀌었으면 다시 칠한다 (0.1초에 한 번까지) */
  update(vision, team, now) {
    if (vision.version === this.version || now - this.builtAt < REBUILD_MS) return;
    this.version = vision.version;
    this.builtAt = now;
    const counts = vision.counts[team];
    const explored = vision.explored[team];
    const data = this.image.data;
    for (let i = 0; i < counts.length; i++) {
      data[i * 4 + 3] = counts[i] > 0 ? FOG_ALPHA.visible : explored[i] ? FOG_ALPHA.explored : FOG_ALPHA.unexplored;
    }
    this.ctx.putImageData(this.image, 0, 0);
  }

  /**
   * (x, y)에서 w×h 크기로 늘려 그린다.
   * extend를 주면 가장자리 줄을 바깥으로 그만큼 늘여 그린다 — 맵 밖 바다가 맵 가장자리와 같은 어둡기로 이어진다.
   */
  draw(ctx, x, y, w, h, smooth = true, extend = 0) {
    const previous = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = smooth;
    const { canvas } = this;
    ctx.drawImage(canvas, x, y, w, h);
    if (extend > 0) {
      const cw = canvas.width;
      const ch = canvas.height;
      ctx.drawImage(canvas, 0, 0, 1, ch, x - extend, y, extend, h); // 왼쪽
      ctx.drawImage(canvas, cw - 1, 0, 1, ch, x + w, y, extend, h); // 오른쪽
      ctx.drawImage(canvas, 0, 0, cw, 1, x, y - extend, w, extend); // 위
      ctx.drawImage(canvas, 0, ch - 1, cw, 1, x, y + h, w, extend); // 아래
      ctx.drawImage(canvas, 0, 0, 1, 1, x - extend, y - extend, extend, extend);
      ctx.drawImage(canvas, cw - 1, 0, 1, 1, x + w, y - extend, extend, extend);
      ctx.drawImage(canvas, 0, ch - 1, 1, 1, x - extend, y + h, extend, extend);
      ctx.drawImage(canvas, cw - 1, ch - 1, 1, 1, x + w, y + h, extend, extend);
    }
    ctx.imageSmoothingEnabled = previous;
  }
}
