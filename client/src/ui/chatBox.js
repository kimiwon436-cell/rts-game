import { PLAYER_COLORS } from '@rune/shared/constants.js';
import { CHAT_MAX, CHAT_SCOPE } from '@rune/shared/rules/chat.js';
import { h } from './dom.js';

const FADE_AFTER_MS = 10_000; // 게임 화면에서 메시지가 흐려지기까지
const MAX_LINES = 100;

/** 보낸 사람 색: 경기 중에는 플레이어 색, 대기실(슬롯 없음)에서는 팀 색 */
const colorOf = (from) => PLAYER_COLORS[from.slot ?? from.team] ?? '#a9afbb';

/**
 * 채팅 상자.
 * - variant 'panel': 대기실. 목록과 입력 칸이 늘 보인다
 * - variant 'overlay': 게임 화면. 새 메시지는 잠깐 보였다 흐려지고, open()으로 입력 칸을 연다
 *   (Enter 보내기, Esc 닫기, Tab 전체·팀 바꾸기)
 */
export function createChatBox({ messages = [], teamGame = false, variant = 'panel', onSend }) {
  let scope = CHAT_SCOPE.ALL;
  let opened = variant === 'panel';

  const list = h('ol', { class: 'chat-list', 'aria-live': 'polite', 'aria-label': '채팅' });
  const scopeButton = h('button', { class: 'chat-scope', type: 'button', title: '전체·팀 바꾸기 (Tab)' });
  const input = h('input', { class: 'input chat-input', maxlength: CHAT_MAX, placeholder: '메시지 입력…', 'aria-label': '채팅 입력' });
  const sendButton = h('button', { class: 'btn btn-sm', type: 'submit' }, '보내기');
  const form = h('form', { class: 'chat-form' }, teamGame ? scopeButton : null, input, sendButton);
  const el = h('section', { class: `chat chat-${variant}` }, list, form);

  const renderScope = () => {
    scopeButton.textContent = scope === CHAT_SCOPE.TEAM ? '팀' : '전체';
    scopeButton.classList.toggle('is-team', scope === CHAT_SCOPE.TEAM);
  };
  const toggleScope = () => {
    if (!teamGame) return;
    scope = scope === CHAT_SCOPE.TEAM ? CHAT_SCOPE.ALL : CHAT_SCOPE.TEAM;
    renderScope();
  };
  scopeButton.addEventListener('click', toggleScope);
  renderScope();

  function line(message) {
    const time = new Date(message.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const li = message.from
      ? h(
          'li',
          { class: message.scope === CHAT_SCOPE.TEAM ? 'chat-line is-team' : 'chat-line' },
          message.scope === CHAT_SCOPE.TEAM ? h('span', { class: 'chat-tag' }, '[팀]') : null,
          h('strong', { class: 'chat-name', style: `color: ${colorOf(message.from)}` }, message.from.nickname),
          h('span', { class: 'chat-text' }, message.text),
          h('time', { class: 'chat-time' }, time),
        )
      : h('li', { class: 'chat-line is-notice' }, h('span', { class: 'chat-text' }, message.text));
    li.dataset.at = String(Date.now());
    return li;
  }

  function add(message) {
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
    list.append(line(message));
    while (list.children.length > MAX_LINES) list.firstChild.remove();
    if (atBottom || variant === 'overlay') list.scrollTop = list.scrollHeight;
  }

  function reset(next) {
    list.replaceChildren(...next.map(line));
    // 기록으로 받은 옛 메시지는 게임 화면에서 바로 흐리게 둔다
    if (variant === 'overlay') for (const li of list.children) li.dataset.at = '0';
    list.scrollTop = list.scrollHeight;
  }

  function open() {
    opened = true;
    el.classList.add('is-open');
    input.focus();
  }
  function close() {
    if (variant === 'panel') return;
    opened = false;
    el.classList.remove('is-open');
    input.blur();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) {
      close();
      return;
    }
    input.value = '';
    await onSend(text, scope);
    if (variant === 'overlay') close();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      input.value = '';
      close();
    } else if (event.key === 'Tab' && teamGame) {
      event.preventDefault();
      toggleScope();
    }
  });

  // 게임 화면: 오래된 줄을 흐리게 (입력 칸이 열려 있으면 모두 보인다)
  let fadeTimer = null;
  if (variant === 'overlay') {
    fadeTimer = setInterval(() => {
      const now = Date.now();
      for (const li of list.children) li.classList.toggle('is-faded', !opened && now - Number(li.dataset.at) > FADE_AFTER_MS);
    }, 500);
  }

  reset(messages);
  return {
    el,
    add,
    reset,
    open,
    close,
    get isOpen() {
      return opened;
    },
    destroy: () => clearInterval(fadeTimer),
  };
}
