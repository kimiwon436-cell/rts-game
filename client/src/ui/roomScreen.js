import { PLAYER_COLORS } from '@rune/shared/constants.js';
import { GAME_MODES, MAP_LIST, mapsForMode } from '@rune/shared/map/maps/index.js';
import { h } from './dom.js';

export const TEAM_NAMES = ['1팀', '2팀'];
/** 팀 색: 팀 0은 따뜻한 색(슬롯 0), 팀 1은 차가운 색(슬롯 1) */
export const TEAM_COLORS = [PLAYER_COLORS[0], PLAYER_COLORS[1]];

const mapName = (mapId) => MAP_LIST.find((m) => m.id === mapId)?.name ?? mapId;

/**
 * 대기실: 경기 방식·맵(방장만 바꾼다), 팀 두 줄, 준비.
 * 팀 인원이 모두 차고 모두 준비하면 서버가 카운트다운을 시작한다.
 */
export function createRoomScreen({ me, onReady, onLeave, onTeam, onSettings }) {
  let myReady = false;
  let countdownTimer = null;

  const title = h('h1', { class: 'room-title' });
  const hint = h('p', { class: 'note' });
  const settings = h('div', { class: 'room-settings' });
  const teams = h('div', { class: 'teams' });
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
      settings,
      teams,
      countdown,
      h('div', { class: 'room-actions' }, leaveButton, readyButton),
    ),
  );

  function renderSettings(room) {
    const isHost = room.hostUid === me.uid;
    if (!isHost) {
      settings.replaceChildren(
        h('span', { class: 'setting-chip' }, GAME_MODES[room.mode].name),
        h('span', { class: 'setting-chip' }, mapName(room.mapId)),
      );
      return;
    }
    const modeSelect = h(
      'select',
      { class: 'input select', 'aria-label': '경기 방식' },
      ...Object.values(GAME_MODES).map((mode) => h('option', { value: mode.id }, mode.name)),
    );
    modeSelect.value = room.mode;
    modeSelect.addEventListener('change', () => onSettings({ mode: modeSelect.value }));
    const mapSelect = h(
      'select',
      { class: 'input select', 'aria-label': '맵' },
      ...mapsForMode(room.mode).map((map) => h('option', { value: map.id }, map.name)),
    );
    mapSelect.value = room.mapId;
    mapSelect.addEventListener('change', () => onSettings({ mapId: mapSelect.value }));
    settings.replaceChildren(
      h('label', { class: 'setting' }, h('span', { class: 'label' }, '방식'), modeSelect),
      h('label', { class: 'setting' }, h('span', { class: 'label' }, '맵'), mapSelect),
    );
  }

  function playerCard(room, player, team) {
    const style = `--slot-color: ${TEAM_COLORS[team]}`;
    if (!player) {
      return h(
        'div',
        { class: 'slot is-empty', style },
        h('span', { class: 'slot-name' }, '빈 자리'),
        h('span', { class: 'slot-state' }, '기다리는 중'),
      );
    }
    const tags = [];
    if (player.uid === me.uid) tags.push('나');
    if (player.uid === room.hostUid) tags.push('방장');
    return h(
      'div',
      { class: 'slot', style },
      tags.length ? h('span', { class: 'slot-label' }, tags.join(' · ')) : null,
      h('span', { class: 'slot-name' }, player.nickname),
      player.connected === false
        ? h('span', { class: 'slot-state' }, '연결 끊김 · 재접속 기다리는 중')
        : h('span', { class: player.ready ? 'slot-state is-ready' : 'slot-state' }, player.ready ? '준비 완료' : '준비 중'),
    );
  }

  function renderTeams(room) {
    const size = GAME_MODES[room.mode].teamSize;
    const mine = room.players.find((p) => p.uid === me.uid);
    teams.replaceChildren(
      ...[0, 1].map((team) => {
        const members = room.players.filter((p) => p.team === team);
        const cards = Array.from({ length: size }, (_, i) => playerCard(room, members[i], team));
        const canJoin = mine && mine.team !== team && members.length < size && !room.ranked;
        return h(
          'section',
          { class: 'team', style: `--team-color: ${TEAM_COLORS[team]}`, 'aria-label': TEAM_NAMES[team] },
          h(
            'header',
            { class: 'team-head' },
            h('span', { class: 'team-name' }, TEAM_NAMES[team]),
            h('span', { class: 'team-count mono' }, `${members.length}/${size}`),
            canJoin ? h('button', { class: 'btn btn-sm', type: 'button', onClick: () => onTeam(team) }, '이 팀으로') : null,
          ),
          h('div', { class: 'team-slots' }, ...cards),
        );
      }),
    );
  }

  function update(room) {
    title.textContent = room.name;
    renderSettings(room);
    renderTeams(room);

    myReady = Boolean(room.players.find((p) => p.uid === me.uid)?.ready);
    readyButton.textContent = myReady ? '준비 취소' : '준비';
    readyButton.classList.toggle('btn-primary', !myReady);

    const full = room.players.length === room.maxPlayers;
    hint.textContent = !full
      ? `${room.maxPlayers - room.players.length}명 더 들어오면 모두 준비를 눌러 시작합니다.`
      : room.players.every((p) => p.ready)
        ? '모두 준비했습니다. 곧 시작합니다.'
        : '모두 준비하면 게임이 시작됩니다.';
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
