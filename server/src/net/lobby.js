import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { EV, ERR, ROOM_STATUS } from '@rune/shared/protocol.js';
import { ROOM_NAME_MAX, START_COUNTDOWN_SEC } from '@rune/shared/constants.js';
import { GAME_MODES, MAP_LIST, defaultMapFor } from '@rune/shared/map/maps/index.js';
import { NICKNAME_ERROR } from '@rune/shared/rules/nickname.js';
import { cleanText } from './auth.js';
import { Match } from '../game/Match.js';
import { saveMatchResult } from '../persistence/matches.js';
import { MemoryProfileStore, ProfileError } from '../persistence/profiles.js';

const LOBBY_CHANNEL = 'lobby';
/** 방 목록은 이 시간 안의 변화를 모아 한 번에 보낸다 (로비에 사람이 많을 때 방 하나가 바뀔 때마다 모두에게 보내지 않게) */
const LIST_BROADCAST_MS = 250;
const channelOf = (roomId) => `room:${roomId}`;

const ok = (data = {}) => ({ ok: true, ...data });
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

/** 클라이언트에 보내는 프로필 (저장소 내부 필드는 빼고) */
export const publicProfile = (p) =>
  p && { uid: p.uid, nickname: p.nickname, ratings: p.ratings, ranked: p.ranked, wins: p.wins, losses: p.losses, matches: p.matches };

/**
 * 방 목록, 입장, 준비, 시작 카운트다운, 경기 수명 관리. 상태는 서버 메모리에만 있다.
 * 한 uid는 동시에 소켓 하나, 방 하나에만 속한다.
 * 경기 중에 연결이 끊기면 유예 시간 동안 자리를 지켜 주고, 그 안에 돌아오면 이어서 한다.
 */
/**
 * 로비가 내는 이벤트 (매칭·채팅이 듣는다)
 * - socketReady (socket)             로비 이벤트가 열린 소켓
 * - enterRoom (uid)                  방에 들어간다 (대기열에서 빼야 한다)
 * - playerJoined (room, player, socket) / playerLeft (room, player) / playerRejoined (room, socket)
 * - rankedAbort (room, uids)         시작 전에 랭킹전 방이 깨졌다
 * - matchEnd (room, result, record)  경기가 끝났다
 * - roomClosed (room)
 */
export class Lobby extends EventEmitter {
  constructor(io, { countdownSec = START_COUNTDOWN_SEC, reconnectGraceSec = 60, profiles = new MemoryProfileStore() } = {}) {
    super();
    this.io = io;
    this.profiles = profiles;
    this.countdownSec = countdownSec;
    this.reconnectGraceSec = reconnectGraceSec;
    this.rooms = new Map(); // roomId → room
    this.roomOfUid = new Map(); // uid → roomId
    this.socketOfUid = new Map(); // uid → socket
    this.listTimer = null;
  }

  /** ack 응답이 있는 이벤트를 연결한다. 처리 함수는 값이나 Promise를 돌려준다. */
  bind(socket, event, handler) {
    socket.on(event, (payload, ack) => {
      if (typeof payload === 'function') {
        ack = payload;
        payload = undefined;
      }
      const reply = typeof ack === 'function' ? ack : () => {};
      const body = payload !== null && typeof payload === 'object' ? payload : {};
      Promise.resolve()
        .then(() => handler(body))
        .then(reply, (err) => {
          console.error('명령 처리 중 오류', event, err);
          reply(fail(ERR.INVALID_PAYLOAD));
        });
    });
  }

  attach(socket) {
    const { uid } = socket.data;

    const previous = this.socketOfUid.get(uid);
    if (previous && previous.id !== socket.id) {
      previous.emit(EV.SESSION_REPLACED);
      previous.disconnect(true);
    }
    this.socketOfUid.set(uid, socket);

    this.bind(socket, EV.NET_PING, () => ok({ serverTime: Date.now() }));
    this.bind(socket, EV.PROFILE_CREATE, (body) => this.createProfile(socket, body));
    socket.on('disconnect', (reason) => {
      console.log('[접속 종료]', uid, reason);
      if (this.socketOfUid.get(uid) !== socket) return; // 새 세션으로 교체된 소켓
      this.socketOfUid.delete(uid);
      this.handleDisconnect(socket);
    });

    // 가입만 하고 닉네임을 아직 정하지 않았으면 로비에 들이지 않는다
    if (socket.data.profile) this.enterLobby(socket);
    else socket.emit(EV.SESSION_PROFILE, null);
  }

  /** 닉네임을 정해 프로필을 만든다 (가입 직후 한 번). 중복은 저장소가 트랜잭션으로 막는다. */
  async createProfile(socket, { nickname }) {
    if (socket.data.profile) return fail(ERR.PROFILE_EXISTS);
    let profile;
    try {
      profile = await this.profiles.create(socket.data.uid, nickname);
    } catch (err) {
      if (!(err instanceof ProfileError)) {
        console.error('[프로필 만들기 실패]', socket.data.uid, err);
        return fail(ERR.UNAVAILABLE);
      }
      if (err.code === 'PROFILE_EXISTS') return fail(ERR.PROFILE_EXISTS);
      if (err.code === NICKNAME_ERROR.TAKEN) return fail(ERR.NICKNAME_TAKEN);
      return fail(ERR.NICKNAME_INVALID, { reason: err.code });
    }
    console.log('[가입]', socket.data.uid, profile.nickname);
    socket.data.profile = profile;
    socket.data.nickname = profile.nickname;
    if (socket.connected) this.enterLobby(socket);
    return ok({ profile: publicProfile(profile) });
  }

  /** 프로필이 있는 소켓에 로비 이벤트를 열고, 남아 있던 방이 있으면 다시 붙인다 */
  enterLobby(socket) {
    if (socket.data.inLobby) return;
    socket.data.inLobby = true;
    const { uid } = socket.data;
    socket.join(LOBBY_CHANNEL);
    socket.emit(EV.SESSION_PROFILE, publicProfile(socket.data.profile));

    this.bind(socket, EV.LOBBY_LIST, () => ok({ rooms: this.summaries() }));
    this.bind(socket, EV.LOBBY_CREATE, (body) => this.create(socket, body));
    this.bind(socket, EV.LOBBY_JOIN, (body) => this.join(socket, body));
    this.bind(socket, EV.LOBBY_LEAVE, () => this.leave(socket));
    this.bind(socket, EV.LOBBY_READY, (body) => this.setReady(socket, body));
    this.bind(socket, EV.LOBBY_TEAM, (body) => this.setTeam(socket, body));
    this.bind(socket, EV.LOBBY_SETTINGS, (body) => this.setSettings(socket, body));
    this.emit('socketReady', socket);

    // 게임 명령은 응답 없이 경기로 넘긴다. 거부되면 경기가 GAME_REJECT를 보낸다.
    socket.on(EV.GAME_CMD, (cmd) => {
      this.roomOf(socket)?.match?.enqueue(uid, cmd);
    });

    // 방에 남아 있던 uid면 다시 붙여 준다 (재접속, 또는 다른 탭에서 이어받기)
    const room = this.roomOfUid.has(uid) ? this.rooms.get(this.roomOfUid.get(uid)) : null;
    if (room) this.rejoin(socket, room);
    else socket.emit(EV.LOBBY_ROOM, null);
  }

  /** 돌아온 플레이어를 방 채널에 다시 넣고, 경기 중이면 이어서 보게 한다 */
  rejoin(socket, room) {
    const uid = socket.data.uid;
    const player = room.players.find((p) => p.uid === uid);
    if (!player) return;

    clearTimeout(player.graceTimer);
    player.graceTimer = null;
    player.connected = true;
    socket.join(channelOf(room.id));

    if (room.status === ROOM_STATUS.PLAYING && room.match) {
      socket.emit(EV.GAME_RESUME, this.startPayload(room));
      room.match.markNeedsFull(uid);
      console.log('[재접속]', room.id, uid);
    }
    socket.emit(EV.LOBBY_ROOM, this.detail(room));
    this.broadcastRoom(room);
    this.emit('playerRejoined', room, socket, player);
  }

  /** 연결이 끊겼다: 경기 중이면 유예 시간 동안 기다리고, 아니면 바로 방에서 뺀다 */
  handleDisconnect(socket) {
    const room = this.roomOf(socket);
    if (!room) return;
    if (room.status !== ROOM_STATUS.PLAYING || !room.match) {
      this.removeFromRoom(socket);
      return;
    }
    const uid = socket.data.uid;
    const player = room.players.find((p) => p.uid === uid);
    if (!player) return;

    player.connected = false;
    player.graceTimer = setTimeout(() => this.dropPlayer(room, uid), this.reconnectGraceSec * 1000);
    player.graceTimer.unref?.();
    console.log('[연결 끊김]', room.id, uid, this.reconnectGraceSec + '초 기다립니다');
    this.broadcastRoom(room);
    this.emit('playerDisconnected', room, player);
  }

  /** 유예 시간이 끝났다: 돌아오지 않은 플레이어는 패배하고 방에서 빠진다 */
  dropPlayer(room, uid) {
    if (this.rooms.get(room.id) !== room) return;
    const player = room.players.find((p) => p.uid === uid);
    if (!player || player.connected) return;

    clearTimeout(player.graceTimer);
    console.log('[유예 종료]', room.id, uid);
    this.roomOfUid.delete(uid);
    room.players = room.players.filter((p) => p.uid !== uid);
    room.match?.removePlayer(uid);
    this.emit('playerLeft', room, player);

    if (room.players.length === 0) {
      room.match?.stop();
      this.rooms.delete(room.id);
      this.emit('roomClosed', room);
    } else {
      if (room.hostUid === uid) room.hostUid = room.players[0].uid;
      this.broadcastRoom(room);
    }
    this.broadcastList();
  }

  // ---------- 방 ----------

  /** 새 방. 만든 사람이 방장이고, 경기 방식(1대1·2대2·3대3)과 맵을 정한다 */
  create(socket, { name, mode }) {
    const { uid, nickname } = socket.data;
    const gameMode = GAME_MODES[mode] ? mode : '1v1';
    this.emit('enterRoom', uid);
    this.removeFromRoom(socket);

    const room = {
      id: randomUUID().slice(0, 8),
      name: cleanText(name, ROOM_NAME_MAX) || nickname + '의 방',
      hostUid: uid,
      status: ROOM_STATUS.WAITING,
      mode: gameMode,
      mapId: defaultMapFor(gameMode),
      ranked: false,
      players: [], // [{ uid, nickname, team, slot, ready, connected, graceTimer, joinedAt }]
      countdownTimer: null,
      match: null,
      createdAt: Date.now(),
    };
    this.rooms.set(room.id, room);
    this.addPlayer(room, socket, 0);
    console.log('[방 생성]', room.id, room.name, gameMode, uid);
    return ok({ room: this.detail(room) });
  }

  join(socket, { roomId }) {
    if (typeof roomId !== 'string') return fail(ERR.INVALID_PAYLOAD);
    const room = this.rooms.get(roomId);
    if (!room) return fail(ERR.ROOM_NOT_FOUND);

    const { uid } = socket.data;
    if (this.roomOfUid.get(uid) === room.id) return ok({ room: this.detail(room) });
    if (room.ranked || room.status !== ROOM_STATUS.WAITING) return fail(ERR.ROOM_NOT_WAITING);
    if (room.players.length >= maxPlayersOf(room)) return fail(ERR.ROOM_FULL);

    this.emit('enterRoom', uid);
    this.removeFromRoom(socket);
    const [team0, team1] = teamCounts(room);
    this.addPlayer(room, socket, team1 < team0 ? 1 : 0); // 사람이 적은 팀으로
    console.log('[방 입장]', room.id, uid);
    return ok({ room: this.detail(room) });
  }

  leave(socket) {
    if (!this.roomOfUid.has(socket.data.uid)) return fail(ERR.NOT_IN_ROOM);
    this.removeFromRoom(socket);
    return ok();
  }

  /** 팀 바꾸기 (대기 중에만). 옮기면 준비가 풀린다 */
  setTeam(socket, { team }) {
    const room = this.roomOf(socket);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.ranked || room.status !== ROOM_STATUS.WAITING) return fail(ERR.ROOM_NOT_WAITING);
    if (team !== 0 && team !== 1) return fail(ERR.INVALID_PAYLOAD);
    const player = room.players.find((p) => p.uid === socket.data.uid);
    if (player.team === team) return ok({ room: this.detail(room) });
    if (teamCounts(room)[team] >= GAME_MODES[room.mode].teamSize) return fail(ERR.TEAM_FULL);

    player.team = team;
    player.ready = false;
    this.broadcastRoom(room);
    return ok({ room: this.detail(room) });
  }

  /** 방장이 경기 방식과 맵을 바꾼다. 바꾸면 모두의 준비가 풀린다 */
  setSettings(socket, { mode, mapId }) {
    const room = this.roomOf(socket);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostUid !== socket.data.uid) return fail(ERR.NOT_HOST);
    if (room.ranked || room.status !== ROOM_STATUS.WAITING) return fail(ERR.ROOM_NOT_WAITING);

    const nextMode = mode ?? room.mode;
    if (!GAME_MODES[nextMode]) return fail(ERR.INVALID_SETTINGS);
    const nextMap = mapId ?? (nextMode === room.mode ? room.mapId : defaultMapFor(nextMode));
    if (!MAP_LIST.some((m) => m.id === nextMap && m.mode === nextMode)) return fail(ERR.INVALID_SETTINGS);
    // 줄이면 넘치는 팀이 없어야 한다
    const size = GAME_MODES[nextMode].teamSize;
    if (teamCounts(room).some((count) => count > size)) return fail(ERR.ROOM_FULL);

    room.mode = nextMode;
    room.mapId = nextMap;
    for (const player of room.players) player.ready = false;
    this.broadcastRoom(room);
    this.broadcastList();
    return ok({ room: this.detail(room) });
  }

  setReady(socket, { ready }) {
    const room = this.roomOf(socket);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.ranked || room.status === ROOM_STATUS.PLAYING) return fail(ERR.ROOM_NOT_WAITING); // 랭킹전은 자동 시작

    const player = room.players.find((p) => p.uid === socket.data.uid);
    player.ready = Boolean(ready);
    if (room.status === ROOM_STATUS.STARTING && !player.ready) this.cancelCountdown(room);
    this.maybeStartCountdown(room);
    this.broadcastRoom(room);
    return ok({ room: this.detail(room) });
  }

  /**
   * 랭킹전 방을 연다. 매칭이 정한 팀 그대로 넣고, 준비 없이 바로 카운트다운한다.
   * 한 명이라도 접속이 끊겼거나 이미 방에 있으면 열지 않는다 (null).
   */
  openRankedRoom({ mode, mapId, players }) {
    const sockets = players.map((p) => this.socketOfUid.get(p.uid));
    if (sockets.some((socket, i) => !socket?.data.profile || this.roomOfUid.has(players[i].uid))) return null;

    const room = {
      id: randomUUID().slice(0, 8),
      name: `랭킹전 ${GAME_MODES[mode].name}`,
      hostUid: null,
      status: ROOM_STATUS.WAITING,
      mode,
      mapId,
      ranked: true,
      players: [],
      countdownTimer: null,
      match: null,
      createdAt: Date.now(),
    };
    this.rooms.set(room.id, room);
    players.forEach((p, i) => this.addPlayer(room, sockets[i], p.team, { ready: true }));
    this.maybeStartCountdown(room);
    console.log('[랭킹전 방]', room.id, mode, mapId);
    return room;
  }

  addPlayer(room, socket, team, { ready = false } = {}) {
    room.players.push({
      uid: socket.data.uid,
      nickname: socket.data.nickname,
      team,
      slot: null, // 경기를 시작할 때 맵의 시작 위치로 정한다
      ready,
      connected: true,
      graceTimer: null,
      joinedAt: Date.now(),
    });
    this.roomOfUid.set(socket.data.uid, room.id);
    socket.join(channelOf(room.id));
    this.broadcastRoom(room);
    this.broadcastList();
    this.emit('playerJoined', room, room.players[room.players.length - 1], socket);
  }

  removeFromRoom(socket) {
    const { uid } = socket.data;
    const roomId = this.roomOfUid.get(uid);
    if (!roomId) return;

    this.roomOfUid.delete(uid);
    socket.leave(channelOf(roomId));
    socket.emit(EV.LOBBY_ROOM, null);

    const room = this.rooms.get(roomId);
    if (!room) return;
    const leaving = room.players.find((p) => p.uid === uid);
    clearTimeout(leaving?.graceTimer);
    room.players = room.players.filter((p) => p.uid !== uid);
    room.match?.removePlayer(uid);
    if (leaving) this.emit('playerLeft', room, leaving);
    if (room.status === ROOM_STATUS.STARTING) this.cancelCountdown(room);

    // 랭킹전은 시작 전에 한 명이라도 나가면 깨진다. 남은 사람은 다시 매칭을 기다린다
    if (room.ranked && !room.match) {
      this.disband(room);
      this.emit('rankedAbort', room, room.players.map((p) => p.uid));
      this.broadcastList();
      return;
    }

    if (room.players.length === 0) {
      room.match?.stop();
      this.rooms.delete(room.id);
      this.emit('roomClosed', room);
      console.log('[방 삭제]', room.id);
    } else {
      if (room.hostUid === uid) room.hostUid = room.players[0].uid;
      this.broadcastRoom(room);
    }
    this.broadcastList();
  }

  /** 자리가 다 찼고, 팀 인원이 맞고, 모두 준비했으면 카운트다운 */
  maybeStartCountdown(room) {
    if (room.status !== ROOM_STATUS.WAITING) return;
    const size = GAME_MODES[room.mode].teamSize;
    if (room.players.length < maxPlayersOf(room) || !room.players.every((p) => p.ready)) return;
    if (teamCounts(room).some((count) => count !== size)) return;

    room.status = ROOM_STATUS.STARTING;
    this.io.to(channelOf(room.id)).emit(EV.GAME_COUNTDOWN, { seconds: this.countdownSec });
    room.countdownTimer = setTimeout(() => this.startGame(room), this.countdownSec * 1000);
    this.broadcastList();
  }

  cancelCountdown(room) {
    clearTimeout(room.countdownTimer);
    room.countdownTimer = null;
    room.status = ROOM_STATUS.WAITING;
    this.io.to(channelOf(room.id)).emit(EV.GAME_COUNTDOWN, { seconds: 0 });
    this.broadcastList();
  }

  /**
   * 시작 위치(슬롯)를 정한다: 맵에서 짝수 슬롯은 팀 0, 홀수 슬롯은 팀 1이다.
   * 각 팀 안에서는 먼저 들어온 사람부터 앞 슬롯을 받는다.
   */
  assignSlots(room) {
    for (const team of [0, 1]) {
      room.players
        .filter((p) => p.team === team)
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .forEach((player, i) => {
          player.slot = team + i * 2;
        });
    }
    room.players.sort((a, b) => a.slot - b.slot);
  }

  startPayload(room) {
    return {
      roomId: room.id,
      mapId: room.mapId,
      mode: room.mode,
      ranked: room.ranked,
      players: room.players.map(({ uid, nickname, slot, team }) => ({ uid, nickname, slot, team })),
    };
  }

  startGame(room) {
    room.countdownTimer = null;
    if (this.rooms.get(room.id) !== room || room.status !== ROOM_STATUS.STARTING) return;

    room.status = ROOM_STATUS.PLAYING;
    this.assignSlots(room);
    const payload = this.startPayload(room);
    this.io.to(channelOf(room.id)).emit(EV.GAME_START, payload);
    room.match = new Match({
      roomId: room.id,
      mapId: room.mapId,
      mode: room.mode,
      ranked: room.ranked,
      players: payload.players,
      getSocket: (uid) => this.socketOfUid.get(uid),
      onEnd: (result, record) => this.endGame(room, result, record),
    });
    room.match.start();
    this.broadcastRoom(room);
    this.broadcastList();
    this.emit('matchStart', room);
    const teams = [0, 1].map((team) => payload.players.filter((p) => p.team === team).map((p) => p.nickname).join('·'));
    console.log('[게임 시작]', room.id, room.mode, room.mapId, teams.join(' vs '));
  }

  /**
   * 경기가 끝나면 방을 대기 상태로 되돌린다. 같은 방에서 다시 준비해 재대결할 수 있다.
   * 전적 저장은 기다리지 않는다 — 실패해도 경기 진행에는 영향이 없다.
   */
  endGame(room, result, record) {
    if (this.rooms.get(room.id) !== room) return;
    room.match = null;
    room.status = ROOM_STATUS.WAITING;
    for (const player of room.players) {
      clearTimeout(player.graceTimer);
      player.graceTimer = null;
      player.ready = false;
    }
    this.broadcastRoom(room);
    this.broadcastList();

    const winners = result.players.filter((p) => p.team === result.winnerTeam).map((p) => p.nickname);
    console.log('[게임 종료]', room.id, '승리=' + (winners.join('·') || '없음'), result.reason, result.durationSec + '초');
    if (record) saveMatchResult(record).catch((err) => console.error('전적 저장 실패', err));
    this.emit('matchEnd', room, result, record);

    // 랭킹전은 같은 방에서 재대결하지 않는다: 방을 닫고 모두 로비로
    if (room.ranked) {
      this.disband(room);
      this.broadcastList();
      return;
    }

    // 끊긴 채로 경기가 끝난 사람은 방에서 뺀다 (돌아올 자리를 남겨 둘 이유가 없다)
    for (const player of [...room.players]) {
      if (!player.connected) this.dropPlayer(room, player.uid);
    }
  }

  /** 방을 없애고 남은 사람을 방에서 뺀다 (LOBBY_ROOM null) */
  disband(room) {
    clearTimeout(room.countdownTimer);
    this.rooms.delete(room.id);
    this.emit('roomClosed', room);
    for (const player of room.players) {
      clearTimeout(player.graceTimer);
      this.roomOfUid.delete(player.uid);
      const socket = this.socketOfUid.get(player.uid);
      socket?.leave(channelOf(room.id));
      socket?.emit(EV.LOBBY_ROOM, null);
    }
  }

  /** 서버를 닫을 때 진행 중인 카운트다운, 재접속 유예, 경기를 모두 멈춘다 */
  dispose() {
    clearTimeout(this.listTimer);
    this.listTimer = null;
    for (const room of this.rooms.values()) {
      clearTimeout(room.countdownTimer);
      for (const player of room.players) clearTimeout(player.graceTimer);
      room.match?.stop();
    }
  }

  roomOf(socket) {
    const roomId = this.roomOfUid.get(socket.data.uid);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  summaries() {
    return [...this.rooms.values()]
      .filter((r) => !r.ranked) // 랭킹전 방은 목록에 보이지 않는다
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => ({
        id: r.id,
        name: r.name,
        mode: r.mode,
        mapId: r.mapId,
        players: r.players.length,
        maxPlayers: maxPlayersOf(r),
        status: r.status,
      }));
  }

  detail(room) {
    return {
      id: room.id,
      name: room.name,
      hostUid: room.hostUid,
      status: room.status,
      mode: room.mode,
      mapId: room.mapId,
      ranked: room.ranked,
      maxPlayers: maxPlayersOf(room),
      players: room.players.map(({ uid, nickname, team, slot, ready, connected }) => ({
        uid,
        nickname,
        team,
        slot,
        ready,
        connected,
      })),
    };
  }

  broadcastRoom(room) {
    this.io.to(channelOf(room.id)).emit(EV.LOBBY_ROOM, this.detail(room));
  }

  broadcastList() {
    if (this.listTimer) return; // 곧 나갈 목록에 이번 변화도 담긴다
    this.listTimer = setTimeout(() => {
      this.listTimer = null;
      this.io.to(LOBBY_CHANNEL).emit(EV.LOBBY_UPDATE, this.summaries());
    }, LIST_BROADCAST_MS);
    this.listTimer.unref?.();
  }
}

const maxPlayersOf = (room) => GAME_MODES[room.mode].teamSize * 2;
const teamCounts = (room) => [0, 1].map((team) => room.players.filter((p) => p.team === team).length);
