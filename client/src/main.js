import './styles.css';
import { EV, ERR } from '@rune/shared/protocol.js';
import { NICKNAME_MAX } from '@rune/shared/constants.js';
import { FIREBASE_CONFIG, SERVER_URL } from './config.js';
import { signIn, authErrorMessage } from './auth.js';
import { connectToServer, request, startPing } from './net/socket.js';
import { readStorage, writeStorage } from './ui/dom.js';
import { toast } from './ui/toast.js';
import { errorMessage } from './ui/messages.js';
import { createTitleScreen } from './ui/titleScreen.js';
import { createLobbyScreen } from './ui/lobbyScreen.js';
import { createRoomScreen } from './ui/roomScreen.js';
import { createGameView } from './game/GameView.js';

const NICKNAME_KEY = 'rune.nickname';
const app = document.getElementById('app');
const canvas = document.getElementById('game');

const state = {
  session: null, // { mode, uid, getToken, saveProfile }
  nickname: '',
  socket: null,
  stopPing: null,
  ping: null,
  rooms: [],
  room: null, // 내가 들어간 방
  view: null, // 'title' | 'lobby' | 'room' | 'game'
  screen: null,
};
if (import.meta.env.DEV) window.__rune = state;

const me = () => ({ uid: state.session.uid, nickname: state.nickname });

/** 화면을 바꾼다. 이전 화면은 destroy로 정리한다. */
function show(view, screen) {
  state.screen?.destroy?.();
  state.view = view;
  state.screen = screen;
  app.replaceChildren(screen.el);
  if (state.ping != null) screen.setPing?.(state.ping);
}

// ---------- 입장 ----------

function showTitle(errorText = '') {
  closeSocket();
  const screen = createTitleScreen({
    nickname: readStorage(NICKNAME_KEY) ?? '',
    modeLabel: FIREBASE_CONFIG
      ? 'Firebase 익명 로그인으로 접속합니다.'
      : '개발 모드 · Firebase 설정이 없어 게스트로 접속합니다.',
    onSubmit: enter,
  });
  show('title', screen);
  if (errorText) screen.showError(errorText);
  screen.focus();
}

async function enter(nickname) {
  state.nickname = nickname.slice(0, NICKNAME_MAX);
  writeStorage(NICKNAME_KEY, state.nickname);

  if (!state.session) {
    try {
      state.session = await signIn();
    } catch (err) {
      console.error('[로그인 실패]', err);
      throw new Error(authErrorMessage(err));
    }
  }
  state.session
    .saveProfile(state.nickname)
    .catch((err) => console.warn('[Firestore] 프로필을 저장하지 못했습니다', err));

  await openSocket();
  showLobby();
}

// ---------- 소켓 ----------

function openSocket() {
  closeSocket();
  const socket = connectToServer({ getToken: state.session.getToken, getNickname: () => state.nickname });
  state.socket = socket;

  socket.on(EV.LOBBY_UPDATE, (rooms) => {
    state.rooms = rooms;
    if (state.view === 'lobby') state.screen.setRooms(rooms);
  });
  socket.on(EV.LOBBY_ROOM, onRoom);
  socket.on(EV.GAME_COUNTDOWN, ({ seconds }) => {
    if (state.view === 'room') state.screen.setCountdown(seconds);
  });
  socket.on(EV.GAME_START, startGame);
  socket.on(EV.SESSION_REPLACED, () => {
    showTitle('다른 탭에서 같은 계정으로 접속해 이 탭의 연결이 끊어졌습니다.');
  });
  socket.on('disconnect', (reason) => {
    state.screen?.setOnline?.(false);
    if (reason === 'io client disconnect' || reason === 'io server disconnect') return;
    toast('서버와 연결이 끊어졌습니다. 다시 연결하는 중…', { error: true });
  });

  return new Promise((resolve, reject) => {
    let firstConnect = true;

    socket.on('connect', () => {
      console.log(`[소켓] 연결됨 uid=${state.session.uid}`);
      state.screen?.setOnline?.(true);
      if (firstConnect) {
        firstConnect = false;
        state.stopPing = startPing(socket, (ms) => {
          state.ping = ms;
          state.screen?.setPing?.(ms);
        });
        resolve();
        return;
      }
      // 재연결: 서버는 끊긴 플레이어를 방에서 뺐으므로 로비에서 다시 시작한다
      toast('서버에 다시 연결했습니다.');
      if (state.view !== 'lobby') showLobby();
    });

    socket.on('connect_error', (err) => {
      if (err.message === ERR.UNAUTHORIZED) {
        if (firstConnect) {
          closeSocket();
          reject(new Error(errorMessage(ERR.UNAUTHORIZED)));
        } else {
          showTitle(errorMessage(ERR.UNAUTHORIZED));
        }
        return;
      }
      if (firstConnect) {
        closeSocket();
        reject(new Error(`게임 서버(${SERVER_URL})에 연결할 수 없습니다. 서버가 켜져 있는지 확인하세요.`));
      }
    });
  });
}

function closeSocket() {
  state.stopPing?.();
  state.stopPing = null;
  if (state.socket) {
    state.socket.removeAllListeners();
    state.socket.disconnect();
    state.socket = null;
  }
  state.room = null;
}

// ---------- 로비와 대기실 ----------

function showLobby() {
  const screen = createLobbyScreen({ me: me(), onCreate: createRoom, onJoin: joinRoom });
  show('lobby', screen);
  screen.setOnline(Boolean(state.socket?.connected));
  screen.setRooms(state.rooms);
  request(state.socket, EV.LOBBY_LIST).then((res) => {
    if (!res.ok) return;
    state.rooms = res.rooms;
    if (state.screen === screen) screen.setRooms(res.rooms);
  });
}

async function createRoom(name) {
  const res = await request(state.socket, EV.LOBBY_CREATE, { name });
  if (res.ok) onRoom(res.room);
  else toast(errorMessage(res.error), { error: true });
}

async function joinRoom(roomId) {
  const res = await request(state.socket, EV.LOBBY_JOIN, { roomId });
  if (res.ok) onRoom(res.room);
  else toast(errorMessage(res.error), { error: true });
}

async function setReady(ready) {
  const res = await request(state.socket, EV.LOBBY_READY, { ready });
  if (!res.ok) toast(errorMessage(res.error), { error: true });
}

async function leaveRoom() {
  await request(state.socket, EV.LOBBY_LEAVE);
  if (state.view !== 'lobby') showLobby();
}

/** 서버가 알려준 내 방 상태를 화면에 반영한다. room이 null이면 방에서 나온 것이다. */
function onRoom(room) {
  state.room = room;
  if (!room) {
    if (state.view === 'room') showLobby();
    return;
  }
  if (state.view === 'game') {
    state.screen.updateRoom(room);
    return;
  }
  if (state.view !== 'room') {
    show('room', createRoomScreen({ me: me(), onReady: setReady, onLeave: leaveRoom }));
  }
  state.screen.update(room);
}

// ---------- 게임 ----------

function startGame({ roomId, mapId, players }) {
  console.log(`[게임 시작] 방 ${roomId} · 맵 ${mapId}`);
  show(
    'game',
    createGameView({
      canvas,
      mapId,
      players,
      me: me(),
      roomName: state.room?.name ?? '',
      onLeave: leaveRoom,
    }),
  );
}

showTitle();
