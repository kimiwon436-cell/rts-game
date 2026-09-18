// 소리 설정: 버튼 하나와 그 아래 펼쳐지는 판 (끄기 · 전체 · 갈래별 크기). 설정은 이 브라우저에 기억한다.
import { CHANNELS } from '../audio/soundList.js';
import { sound } from '../audio/soundEngine.js';
import { h } from './dom.js';

const SLIDERS = [['master', '전체'], ...Object.entries(CHANNELS).map(([key, { name }]) => [key, name])];

/**
 * @param {{ onOpen?: () => void }} [options] onOpen: 판을 열 때 (같은 자리의 다른 판을 닫는다)
 */
export function createSoundControl({ onOpen } = {}) {
  const mute = h('input', { type: 'checkbox', onChange: (e) => sound.set('muted', e.target.checked) });
  const sliders = new Map();
  const rows = SLIDERS.map(([key, label]) => {
    const input = h('input', {
      type: 'range',
      min: 0,
      max: 100,
      step: 5,
      'aria-label': `${label} 크기`,
      onInput: (e) => sound.set(key, Number(e.target.value) / 100),
    });
    const value = h('span', { class: 'sound-value' });
    sliders.set(key, { input, value });
    return h('label', { class: 'sound-row' }, h('span', {}, label), input, value);
  });

  const button = h('button', { class: 'btn btn-sm', type: 'button', 'aria-expanded': 'false', onClick: () => toggle() }, '소리');
  const panel = h(
    'div',
    { class: 'confirm sound-panel', role: 'dialog', 'aria-label': '소리 설정', hidden: true },
    h('label', { class: 'sound-mute' }, mute, '소리 끄기'),
    ...rows,
    h('div', { class: 'confirm-actions' }, h('button', { class: 'btn btn-sm', type: 'button', onClick: () => toggle(false) }, '닫기')),
  );
  const el = h('div', { class: 'sound-control' }, button, panel);
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    toggle(false);
    button.focus();
  });

  function toggle(open = panel.hidden) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) onOpen?.();
  }

  function render(settings) {
    mute.checked = settings.muted;
    button.textContent = settings.muted ? '소리 꺼짐' : '소리';
    for (const [key, { input, value }] of sliders) {
      const percent = Math.round(settings[key] * 100);
      if (document.activeElement !== input) input.value = String(percent);
      value.textContent = String(percent);
      input.disabled = settings.muted;
    }
  }

  // 판 밖을 누르면 닫는다
  const onPointerDown = (event) => {
    if (!panel.hidden && !el.contains(event.target)) toggle(false);
  };
  document.addEventListener('pointerdown', onPointerDown);
  const unsubscribe = sound.subscribe(render);
  render(sound.settings);

  return {
    el,
    get open() {
      return !panel.hidden;
    },
    close: () => toggle(false),
    destroy() {
      unsubscribe();
      document.removeEventListener('pointerdown', onPointerDown);
    },
  };
}
