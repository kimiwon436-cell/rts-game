/**
 * 유닛 공간 색인: 맵을 cellSize 타일 칸으로 나누고 칸마다 유닛을 모아 둔다.
 * 틱마다 새로 만들지만 계수 정렬로 한 줄짜리 배열에 담아 할당이 없다.
 * 같은 칸 안에서는 넣은 순서(world.units 순서 = id 오름차순)를 지킨다 — 순서에 기대는 판정이 그대로 나온다.
 *
 * 훑는 법 (콜백 없이 가장 빠르게):
 *   const { cols, starts, items } = grid;
 *   for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
 *     const cell = row * cols + col;
 *     for (let i = starts[cell]; i < starts[cell + 1]; i++) visit(items[i]);
 *   }
 */
export class UnitGrid {
  constructor(width, height, cellSize) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.starts = new Int32Array(this.cols * this.rows + 1);
    this.items = [];
    this.cellOfItem = new Int32Array(256);
    this.next = new Int32Array(this.starts.length);
  }

  col(x) {
    return Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cellSize)));
  }

  row(y) {
    return Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cellSize)));
  }

  /** units(배열)를 칸별로 담는다 */
  build(units) {
    const { cols, starts } = this;
    const count = units.length;
    if (this.cellOfItem.length < count) this.cellOfItem = new Int32Array(count * 2);
    const cellOfItem = this.cellOfItem;
    starts.fill(0);
    for (let i = 0; i < count; i++) {
      const unit = units[i];
      const cell = this.row(unit.y) * cols + this.col(unit.x);
      cellOfItem[i] = cell;
      starts[cell + 1]++;
    }
    for (let cell = 1; cell < starts.length; cell++) starts[cell] += starts[cell - 1];
    // 칸마다 채울 자리: starts를 건드리지 않으려고 한 칸씩 밀린 복사본을 쓴다
    const { items, next } = this;
    items.length = count;
    next.set(starts);
    for (let i = 0; i < count; i++) items[next[cellOfItem[i]]++] = units[i];
    return this;
  }
}
