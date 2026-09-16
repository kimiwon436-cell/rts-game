import { GAME_MODES } from '@rune/shared/map/maps/index.js';
import { h } from './dom.js';

const formatWait = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/**
 * 로비의 랭킹전 칸: 방식 고르기(방식마다 내 레이팅), 매칭 시작/취소, 대기 상태, 순위표 열기.
 * @param {{ profile, onJoin: (mode) => Promise, onLeave: () => Promise, onLeaderboard: (mode) => Promise }} options
 */
export function createRankedPanel({ profile, onJoin, onLeave, onLeaderboard }) {
  let selected = '1v1';
  let queued = null; // { mode, waitingSec, queueSize }
  let tickTimer = null;

  const modeButtons = Object.values(GAME_MODES).map((mode) =>
    h(
      'button',
      { class: 'ranked-mode', type: 'button', 'aria-pressed': 'false', onClick: () => select(mode.id) },
      h('span', { class: 'ranked-mode-name' }, mode.name),
      h('span', { class: 'ranked-mode-rating mono' }),
    ),
  );
  const record = h('p', { class: 'note' });
  const status = h('p', { class: 'ranked-status', 'aria-live': 'polite' });
  const actionButton = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, '매칭 시작');
  const boardButton = h('button', { class: 'btn btn-block', type: 'button', onClick: () => onLeaderboard(selected) }, '순위표');

  actionButton.addEventListener('click', async () => {
    actionButton.disabled = true;
    try {
      if (queued) await onLeave();
      else await onJoin(selected);
    } finally {
      actionButton.disabled = false;
    }
  });

  const el = h(
    'section',
    { class: 'panel ranked-panel', 'aria-labelledby': 'ranked-title' },
    h('h2', { class: 'panel-title', id: 'ranked-title' }, '랭킹전'),
    h('div', { class: 'ranked-modes', role: 'group', 'aria-label': '랭킹전 방식' }, ...modeButtons),
    record,
    status,
    actionButton,
    boardButton,
  );

  function select(mode) {
    if (queued) return; // 기다리는 동안은 방식을 못 바꾼다
    selected = mode;
    render();
  }

  function render() {
    Object.keys(GAME_MODES).forEach((mode, i) => {
      modeButtons[i].setAttribute('aria-pressed', String(mode === selected));
      modeButtons[i].disabled = Boolean(queued) && mode !== queued.mode;
      modeButtons[i].querySelector('.ranked-mode-rating').textContent = profile ? String(profile.ratings[mode]) : '—';
    });
    const r = profile?.ranked?.[selected] ?? { wins: 0, losses: 0 };
    const games = r.wins + r.losses;
    record.textContent = games ? `${GAME_MODES[selected].name} ${r.wins}승 ${r.losses}패` : `${GAME_MODES[selected].name} 첫 랭킹전 (처음 10판은 레이팅이 크게 움직입니다)`;
    if (queued) {
      status.textContent = `상대를 찾는 중… ${formatWait(queued.waitingSec)} · 대기 ${queued.queueSize}명`;
      actionButton.textContent = '매칭 취소';
      actionButton.classList.remove('btn-primary');
    } else {
      status.textContent = '';
      actionButton.textContent = '매칭 시작';
      actionButton.classList.add('btn-primary');
    }
  }

  render();
  return {
    el,
    /** 서버의 대기 상태 (null이면 대기열에서 나왔다) */
    setStatus(next) {
      clearInterval(tickTimer);
      queued = next && !next.cancelled ? { ...next } : null;
      if (queued) {
        selected = queued.mode;
        // 서버 알림은 2초마다라, 사이사이 초를 직접 센다
        tickTimer = setInterval(() => {
          queued.waitingSec += 1;
          render();
        }, 1000);
      }
      render();
    },
    setProfile(next) {
      profile = next;
      render();
    },
    destroy: () => clearInterval(tickTimer),
  };
}

/** 순위표 대화 상자. 방식 탭을 누르면 다시 불러온다 */
export function createLeaderboardDialog({ mode, onLoad, onClose }) {
  const body = h('div', { class: 'board-body' }, h('p', { class: 'note' }, '불러오는 중…'));
  const footer = h('p', { class: 'board-me' });
  const tabs = Object.values(GAME_MODES).map((m) =>
    h('button', { class: 'auth-tab', type: 'button', role: 'tab', onClick: () => load(m.id) }, m.name),
  );
  const panel = h(
    'div',
    { class: 'board-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'board-title' },
    h(
      'header',
      { class: 'board-head' },
      h('h2', { class: 'panel-title', id: 'board-title' }, '순위표'),
      h('button', { class: 'btn btn-sm', type: 'button', onClick: () => onClose() }, '닫기'),
    ),
    h('div', { class: 'auth-tabs board-tabs', role: 'tablist' }, ...tabs),
    body,
    footer,
  );
  const el = h('div', { class: 'board-overlay', onClick: (e) => e.target === el && onClose() }, panel);

  async function load(nextMode) {
    Object.keys(GAME_MODES).forEach((id, i) => {
      tabs[i].classList.toggle('is-active', id === nextMode);
      tabs[i].setAttribute('aria-selected', String(id === nextMode));
    });
    body.replaceChildren(h('p', { class: 'note' }, '불러오는 중…'));
    footer.textContent = '';
    const res = await onLoad(nextMode);
    if (!res.ok) {
      body.replaceChildren(h('p', { class: 'form-error' }, '순위표를 불러오지 못했습니다.'));
      return;
    }
    if (!res.entries.length) {
      body.replaceChildren(h('p', { class: 'note' }, '아직 랭킹전을 한 사람이 없습니다.'));
    } else {
      body.replaceChildren(
        h(
          'table',
          { class: 'board-table' },
          h('thead', {}, h('tr', {}, h('th', {}, '순위'), h('th', {}, '닉네임'), h('th', {}, '레이팅'), h('th', {}, '승'), h('th', {}, '패'))),
          h(
            'tbody',
            {},
            ...res.entries.map((e) =>
              h(
                'tr',
                { class: e.me ? 'is-me' : '' },
                h('td', { class: 'mono' }, String(e.rank)),
                h('td', {}, e.nickname),
                h('td', { class: 'mono' }, String(e.rating)),
                h('td', { class: 'mono' }, String(e.wins)),
                h('td', { class: 'mono' }, String(e.losses)),
              ),
            ),
          ),
        ),
      );
    }
    const me = res.me;
    footer.textContent = `내 순위 ${me.rank ?? '—'}위 · 레이팅 ${me.rating} · ${me.wins}승 ${me.losses}패`;
  }

  load(mode);
  return { el };
}
