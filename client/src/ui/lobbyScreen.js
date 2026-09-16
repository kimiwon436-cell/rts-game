import { ROOM_NAME_MAX } from '@rune/shared/constants.js';
import { ROOM_STATUS } from '@rune/shared/protocol.js';
import { h } from './dom.js';

const STATUS_LABEL = {
  [ROOM_STATUS.WAITING]: '가득 참',
  [ROOM_STATUS.STARTING]: '시작 중',
  [ROOM_STATUS.PLAYING]: '진행 중',
};

export function createLobbyScreen({ me, onCreate, onJoin, onOpenReplay }) {
  const conn = h('span', { class: 'conn' }, '연결됨');
  const ping = h('span', { class: 'mono' }, '— ms');
  const list = h('ul', { class: 'room-list' });

  const nameInput = h('input', {
    class: 'input',
    id: 'room-name',
    name: 'room-name',
    maxlength: ROOM_NAME_MAX,
    placeholder: `${me.nickname}의 방`,
  });
  const createButton = h('button', { class: 'btn btn-primary', type: 'submit' }, '방 만들기');
  const createForm = h(
    'form',
    {
      class: 'create-form',
      onSubmit: async (event) => {
        event.preventDefault();
        createButton.disabled = true;
        try {
          await onCreate(nameInput.value);
        } finally {
          createButton.disabled = false;
        }
      },
    },
    h('label', { class: 'label', for: 'room-name' }, '방 이름'),
    nameInput,
    createButton,
    h('p', { class: 'note' }, '방을 만들면 다른 플레이어가 목록에서 입장할 수 있습니다.'),
  );

  const replayPanel = h(
    'section',
    { class: 'panel', 'aria-labelledby': 'replay-title' },
    h('h2', { class: 'panel-title', id: 'replay-title' }, '리플레이'),
    h('p', { class: 'note' }, '경기가 끝나면 결과 화면에서 저장할 수 있습니다 (.rcr 파일).'),
    h('button', { class: 'btn', type: 'button', onClick: () => onOpenReplay?.() }, '리플레이 파일 열기'),
  );

  const el = h(
    'main',
    { class: 'screen' },
    h(
      'div',
      { class: 'lobby' },
      h(
        'header',
        { class: 'topbar' },
        h('p', { class: 'brand' }, 'Rune ', h('span', { class: 'amp' }, '&'), ' Crown'),
        h('div', { class: 'who' }, h('strong', {}, me.nickname), conn, ping),
      ),
      h(
        'div',
        { class: 'lobby-grid' },
        h(
          'section',
          { class: 'panel', 'aria-labelledby': 'rooms-title' },
          h('h2', { class: 'panel-title', id: 'rooms-title' }, '열린 방'),
          list,
        ),
        h(
          'div',
          { class: 'lobby-side' },
          h(
            'section',
            { class: 'panel', 'aria-labelledby': 'create-title' },
            h('h2', { class: 'panel-title', id: 'create-title' }, '새 방'),
            createForm,
          ),
          replayPanel,
        ),
      ),
    ),
  );

  function setRooms(rooms) {
    if (rooms.length === 0) {
      list.replaceChildren(h('li', { class: 'empty' }, '아직 열린 방이 없습니다. 새 방을 만들어 보세요.'));
      return;
    }
    list.replaceChildren(
      ...rooms.map((room) => {
        const joinable = room.status === ROOM_STATUS.WAITING && room.players < room.maxPlayers;
        return h(
          'li',
          { class: 'room-row' },
          h('span', { class: 'room-name', title: room.name }, room.name),
          h('span', { class: 'room-count' }, `${room.players}/${room.maxPlayers}`),
          joinable
            ? h('button', { class: 'btn btn-sm', type: 'button', onClick: () => onJoin(room.id) }, '입장')
            : h(
                'span',
                { class: room.status === ROOM_STATUS.WAITING ? 'badge' : 'badge badge-playing' },
                STATUS_LABEL[room.status],
              ),
        );
      }),
    );
  }

  return {
    el,
    setRooms,
    setPing: (ms) => {
      ping.textContent = `${ms} ms`;
    },
    setOnline: (online) => {
      conn.textContent = online ? '연결됨' : '연결 끊김';
      conn.classList.toggle('offline', !online);
    },
  };
}
