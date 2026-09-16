import { EV, ERR } from '@rune/shared/protocol.js';
import { CHAT_BURST, CHAT_HISTORY, CHAT_SCOPE, cleanChat, maskProfanity } from '@rune/shared/rules/chat.js';

const ok = (data = {}) => ({ ok: true, ...data });
const fail = (error) => ({ ok: false, error });

/**
 * 방 채팅 (대기실과 경기 중).
 * - 전체: 방의 모두에게 / 팀: 같은 팀에게만 (보낸 사람의 팀 기준)
 * - 서버가 거른다: 보이지 않는 문자·연속 공백 정리, 150자, 5초에 5개, 욕설 가리기
 * - 방마다 최근 50개를 기억해, 들어오거나 다시 접속한 사람에게 (볼 수 있는 것만) 보낸다
 * - 들어옴·나감·연결 끊김·경기 시작은 안내 메시지(from: null)로 남긴다
 */
export class Chat {
  constructor({ lobby, now = () => Date.now() }) {
    this.lobby = lobby;
    this.now = now;
    this.history = new Map(); // roomId → messages
    this.sentAt = new Map(); // uid → 최근에 보낸 시각들
    this.seq = 0;

    lobby.on('socketReady', (socket) => this.lobby.bind(socket, EV.CHAT_SEND, (body) => this.send(socket, body)));
    lobby.on('playerJoined', (room, player, socket) => {
      this.sendHistory(socket, room, player);
      this.notice(room, `${player.nickname}님이 들어왔습니다.`);
    });
    lobby.on('playerRejoined', (room, socket, player) => {
      this.sendHistory(socket, room, player);
      this.notice(room, `${player.nickname}님이 다시 접속했습니다.`);
    });
    lobby.on('playerDisconnected', (room, player) => this.notice(room, `${player.nickname}님의 연결이 끊겼습니다.`));
    lobby.on('playerLeft', (room, player) => this.notice(room, `${player.nickname}님이 나갔습니다.`));
    lobby.on('matchStart', (room) => this.notice(room, '경기가 시작됐습니다. Enter로 채팅, Tab으로 전체·팀 전환'));
    lobby.on('roomClosed', (room) => this.history.delete(room.id));
  }

  send(socket, { text, scope }) {
    const room = this.lobby.roomOf(socket);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    const clean = cleanChat(text);
    if (!clean) return fail(ERR.CHAT_EMPTY);

    const { uid } = socket.data;
    const now = this.now();
    const recent = (this.sentAt.get(uid) ?? []).filter((t) => now - t < CHAT_BURST.windowMs);
    if (recent.length >= CHAT_BURST.count) return fail(ERR.CHAT_RATE_LIMITED);
    recent.push(now);
    this.sentAt.set(uid, recent);

    const player = room.players.find((p) => p.uid === uid);
    const message = {
      id: ++this.seq,
      scope: scope === CHAT_SCOPE.TEAM ? CHAT_SCOPE.TEAM : CHAT_SCOPE.ALL,
      text: maskProfanity(clean),
      at: now,
      from: { nickname: player.nickname, team: player.team, slot: player.slot },
    };
    this.record(room, message);
    return ok({ id: message.id });
  }

  /** 안내 메시지 (보낸 사람 없음) */
  notice(room, text) {
    if (!this.lobby.rooms.has(room.id)) return;
    this.record(room, { id: ++this.seq, scope: CHAT_SCOPE.ALL, text, at: this.now(), from: null });
  }

  record(room, message) {
    const list = this.history.get(room.id) ?? [];
    list.push(message);
    if (list.length > CHAT_HISTORY) list.splice(0, list.length - CHAT_HISTORY);
    this.history.set(room.id, list);
    for (const player of room.players) {
      if (!canSee(message, player)) continue;
      this.lobby.socketOfUid.get(player.uid)?.emit(EV.CHAT_MESSAGE, message);
    }
  }

  sendHistory(socket, room, player) {
    const messages = (this.history.get(room.id) ?? []).filter((m) => canSee(m, player));
    socket.emit(EV.CHAT_HISTORY, { roomId: room.id, messages });
  }
}

/** 팀 메시지는 같은 팀만 본다 */
const canSee = (message, player) => message.scope !== CHAT_SCOPE.TEAM || message.from?.team === player.team;
