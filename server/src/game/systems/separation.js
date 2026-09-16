import { UNITS } from '@rune/shared/data/units.js';

const CELL_SIZE = 2; // 공간 해시 한 칸 (타일). 유닛 지름보다 커야 한다
const RESOLVE = 0.6; // 한 틱에 겹친 거리의 60%만 풀어 부드럽게 밀어낸다
const SIDESTEP = 0.6; // 마주 보고 부딪힌 두 유닛을 옆으로 미끄러뜨리는 비율
const HEAD_ON = 0.35; // 진행 방향이 서로를 이만큼(코사인) 넘게 향하면 마주 오는 것으로 본다

/** 다음 웨이포인트로 향하는 단위 벡터 (경로가 없으면 null) */
function heading(unit) {
  const next = unit.path?.[0];
  if (!next) return null;
  const hx = next[0] - unit.x;
  const hy = next[1] - unit.y;
  const length = Math.hypot(hx, hy);
  return length > 1e-4 ? [hx / length, hy / length] : null;
}

/** 경제 일을 하는 농노는 서로 겹쳐도 된다 (금광·나무 앞 교통 체증 방지) */
const ignoresCollision = (unit) =>
  Boolean(unit.carrierId) || // 등에 탄 유닛은 몸이 없다
  unit.order?.type === 'gather' ||
  unit.order?.type === 'construct' ||
  unit.order?.type === 'returnCargo';

const cellKey = (cx, cy) => cy * 4096 + cx;

/** 겹친 유닛을 서로 밀어낸다. 움직이는 유닛이 서 있는 유닛을 비켜 가게 한다. */
export function separateUnits(world) {
  const cells = new Map();
  const bodies = [];
  for (const unit of world.units.values()) {
    if (ignoresCollision(unit)) continue;
    bodies.push(unit);
    const key = cellKey(Math.floor(unit.x / CELL_SIZE), Math.floor(unit.y / CELL_SIZE));
    let cell = cells.get(key);
    if (!cell) {
      cell = [];
      cells.set(key, cell);
    }
    cell.push(unit);
  }

  for (const a of bodies) {
    const cx = Math.floor(a.x / CELL_SIZE);
    const cy = Math.floor(a.y / CELL_SIZE);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cell = cells.get(cellKey(cx + ox, cy + oy));
        if (!cell) continue;
        for (const b of cell) if (b.id > a.id) resolvePair(world, a, b);
      }
    }
  }
}

function resolvePair(world, a, b) {
  const minDistance = UNITS[a.type].radius + UNITS[b.type].radius;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let distance = Math.hypot(dx, dy);
  if (distance >= minDistance) return;

  if (distance < 1e-4) {
    // 완전히 겹쳤으면 id로 정한 방향으로 벌린다 (항상 같은 결과)
    const angle = ((a.id * 131 + b.id * 71) % 360) * (Math.PI / 180);
    dx = Math.cos(angle);
    dy = Math.sin(angle);
    distance = 0;
  } else {
    dx /= distance;
    dy /= distance;
  }

  const push = (minDistance - distance) * RESOLVE;
  const aMoving = Boolean(a.path || a.pathPending);
  const bMoving = Boolean(b.path || b.pathPending);
  const aShare = aMoving === bMoving ? 0.5 : aMoving ? 0.2 : 0.8;

  // 둘 다 서로를 향해 걷고 있으면 중심을 잇는 선으로만 밀어서는 영영 못 지나간다 (정면 교착).
  // 옆으로도 반대 방향으로 밀어 서로 비켜 가게 한다. 방향은 id 순서로 정해 늘 같은 결과가 나온다.
  let sx = 0;
  let sy = 0;
  if (aMoving && bMoving) {
    const ha = heading(a);
    const hb = heading(b);
    if (ha && hb && ha[0] * dx + ha[1] * dy > HEAD_ON && -(hb[0] * dx + hb[1] * dy) > HEAD_ON) {
      sx = -dy * push * SIDESTEP;
      sy = dx * push * SIDESTEP;
    }
  }
  nudge(world, a, -dx * push * aShare + sx, -dy * push * aShare + sy);
  nudge(world, b, dx * push * (1 - aShare) - sx, dy * push * (1 - aShare) - sy);
}

/** 축마다 따로 옮겨서 벽에 닿으면 그 축만 멈춘다 (벽을 따라 미끄러진다) */
function nudge(world, unit, dx, dy) {
  const nx = unit.x + dx;
  if (!world.nav.isBlocked(Math.floor(nx), Math.floor(unit.y))) unit.x = nx;
  const ny = unit.y + dy;
  if (!world.nav.isBlocked(Math.floor(unit.x), Math.floor(ny))) unit.y = ny;
}
