import { PLAYER_COLORS, TILE_SIZE } from '@rune/shared/constants.js';
import { TERRAIN } from '@rune/shared/map/grid.js';

const TERRAIN_COLORS = {
  [TERRAIN.GRASS]: '#4d7a3a',
  [TERRAIN.DIRT]: '#7b6647',
  [TERRAIN.WATER]: '#2e5d86',
  [TERRAIN.ROCK]: '#6c6f73',
  [TERRAIN.TREE]: '#2a4f27',
};

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** 맵 전체를 1타일 = 1픽셀로 그려 두고 카메라 영역을 겹쳐 보여준다. 클릭·드래그로 화면을 옮긴다. */
export class Minimap {
  constructor(map, camera, cssSize = 192) {
    this.map = map;
    this.camera = camera;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(cssSize * dpr);
    this.canvas.height = Math.round(cssSize * dpr);
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', '미니맵. 클릭하거나 드래그하면 그 위치로 화면을 옮깁니다.');
    this.ctx = this.canvas.getContext('2d');
    this.base = this.renderBase();

    let dragging = false;
    const moveCamera = (event) => {
      const r = this.canvas.getBoundingClientRect();
      const tx = ((event.clientX - r.left) / r.width) * map.width;
      const ty = ((event.clientY - r.top) / r.height) * map.height;
      camera.centerOn(tx * TILE_SIZE, ty * TILE_SIZE);
    };
    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      dragging = true;
      this.canvas.setPointerCapture(event.pointerId);
      moveCamera(event);
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (dragging) moveCamera(event);
    });
    this.canvas.addEventListener('pointerup', () => {
      dragging = false;
    });
  }

  renderBase() {
    const { width, height, tiles } = this.map;
    const base = document.createElement('canvas');
    base.width = width;
    base.height = height;
    const ctx = base.getContext('2d');

    const image = ctx.createImageData(width, height);
    const palette = Object.fromEntries(Object.entries(TERRAIN_COLORS).map(([k, hex]) => [k, hexToRgb(hex)]));
    for (let i = 0; i < tiles.length; i++) {
      const [r, g, b] = palette[tiles[i]];
      image.data[i * 4] = r;
      image.data[i * 4 + 1] = g;
      image.data[i * 4 + 2] = b;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);

    ctx.fillStyle = '#e2b53e';
    for (const m of this.map.goldMines) ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.fillStyle = '#9cc0ff';
    for (const w of this.map.wells) ctx.fillRect(w.x, w.y, w.w, w.h);
    for (const { slot, keep } of this.map.starts) {
      ctx.fillStyle = PLAYER_COLORS[slot];
      ctx.fillRect(keep.x - 1, keep.y - 1, keep.w + 2, keep.h + 2);
    }
    return base;
  }

  draw() {
    const { ctx, canvas, camera, map } = this;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0, canvas.width, canvas.height);

    const k = canvas.width / (map.width * TILE_SIZE);
    const view = camera.visibleRect();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, canvas.width / 192);
    ctx.strokeRect(view.x * k, view.y * k, view.w * k, view.h * k);
  }
}
