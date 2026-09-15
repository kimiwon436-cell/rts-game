import { randomUUID } from 'node:crypto';
import { EV, ERR, ROOM_STATUS } from '@rune/shared/protocol.js';
import { MAX_PLAYERS, ROOM_NAME_MAX, START_COUNTDOWN_SEC } from '@rune/shared/constants.js';
import { DEFAULT_MAP_ID } from '@rune/shared/map/maps/index.js';
import { cleanText } from './auth.js';

const LOBBY_CHANNEL = 'lobby';
const channelOf = (roomId) => `room:${roomId}`;

const ok = (data = {}) => ({ ok: true, ...data });
const fail = (error) => ({ ok: false, error });

/**
 * 방 목록, 입장, 준비, 시작 카운트다운을 관리한다. 상태는 서버 메모리에만 있다.
 * 한 uid는 동시에 소켓 하나, 방 하나에만 속한다.
 */
export class Lobby {
  constructor(io, { countdownSec = START_COUNTDOWN_SEC } = {}) {
    this.io = io;
    this.countdownSec = countdownSec;
    this.rooms = new Map(); // roomId → room
    this.roomOfUid = new Map(); // uid → roomId
    this.socketOfUid = new Map(); // uid → socket
  }

  attach(socket) {
    const { uid } = socket.data;

    const previous = this.socketOfUid.get(uid);
    if (previous && previous.id !== socket.id) {
      this.removeFromRoom(previous);
      previous.emit(EV.SESSION_REPLACED);
      previous.disconnect(true);
    }
    this.socketOfUid.set(uid, socket);
    socket.join(LOBBY_CHANNEL);

    const handle = (event, handler) => {
      socket.on(event, (payload, ack) => {
        if (typeof payload === 'function') {
          ack = payload;
          payload = undefined;
        }
        const reply = typeof ack === 'function' ? ack : () => {};
        const body = payload !== null && typeof payload === 'object' ? payload : {};
        try {
          reply(handler(body));
        } catch (err) {
          console.error(`[${event}] 처리 중 오류`, err);
          reply(fail(ERR.INVALID_PAYLOAD));
        }
      });
    };

    handle(EV.NET_PING, () => ok({ serverTime: Date.now() }));
    handle(EV.LOBBY_LIST, () => ok({ rooms: this.summaries() }));
    handle(EV.LOBBY_CREATE, (body) => this.create(socket, body));
    handle(EV.LOBBY_JOIN, (body) => this.join(socket, body));
    handle(EV.LOBBY_LEAVE, () => this.leave(socket));
    handle(EV.LOBBY_READY, (body) => this.setReady(socket, body));

    socket.on('disconnect', (reason) => {
      console.log(`[접속 종료] uid=${uid} (${reason})`);
      if (this.socketOfUid.get(uid) !== socket) return; // 새 세션으로 교체된 소켓
      this.socketOfUid.delete(uid);
      this.removeFromRoom(socket);
    });
  }

  create(socket, { name }) {
    const { uid, nickname } = socket.data;
    this.removeFromRoom(socket);

    const room = {
      id: randomUUID().slice(0, 8),
      name: cleanText(name, ROOM_NAME_MAX) || `${nickname}의 방`,
      hostUid: uid,
      status: ROOM_STATUS.WAITING,
      mapId: DEFAULT_MAP_ID,
      players: [],
      countdownTimer: null,
      createdAt: Date.now(),
    };
    this.rooms.set(room.id, room);
    this.addPlayer(room, socket);
    console.log(`[방 생성] ${room.id} "${room.name}" uid=${uid}`);
    return ok({ room: this.detail(room) });
  }

  join(socket, { roomId }) {
    if (typeof roomId !== 'string') return fail(ERR.INVALID_PAYLOAD);
    const room = this.rooms.get(roomId);
    if (!room) return fail(ERR.ROOM_NOT_FOUND);

    const { uid } = socket.data;
    if (this.roomOfUid.get(uid) === room.id) return ok({ room: this.detail(room) });
    if (room.status !== ROOM_STATUS.WAITING) return fail(ERR.ROOM_NOT_WAITING);
    if (room.players.length >= MAX_PLAYERS) return fail(ERR.ROOM_FULL);

    this.removeFromRoom(socket);
    this.addPlayer(room, socket);
    console.log(`[방 입장] ${room.id} uid=${uid}`);
    return ok({ room: this.detail(room) });
  }

  leave(socket) {
    if (!this.roomOfUid.has(socket.data.uid)) return fail(ERR.NOT_IN_ROOM);
    this.removeFromRoom(socket);
    return ok();
  }

  setReady(socket, { ready }) {
    const room = this.roomOf(socket);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.status === ROOM_STATUS.PLAYING) return fail(ERR.ROOM_NOT_WAITING);

    const player = room.players.find((p) => p.uid === socket.data.uid);
    player.ready = Boolean(ready);
    if (room.status === ROOM_STATUS.STARTING && !player.ready) this.cancelCountdown(room);
    this.maybeStartCountdown(room);
    this.broadcastRoom(room);
    return ok({ room: this.detail(room) });
  }

  addPlayer(room, socket) {
    const taken = new Set(room.players.map((p) => p.slot));
    const slot = Array.from({ length: MAX_PLAYERS }, (_, i) => i).find((s) => !taken.has(s));
    room.players.push({ uid: socket.data.uid, nickname: socket.data.nickname, slot, ready: false });
    room.players.sort((a, b) => a.slot - b.slot);
    this.roomOfUid.set(socket.data.uid, room.id);
    socket.join(channelOf(room.id));
    this.broadcastRoom(room);
    this.broadcastList();
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
    room.players = room.players.filter((p) => p.uid !== uid);
    if (room.status === ROOM_STATUS.STARTING) this.cancelCountdown(room);

    if (room.players.length === 0) {
      this.rooms.delete(room.id);
      console.log(`[방 삭제] ${room.id}`);
    } else {
      if (room.hostUid === uid) room.hostUid = room.players[0].uid;
      this.broadcastRoom(room);
    }
    this.broadcastList();
  }

  maybeStartCountdown(room) {
    if (room.status !== ROOM_STATUS.WAITING) return;
    if (room.players.length < MAX_PLAYERS || !room.players.every((p) => p.ready)) return;

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

  startGame(room) {
    room.countdownTimer = null;
    if (this.rooms.get(room.id) !== room || room.status !== ROOM_STATUS.STARTING) return;

    room.status = ROOM_STATUS.PLAYING;
    const payload = {
      roomId: room.id,
      mapId: room.mapId,
      players: room.players.map(({ uid, nickname, slot }) => ({ uid, nickname, slot })),
    };
    this.io.to(channelOf(room.id)).emit(EV.GAME_START, payload);
    this.broadcastRoom(room);
    this.broadcastList();
    console.log(`[게임 시작] ${room.id} ${payload.players.map((p) => `${p.nickname}(${p.uid})`).join(' vs ')}`);
  }

  roomOf(socket) {
    const roomId = this.roomOfUid.get(socket.data.uid);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  summaries() {
    return [...this.rooms.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => ({ id: r.id, name: r.name, players: r.players.length, maxPlayers: MAX_PLAYERS, status: r.status }));
  }

  detail(room) {
    return {
      id: room.id,
      name: room.name,
      hostUid: room.hostUid,
      status: room.status,
      mapId: room.mapId,
      players: room.players.map(({ uid, nickname, slot, ready }) => ({ uid, nickname, slot, ready })),
    };
  }

  broadcastRoom(room) {
    this.io.to(channelOf(room.id)).emit(EV.LOBBY_ROOM, this.detail(room));
  }

  broadcastList() {
    this.io.to(LOBBY_CHANNEL).emit(EV.LOBBY_UPDATE, this.summaries());
  }
}
