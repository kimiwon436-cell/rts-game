import { NICKNAME_MAX } from '@rune/shared/constants.js';
import { h } from './dom.js';

export function createTitleScreen({ nickname, modeLabel, onSubmit, onOpenReplay }) {
  const input = h('input', {
    class: 'input',
    id: 'nickname',
    name: 'nickname',
    maxlength: NICKNAME_MAX,
    autocomplete: 'nickname',
    placeholder: '예: 새벽기사',
  });
  input.value = nickname;

  const button = h('button', { class: 'btn btn-primary', type: 'submit' }, '입장');
  const error = h('p', { class: 'form-error', role: 'alert' });

  const setBusy = (busy) => {
    button.disabled = busy;
    button.textContent = busy ? '접속 중…' : '입장';
  };

  const form = h(
    'form',
    {
      class: 'entry-form',
      onSubmit: async (event) => {
        event.preventDefault();
        const name = input.value.trim();
        if (!name) {
          error.textContent = '닉네임을 입력하세요.';
          input.focus();
          return;
        }
        error.textContent = '';
        setBusy(true);
        try {
          await onSubmit(name);
        } catch (err) {
          error.textContent = err.message;
          setBusy(false);
        }
      },
    },
    h('label', { class: 'label', for: 'nickname' }, '닉네임'),
    h('div', { class: 'entry-row' }, input, button),
    error,
  );

  const el = h(
    'main',
    { class: 'screen' },
    h(
      'div',
      { class: 'title-card' },
      h(
        'div',
        {},
        h('h1', { class: 'wordmark' }, 'Rune ', h('span', { class: 'amp' }, '&'), ' Crown'),
        h('p', { class: 'tagline' }, '마나 샘을 지배하는 자가 왕관을 쓴다'),
      ),
      form,
      h('p', { class: 'note' }, modeLabel),
      h(
        'button',
        { class: 'btn btn-sm btn-ghost', type: 'button', onClick: () => onOpenReplay?.() },
        '리플레이 파일 열기',
      ),
    ),
  );

  return {
    el,
    focus: () => input.focus(),
    showError(message) {
      error.textContent = message;
      setBusy(false);
    },
  };
}
