import { FieldValue } from 'firebase-admin/firestore';
import { NICKNAME_ERROR, nicknameKey, validateNickname } from '@rune/shared/rules/nickname.js';
import { DEFAULT_RATING } from '@rune/shared/rules/rating.js';
import { getDb } from '../firebase.js';

/** 랭킹전 모드 (모드마다 레이팅이 따로다) */
export const RATING_MODES = Object.freeze(['1v1', '2v2', '3v3']);
export { DEFAULT_RATING };

export class ProfileError extends Error {
  /** @param {string} code NICKNAME_ERROR 값 또는 'PROFILE_EXISTS' */
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const defaultRatings = () => Object.fromEntries(RATING_MODES.map((mode) => [mode, DEFAULT_RATING]));
const defaultRanked = () => Object.fromEntries(RATING_MODES.map((mode) => [mode, { wins: 0, losses: 0 }]));

/** 저장된 문서를 게임이 쓰는 프로필 모양으로 */
function toProfile(uid, data) {
  return {
    uid,
    nickname: data.nickname,
    ratings: { ...defaultRatings(), ...(data.ratings ?? {}) },
    // 랭킹 승패는 모드마다 따로
    ranked: Object.fromEntries(
      RATING_MODES.map((mode) => [mode, { wins: data.ranked?.[mode]?.wins ?? 0, losses: data.ranked?.[mode]?.losses ?? 0 }]),
    ),
    wins: data.wins ?? 0,
    losses: data.losses ?? 0,
    matches: data.matches ?? 0,
  };
}

/**
 * 프로필 저장소 (Firestore).
 * users/{uid}     — 닉네임, 레이팅, 전적
 * nicknames/{key} — 닉네임 예약. 대소문자를 무시한 키로 중복을 막는다
 */
export class FirestoreProfileStore {
  constructor(db) {
    this.db = db;
  }

  async get(uid) {
    const snap = await this.db.collection('users').doc(uid).get();
    const data = snap.data();
    // nicknameKey가 없으면 예전(익명 로그인) 문서라 가입한 프로필로 치지 않는다
    return snap.exists && data?.nicknameKey ? toProfile(uid, data) : null;
  }

  async isAvailable(nickname) {
    const snap = await this.db.collection('nicknames').doc(nicknameKey(nickname)).get();
    return !snap.exists;
  }

  async create(uid, rawNickname) {
    const checked = validateNickname(rawNickname);
    if (!checked.ok) throw new ProfileError(checked.reason);
    const { nickname } = checked;
    const key = nicknameKey(nickname);
    const userRef = this.db.collection('users').doc(uid);
    const nameRef = this.db.collection('nicknames').doc(key);

    return this.db.runTransaction(async (tx) => {
      const [user, name] = await Promise.all([tx.get(userRef), tx.get(nameRef)]);
      if (user.exists && user.data()?.nicknameKey) throw new ProfileError('PROFILE_EXISTS');
      if (name.exists && name.data()?.uid !== uid) throw new ProfileError(NICKNAME_ERROR.TAKEN);

      const data = {
        nickname,
        nicknameKey: key,
        ratings: defaultRatings(),
        ranked: defaultRanked(),
        createdAt: FieldValue.serverTimestamp(),
      };
      tx.set(nameRef, { uid, nickname, createdAt: FieldValue.serverTimestamp() });
      tx.set(userRef, data, { merge: true }); // 예전 전적(wins·losses)이 있으면 남긴다
      return toProfile(uid, { ...(user.data() ?? {}), ...data });
    });
  }

  /** 랭킹전 결과: 레이팅을 새 값으로 쓰고 랭킹 승패를 더한다 */
  async applyRatings(changes) {
    const batch = this.db.batch();
    for (const { uid, mode, rating, won } of changes) {
      batch.set(
        this.db.collection('users').doc(uid),
        {
          ratings: { [mode]: rating },
          ranked: { [mode]: { wins: FieldValue.increment(won ? 1 : 0), losses: FieldValue.increment(won ? 0 : 1) } },
        },
        { merge: true },
      );
    }
    await batch.commit();
  }

  /** 모드별 순위표 (레이팅이 있는 문서만 정렬된다 — 예전 익명 문서는 빠진다) */
  async leaderboard(mode, limit = 50) {
    const snap = await this.db.collection('users').orderBy(`ratings.${mode}`, 'desc').limit(limit).get();
    return snap.docs.filter((doc) => doc.data().nicknameKey).map((doc) => toProfile(doc.id, doc.data()));
  }

  /** 내 순위 = 나보다 레이팅이 높은 사람 수 + 1 (집계 쿼리라 문서를 읽지 않는다) */
  async rankOf(uid, mode) {
    const me = await this.get(uid);
    if (!me) return null;
    const snap = await this.db.collection('users').where(`ratings.${mode}`, '>', me.ratings[mode]).count().get();
    return snap.data().count + 1;
  }
}

/** 메모리 저장소 — Firebase 없이 도는 개발 모드와 테스트용. 서버를 끄면 사라진다. */
export class MemoryProfileStore {
  constructor() {
    this.users = new Map(); // uid → data
    this.names = new Map(); // key → uid
  }

  async get(uid) {
    const data = this.users.get(uid);
    return data ? toProfile(uid, data) : null;
  }

  async isAvailable(nickname) {
    return !this.names.has(nicknameKey(nickname));
  }

  async create(uid, rawNickname) {
    const checked = validateNickname(rawNickname);
    if (!checked.ok) throw new ProfileError(checked.reason);
    const key = nicknameKey(checked.nickname);
    if (this.users.has(uid)) throw new ProfileError('PROFILE_EXISTS');
    if (this.names.has(key) && this.names.get(key) !== uid) throw new ProfileError(NICKNAME_ERROR.TAKEN);
    const data = { nickname: checked.nickname, nicknameKey: key, ratings: defaultRatings(), ranked: defaultRanked() };
    this.names.set(key, uid);
    this.users.set(uid, data);
    return toProfile(uid, data);
  }

  async applyRatings(changes) {
    for (const { uid, mode, rating, won } of changes) {
      const data = this.users.get(uid);
      if (!data) continue;
      data.ratings = { ...data.ratings, [mode]: rating };
      const record = data.ranked[mode];
      data.ranked = { ...data.ranked, [mode]: { wins: record.wins + (won ? 1 : 0), losses: record.losses + (won ? 0 : 1) } };
    }
  }

  async leaderboard(mode, limit = 50) {
    return [...this.users.entries()]
      .map(([uid, data]) => toProfile(uid, data))
      .sort((a, b) => b.ratings[mode] - a.ratings[mode])
      .slice(0, limit);
  }

  async rankOf(uid, mode) {
    const me = await this.get(uid);
    if (!me) return null;
    let higher = 0;
    for (const [other, data] of this.users) if (other !== uid && toProfile(other, data).ratings[mode] > me.ratings[mode]) higher++;
    return higher + 1;
  }
}

/** Firebase가 설정돼 있으면 Firestore, 아니면 메모리 */
export function createProfileStore() {
  const db = getDb();
  return db ? new FirestoreProfileStore(db) : new MemoryProfileStore();
}
