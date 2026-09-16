import { MAX_PLAYERS, PLAYER_COLORS } from '@rune/shared/constants.js';
import { h } from './dom.js';

export function createRoomScreen({ me, onReady, onLeave }) {
  let myReady = false;
  let countdownTimer = null;

  const title = h('h1', { class: 'room-title' });
  const hint = h('p', { class: 'note' });
  const slots = h('div', { class: 'slots' });
  const countdown = h('p', { class: 'countdown', 'aria-live': 'assertive' });
  const readyButton = h('button', { class: 'btn btn-primary', type: 'button', onClick: () => onReady(!myReady) }, '준비');
  const leaveButton = h('button', { class: 'btn', type: 'button', onClick: onLeave }, '나가기');

  const el = h(
    'main',
    { class: 'screen' },
    h(
      'div',
      { class: 'room' },
      h('div', { class: 'room-head' }, h('p', { class: 'note' }, '대기실'), title, hint),
      slots,
      countdown,
      h('div', { class: 'room-actions' }, leaveButton, readyButton),
    ),
  );

  function slotCard(room, slot) {
    const player = room.players.find((p) => p.slot === slot);
    const style = `--slot-color: ${PLAYER_COLORS[slot]}`;
    if (!player) {
      return h(
        'div',
        { class: 'slot', style },
        h('span', { class: 'slot-label' }, `P${slot + 1}`),
        h('span', { class: 'slot-name' }, '빈 자리'),
        h('span', { class: 'slot-state' }, '상대를 기다리는 중'),
      );
    }
    const tags = [`P${slot + 1}`];
    if (player.uid === me.uid) tags.push('나');
    if (player.uid === room.hostUid) tags.push('방장');
    return h(
      'div',
      { class: 'slot', style },
      h('span', { class: 'slot-label' }, tags.join(' · ')),
      h('span', { class: 'slot-name' }, player.nickname),
      player.connected === false
        ? h('span', { class: 'slot-state' }, '연결 끊김 · 재접속 기다리는 중')
        : h('span', { class: player.ready ? 'slot-state is-ready' : 'slot-state' }, player.ready ? '준비 완료' : '준비 중'),
    );
  }

  function update(room) {
    title.textContent = room.name;
    slots.replaceChildren(...Array.from({ length: MAX_PLAYERS }, (_, slot) => slotCard(room, slot)));

    myReady = Boolean(room.players.find((p) => p.uid === me.uid)?.ready);
    readyButton.textContent = myReady ? '준비 취소' : '준비';
    readyButton.classList.toggle('btn-primary', !myReady);

    const full = room.players.length === MAX_PLAYERS;
    hint.textContent = !full
      ? '상대가 들어오면 둘 다 준비를 눌러 시작합니다.'
      : room.players.every((p) => p.ready)
        ? '모두 준비했습니다. 곧 시작합니다.'
        : '둘 다 준비하면 게임이 시작됩니다.';
  }

  function setCountdown(seconds) {
    clearInterval(countdownTimer);
    if (!seconds) {
      countdown.textContent = '';
      return;
    }
    let left = Math.ceil(seconds);
    countdown.textContent = String(left);
    countdownTimer = setInterval(() => {
      left -= 1;
      countdown.textContent = left > 0 ? String(left) : '';
      if (left <= 0) clearInterval(countdownTimer);
    }, 1000);
  }

  return {
    el,
    update,
    setCountdown,
    destroy: () => clearInterval(countdownTimer),
  };
}
