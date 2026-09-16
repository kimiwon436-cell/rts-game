import { PLAYER_COLORS, TILE_SIZE } from '@rune/shared/constants.js';
import { BUILDINGS } from '@rune/shared/data/buildings.js';
import { UNITS } from '@rune/shared/data/units.js';
import { ABILITIES } from '@rune/shared/data/abilities.js';
import { TerrainCache } from './terrain.js';
import {
  drawBuilding,
  drawEffect,
  drawGoldMine,
  drawHealthBar,
  drawLabel,
  drawRally,
  drawSelectionRing,
  drawUnit,
} from './entities.js';

const S = TILE_SIZE;
const TAU = Math.PI * 2;
const MARKER_MS = 550;
const MARKER_COLORS = { move: '120, 230, 140', work: '226, 181, 62', place: '226, 181, 62', attack: '235, 90, 80' };

const intersects = (rect, x, y, w, h) => x < rect.x + rect.w && x + w > rect.x && y < rect.y + rect.h && y + h > rect.y;

function fillCircle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

/** 월드를 캔버스에 그린다: 지형 → 금광·마나 샘 → 건물 → 유닛 → 선택·배치 미리보기 → 표시 */
export class Renderer {
  constructor(canvas, world, camera, players) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;
    this.map = world.map;
    this.camera = camera;
    this.players = players;
    this.terrain = new TerrainCache(world.map, world.tiles);
    this.initialMineAmount = new Map(world.map.goldMines.map((m) => [m.id, m.amount]));
    this.dpr = 1;

    // GameView가 매 프레임 채우는 상태
    this.hoverTile = null;
    this.selection = new Set(); // 유닛·건물 id(숫자) 또는 금광 id(문자열)
    this.ghost = null; // { type, x, y, valid }
    this.dragBox = null; // 화면 좌표 { x0, y0, x1, y1 }
    this.markers = [];
    this.attackCursor = null; // 공격 이동 지점을 고르는 중이면 마우스 위치 (타일 좌표)
    this.castCursor = null; // 능력 쓸 곳을 고르는 중이면 { x, y, ability }
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.camera.setViewport(width, height);
  }

  /** 명령을 내린 자리에 잠깐 퍼지는 고리. kind: 'move' | 'work' | 'place' */
  addMarker(x, y, kind) {
    this.markers.push({ x, y, kind, start: performance.now() });
  }

  draw(timeMs) {
    const { ctx, camera } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // 이동량을 기기 픽셀 단위로 반올림해 지형 청크 경계가 벌어지지 않게 한다
    const scale = camera.zoom * this.dpr;
    ctx.setTransform(scale, 0, 0, scale, -Math.round(camera.x * scale), -Math.round(camera.y * scale));
    const view = camera.visibleRect();

    this.terrain.draw(ctx, view);
    this.drawMapBorder(ctx);
    this.drawMines(ctx, view);
    this.drawWells(ctx, view, timeMs);
    this.drawBuildings(ctx, view, timeMs);
    this.drawUnits(ctx, view, timeMs);
    this.drawHealthBars(ctx, view);
    this.drawCastCursor(ctx, timeMs);
    this.drawSelection(ctx);
    this.drawEffects(ctx);
    this.drawGhost(ctx, timeMs);
    this.drawMarkers(ctx, timeMs);
    this.drawAttackCursor(ctx, timeMs);
    this.drawHover(ctx);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawDragBox(ctx);
  }

  drawMapBorder(ctx) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 4 / this.camera.zoom;
    ctx.strokeRect(0, 0, this.map.width * S, this.map.height * S);
  }

  drawMines(ctx, view) {
    for (const mine of this.map.goldMines) {
      const amount = this.world.mineAmounts.get(mine.id);
      if (amount === undefined || !intersects(view, mine.x * S, mine.y * S, mine.w * S, mine.h * S)) continue;
      drawGoldMine(ctx, mine, amount, this.initialMineAmount.get(mine.id));
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

      if (this.world.isWellTaken(well.id)) continue; // 오벨리스크가 그 위에 그려진다

      ctx.fillStyle = '#4d535d';
      fillCircle(ctx, cx, cy, size * 0.44);
      ctx.fillStyle = '#23457a';
      fillCircle(ctx, cx, cy, size * 0.33);
      ctx.fillStyle = `rgba(165, 205, 255, ${0.55 + pulse * 0.35})`;
      fillCircle(ctx, cx, cy, size * 0.14);

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

  drawBuildings(ctx, view, timeMs) {
    const visible = [...this.world.buildings.values()]
      .filter((b) => intersects(view, b.x * S - S, b.y * S - S * 2, (b.size + 2) * S, (b.size + 3) * S))
      .sort((a, b) => a.y + a.size - (b.y + b.size));

    for (const b of visible) {
      drawBuilding(ctx, b, PLAYER_COLORS[b.owner], timeMs, this.world.ages.get(b.owner) ?? 1);
      if (b.type === 'keep') {
        const player = this.players.find((p) => p.slot === b.owner);
        if (player) drawLabel(ctx, `P${b.owner + 1} ${player.nickname}`, (b.x + b.size / 2) * S, b.y * S - 8, PLAYER_COLORS[b.owner]);
      }
    }
  }

  drawUnits(ctx, view, timeMs) {
    const visible = [...this.world.units.values()]
      .filter((u) => intersects(view, u.drawX * S - S, u.drawY * S - S, S * 2, S * 2))
      .sort((a, b) => a.drawY - b.drawY);
    for (const u of visible) drawUnit(ctx, u, PLAYER_COLORS[u.owner], timeMs);
  }

  /** 다친 유닛·건물은 선택하지 않아도 체력 막대를 보여준다 (선택한 것은 drawSelection이 그린다) */
  drawHealthBars(ctx, view) {
    for (const unit of this.world.units.values()) {
      const max = UNITS[unit.type].hp;
      if (unit.hp >= max || unit.carried || this.selection.has(unit.id)) continue;
      const x = unit.drawX * S;
      const y = unit.drawY * S;
      if (!intersects(view, x - S, y - S, S * 2, S * 2)) continue;
      drawHealthBar(ctx, x, y - 26, Math.max(20, UNITS[unit.type].radius * S * 2), unit.hp / max);
    }
    for (const b of this.world.buildings.values()) {
      const max = BUILDINGS[b.type].hp;
      if (!b.complete || b.hp >= max || this.selection.has(b.id)) continue;
      if (!intersects(view, b.x * S, b.y * S, b.size * S, b.size * S)) continue;
      drawHealthBar(ctx, (b.x + b.size / 2) * S, b.y * S + b.size * S + 4, b.size * S * 0.6, b.hp / max);
    }
  }

  drawEffects(ctx) {
    const now = performance.now();
    this.world.effects = this.world.effects.filter((effect) => drawEffect(ctx, effect, now));
  }

  /** 능력 범위 미리보기 (성좌 붕괴·시간의 결계는 반경, 여명 돌격은 방향선) */
  drawCastCursor(ctx, timeMs) {
    const cursor = this.castCursor;
    if (!cursor) return;
    const ability = ABILITIES[cursor.ability];
    const x = cursor.x * S;
    const y = cursor.y * S;
    ctx.strokeStyle = `rgba(160, 200, 255, ${0.7 + 0.25 * Math.sin(timeMs / 180)})`;
    ctx.lineWidth = 2;
    if (ability.radius) {
      ctx.beginPath();
      ctx.arc(x, y, ability.radius * S, 0, TAU);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, TAU);
    ctx.stroke();
  }

  drawAttackCursor(ctx, timeMs) {
    const cursor = this.attackCursor;
    if (!cursor) return;
    const x = cursor.x * S;
    const y = cursor.y * S;
    const r = 10 + Math.sin(timeMs / 150) * 1.5;
    ctx.strokeStyle = 'rgba(235, 90, 80, 0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.moveTo(x - r - 5, y);
    ctx.lineTo(x - r + 4, y);
    ctx.moveTo(x + r - 4, y);
    ctx.lineTo(x + r + 5, y);
    ctx.moveTo(x, y - r - 5);
    ctx.lineTo(x, y - r + 4);
    ctx.moveTo(x, y + r - 4);
    ctx.lineTo(x, y + r + 5);
    ctx.stroke();
  }

  drawSelection(ctx) {
    for (const id of this.selection) {
      if (typeof id === 'string') {
        const mine = this.map.goldMines.find((m) => m.id === id);
        if (!mine) continue;
        ctx.strokeStyle = 'rgba(226, 181, 62, 0.95)';
        ctx.lineWidth = 2;
        ctx.strokeRect(mine.x * S + 2, mine.y * S + 2, mine.w * S - 4, mine.h * S - 4);
        continue;
      }

      const unit = this.world.units.get(id);
      if (unit?.carried) continue;
      if (unit) {
        const x = unit.drawX * S;
        const y = unit.drawY * S;
        const relation = this.world.relationOf(unit);
        const radius = UNITS[unit.type].radius * S;
        drawSelectionRing(ctx, x, y + 7, radius + 2, relation);
        drawHealthBar(ctx, x, y - 26, Math.max(20, radius * 2), unit.hp / UNITS[unit.type].hp);
        continue;
      }

      const b = this.world.buildings.get(id);
      if (b) {
        const relation = this.world.relationOf(b);
        const mine = relation === 'mine';
        ctx.strokeStyle = { mine: 'rgba(120, 230, 140, 0.95)', ally: 'rgba(240, 205, 100, 0.95)', enemy: 'rgba(240, 120, 110, 0.95)' }[relation];
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x * S + 1, b.y * S + 1, b.size * S - 2, b.size * S - 2);
        drawHealthBar(ctx, (b.x + b.size / 2) * S, b.y * S + b.size * S + 4, b.size * S * 0.6, b.hp / BUILDINGS[b.type].hp);
        if (mine && b.rally) drawRally(ctx, b, b.rally, PLAYER_COLORS[b.owner]);
      }
    }
  }

  drawGhost(ctx, timeMs) {
    const g = this.ghost;
    if (!g) return;
    const size = BUILDINGS[g.type].size * S;
    const px = g.x * S;
    const py = g.y * S;
    const alpha = 0.22 + 0.06 * Math.sin(timeMs / 180);
    ctx.fillStyle = g.valid ? `rgba(100, 220, 130, ${alpha})` : `rgba(235, 90, 80, ${alpha + 0.08})`;
    ctx.fillRect(px, py, size, size);
    ctx.strokeStyle = g.valid ? 'rgba(120, 235, 150, 0.95)' : 'rgba(245, 110, 100, 0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, size - 2, size - 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    for (let i = 1; i < BUILDINGS[g.type].size; i++) {
      ctx.beginPath();
      ctx.moveTo(px + i * S, py);
      ctx.lineTo(px + i * S, py + size);
      ctx.moveTo(px, py + i * S);
      ctx.lineTo(px + size, py + i * S);
      ctx.stroke();
    }
    drawLabel(ctx, BUILDINGS[g.type].name, px + size / 2, py - 6, g.valid ? '#62c27f' : '#e0574c');
  }

  drawMarkers(ctx, timeMs) {
    const now = performance.now();
    this.markers = this.markers.filter((m) => now - m.start < MARKER_MS);
    for (const m of this.markers) {
      const t = (now - m.start) / MARKER_MS;
      ctx.strokeStyle = `rgba(${MARKER_COLORS[m.kind]}, ${1 - t})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(m.x * S, m.y * S, 6 + t * 12, (6 + t * 12) * 0.5, 0, 0, TAU);
      ctx.stroke();
    }
  }

  drawHover(ctx) {
    const tile = this.hoverTile;
    if (!tile || this.ghost || tile.x < 0 || tile.y < 0 || tile.x >= this.map.width || tile.y >= this.map.height) return;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1 / this.camera.zoom;
    ctx.strokeRect(tile.x * S, tile.y * S, S, S);
  }

  drawDragBox(ctx) {
    const box = this.dragBox;
    if (!box) return;
    const x = Math.min(box.x0, box.x1);
    const y = Math.min(box.y0, box.y1);
    const w = Math.abs(box.x1 - box.x0);
    const h = Math.abs(box.y1 - box.y0);
    ctx.fillStyle = 'rgba(120, 230, 140, 0.12)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(120, 230, 140, 0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  }
}
