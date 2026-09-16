// 터치 조작. 마우스 입력(Input.js)과 따로 돌고, 손가락 제스처를 게임 동작으로 바꿔 넘긴다.
//
// - 탭: 고르기 / (병력을 골랐으면) 그 자리에 명령 — 마우스의 왼쪽·오른쪽 클릭을 하나로 합쳤다
// - 두 번 탭: 화면 안의 같은 종류 유닛 모두 고르기
// - 한 손가락 끌기: 화면 이동
// - 길게 누른 채 끌기: 사각형으로 여러 유닛 고르기
// - 두 손가락: 벌리고 오므려 확대·축소, 함께 움직여 화면 이동
// - 건물을 놓는 중에는 끄는 대로 미리보기가 따라오고, 손을 떼면 짓는다

const TAP_SLOP = 10; // 이만큼(px) 안 움직이면 탭
const LONG_PRESS_MS = 380;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_SLOP = 28;
const PINCH_STEP = 1.28; // 손가락 사이가 이 배율만큼 벌어지면 확대 한 단계

export const isCoarsePointer = () =>
  typeof matchMedia === 'function' && (matchMedia('(pointer: coarse)').matches || matchMedia('(hover: none)').matches);

export class TouchControls {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} handlers
   * @param {(x: number, y: number) => void} handlers.onTap
   * @param {(x: number, y: number) => void} [handlers.onDoubleTap]
   * @param {(dx: number, dy: number) => void} handlers.onPan
   * @param {(direction: 1 | -1, x: number, y: number) => void} handlers.onZoom
   * @param {(phase: 'start' | 'move' | 'end' | 'cancel', x: number, y: number) => void} [handlers.onBox]
   * @param {() => boolean} [handlers.dragsGhost] 참이면 한 손가락 끌기가 화면 이동 대신 미리보기 이동
   * @param {(phase: 'start' | 'move' | 'end', x: number, y: number) => void} [handlers.onGhost]
   */
  constructor(canvas, handlers) {
    this.canvas = canvas;
    this.handlers = handlers;
    this.pointers = new Map(); // pointerId → { x, y, startX, startY }
    this.gesture = 'none'; // none | pending | pan | box | ghost | pinch | finished
    this.longPressTimer = null;
    this.lastTap = { time: 0, x: 0, y: 0 };
    this.pinch = null;
    this.cleanups = [];

    const listen = (type, handler) => {
      canvas.addEventListener(type, handler, { passive: false });
      this.cleanups.push(() => canvas.removeEventListener(type, handler, { passive: false }));
    };
    listen('pointerdown', (e) => this.down(e));
    listen('pointermove', (e) => this.move(e));
    listen('pointerup', (e) => this.up(e, false));
    listen('pointercancel', (e) => this.up(e, true));
    // iOS 사파리는 포인터 이벤트와 별개로 제스처 확대를 시도한다
    listen('gesturestart', (e) => e.preventDefault());
  }

  down(e) {
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // 합성 이벤트 등 캡처할 수 없는 포인터는 그냥 둔다
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });

    if (this.pointers.size === 1) {
      if (this.handlers.dragsGhost?.()) {
        this.gesture = 'ghost';
        this.handlers.onGhost?.('start', e.clientX, e.clientY);
        return;
      }
      this.gesture = 'pending';
      clearTimeout(this.longPressTimer);
      this.longPressTimer = setTimeout(() => this.startBox(e.pointerId), LONG_PRESS_MS);
      return;
    }

    // 두 번째 손가락: 하던 제스처를 접고 확대·이동으로 바꾼다
    clearTimeout(this.longPressTimer);
    if (this.gesture === 'box') this.handlers.onBox?.('cancel', 0, 0);
    if (this.gesture === 'ghost') this.handlers.onGhost?.('cancel', 0, 0);
    this.gesture = 'pinch';
    this.pinch = this.pinchState();
  }

  startBox(pointerId) {
    const p = this.pointers.get(pointerId);
    if (this.gesture !== 'pending' || !p || !this.handlers.onBox) return;
    this.gesture = 'box';
    navigator.vibrate?.(12);
    this.handlers.onBox('start', p.x, p.y);
  }

  move(e) {
    if (e.pointerType !== 'touch') return;
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;

    switch (this.gesture) {
      case 'pending':
        if (Math.hypot(p.x - p.startX, p.y - p.startY) > TAP_SLOP) {
          clearTimeout(this.longPressTimer);
          this.gesture = 'pan';
          this.handlers.onPan(p.x - p.startX, p.y - p.startY);
        }
        break;
      case 'pan':
        this.handlers.onPan(dx, dy);
        break;
      case 'box':
        this.handlers.onBox?.('move', p.x, p.y);
        break;
      case 'ghost':
        this.handlers.onGhost?.('move', p.x, p.y);
        break;
      case 'pinch':
        this.updatePinch();
        break;
      default:
    }
  }

  up(e, cancelled) {
    if (e.pointerType !== 'touch') return;
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    clearTimeout(this.longPressTimer);

    if (this.gesture === 'pinch') {
      // 손가락이 하나 남아도 바로 화면 이동으로 넘어가지 않는다 (확대 끝에 화면이 튀지 않게)
      this.gesture = this.pointers.size ? 'finished' : 'none';
      this.pinch = null;
      return;
    }
    if (this.pointers.size) return;

    const gesture = this.gesture;
    this.gesture = 'none';
    if (cancelled) {
      if (gesture === 'box') this.handlers.onBox?.('cancel', p.x, p.y);
      if (gesture === 'ghost') this.handlers.onGhost?.('cancel', p.x, p.y);
      return;
    }
    if (gesture === 'box') this.handlers.onBox?.('end', p.x, p.y);
    else if (gesture === 'ghost') this.handlers.onGhost?.('end', p.x, p.y);
    else if (gesture === 'pending') this.tap(p.x, p.y);
  }

  tap(x, y) {
    const now = performance.now();
    const last = this.lastTap;
    if (this.handlers.onDoubleTap && now - last.time < DOUBLE_TAP_MS && Math.hypot(x - last.x, y - last.y) < DOUBLE_TAP_SLOP) {
      this.lastTap = { time: 0, x: 0, y: 0 };
      this.handlers.onDoubleTap(x, y);
      return;
    }
    this.lastTap = { time: now, x, y };
    this.handlers.onTap(x, y);
  }

  pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  updatePinch() {
    if (this.pointers.size < 2 || !this.pinch) return;
    const now = this.pinchState();
    this.handlers.onPan(now.cx - this.pinch.cx, now.cy - this.pinch.cy);
    this.pinch.cx = now.cx;
    this.pinch.cy = now.cy;

    const ratio = now.distance / this.pinch.distance;
    if (ratio >= PINCH_STEP) {
      this.handlers.onZoom(1, now.cx, now.cy);
      this.pinch.distance = now.distance;
    } else if (ratio <= 1 / PINCH_STEP) {
      this.handlers.onZoom(-1, now.cx, now.cy);
      this.pinch.distance = now.distance;
    }
  }

  destroy() {
    clearTimeout(this.longPressTimer);
    this.cleanups.forEach((cleanup) => cleanup());
    this.cleanups = [];
    this.pointers.clear();
  }
}
