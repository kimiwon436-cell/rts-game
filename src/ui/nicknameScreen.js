import { h } from './dom.js';
import { nicknameField } from './authScreen.js';

/** 가입은 했지만 닉네임을 아직 정하지 않은 계정 (가입 중 닉네임이 먼저 선점된 경우 등) */
export function createNicknameScreen({ loginId, value = '', errorText = '', onSubmit, onCheckNickname, onSignOut }) {
  const nickname = nicknameField({ onCheckNickname, value });
  const error = h('p', { class: 'form-error', role: 'alert' }, errorText);
  const button = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, '시작하기');

  const form = h('form', { class: 'auth-form' }, nickname.el, button, error);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    button.disabled = true;
    const problem = (await nickname.check()) ?? (await onSubmit(nickname.input.value.trim()));
    if (problem) {
      error.textContent = problem;
      button.disabled = false;
      nickname.input.focus();
    }
  });

  const el = h(
    'main',
    { class: 'screen' },
    h(
      'div',
      { class: 'title-card auth-card' },
      h('div', {}, h('h1', { class: 'screen-title' }, '닉네임을 정해 주세요'), h('p', { class: 'tagline' }, '순위표와 채팅에 보이는 이름입니다. 나중에 바꿀 수 없습니다.')),
      h('section', { class: 'panel auth-panel' }, form),
      h('p', { class: 'note' }, `아이디 ${loginId ?? ''}(으)로 로그인했습니다.`),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: () => onSignOut() }, '로그아웃'),
    ),
  );
  return { el, focus: () => nickname.input.focus() };
}
