import './styles.css';
import { EV, ERR } from '@rune/shared/protocol.js';
import { GAME_MODES, MAP_LIST } from '@rune/shared/map/maps/index.js';
import { NICKNAME_MESSAGES } from '@rune/shared/rules/nickname.js';
import { SERVER_URL } from './config.js';
import { authErrorMessage, createAuth } from './auth.js';
import { checkNickname, connectToServer, request, startPing } from './net/socket.js';
import { toast } from './ui/toast.js';
import { errorMessage } from './ui/messages.js';
import { createAuthScreen } from './ui/authScreen.js';
import { createNicknameScreen } from './ui/nicknameScreen.js';
import { createStatusScreen } from './ui/statusScreen.js';
import { createLobbyScreen } from './ui/lobbyScreen.js';
import { createRoomScreen } from './ui/roomScreen.js';
import { createGameView } from './game/GameView.js';
import { createReplayView } from './game/ReplayView.js';
import { createRecorder, decodeReplay, pickReplayFile } from './game/replayFile.js';

const app = document.getElementById('app');
const canvas = document.getElementById('game');

const state = {
  auth: null, // createAuth() 결과
  session: null, // { mode, uid, email, getToken } — 로그인한 계정
  profile: null, // 서버가 보낸 프로필 { uid, nickname, ratings, ... }
  pendingNickname: null, // 가입 폼에서 고른 닉네임. 접속하자마자 예약한다
  socket: null,
  stopPing: null,
  ping: null,
  rooms: [],
  room: null, // 내가 들어간 방
  recorder: null, // 지금 경기의 리플레이 녹화 (재접속해도 이어서 쌓는다)
  ranked: null, // 랭킹전 대기 상태 { mode, waitingSec, queueSize }
  gameEnded: false, // 결과 화면을 보고 있는 중 (방이 닫혀도 로비로 끌어내지 않는다)
  view: null, // 'loading' | 'auth' | 'nickname' | 'lobby' | 'room' | 'game' | 'replay' | 'status'
  screen: null,
};
if (import.meta.env.DEV) window.__rune = state;

const me = () => ({ uid: state.session.uid, nickname: state.profile?.nickname ?? '' });

/** 화면을 바꾼다. 이전 화면은 destroy로 정리한다. */
function show(view, screen) {
  state.screen?.destroy?.();
  state.view = view;
  state.screen = screen;
  app.replaceChildren(screen.el);
  if (state.ping != null) screen.setPing?.(state.ping);
  screen.focus?.();
}

const showStatus = (title, message = '', actions = []) => show('status', createStatusScreen({ title, message, actions }));

// ---------- 로그인 ----------

async function boot() {
  showStatus('불러오는 중…');
  try {
    state.auth = await createAuth();
  } catch (err) {
    console.error('[로그인 서비스]', err);
    showStatus('로그인 서비스를 불러오지 못했습니다', authErrorMessage(err), [
      { label: '새로고침', primary: true, onClick: () => location.reload() },
    ]);
    return;
  }
  // 저장된 로그인이 있으면 바로 들어가고, 없으면 로그인 화면을 띄운다 (브라우저를 닫았다 열어도 유지)
  state.auth.onChange(onSession);
}

function onSession(session) {
  if (!session) {
    state.session = null;
    state.profile = null;
    closeSocket();
    if (state.view !== 'replay') showAuth();
    return;
  }
  if (state.session?.uid === session.uid && state.socket) return; // 같은 계정의 토큰 갱신
  state.session = session;
  connect();
}

function showAuth(errorText = '') {
  const screen = createAuthScreen({
    mode: state.auth.mode,
    onSignIn: (email, password) => state.auth.signIn(email, password),
    onSignUp: async (email, password, nickname) => {
      state.pendingNickname = nickname; // 계정이 만들어지면 접속하자마자 이 닉네임을 예약한다
      try {
        await state.auth.signUp(email, password);
      } catch (err) {
        state.pendingNickname = null;
        throw err;
      }
    },
    onResetPassword: (email) => state.auth.sendPasswordReset(email),
    onCheckNickname: checkNickname,
    onOpenReplay: openReplay,
  });
  show('auth', screen);
  if (errorText) screen.showError(errorText);
}

async function signOut() {
  closeSocket();
  state.profile = null;
  await state.auth.signOut(); // onSession(null)이 로그인 화면을 띄운다
}

function profileErrorMessage(res) {
  if (res.error === ERR.NICKNAME_INVALID) return NICKNAME_MESSAGES[res.reason] ?? errorMessage(res.error);
  return errorMessage(res.error);
}

/** 닉네임을 예약한다. 성공하면 서버가 SESSION_PROFILE로 알려 로비로 간다. 실패하면 문장을 돌려준다. */
async function claimNickname(nickname) {
  const res = await request(state.socket, EV.PROFILE_CREATE, { nickname });
  if (res.ok) return null;
  return profileErrorMessage(res);
}

function showNicknameScreen(value = '', errorText = '') {
  show(
    'nickname',
    createNicknameScreen({
      email: state.session?.email,
      value,
      errorText,
      onSubmit: claimNickname,
      onCheckNickname: checkNickname,
      onSignOut: signOut,
    }),
  );
}

// ---------- 소켓 ----------

async function connect() {
  showStatus('게임 서버에 연결하는 중…');
  try {
    await openSocket();
  } catch (err) {
    showStatus('연결하지 못했습니다', err.message, [
      { label: '다시 시도', primary: true, onClick: connect },
      { label: '로그아웃', onClick: signOut },
    ]);
  }
}

function openSocket() {
  closeSocket();
  const socket = connectToServer({ getToken: state.session.getToken });
  state.socket = socket;

  socket.on(EV.SESSION_PROFILE, async (profile) => {
    state.profile = profile;
    if (profile) {
      state.pendingNickname = null;
      if (['status', 'auth', 'nickname'].includes(state.view)) showLobby();
      else state.screen?.setProfile?.(profile); // 랭킹전 뒤 레이팅이 바뀌었다
      return;
    }
    // 가입 폼에서 고른 닉네임이 있으면 바로 예약한다. 먼저 누가 가져갔으면 닉네임 화면에서 다시 고른다
    const wanted = state.pendingNickname;
    state.pendingNickname = null;
    const problem = wanted ? await claimNickname(wanted) : '';
    if (problem !== null) showNicknameScreen(wanted ?? '', problem);
  });
  socket.on(EV.RANKED_STATUS, (status) => {
    if (status?.cancelled) toast('상대가 나가 매칭이 취소됐습니다. 다시 찾는 중…', { error: true });
    state.ranked = status?.cancelled ? null : status;
    if (state.view === 'lobby') state.screen.setRankedStatus(state.ranked);
  });
  socket.on(EV.RANKED_FOUND, ({ mode, mapId }) => {
    state.ranked = null;
    const map = MAP_LIST.find((m) => m.id === mapId)?.name ?? mapId;
    toast(`매칭됐습니다! ${GAME_MODES[mode].name} · ${map} — 곧 시작합니다`);
  });
  socket.on(EV.RANKED_RESULT, (payload) => {
    if (state.view === 'game') state.screen.setRankedResult?.(payload);
  });
  socket.on(EV.GAME_END, () => {
    state.gameEnded = true;
  });
  socket.on(EV.LOBBY_UPDATE, (rooms) => {
    state.rooms = rooms;
    if (state.view === 'lobby') state.screen.setRooms(rooms);
  });
  socket.on(EV.LOBBY_ROOM, onRoom);
  socket.on(EV.GAME_COUNTDOWN, ({ seconds }) => {
    if (state.view === 'room') state.screen.setCountdown(seconds);
  });
  socket.on(EV.GAME_START, (payload) => startGame(payload));
  socket.on(EV.GAME_RESUME, (payload) => {
    toast('경기에 다시 들어왔습니다.');
    startGame(payload, { resume: true });
  });
  socket.on(EV.SESSION_REPLACED, () => {
    closeSocket();
    showStatus('다른 곳에서 접속했습니다', '같은 계정으로 다른 탭이나 기기에서 접속해 이 화면의 연결이 끊어졌습니다.', [
      { label: '여기서 다시 접속', primary: true, onClick: connect },
      { label: '로그아웃', onClick: signOut },
    ]);
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
      // 재연결: 서버가 SESSION_PROFILE, LOBBY_ROOM(경기 중이면 GAME_RESUME도)으로 상태를 다시 알려 준다
      toast('서버에 다시 연결했습니다.');
    });

    socket.on('connect_error', (err) => {
      const known = err.message === ERR.UNAUTHORIZED || err.message === ERR.UNAVAILABLE;
      if (!firstConnect) {
        if (known) {
          closeSocket();
          showStatus('연결이 끊어졌습니다', errorMessage(err.message), [
            { label: '다시 접속', primary: true, onClick: connect },
            { label: '로그아웃', onClick: signOut },
          ]);
        }
        return;
      }
      closeSocket();
      reject(new Error(known ? errorMessage(err.message) : `게임 서버(${SERVER_URL})에 연결할 수 없습니다. 서버가 켜져 있는지 확인하세요.`));
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
  const screen = createLobbyScreen({
    me: me(),
    profile: state.profile,
    onCreate: createRoom,
    onJoin: joinRoom,
    onOpenReplay: openReplay,
    onSignOut: signOut,
    onRankedJoin: async (mode) => {
      const res = await request(state.socket, EV.RANKED_JOIN, { mode });
      if (!res.ok) toast(errorMessage(res.error), { error: true });
    },
    onRankedLeave: () => request(state.socket, EV.RANKED_LEAVE),
    onLoadLeaderboard: (mode) => request(state.socket, EV.RANKED_LEADERBOARD, { mode }),
  });
  show('lobby', screen);
  screen.setRankedStatus(state.ranked);
  screen.setOnline(Boolean(state.socket?.connected));
  screen.setRooms(state.rooms);
  request(state.socket, EV.LOBBY_LIST).then((res) => {
    if (!res.ok) return;
    state.rooms = res.rooms;
    if (state.screen === screen) screen.setRooms(res.rooms);
  });
}

async function createRoom(name, mode) {
  const res = await request(state.socket, EV.LOBBY_CREATE, { name, mode });
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

async function setTeam(team) {
  const res = await request(state.socket, EV.LOBBY_TEAM, { team });
  if (!res.ok) toast(errorMessage(res.error), { error: true });
}

async function changeSettings(settings) {
  const res = await request(state.socket, EV.LOBBY_SETTINGS, settings);
  if (!res.ok) {
    toast(errorMessage(res.error), { error: true });
    if (state.room && state.view === 'room') state.screen.update(state.room); // 고른 값을 되돌린다
  }
}

const roomScreen = () =>
  createRoomScreen({ me: me(), onReady: setReady, onLeave: leaveRoom, onTeam: setTeam, onSettings: changeSettings });

async function leaveRoom() {
  await request(state.socket, EV.LOBBY_LEAVE);
  if (state.view !== 'lobby') showLobby();
}

/** 서버가 알려준 내 방 상태를 화면에 반영한다. room이 null이면 방에서 나온 것이다. */
function onRoom(room) {
  state.room = room;
  if (!room) {
    if (state.view === 'game' && state.gameEnded) return; // 결과 화면은 그대로 (랭킹전은 끝나면 방이 닫힌다)
    if (state.view === 'room' || state.view === 'game') showLobby();
    return;
  }
  if (state.view === 'game') {
    state.screen.updateRoom(room);
    return;
  }
  if (state.view !== 'room') show('room', roomScreen());
  state.screen.update(room);
}

// ---------- 게임 ----------

function startGame({ roomId, mapId, players, ranked = false }, { resume = false } = {}) {
  state.gameEnded = false;
  state.ranked = null;
  console.log(`[게임 ${resume ? '재접속' : '시작'}] 방 ${roomId} · 맵 ${mapId}`);
  // 재접속이면 같은 경기의 녹화를 이어서 쌓는다 (중간의 전체 스냅샷이 상태를 다시 맞춘다)
  if (!resume || state.recorder?.roomId !== roomId) {
    const mySlot = players.find((p) => p.uid === state.session.uid)?.slot ?? 0;
    state.recorder = createRecorder({ mapId, players, mySlot });
    state.recorder.roomId = roomId;
  }
  show(
    'game',
    createGameView({
      canvas,
      socket: state.socket,
      mapId,
      players,
      me: me(),
      recorder: state.recorder,
      ranked,
      roomName: state.room?.name ?? '',
      onLeave: leaveRoom,
      onReturnToRoom: returnToRoom,
    }),
  );
}

/** 경기가 끝난 뒤 같은 방의 대기실로 돌아간다 (방이 없으면 로비로) */
function returnToRoom() {
  if (!state.room) {
    showLobby();
    return;
  }
  show('room', roomScreen());
  state.screen.update(state.room);
}

// ---------- 리플레이 ----------

async function openReplay() {
  const file = await pickReplayFile();
  if (!file) return;
  let replay;
  try {
    replay = await decodeReplay(file);
  } catch (err) {
    toast(err.message, { error: true });
    return;
  }
  show(
    'replay',
    createReplayView({
      canvas,
      replay,
      // 로그인해 있으면 로비로, 로그인 화면에서 열었으면 로그인 화면으로
      onExit: () => {
        if (!state.session) showAuth();
        else if (state.profile && state.socket) showLobby();
        else connect();
      },
    }),
  );
}

boot();
