const PAN_KEYS = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

const isTyping = (event) => {
  const t = event.target;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || Boolean(t?.isContentEditable);
};

/**
 * 카메라 조작용 입력 상태. 3-1에서는 이동·확대만 다룬다.
 * (선택과 우클릭 명령은 3-3에서 추가)
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, inside: false };
    this.dragging = false;
    this.dragDelta = { x: 0, y: 0 };
    this.wheelAccum = 0;
    this.wheelSteps = 0;
    this.cleanups = [];

    this.listen(window, 'keydown', (e) => {
      if (isTyping(e) || !PAN_KEYS[e.code]) return;
      this.keys.add(e.code);
      e.preventDefault();
    });
    this.listen(window, 'keyup', (e) => this.keys.delete(e.code));
    this.listen(window, 'blur', () => {
      this.keys.clear();
      this.mouse.inside = false;
      this.dragging = false;
    });

    this.listen(window, 'pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (this.dragging) {
        this.dragDelta.x += e.clientX - this.mouse.x;
        this.dragDelta.y += e.clientY - this.mouse.y;
      }
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.inside = true;
    });
    this.listen(document.documentElement, 'mouseleave', () => {
      this.mouse.inside = false;
    });

    // 가운데 버튼 드래그로 화면 이동
    this.listen(canvas, 'pointerdown', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      this.dragging = true;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    this.listen(canvas, 'pointerup', (e) => {
      if (e.button === 1) this.dragging = false;
    });
    this.listen(canvas, 'mousedown', (e) => {
      if (e.button === 1) e.preventDefault(); // 윈도우 자동 스크롤 막기
    });
    this.listen(canvas, 'contextmenu', (e) => e.preventDefault());

    this.listen(
      canvas,
      'wheel',
      (e) => {
        e.preventDefault();
        this.wheelAccum += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        // 마우스 휠 한 칸(약 100)마다 한 단계. 트랙패드의 작은 값은 모아서 처리한다
        while (this.wheelAccum <= -100) {
          this.wheelSteps += 1;
          this.wheelAccum += 100;
        }
        while (this.wheelAccum >= 100) {
          this.wheelSteps -= 1;
          this.wheelAccum -= 100;
        }
      },
      { passive: false },
    );
  }

  listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  /** 방향키·WASD 입력 (-1, 0, 1) */
  keyAxis() {
    let x = 0;
    let y = 0;
    for (const code of this.keys) {
      x += PAN_KEYS[code][0];
      y += PAN_KEYS[code][1];
    }
    return [Math.sign(x), Math.sign(y)];
  }

  /** 마우스가 창 가장자리에 닿았을 때의 방향 (-1, 0, 1) */
  edgeAxis(width, height, margin = 8) {
    if (!this.mouse.inside || this.dragging) return [0, 0];
    const { x, y } = this.mouse;
    return [x <= margin ? -1 : x >= width - margin ? 1 : 0, y <= margin ? -1 : y >= height - margin ? 1 : 0];
  }

  consumeDrag() {
    const delta = { ...this.dragDelta };
    this.dragDelta.x = 0;
    this.dragDelta.y = 0;
    return delta;
  }

  consumeWheel() {
    const steps = this.wheelSteps;
    this.wheelSteps = 0;
    return steps;
  }

  destroy() {
    this.cleanups.forEach((cleanup) => cleanup());
    this.cleanups = [];
    this.keys.clear();
  }
}
