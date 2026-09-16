import { EV, ERR } from '@rune/shared/protocol.js';
import { GAME_MODES, mapsForMode } from '@rune/shared/map/maps/index.js';
import { balanceTeams, findMatch, ratingChanges } from '@rune/shared/rules/rating.js';
import { publicProfile } from './lobby.js';

const ok = (data = {}) => ({ ok: true, ...data });
const fail = (error) => ({ ok: false, error });

const STATUS_EVERY_MS = 2000;
const LEADERBOARD_TTL_MS = 30_000;
const LEADERBOARD_SIZE = 50;

/**
 * 랭킹전 매칭.
 * - 모드별 대기열. 1초마다 레이팅이 가까운 사람끼리 한 경기를 찾는다 (오래 기다릴수록 허용 차이가 넓어진다)
 * - 찾으면 두 팀의 레이팅 합이 가장 비슷하게 나누고, 로비에 랭킹전 방을 열어 바로 카운트다운한다
 * - 경기가 끝나면 팀 평균 Elo로 레이팅을 바꿔 저장하고 참가자에게 알린다
 */
export class Matchmaker {
  constructor({ lobby, profiles, intervalMs = 1000, random = Math.random }) {
    this.lobby = lobby;
    this.profiles = profiles;
    this.random = random;
    this.queues = new Map(Object.keys(GAME_MODES).map((mode) => [mode, []]));
    this.entryOf = new Map(); // uid → { uid, mode, rating, games, joinedAt }
    this.lastStatusAt = 0;
    this.leaderboards = new Map(); // mode → { at, entries }

    lobby.onSocketReady = (socket) => this.attach(socket);
    lobby.onEnterRoom = (uid) => this.leave(uid); // 방에 들어가면 대기열에서 뺀다
    lobby.onRankedAbort = (room, uids) => this.requeue(room, uids);
    lobby.onMatchEnd = (room, result, record) => {
      if (room.ranked) this.settle(room, result, record).catch((err) => console.error('[레이팅 저장 실패]', err));
    };

    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref?.();
  }

  /** 로비에 들어온 소켓에 랭킹전 이벤트를 연다 */
  attach(socket) {
    this.lobby.bind(socket, EV.RANKED_JOIN, (body) => this.join(socket, body));
    this.lobby.bind(socket, EV.RANKED_LEAVE, () => {
      this.leave(socket.data.uid);
      return ok();
    });
    this.lobby.bind(socket, EV.RANKED_LEADERBOARD, (body) => this.leaderboard(socket, body));
    const entry = this.entryOf.get(socket.data.uid);
    if (entry) this.sendStatus(entry); // 다른 탭에서 이어받았다
  }

  join(socket, { mode }) {
    if (!GAME_MODES[mode]) return fail(ERR.INVALID_PAYLOAD);
    if (this.lobby.roomOf(socket)) return fail(ERR.IN_ROOM);
    const { uid, profile } = socket.data;
    this.leave(uid, { silent: true });

    const entry = {
      uid,
      mode,
      rating: profile.ratings[mode],
      games: profile.ranked[mode].wins + profile.ranked[mode].losses,
      joinedAt: Date.now(),
    };
    this.queues.get(mode).push(entry);
    this.entryOf.set(uid, entry);
    console.log('[매칭 대기]', mode, profile.nickname, entry.rating);
    this.sendStatus(entry);
    this.tick();
    return ok({ mode });
  }

  leave(uid, { silent = false } = {}) {
    const entry = this.entryOf.get(uid);
    if (!entry) return;
    this.entryOf.delete(uid);
    const queue = this.queues.get(entry.mode);
    queue.splice(queue.indexOf(entry), 1);
    if (!silent) this.lobby.socketOfUid.get(uid)?.emit(EV.RANKED_STATUS, null);
  }

  tick() {
    const now = Date.now();
    for (const [mode, queue] of this.queues) {
      // 끊긴 사람은 빼 둔다 (돌아오면 다시 줄을 서야 한다)
      for (const entry of [...queue]) if (!this.lobby.socketOfUid.has(entry.uid)) this.leave(entry.uid, { silent: true });

      let group;
      while ((group = findMatch(queue, GAME_MODES[mode].teamSize * 2, now))) {
        for (const entry of group) this.leave(entry.uid, { silent: true });
        this.startMatch(mode, group);
      }
    }
    if (now - this.lastStatusAt >= STATUS_EVERY_MS) {
      this.lastStatusAt = now;
      for (const entry of this.entryOf.values()) this.sendStatus(entry);
    }
  }

  startMatch(mode, group) {
    const [team0, team1] = balanceTeams(group);
    const maps = mapsForMode(mode);
    const mapId = maps[Math.floor(this.random() * maps.length)].id;
    const players = [...team0.map((e) => ({ uid: e.uid, team: 0 })), ...team1.map((e) => ({ uid: e.uid, team: 1 }))];
    const room = this.lobby.openRankedRoom({ mode, mapId, players });
    if (!room) {
      // 그사이 누가 끊겼거나 방에 들어갔다: 남은 사람은 기다리던 순서 그대로 다시 줄 세운다
      for (const entry of group) if (this.lobby.socketOfUid.has(entry.uid)) this.restore(entry);
      return;
    }
    for (const { uid } of players) this.lobby.socketOfUid.get(uid)?.emit(EV.RANKED_FOUND, { mode, mapId });
    console.log('[매칭 성사]', mode, mapId, group.map((e) => e.rating).join(','));
  }

  /** 기다리던 순서를 잃지 않게 되돌려 넣는다 */
  restore(entry) {
    this.queues.get(entry.mode).push(entry);
    this.entryOf.set(entry.uid, entry);
    this.sendStatus(entry);
  }

  /** 시작 전에 누가 나가 랭킹전 방이 깨졌다: 남은 사람을 대기열 앞쪽으로 되돌린다 */
  requeue(room, uids) {
    for (const uid of uids) {
      const socket = this.lobby.socketOfUid.get(uid);
      if (!socket?.data.profile) continue;
      socket.emit(EV.RANKED_STATUS, { mode: room.mode, waitingSec: 0, queueSize: 0, cancelled: true });
      const result = this.join(socket, { mode: room.mode });
      if (result.ok) this.entryOf.get(uid).joinedAt = room.createdAt - 60_000; // 오래 기다린 것으로 쳐서 먼저 잡히게
    }
  }

  sendStatus(entry) {
    this.lobby.socketOfUid.get(entry.uid)?.emit(EV.RANKED_STATUS, {
      mode: entry.mode,
      waitingSec: Math.floor((Date.now() - entry.joinedAt) / 1000),
      queueSize: this.queues.get(entry.mode).length,
    });
  }

  /** 경기가 끝났다: 레이팅을 바꿔 저장하고 참가자에게 알린다 */
  async settle(room, result, record) {
    if (result.winnerTeam == null) return; // 무승부는 바꾸지 않는다
    const stored = await Promise.all(record.players.map((p) => this.profiles.get(p.uid)));
    const players = record.players.map((p, i) => ({
      uid: p.uid,
      team: p.team,
      nickname: p.nickname,
      rating: stored[i]?.ratings[room.mode] ?? 1000,
      games: (stored[i]?.ranked[room.mode].wins ?? 0) + (stored[i]?.ranked[room.mode].losses ?? 0),
    }));
    const changes = ratingChanges(players, result.winnerTeam);
    await this.profiles.applyRatings(changes.map((c) => ({ uid: c.uid, mode: room.mode, rating: c.after, won: c.won })));
    this.leaderboards.delete(room.mode);

    const summary = changes.map((c, i) => ({
      nickname: players[i].nickname,
      team: c.team,
      before: c.before,
      after: c.after,
      delta: c.delta,
      won: c.won,
    }));
    for (const change of changes) {
      const socket = this.lobby.socketOfUid.get(change.uid);
      if (!socket?.data.profile) continue;
      const profile = socket.data.profile;
      profile.ratings[room.mode] = change.after;
      if (change.won) profile.ranked[room.mode].wins += 1;
      else profile.ranked[room.mode].losses += 1;
      socket.emit(EV.SESSION_PROFILE, publicProfile(profile));
      socket.emit(EV.RANKED_RESULT, { mode: room.mode, changes: summary });
    }
    console.log('[레이팅]', room.mode, summary.map((c) => `${c.nickname} ${c.before}→${c.after}`).join(', '));
  }

  /** 모드별 상위 50명과 내 순위. 순위표는 30초 동안 캐시한다 (Firestore 읽기를 아끼려고) */
  async leaderboard(socket, { mode }) {
    if (!GAME_MODES[mode]) return fail(ERR.INVALID_PAYLOAD);
    let board = this.leaderboards.get(mode);
    if (!board || Date.now() - board.at > LEADERBOARD_TTL_MS) {
      const top = await this.profiles.leaderboard(mode, LEADERBOARD_SIZE);
      board = {
        at: Date.now(),
        entries: top.map((p, i) => ({
          uid: p.uid,
          rank: i + 1,
          nickname: p.nickname,
          rating: p.ratings[mode],
          wins: p.ranked[mode].wins,
          losses: p.ranked[mode].losses,
        })),
      };
      this.leaderboards.set(mode, board);
    }
    const { uid, profile } = socket.data;
    const listed = board.entries.find((e) => e.uid === uid);
    const rank = listed?.rank ?? (await this.profiles.rankOf(uid, mode));
    return ok({
      mode,
      entries: board.entries.map(({ uid: entryUid, ...rest }) => ({ ...rest, me: entryUid === uid })),
      me: { rank, rating: profile.ratings[mode], ...profile.ranked[mode] },
    });
  }

  dispose() {
    clearInterval(this.timer);
  }
}
