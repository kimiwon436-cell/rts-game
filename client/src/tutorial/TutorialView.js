import { h, writeStorage } from '../ui/dom.js';
import { createGameView } from '../game/GameView.js';
import { isCoarsePointer } from '../input/TouchControls.js';
import { LocalMatch } from './LocalMatch.js';
import { TUTORIAL_STEPS } from './steps.js';

export const TUTORIAL_DONE_KEY = 'rune.tutorial.done';

const PLAYERS = [
  { uid: 'tutorial-me', nickname: '나', slot: 0, team: 0 },
  { uid: 'tutorial-tutor', nickname: '훈련 교관', slot: 1, team: 1 },
];

/**
 * 튜토리얼: 서버 없이 브라우저에서 도는 연습 경기(LocalMatch) 위에 단계별 안내를 띄운다.
 * 게임 화면은 실제 경기와 같은 GameView이고, 단계마다 월드와 화면 상태를 보고 목표를 확인한다.
 */
export function createTutorialView({ canvas, onExit }) {
  const match = new LocalMatch({ mapId: 'duel01', players: PLAYERS, mySlot: 0 });
  const view = createGameView({
    canvas,
    socket: match,
    mapId: 'duel01',
    players: PLAYERS,
    me: PLAYERS[0],
    recorder: null,
    tutorial: true,
    onLeave: onExit,
    onReturnToRoom: onExit,
  });
  const touch = isCoarsePointer();
  const ctx = { match, sim: match.world, view, slot: 0, touch, data: {} };

  const counter = h('span', { class: 'tutorial-counter mono' });
  const title = h('h2', { class: 'tutorial-title' });
  const text = h('p', { class: 'tutorial-text' });
  const dots = h('div', { class: 'tutorial-dots', 'aria-hidden': 'true' }, ...TUTORIAL_STEPS.map(() => h('i')));
  const actions = h('div', { class: 'tutorial-actions' });
  const panel = h(
    'section',
    { class: 'tutorial-panel', 'aria-live': 'polite', 'aria-label': '튜토리얼 안내' },
    h('header', { class: 'tutorial-head' }, counter, dots),
    title,
    text,
    actions,
  );
  const el = h('div', { class: 'tutorial' }, view.el, panel);

  let index = -1;
  let advancing = false;

  const button = (label, onClick, primary = false) =>
    h('button', { class: primary ? 'btn btn-sm btn-primary' : 'btn btn-sm', type: 'button', onClick }, label);

  function render(step) {
    counter.textContent = `${index + 1} / ${TUTORIAL_STEPS.length}`;
    title.textContent = step.title;
    text.textContent = typeof step.text === 'string' ? step.text : touch ? step.text.touch : step.text.mouse;
    [...dots.children].forEach((dot, i) => {
      dot.className = i < index ? 'is-done' : i === index ? 'is-current' : '';
    });
    const buttons = [button('건너뛰기', () => go(index + 1)), button('나가기', onExit)];
    if (step.manual) buttons.unshift(button('다음', () => go(index + 1), true));
    actions.replaceChildren(...buttons); // replaceChildren은 null을 "null" 글자로 넣으므로 배열로 넘긴다
  }

  function go(next) {
    advancing = false;
    panel.classList.remove('is-done');
    index = next;
    match.speed = 1;
    if (index >= TUTORIAL_STEPS.length) {
      finish();
      return;
    }
    ctx.data = {};
    TUTORIAL_STEPS[index].start?.(ctx);
    render(TUTORIAL_STEPS[index]);
  }

  function finish() {
    writeStorage(TUTORIAL_DONE_KEY, '1');
    counter.textContent = '완료';
    [...dots.children].forEach((dot) => {
      dot.className = 'is-done';
    });
    title.textContent = '튜토리얼을 마쳤습니다!';
    text.textContent = '이제 로비에서 방을 만들어 친구와 겨루거나, 랭킹전에 도전해 보세요. 이 연습 경기는 계속 둘러봐도 됩니다.';
    actions.replaceChildren(button('나가기', onExit, true), button('처음부터 다시', restart));
  }

  function restart() {
    onExit({ restart: true });
  }

  // 틱마다 지금 단계의 목표를 확인하고, 이루면 잠깐 표시한 뒤 넘어간다
  const stopWatching = match.onTick(() => {
    const step = TUTORIAL_STEPS[index];
    if (!step || step.manual || advancing || !step.done(ctx)) return;
    advancing = true;
    panel.classList.add('is-done');
    setTimeout(() => {
      if (advancing) go(index + 1);
    }, 900);
  });

  match.start();
  go(0);

  return {
    el,
    destroy() {
      stopWatching();
      match.stop();
      view.destroy();
    },
  };
}
