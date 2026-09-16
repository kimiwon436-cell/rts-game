import { TERRAIN, isBlockingTerrain } from './grid.js';
import { mulberry32 } from '../random.js';

/**
 * 점대칭 맵 제작 도구.
 * 한 팀(팀 0) 쪽만 그리면 맵 중심에 대해 반대쪽(팀 1)이 똑같이 생긴다 — 그래서 결과는 늘 공정하다.
 * 서버와 클라이언트가 같은 코드·시드로 같은 맵을 만들기 때문에 네트워크로는 mapId만 보낸다.
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

    /** 점 목록을 잇는 굵은 띠 (강, 능선) */
    band(points, halfWidth, terrain, roughness = 0.8) {
      for (let i = 0; i < points.length - 1; i++) {
        const [a, b] = [points[i], points[i + 1]];
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
        for (let s = 0; s <= steps; s++) {
          const px = a.x + ((b.x - a.x) * s) / steps;
          const py = a.y + ((b.y - a.y) * s) / steps;
          const r = halfWidth + (rand() - 0.5) * roughness;
          for (let y = Math.floor(py - r); y <= Math.ceil(py + r); y++) {
            for (let x = Math.floor(px - r); x <= Math.ceil(px + r); x++) {
              if (Math.hypot(x + 0.5 - px, y + 0.5 - py) <= r) setSym(x, y, terrain);
            }
          }
        }
      }
    },

    /** 흩어진 나무 따위. where(x, y)가 참인 곳에만 (대칭이므로 한쪽 절반만 고르면 된다) */
    scatter(count, terrain, where = () => true) {
      for (let i = 0; i < count; i++) {
        const x = Math.floor(rand() * width);
        const y = Math.floor(rand() * height);
        if (where(x, y)) setSym(x, y, terrain);
      }
    },

    /** 본진 공터 */
    clearing(center, radius, terrain = TERRAIN.DIRT) {
      for (let y = Math.floor(center.y - radius - 2); y <= Math.ceil(center.y + radius + 2); y++) {
        for (let x = Math.floor(center.x - radius - 2); x <= Math.ceil(center.x + radius + 2); x++) {
          const d = Math.hypot(x + 0.5 - center.x, y + 0.5 - center.y) + (rand() - 0.5) * 1.5;
          if (d < radius && inside(x, y)) setSym(x, y, terrain);
        }
      }
    },

    /** 사각형과 그 둘레의 막힌 지형을 풀밭으로 */
    clearRect({ x, y, w, h }, margin) {
      for (let ty = y - margin; ty < y + h + margin; ty++) {
        for (let tx = x - margin; tx < x + w + margin; tx++) {
          if (inside(tx, ty) && isBlockingTerrain(get(tx, ty))) setSym(tx, ty, TERRAIN.GRASS);
        }
      }
    },

    /** 두 점 사이에 3칸 폭 길을 낸다 (막힌 지형만 풀밭으로) */
    carvePath(a, b, halfWidth = 1) {
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
      for (let s = 0; s <= steps; s++) {
        const px = a.x + ((b.x - a.x) * s) / steps;
        const py = a.y + ((b.y - a.y) * s) / steps;
        for (let oy = -halfWidth; oy <= halfWidth; oy++) {
          for (let ox = -halfWidth; ox <= halfWidth; ox++) {
            const tx = Math.floor(px) + ox;
            const ty = Math.floor(py) + oy;
            if (inside(tx, ty) && isBlockingTerrain(get(tx, ty))) setSym(tx, ty, TERRAIN.GRASS);
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
