import { h } from './dom.js';

/** 불러오는 중, 연결 실패 같은 한 줄짜리 화면. actions: [{ label, onClick, primary }] */
export function createStatusScreen({ title, message = '', actions = [] }) {
  const el = h(
    'main',
    { class: 'screen' },
    h(
      'div',
      { class: 'title-card status-card', role: actions.length ? 'alert' : 'status' },
      h('p', { class: 'brand' }, 'Rune ', h('span', { class: 'amp' }, '&'), ' Crown'),
      h('h1', { class: 'screen-title' }, title),
      message ? h('p', { class: 'tagline' }, message) : null,
      actions.length
        ? h(
            'div',
            { class: 'status-actions' },
            ...actions.map(({ label, onClick, primary }) =>
              h('button', { class: primary ? 'btn btn-primary' : 'btn', type: 'button', onClick }, label),
            ),
          )
        : null,
    ),
  );
  return { el };
}
