import { TILE_SIZE } from '@rune/shared/constants.js';
import { TERRAIN } from '@rune/shared/map/grid.js';
import { hash2 } from '@rune/shared/random.js';

export const CHUNK_TILES = 16;
const S = TILE_SIZE;
const CHUNK_PX = CHUNK_TILES * S;

const GRASS = ['#4d7a3a', '#53803e', '#497436', '#577f40'];
const DIRT = ['#7b6647', '#806b4b', '#766143'];
const WATER = ['#2e5d86', '#2a577e'];
const SHORE = '#5a8fb4';

/**
 * 지형을 16×16 타일(512px) 청크 단위로 오프스크린 캔버스에 한 번만 그려 두고,
 * 매 프레임에는 화면에 보이는 청크만 복사한다.
 */
export class TerrainCache {
  /** tiles: 경기 중에 바뀌는 지형 배열 (나무가 베이면 풀밭이 된다) */
  constructor(map, tiles = map.tiles) {
    this.map = map;
    this.tiles = tiles;
    this.chunks = new Map();
    this.chunksX = Math.ceil(map.width / CHUNK_TILES);
    this.chunksY = Math.ceil(map.height / CHUNK_TILES);
  }

  draw(ctx, rect) {
    const x0 = Math.max(0, Math.floor(rect.x / CHUNK_PX));
    const y0 = Math.max(0, Math.floor(rect.y / CHUNK_PX));
    const x1 = Math.min(this.chunksX - 1, Math.floor((rect.x + rect.w) / CHUNK_PX));
    const y1 = Math.min(this.chunksY - 1, Math.floor((rect.y + rect.h) / CHUNK_PX));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        ctx.drawImage(this.chunk(cx, cy), cx * CHUNK_PX, cy * CHUNK_PX);
      }
    }
  }

  chunk(cx, cy) {
    const key = cy * this.chunksX + cx;
    let canvas = this.chunks.get(key);
    if (!canvas) {
      canvas = this.renderChunk(cx, cy);
      this.chunks.set(key, canvas);
    }
    return canvas;
  }

  /** 칸이 바뀌었을 때 그 칸이 든 청크를 다음 프레임에 다시 그리게 한다 */
  invalidateTile(tx, ty) {
    this.chunks.delete(Math.floor(ty / CHUNK_TILES) * this.chunksX + Math.floor(tx / CHUNK_TILES));
  }

  renderChunk(cx, cy) {
    const canvas = document.createElement('canvas');
    canvas.width = CHUNK_PX;
    canvas.height = CHUNK_PX;
    const ctx = canvas.getContext('2d');
    const tx0 = cx * CHUNK_TILES;
    const ty0 = cy * CHUNK_TILES;
    const tx1 = Math.min(tx0 + CHUNK_TILES, this.map.width);
    const ty1 = Math.min(ty0 + CHUNK_TILES, this.map.height);

    // 바닥을 먼저 다 깔고, 그 위에 나무와 바위를 올린다
    for (let ty = ty0; ty < ty1; ty++) {
      for (let tx = tx0; tx < tx1; tx++) this.drawGround(ctx, tx, ty, (tx - tx0) * S, (ty - ty0) * S);
    }
    for (let ty = ty0; ty < ty1; ty++) {
      for (let tx = tx0; tx < tx1; tx++) this.drawProp(ctx, tx, ty, (tx - tx0) * S, (ty - ty0) * S);
    }
    return canvas;
  }

  terrainAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) return -1;
    return this.tiles[ty * this.map.width + tx];
  }

  drawGround(ctx, tx, ty, px, py) {
    const t = this.terrainAt(tx, ty);
    const r = hash2(tx, ty, 1);

    if (t === TERRAIN.WATER) {
      ctx.fillStyle = WATER[r < 0.5 ? 0 : 1];
      ctx.fillRect(px, py, S, S);
      ctx.fillStyle = SHORE;
      if (this.terrainAt(tx, ty - 1) !== TERRAIN.WATER) ctx.fillRect(px, py, S, 3);
      if (this.terrainAt(tx, ty + 1) !== TERRAIN.WATER) ctx.fillRect(px, py + S - 3, S, 3);
      if (this.terrainAt(tx - 1, ty) !== TERRAIN.WATER) ctx.fillRect(px, py, 3, S);
      if (this.terrainAt(tx + 1, ty) !== TERRAIN.WATER) ctx.fillRect(px + S - 3, py, 3, S);
      if (r > 0.6) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.fillRect(px + 6 + Math.floor(r * 12), py + 10 + Math.floor(hash2(tx, ty, 2) * 12), 9, 2);
      }
      return;
    }

    if (t === TERRAIN.DIRT) {
      ctx.fillStyle = DIRT[Math.floor(r * DIRT.length)];
      ctx.fillRect(px, py, S, S);
      ctx.fillStyle = 'rgba(255, 238, 205, 0.13)';
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(px + Math.floor(hash2(tx, ty, 10 + i) * 29), py + Math.floor(hash2(tx, ty, 20 + i) * 29), 2, 2);
      }
      return;
    }

    // 풀밭 (나무와 바위 칸도 바닥은 풀밭)
    ctx.fillStyle = GRASS[Math.floor(r * GRASS.length)];
    ctx.fillRect(px, py, S, S);
    ctx.fillStyle = 'rgba(22, 42, 16, 0.28)';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(px + Math.floor(hash2(tx, ty, 30 + i) * 30), py + Math.floor(hash2(tx, ty, 40 + i) * 29), 2, 3);
    }
    if (t === TERRAIN.GRASS && hash2(tx, ty, 50) > 0.965) {
      ctx.fillStyle = hash2(tx, ty, 51) > 0.5 ? '#e8d27a' : '#d9dfe8';
      ctx.fillRect(px + 8 + Math.floor(hash2(tx, ty, 52) * 16), py + 8 + Math.floor(hash2(tx, ty, 53) * 16), 3, 3);
    }
  }

  drawProp(ctx, tx, ty, px, py) {
    const t = this.terrainAt(tx, ty);

    if (t === TERRAIN.ROCK) {
      const up = this.terrainAt(tx, ty - 1) === TERRAIN.ROCK;
      const down = this.terrainAt(tx, ty + 1) === TERRAIN.ROCK;
      const left = this.terrainAt(tx - 1, ty) === TERRAIN.ROCK;
      const right = this.terrainAt(tx + 1, ty) === TERRAIN.ROCK;
      const x = px + (left ? 0 : 3);
      const y = py + (up ? 0 : 3);
      const w = S - (left ? 0 : 3) - (right ? 0 : 3);
      const h = S - (up ? 0 : 3) - (down ? 0 : 3);
      ctx.fillStyle = '#676a6e';
      ctx.fillRect(x, y, w, h);
      if (!up) {
        ctx.fillStyle = '#8b8e92';
        ctx.fillRect(x, y, w, 5);
      }
      if (!down) {
        ctx.fillStyle = '#46494d';
        ctx.fillRect(x, y + h - 6, w, 6);
      }
      ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
      ctx.fillRect(px + 6 + Math.floor(hash2(tx, ty, 60) * 16), py + 10 + Math.floor(hash2(tx, ty, 61) * 10), 6, 2);
      return;
    }

    if (t === TERRAIN.TREE) {
      const jx = Math.floor(hash2(tx, ty, 70) * 5) - 2;
      const jy = Math.floor(hash2(tx, ty, 71) * 4) - 2;
      const radius = 10 + Math.floor(hash2(tx, ty, 72) * 3);
      const cx = px + 16 + jx;
      const cy = py + 14 + jy;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.beginPath();
      ctx.ellipse(px + 16, py + 27, 11, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#4a3524';
      ctx.fillRect(px + 14, py + 18, 4, 9);

      ctx.fillStyle = '#2b5228';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#3b6d33';
      ctx.beginPath();
      ctx.arc(cx - 3, cy - 3, radius * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
