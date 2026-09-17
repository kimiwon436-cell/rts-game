// 전장의 안개 — 시야 계산 (docs/GAME_DESIGN.md 6-1장)
// 서버는 무엇을 보낼지·누구를 노릴 수 있는지 정하는 데, 클라이언트는 안개를 그리는 데 같은 코드를 쓴다.
import { UNITS } from '../data/units.js';
import { BUILDINGS } from '../data/buildings.js';

/** 아직 짓고 있는 건물(부지)의 시야 */
export const FOUNDATION_SIGHT = 3;

/** 공격한 유닛·건물은 맞은 팀에게 이 시간 동안 드러난다 (보이지 않는 곳에서 쏘는 적이 없게) */
export const REVEAL_SECONDS = 2;
export const REVEAL_SIGHT = 1;

/** 유닛·건물의 시야 반지름 (타일). 건물은 풋프린트 중심에서 잰다 */
export function sightOf(type, complete = true) {
  const unit = UNITS[type];
  if (unit) return unit.sight;
  return complete ? BUILDINGS[type].sight : FOUNDATION_SIGHT;
}

const spanCache = new Map();

/** 반지름 r인 원을 줄마다 가로 반폭으로: spans[dy + r] (칸 중심이 원 안에 드는 칸) */
function spansFor(radius) {
  let spans = spanCache.get(radius);
  if (!spans) {
    spans = new Int16Array(radius * 2 + 1);
    for (let dy = -radius; dy <= radius; dy++) spans[dy + radius] = Math.floor(Math.sqrt(radius * radius - dy * dy));
    spanCache.set(radius, spans);
  }
  return spans;
}

/**
 * 팀마다 칸별로 "이 칸을 보고 있는 시야 수"를 센다.
 * 시야(유닛·건물)는 칸이나 반지름이 바뀔 때만 옛 원을 빼고 새 원을 더하므로,
 * 가만히 선 병력과 건물은 틱마다 비용이 거의 없다.
 *
 * 쓰는 법: begin() → 시야마다 place(key, …) → end() (이번에 놓이지 않은 시야는 사라진 것으로 보고 걷어낸다)
 */
export class VisionGrid {
  /**
   * @param {number} width
   * @param {number} height
   * @param {object} [options]
   * @param {number} [options.teams] 팀 수 (팀 번호는 0부터)
   * @param {boolean} [options.explored] 한 번이라도 본 칸을 기억할지 (클라이언트의 안개 그림용)
   */
  constructor(width, height, { teams = 2, explored = false } = {}) {
    this.width = width;
    this.height = height;
    this.counts = Array.from({ length: teams }, () => new Uint16Array(width * height));
    this.explored = explored ? Array.from({ length: teams }, () => new Uint8Array(width * height)) : null;
    this.sources = new Map(); // key → { team, cx, cy, radius, gen }
    this.gen = 0;
    /** 칸이 바뀔 때마다 오른다 (안개 그림을 다시 만들지 정할 때 쓴다) */
    this.version = 0;
  }

  begin() {
    this.gen++;
  }

  /** 시야 하나를 놓는다. 같은 key가 칸·반지름·팀 모두 그대로면 아무 일도 하지 않는다 */
  place(key, team, x, y, radius) {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    let source = this.sources.get(key);
    if (source) {
      source.gen = this.gen;
      if (source.cx === cx && source.cy === cy && source.radius === radius && source.team === team) return;
      this.stamp(source.team, source.cx, source.cy, source.radius, -1);
      source.team = team;
      source.cx = cx;
      source.cy = cy;
      source.radius = radius;
    } else {
      source = { team, cx, cy, radius, gen: this.gen };
      this.sources.set(key, source);
    }
    this.stamp(team, cx, cy, radius, 1);
  }

  /** 이번 begin() 뒤로 놓이지 않은 시야(사라진 유닛·건물)를 걷어낸다 */
  end() {
    for (const [key, source] of this.sources) {
      if (source.gen === this.gen) continue;
      this.stamp(source.team, source.cx, source.cy, source.radius, -1);
      this.sources.delete(key);
    }
  }

  stamp(team, cx, cy, radius, delta) {
    if (radius <= 0) return;
    const { width, height } = this;
    const counts = this.counts[team];
    const explored = delta > 0 && this.explored ? this.explored[team] : null;
    const spans = spansFor(radius);
    const y0 = Math.max(0, cy - radius);
    const y1 = Math.min(height - 1, cy + radius);
    for (let ty = y0; ty <= y1; ty++) {
      const half = spans[ty - cy + radius];
      const row = ty * width;
      const start = row + Math.max(0, cx - half);
      const end = row + Math.min(width - 1, cx + half);
      if (delta > 0) {
        for (let i = start; i <= end; i++) counts[i]++;
        if (explored) explored.fill(1, start, end + 1);
      } else {
        for (let i = start; i <= end; i++) counts[i]--;
      }
    }
    this.version++;
  }

  isTileVisible(team, tile) {
    return this.counts[team][tile] > 0;
  }

  /** 점(타일 좌표)이 그 팀에게 보이는가 */
  isVisible(team, x, y) {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return false;
    return this.counts[team][ty * this.width + tx] > 0;
  }

  /** 사각형(건물·금광 풋프린트) 중 한 칸이라도 보이는가 */
  isRectVisible(team, rect) {
    const counts = this.counts[team];
    const x0 = Math.max(0, rect.x);
    const x1 = Math.min(this.width - 1, rect.x + rect.w - 1);
    const y0 = Math.max(0, rect.y);
    const y1 = Math.min(this.height - 1, rect.y + rect.h - 1);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) if (counts[ty * this.width + tx] > 0) return true;
    }
    return false;
  }

  isExplored(team, tile) {
    return this.explored ? this.explored[team][tile] === 1 : this.counts[team][tile] > 0;
  }

  /** 모든 시야를 지운다. keepExplored면 한 번 본 칸의 기억은 남긴다 (재접속) */
  clear({ keepExplored = false } = {}) {
    for (const counts of this.counts) counts.fill(0);
    if (!keepExplored) for (const explored of this.explored ?? []) explored.fill(0);
    this.sources.clear();
    this.version++;
  }
}
