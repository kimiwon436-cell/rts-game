import { TERRAIN, isNavigableWater } from './grid.js';
import { mulberry32 } from '../random.js';

const TAU = Math.PI * 2;

/** 길을 낼 때 치워도 되는 지형 (숲·바위). 물은 치우지 않는다 — 강은 다리로만 건넌다 */
const isClearable = (t) => t === TERRAIN.TREE || t === TERRAIN.ROCK;

/** Catmull-Rom 스플라인으로 점 목록을 부드럽게 잇는 점들 (step 타일 간격쯤) */
function smoothPath(points, step = 0.5) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const steps = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const at = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: at(p0.x, p1.x, p2.x, p3.x), y: at(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * 점대칭 맵 제작 도구.
 * 한 팀(팀 0) 쪽만 그리면 맵 중심에 대해 반대쪽(팀 1)이 똑같이 생긴다 — 그래서 결과는 늘 공정하다.
 * 서버와 클라이언트가 같은 코드·시드로 같은 맵을 만들기 때문에 네트워크로는 mapId만 보낸다.
 *
 * 그리는 순서: 숲·바위 → 바다·강(숲을 덮는다) → 다리 → finish(본진 공터와 길목. 물은 건드리지 않는다)
 */
export function createMapBuilder({ width, height, seed }) {
  const tiles = new Uint8Array(width * height); // 기본은 풀밭(0)
  const rand = mulberry32(seed);

  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
  const get = (x, y) => tiles[y * width + x];
  /** 타일 하나를 바꾸면 대칭 위치도 함께 바꾼다 */
  const setSym = (x, y, t) => {
    if (!inside(x, y)) return;
    tiles[y * width + x] = t;
    tiles[(height - 1 - y) * width + (width - 1 - x)] = t;
  };
  const mirrorRect = (r) => ({ ...r, x: width - r.w - r.x, y: height - r.h - r.y });
  const centerOf = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

  /** (px, py)를 중심으로 반지름 r 안의 칸을 칠한다 */
  const disc = (px, py, r, terrain, onlyWhere = null) => {
    for (let y = Math.floor(py - r); y <= Math.ceil(py + r); y++) {
      for (let x = Math.floor(px - r); x <= Math.ceil(px + r); x++) {
        if (!inside(x, y) || Math.hypot(x + 0.5 - px, y + 0.5 - py) > r) continue;
        if (!onlyWhere || onlyWhere(get(x, y))) setSym(x, y, terrain);
      }
    }
  };

  const api = {
    width,
    height,
    tiles,
    rand,
    inside,
    get,
    setSym,
    mirrorRect,
    centerOf,

    /** 울퉁불퉁한 원 */
    blob(cx, cy, r, terrain, roughness = 1.2) {
      for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
        for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
          const d = Math.hypot(x - cx, y - cy) + (rand() - 0.5) * roughness;
          if (d < r) setSym(x, y, terrain);
        }
      }
    },

    /** 점 목록을 잇는 굵은 띠 (능선 따위) */
    band(points, halfWidth, terrain, roughness = 0.8) {
      for (let i = 0; i < points.length - 1; i++) {
        const [a, b] = [points[i], points[i + 1]];
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
        for (let s = 0; s <= steps; s++) {
          const px = a.x + ((b.x - a.x) * s) / steps;
          const py = a.y + ((b.y - a.y) * s) / steps;
          disc(px, py, halfWidth + (rand() - 0.5) * roughness, terrain);
        }
      }
    },

    /**
     * 맵 가장자리를 두르는 바다. depth칸 안팎으로 해안선이 완만하게 들쭉날쭉하다.
     * 배는 이 바다를 따라 섬 둘레를 돌 수 있다.
     */
    sea(depth = 4, wobble = 1.2) {
      const phases = Array.from({ length: 8 }, () => rand() * TAU);
      const shore = (along, side) =>
        depth + wobble * (0.6 * Math.sin(along * 0.21 + phases[side]) + 0.4 * Math.sin(along * 0.53 + phases[side + 4]));
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (y < shore(x, 0) || width - 1 - x < shore(y, 1) || height - 1 - y < shore(x, 2) || x < shore(y, 3)) {
            setSym(x, y, TERRAIN.WATER);
          }
        }
      }
    },

    /** 점 목록을 부드럽게 잇는 강. 폭은 halfWidth 안팎으로 천천히 변한다 */
    river(points, halfWidth = 2, wobble = 0.4) {
      const phase = rand() * TAU;
      smoothPath(points).forEach((p, i) => disc(p.x, p.y, halfWidth + wobble * Math.sin(i * 0.15 + phase), TERRAIN.WATER));
    },

    /** a에서 b까지 물 위에만 다리를 놓는다 (폭 2 × halfWidth + 1칸). 양 끝은 뭍에 닿게 잡는다 */
    bridge(a, b, halfWidth = 1) {
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 3);
      for (let s = 0; s <= steps; s++) {
        const px = a.x + ((b.x - a.x) * s) / steps;
        const py = a.y + ((b.y - a.y) * s) / steps;
        disc(px, py, halfWidth + 0.5, TERRAIN.BRIDGE, (t) => t === TERRAIN.WATER);
      }
    },

    /** 흩어진 나무 따위. where(x, y)가 참인 곳에만 (대칭이므로 한쪽 절반만 고르면 된다) */
    scatter(count, terrain, where = () => true) {
      for (let i = 0; i < count; i++) {
        const x = Math.floor(rand() * width);
        const y = Math.floor(rand() * height);
        if (where(x, y) && get(x, y) === TERRAIN.GRASS) setSym(x, y, terrain);
      }
    },

    /** 본진 공터 (물가는 그대로 둔다) */
    clearing(center, radius, terrain = TERRAIN.DIRT) {
      for (let y = Math.floor(center.y - radius - 2); y <= Math.ceil(center.y + radius + 2); y++) {
        for (let x = Math.floor(center.x - radius - 2); x <= Math.ceil(center.x + radius + 2); x++) {
          const d = Math.hypot(x + 0.5 - center.x, y + 0.5 - center.y) + (rand() - 0.5) * 1.5;
          if (d < radius && inside(x, y) && !isNavigableWater(get(x, y))) setSym(x, y, terrain);
        }
      }
    },

    /** 사각형과 그 둘레의 숲·바위를 풀밭으로 */
    clearRect({ x, y, w, h }, margin) {
      for (let ty = y - margin; ty < y + h + margin; ty++) {
        for (let tx = x - margin; tx < x + w + margin; tx++) {
          if (inside(tx, ty) && isClearable(get(tx, ty))) setSym(tx, ty, TERRAIN.GRASS);
        }
      }
    },

    /** 두 점 사이에 3칸 폭 길을 낸다 (숲·바위만 풀밭으로. 강은 다리로 건넌다) */
    carvePath(a, b, halfWidth = 1) {
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
      for (let s = 0; s <= steps; s++) {
        const px = a.x + ((b.x - a.x) * s) / steps;
        const py = a.y + ((b.y - a.y) * s) / steps;
        for (let oy = -halfWidth; oy <= halfWidth; oy++) {
          for (let ox = -halfWidth; ox <= halfWidth; ox++) {
            const tx = Math.floor(px) + ox;
            const ty = Math.floor(py) + oy;
            if (inside(tx, ty) && isClearable(get(tx, ty))) setSym(tx, ty, TERRAIN.GRASS);
          }
        }
      }
    },

    /**
     * 시설을 마무리한다: 공터·시설 주변을 비우고, 본진에서 모든 시설과 맵 중심까지 길을 낸 뒤 대칭으로 복제한다.
     * @param {object} def
     * @param {Array<{ keep, gold: Array, wells: Array }>} def.bases 팀 0의 본진들 (팀 1은 대칭)
     * @param {Array} [def.sharedGold] 팀 0 쪽 절반에 둔 공용 금광 (대칭으로 하나 더 생긴다)
     * @param {Array} [def.sharedWells] 팀 0 쪽 절반에 둔 공용 마나 샘
     * @param {object} [def.primordial] 맵 한가운데 태초의 샘 (대칭이 자기 자신이어야 한다)
     */
    finish({ id, name, description, teamSize, bases, sharedGold = [], sharedWells = [], primordial = null }) {
      const center = { x: width / 2, y: height / 2 };
      const facilities = [...sharedGold, ...sharedWells, ...(primordial ? [primordial] : [])];

      for (const base of bases) {
        api.clearing(centerOf(base.keep), 7.5);
        api.clearRect(base.keep, 3);
        base.gold.forEach((g) => api.clearRect(g, 2));
        base.wells.forEach((w) => api.clearRect(w, 3));
      }
      sharedGold.forEach((g) => api.clearRect(g, 2));
      [...sharedWells, ...(primordial ? [primordial] : [])].forEach((w) => api.clearRect(w, 3));

      for (const base of bases) {
        const from = centerOf(base.keep);
        for (const target of [...base.gold, ...base.wells, ...facilities]) api.carvePath(from, centerOf(target));
        api.carvePath(from, center);
      }
      // 같은 팀 본진끼리도 이어 준다
      for (let i = 1; i < bases.length; i++) api.carvePath(centerOf(bases[i - 1].keep), centerOf(bases[i].keep));

      const starts = [];
      bases.forEach((base, i) => {
        starts.push({ slot: i * 2, team: 0, keep: base.keep });
        starts.push({ slot: i * 2 + 1, team: 1, keep: mirrorRect(base.keep) });
      });
      starts.sort((a, b) => a.slot - b.slot);

      const both = (list) => [...list, ...list.map(mirrorRect)];
      const goldMines = both([...bases.flatMap((b) => b.gold), ...sharedGold]);
      const wells = [...both([...bases.flatMap((b) => b.wells), ...sharedWells]), ...(primordial ? [primordial] : [])];

      return {
        id,
        name,
        description,
        teamSize,
        width,
        height,
        tiles,
        starts,
        goldMines: goldMines.map(({ x, y, w, h, amount }, i) => ({ id: `gold${i}`, x, y, w, h, amount })),
        wells: wells.map(({ x, y, w, h, kind }, i) => ({ id: `well${i}`, x, y, w, h, kind, rate: kind === 'primordial' ? 4 : 1.5 })),
      };
    },
  };
  return api;
}
