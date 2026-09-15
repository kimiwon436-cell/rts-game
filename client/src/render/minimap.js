import { PLAYER_COLORS, TILE_SIZE } from '@rune/shared/constants.js';
import { TERRAIN } from '@rune/shared/map/grid.js';

const TERRAIN_COLORS = {
  [TERRAIN.GRASS]: '#4d7a3a',
  [TERRAIN.DIRT]: '#7b6647',
  [TERRAIN.WATER]: '#2e5d86',
  [TERRAIN.ROCK]: '#6c6f73',
  [TERRAIN.TREE]: '#2a4f27',
};
const BASE_REFRESH_MS = 1000;

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * 지형은 1타일 = 1픽셀로 그려 두고(나무가 베이면 1초에 한 번까지 다시 그린다),
 * 금광·건물·유닛·카메라 영역은 매 프레임 겹쳐 그린다. 클릭·드래그로 화면을 옮긴다.
 */
export class Minimap {
  constructor(world, camera, cssSize = 192) {
    this.world = world;
    this.map = world.map;
    this.camera = camera;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(cssSize * dpr);
    this.canvas.height = Math.round(cssSize * dpr);
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', '미니맵. 클릭하거나 드래그하면 그 위치로 화면을 옮깁니다.');
    this.ctx = this.canvas.getContext('2d');
    this.palette = Object.fromEntries(Object.entries(TERRAIN_COLORS).map(([k, hex]) => [k, hexToRgb(hex)]));
    this.base = document.createElement('canvas');
    this.base.width = this.map.width;
    this.base.height = this.map.height;
    this.baseDirty = true;
    this.lastBaseRender = -Infinity;

    let dragging = false;
    const moveCamera = (event) => {
      const r = this.canvas.getBoundingClientRect();
      const tx = ((event.clientX - r.left) / r.width) * this.map.width;
      const ty = ((event.clientY - r.top) / r.height) * this.map.height;
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
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  /** 지형이 바뀌었다 (나무가 베였다) */
  markTerrainDirty() {
    this.baseDirty = true;
  }

  renderBase() {
    const { width, height } = this.map;
    const tiles = this.world.tiles;
    const ctx = this.base.getContext('2d');
    const image = ctx.createImageData(width, height);
    for (let i = 0; i < tiles.length; i++) {
      const [r, g, b] = this.palette[tiles[i]];
      image.data[i * 4] = r;
      image.data[i * 4 + 1] = g;
      image.data[i * 4 + 2] = b;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    ctx.fillStyle = '#9cc0ff';
    for (const w of this.map.wells) ctx.fillRect(w.x, w.y, w.w, w.h);
  }

  draw(timeMs) {
    if (this.baseDirty && timeMs - this.lastBaseRender >= BASE_REFRESH_MS) {
      this.renderBase();
      this.baseDirty = false;
      this.lastBaseRender = timeMs;
    }

    const { ctx, canvas, camera, map, world } = this;
    const k = canvas.width / map.width; // 타일 하나의 픽셀 수
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#e2b53e';
    for (const m of map.goldMines) {
      if (world.mineAmounts.has(m.id)) ctx.fillRect(m.x * k, m.y * k, m.w * k, m.h * k);
    }
    for (const b of world.buildings.values()) {
      ctx.fillStyle = PLAYER_COLORS[b.owner];
      ctx.fillRect(b.x * k, b.y * k, b.size * k, b.size * k);
    }
    const dot = Math.max(2, k * 0.9);
    for (const u of world.units.values()) {
      ctx.fillStyle = PLAYER_COLORS[u.owner];
      ctx.fillRect(u.drawX * k - dot / 2, u.drawY * k - dot / 2, dot, dot);
    }

    const view = camera.visibleRect();
    const px = k / TILE_SIZE;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, canvas.width / 192);
    ctx.strokeRect(view.x * px, view.y * px, view.w * px, view.h * px);
  }
}
