import { NICKNAME_MAX, NICKNAME_MESSAGES, PASSWORD_MIN, validateNickname } from '@rune/shared/rules/nickname.js';
import { authErrorMessage } from '../auth.js';
import { h } from './dom.js';

let fieldSeq = 0;

/** 비밀번호 칸 + 보기 버튼 */
function passwordField({ label, autocomplete, hint }) {
  const id = `pw-${++fieldSeq}`;
  const input = h('input', { class: 'input', id, type: 'password', autocomplete, required: true, minlength: PASSWORD_MIN });
  const toggle = h(
    'button',
    {
      class: 'input-addon',
      type: 'button',
      'aria-controls': id,
      'aria-pressed': 'false',
      onClick: () => {
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        toggle.textContent = showing ? '보기' : '숨기기';
        toggle.setAttribute('aria-pressed', String(!showing));
      },
    },
    '보기',
  );
  const el = h(
    'div',
    { class: 'field' },
    h('label', { class: 'label', for: id }, label),
    h('div', { class: 'input-group' }, input, toggle),
    hint ? h('p', { class: 'field-hint' }, hint) : null,
  );
  return { el, input };
}

function textField({ label, type = 'text', autocomplete, placeholder, maxlength }) {
  const id = `field-${++fieldSeq}`;
  const input = h('input', { class: 'input', id, type, autocomplete, placeholder, maxlength, required: true });
  const hint = h('p', { class: 'field-hint', 'aria-live': 'polite' });
  const el = h('div', { class: 'field' }, h('label', { class: 'label', for: id }, label), input, hint);
  return { el, input, hint };
}

/**
 * 닉네임 칸. 입력을 멈추면 규칙을 먼저 보고, 괜찮으면 서버에 쓸 수 있는지 물어본다.
 * @returns {{ el, input, check: () => Promise<string | null> }} check는 문제가 있으면 문장을 돌려준다
 */
export function nicknameField({ onCheckNickname, value = '' }) {
  const field = textField({ label: '닉네임', autocomplete: 'nickname', placeholder: '예: 새벽기사', maxlength: NICKNAME_MAX });
  field.input.value = value;
  field.hint.textContent = `한글·영문·숫자·밑줄 2~${NICKNAME_MAX}자`;
  let timer = null;
  let seq = 0;

  const setHint = (text, tone) => {
    field.hint.textContent = text;
    field.hint.className = tone ? `field-hint is-${tone}` : 'field-hint';
  };

  async function check() {
    clearTimeout(timer);
    const checked = validateNickname(field.input.value);
    if (!checked.ok) {
      setHint(NICKNAME_MESSAGES[checked.reason], 'bad');
      return NICKNAME_MESSAGES[checked.reason];
    }
    const mine = ++seq;
    setHint('확인하는 중…');
    const result = await onCheckNickname(checked.nickname);
    if (mine !== seq) return null; // 그사이 더 새 입력이 있었다
    if (result.available === false) {
      const message = NICKNAME_MESSAGES[result.reason] ?? '쓸 수 없는 닉네임입니다.';
      setHint(message, 'bad');
      return message;
    }
    if (result.available) setHint('쓸 수 있는 닉네임입니다.', 'good');
    else setHint('서버에 확인하지 못했습니다. 가입할 때 다시 확인합니다.');
    return null;
  }

  field.input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(check, 450);
  });
  return { el: field.el, input: field.input, check };
}

/**
 * 첫 화면: 로그인 / 회원가입.
 * onSignIn·onSignUp이 예외를 던지면 문장으로 바꿔 보여 준다. 성공하면 main.js가 화면을 넘긴다.
 */
export function createAuthScreen({ mode, tab = 'signin', onSignIn, onSignUp, onResetPassword, onCheckNickname, onOpenReplay }) {
  const error = h('p', { class: 'form-error', role: 'alert' });
  const notice = h('p', { class: 'form-notice', role: 'status' });
  const setMessage = (err = '', note = '') => {
    error.textContent = err;
    notice.textContent = note;
  };
  const busy = (button, on, label) => {
    button.disabled = on;
    button.textContent = on ? '처리 중…' : label;
  };

  // ---------- 로그인 ----------
  const signInEmail = textField({ label: '이메일', type: 'email', autocomplete: 'email', placeholder: 'name@example.com' });
  const signInPassword = passwordField({ label: '비밀번호', autocomplete: 'current-password' });
  const signInButton = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, '로그인');
  const resetButton = h('button', { class: 'link-btn', type: 'button' }, '비밀번호를 잊으셨나요?');
  resetButton.addEventListener('click', async () => {
    setMessage();
    try {
      await onResetPassword(signInEmail.input.value);
      setMessage('', '비밀번호 재설정 메일을 보냈습니다. 메일함을 확인하세요.');
    } catch (err) {
      setMessage(err.code === 'auth/invalid-email' ? '위 칸에 가입한 이메일을 먼저 입력하세요.' : authErrorMessage(err));
    }
  });
  const signInForm = h('form', { class: 'auth-form' }, signInEmail.el, signInPassword.el, signInButton, resetButton);
  signInForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setMessage();
    busy(signInButton, true, '로그인');
    try {
      await onSignIn(signInEmail.input.value, signInPassword.input.value);
    } catch (err) {
      setMessage(authErrorMessage(err));
      busy(signInButton, false, '로그인');
    }
  });

  // ---------- 회원가입 ----------
  const signUpEmail = textField({ label: '이메일', type: 'email', autocomplete: 'email', placeholder: 'name@example.com' });
  const nickname = nicknameField({ onCheckNickname });
  const signUpPassword = passwordField({ label: '비밀번호', autocomplete: 'new-password', hint: `${PASSWORD_MIN}자 이상` });
  const confirmPassword = passwordField({ label: '비밀번호 확인', autocomplete: 'new-password' });
  const signUpLabel = '가입하고 시작하기';
  const signUpButton = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, signUpLabel);
  const signUpForm = h('form', { class: 'auth-form' }, signUpEmail.el, nickname.el, signUpPassword.el, confirmPassword.el, signUpButton);
  signUpForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setMessage();
    if (signUpPassword.input.value !== confirmPassword.input.value) {
      setMessage('비밀번호 확인이 맞지 않습니다.');
      confirmPassword.input.focus();
      return;
    }
    busy(signUpButton, true, signUpLabel);
    const nicknameProblem = await nickname.check();
    if (nicknameProblem) {
      setMessage(nicknameProblem);
      busy(signUpButton, false, signUpLabel);
      nickname.input.focus();
      return;
    }
    try {
      await onSignUp(signUpEmail.input.value, signUpPassword.input.value, nickname.input.value.trim());
    } catch (err) {
      setMessage(authErrorMessage(err));
      busy(signUpButton, false, signUpLabel);
    }
  });

  // ---------- 탭 ----------
  const tabs = {
    signin: { button: h('button', { class: 'auth-tab', type: 'button', role: 'tab' }, '로그인'), panel: signInForm },
    signup: { button: h('button', { class: 'auth-tab', type: 'button', role: 'tab' }, '회원가입'), panel: signUpForm },
  };
  function select(name) {
    for (const [key, { button, panel }] of Object.entries(tabs)) {
      const active = key === name;
      button.setAttribute('aria-selected', String(active));
      button.classList.toggle('is-active', active);
      panel.hidden = !active;
    }
    setMessage();
  }
  tabs.signin.button.addEventListener('click', () => select('signin'));
  tabs.signup.button.addEventListener('click', () => select('signup'));

  const modeNote =
    mode === 'firebase'
      ? '로그인하면 이 브라우저에서는 로그아웃할 때까지 로그인이 유지됩니다.'
      : '개발 모드 · 계정은 이 브라우저에만 저장됩니다 (보안 없음, 로컬 테스트용)';
  const el = h(
    'main',
    { class: 'screen' },
    h(
      'div',
      { class: 'title-card auth-card' },
      h(
        'div',
        {},
        h('h1', { class: 'wordmark' }, 'Rune ', h('span', { class: 'amp' }, '&'), ' Crown'),
        h('p', { class: 'tagline' }, '마나 샘을 지배하는 자가 왕관을 쓴다'),
      ),
      h(
        'section',
        { class: 'panel auth-panel' },
        h('div', { class: 'auth-tabs', role: 'tablist', 'aria-label': '로그인 또는 회원가입' }, tabs.signin.button, tabs.signup.button),
        signInForm,
        signUpForm,
        error,
        notice,
      ),
      h('p', { class: 'note' }, modeNote),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: () => onOpenReplay?.() }, '리플레이 파일 열기'),
    ),
  );

  select(tab);
  return {
    el,
    focus: () => (tab === 'signin' ? signInEmail : signUpEmail).input.focus(),
    showError: (message) => setMessage(message),
  };
}
