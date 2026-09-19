// 방향키만 카메라에 쓴다. 글자 키는 명령 단축키(Q W E R, A S D, Z X ...)로 쓴다.
const PAN_KEYS = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

const isTyping = (event) => {
  const t = event.target;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || Boolean(t?.isContentEditable);
};

/**
 * 게임 화면의 입력.
 * - 카메라: 방향키, 화면 가장자리, 가운데 버튼 드래그, 휠
 * - 왼쪽·오른쪽 버튼과 키 입력은 handlers로 GameView에 넘긴다
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, inside: false };
    this.panning = false;
    this.panDelta = { x: 0, y: 0 };
    this.wheelAccum = 0;
    this.wheelSteps = 0;
    /** @type {{ down?: Function, move?: Function, up?: Function, key?: Function }} */
    this.handlers = {};
    this.cleanups = [];

    this.listen(window, 'keydown', (e) => {
      if (isTyping(e)) return;
      if (PAN_KEYS[e.code]) {
        this.keys.add(e.code);
        e.preventDefault();
        return;
      }
      this.handlers.key?.(e);
    });
    this.listen(window, 'keyup', (e) => this.keys.delete(e.code));
    this.listen(window, 'blur', () => {
      this.keys.clear();
      this.mouse.inside = false;
      this.panning = false;
    });

    this.listen(window, 'pointermove', (e) => {
      if (e.pointerType === 'touch') return; // 터치는 TouchControls가 맡는다
      if (e.pointerType === 'mouse') {
        if (this.panning) {
          this.panDelta.x += e.clientX - this.mouse.x;
          this.panDelta.y += e.clientY - this.mouse.y;
        }
        this.mouse.inside = true;
      }
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.handlers.move?.(e.clientX, e.clientY, e);
    });
    this.listen(document.documentElement, 'mouseleave', () => {
      this.mouse.inside = false;
    });

    this.listen(canvas, 'pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (e.button === 1) {
        e.preventDefault();
        this.panning = true;
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button === 0 || e.button === 2) {
        canvas.setPointerCapture(e.pointerId);
        this.handlers.down?.(e.button, e.clientX, e.clientY, e);
      }
    });
    this.listen(canvas, 'pointerup', (e) => {
      if (e.pointerType === 'touch') return;
      if (e.button === 1) {
        this.panning = false;
        return;
      }
      if (e.button === 0 || e.button === 2) this.handlers.up?.(e.button, e.clientX, e.clientY, e);
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

  /** 방향키 입력 (-1, 0, 1) */
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
    if (!this.mouse.inside || this.panning) return [0, 0];
    const { x, y } = this.mouse;
    return [x <= margin ? -1 : x >= width - margin ? 1 : 0, y <= margin ? -1 : y >= height - margin ? 1 : 0];
  }

  consumePan() {
    const delta = { ...this.panDelta };
    this.panDelta.x = 0;
    this.panDelta.y = 0;
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
    this.handlers = {};
  }
}
