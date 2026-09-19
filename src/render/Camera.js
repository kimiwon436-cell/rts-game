import { TILE_SIZE } from '@rune/shared/constants.js';

/**
 * 확대 단계. 512px 지형 청크가 모든 단계에서 정수 픽셀로 떨어지게 골랐다
 * (소수 배율이면 청크 경계에 가는 틈이 보인다).
 */
export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const EDGE_MARGIN = TILE_SIZE * 3;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export class Camera {
  constructor(worldWidth, worldHeight) {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.x = 0; // 화면 왼쪽 위의 월드 좌표
    this.y = 0;
    this.zoomIndex = ZOOM_LEVELS.indexOf(1);
    this.viewWidth = 1; // CSS 픽셀
    this.viewHeight = 1;
  }

  get zoom() {
    return ZOOM_LEVELS[this.zoomIndex];
  }

  setViewport(width, height) {
    const center = this.screenToWorld(this.viewWidth / 2, this.viewHeight / 2);
    this.viewWidth = width;
    this.viewHeight = height;
    this.centerOn(center.x, center.y);
  }

  centerOn(wx, wy) {
    this.x = wx - this.viewWidth / this.zoom / 2;
    this.y = wy - this.viewHeight / this.zoom / 2;
    this.clamp();
  }

  /** 화면 픽셀 단위로 이동한다 */
  pan(dxScreen, dyScreen) {
    this.x += dxScreen / this.zoom;
    this.y += dyScreen / this.zoom;
    this.clamp();
  }

  /** 화면 좌표 (sx, sy)를 기준으로 한 단계 확대(+1) 또는 축소(-1) */
  zoomAt(direction, sx, sy) {
    const next = clamp(this.zoomIndex + direction, 0, ZOOM_LEVELS.length - 1);
    if (next === this.zoomIndex) return;
    const anchor = this.screenToWorld(sx, sy);
    this.zoomIndex = next;
    this.x = anchor.x - sx / this.zoom;
    this.y = anchor.y - sy / this.zoom;
    this.clamp();
  }

  screenToWorld(sx, sy) {
    return { x: this.x + sx / this.zoom, y: this.y + sy / this.zoom };
  }

  worldToScreen(wx, wy) {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom };
  }

  /** 화면에 보이는 월드 영역 */
  visibleRect() {
    return { x: this.x, y: this.y, w: this.viewWidth / this.zoom, h: this.viewHeight / this.zoom };
  }

  clamp() {
    const vw = this.viewWidth / this.zoom;
    const vh = this.viewHeight / this.zoom;
    // 맵보다 화면이 크면 가운데에 두고, 아니면 가장자리 밖으로 3타일까지만 허용한다 (HUD에 가려지는 부분용)
    this.x = vw >= this.worldWidth + EDGE_MARGIN * 2
      ? (this.worldWidth - vw) / 2
      : clamp(this.x, -EDGE_MARGIN, this.worldWidth - vw + EDGE_MARGIN);
    this.y = vh >= this.worldHeight + EDGE_MARGIN * 2
      ? (this.worldHeight - vh) / 2
      : clamp(this.y, -EDGE_MARGIN, this.worldHeight - vh + EDGE_MARGIN);
  }
}
