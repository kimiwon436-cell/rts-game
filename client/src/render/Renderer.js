import { PLAYER_COLORS, TILE_SIZE } from '@rune/shared/constants.js';
import { TerrainCache } from './terrain.js';

const S = TILE_SIZE;
const TAU = Math.PI * 2;
const GOLD_NUGGETS = [
  [-14, -6, 5],
  [4, -11, 4],
  [14, 5, 5],
  [-3, 8, 4],
  [-19, 9, 3],
];

const intersects = (rect, x, y, w, h) => x < rect.x + rect.w && x + w > rect.x && y < rect.y + rect.h && y + h > rect.y;

function fillCircle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function fillEllipse(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
}

/** 월드(지형·시설)를 캔버스에 그린다. 3-2부터 서버가 보낸 유닛·건물이 여기에 더해진다. */
export class Renderer {
  constructor(canvas, map, camera, players) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.map = map;
    this.camera = camera;
    this.players = players;
    this.terrain = new TerrainCache(map);
    this.dpr = 1;
    this.hoverTile = null;
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.camera.setViewport(width, height);
  }

  draw(timeMs) {
    const { ctx, camera } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // 월드 좌표계. 이동량을 기기 픽셀 단위로 반올림해 청크 경계가 벌어지지 않게 한다
    const scale = camera.zoom * this.dpr;
    ctx.setTransform(scale, 0, 0, scale, -Math.round(camera.x * scale), -Math.round(camera.y * scale));

    const view = camera.visibleRect();
    this.terrain.draw(ctx, view);
    this.drawMapBorder(ctx);
    this.drawGoldMines(ctx, view);
    this.drawWells(ctx, view, timeMs);
    this.drawStarts(ctx, view);
    this.drawHover(ctx);
  }

  drawMapBorder(ctx) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 4 / this.camera.zoom;
    ctx.strokeRect(0, 0, this.map.width * S, this.map.height * S);
  }

  drawGoldMines(ctx, view) {
    for (const mine of this.map.goldMines) {
      const x = mine.x * S;
      const y = mine.y * S;
      const w = mine.w * S;
      const h = mine.h * S;
      if (!intersects(view, x, y, w, h)) continue;
      const cx = x + w / 2;
      const cy = y + h / 2;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      fillEllipse(ctx, cx, cy + h * 0.3, w * 0.46, h * 0.15);
      ctx.fillStyle = '#5e554b';
      fillEllipse(ctx, cx, cy + 6, w * 0.42, h * 0.34);
      ctx.fillStyle = '#716658';
      fillEllipse(ctx, cx - 10, cy - 2, w * 0.26, h * 0.24);
      ctx.fillStyle = '#7d7163';
      fillEllipse(ctx, cx + 12, cy + 4, w * 0.2, h * 0.18);

      for (const [ox, oy, r] of GOLD_NUGGETS) {
        ctx.fillStyle = '#d9a93a';
        fillCircle(ctx, cx + ox, cy + oy, r);
        ctx.fillStyle = '#f5d67a';
        fillCircle(ctx, cx + ox - r * 0.3, cy + oy - r * 0.3, r * 0.4);
      }
    }
  }

  drawWells(ctx, view, timeMs) {
    for (const well of this.map.wells) {
      const size = well.w * S;
      const x = well.x * S;
      const y = well.y * S;
      if (!intersects(view, x - S, y - S, size + S * 2, size + S * 2)) continue;

      const cx = x + size / 2;
      const cy = y + size / 2;
      const primordial = well.kind === 'primordial';
      const pulse = 0.5 + 0.5 * Math.sin(timeMs / 700 + well.x + well.y);

      const glowRadius = size * (primordial ? 1.35 : 0.95);
      const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, glowRadius);
      glow.addColorStop(0, `rgba(120, 170, 255, ${0.4 + pulse * 0.2})`);
      glow.addColorStop(1, 'rgba(120, 170, 255, 0)');
      ctx.fillStyle = glow;
      fillCircle(ctx, cx, cy, glowRadius);

      ctx.fillStyle = '#4d535d';
      fillCircle(ctx, cx, cy, size * 0.44);
      ctx.fillStyle = '#23457a';
      fillCircle(ctx, cx, cy, size * 0.33);
      ctx.fillStyle = `rgba(165, 205, 255, ${0.55 + pulse * 0.35})`;
      fillCircle(ctx, cx, cy, size * 0.14);

      // 테두리의 룬 눈금이 천천히 돈다
      ctx.strokeStyle = primordial ? '#e7c25a' : '#a4bde8';
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + timeMs / 4000;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * size * 0.36, cy + Math.sin(a) * size * 0.36);
        ctx.lineTo(cx + Math.cos(a) * size * 0.43, cy + Math.sin(a) * size * 0.43);
        ctx.stroke();
      }
    }
  }

  /** 시작 위치의 영주관 자리. 3-2에서 서버가 보낸 실제 건물로 바뀐다. */
  drawStarts(ctx, view) {
    for (const { slot, keep } of this.map.starts) {
      const x = keep.x * S;
      const y = keep.y * S;
      const w = keep.w * S;
      const h = keep.h * S;
      if (!intersects(view, x - S * 3, y - S, w + S * 6, h + S * 2)) continue;

      const cx = x + w / 2;
      const cy = y + h / 2;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(x + 10, y + h - 8, w - 12, 10);
      ctx.fillStyle = '#7d766c';
      ctx.fillRect(x + 6, y + 10, w - 12, h - 16);
      ctx.fillStyle = '#948c80';
      ctx.fillRect(x + 6, y + 10, w - 12, 6);

      ctx.fillStyle = '#6a645b';
      for (const [ox, oy] of [[2, 4], [w - 24, 4], [2, h - 26], [w - 24, h - 26]]) ctx.fillRect(x + ox, y + oy, 22, 22);

      ctx.fillStyle = '#a39a8c';
      ctx.fillRect(cx - 22, cy - 24, 44, 42);
      ctx.fillStyle = '#b3aa9b';
      ctx.fillRect(cx - 22, cy - 24, 44, 6);
      ctx.fillStyle = '#4f4a43';
      ctx.fillRect(cx - 7, cy + 4, 14, 14);

      ctx.fillStyle = '#3a342d';
      ctx.fillRect(cx - 1, cy - 50, 2, 28);
      ctx.fillStyle = PLAYER_COLORS[slot];
      ctx.beginPath();
      ctx.moveTo(cx + 1, cy - 50);
      ctx.lineTo(cx + 22, cy - 44);
      ctx.lineTo(cx + 1, cy - 38);
      ctx.closePath();
      ctx.fill();

      const player = this.players.find((p) => p.slot === slot);
      if (player) this.drawLabel(ctx, `P${slot + 1} ${player.nickname}`, cx, y - 8, PLAYER_COLORS[slot]);
    }
  }

  drawLabel(ctx, text, x, y, color) {
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

  drawHover(ctx) {
    const tile = this.hoverTile;
    if (!tile || tile.x < 0 || tile.y < 0 || tile.x >= this.map.width || tile.y >= this.map.height) return;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1 / this.camera.zoom;
    ctx.strokeRect(tile.x * S, tile.y * S, S, S);
  }
}
