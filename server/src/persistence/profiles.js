import { FieldValue } from 'firebase-admin/firestore';
import { NICKNAME_ERROR, nicknameKey, validateNickname } from '@rune/shared/rules/nickname.js';
import { getDb } from '../firebase.js';

/** 랭킹전 모드별 시작 레이팅 */
export const RATING_MODES = Object.freeze(['1v1', '2v2', '3v3']);
export const DEFAULT_RATING = 1000;

export class ProfileError extends Error {
  /** @param {string} code NICKNAME_ERROR 값 또는 'PROFILE_EXISTS' */
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const defaultRatings = () => Object.fromEntries(RATING_MODES.map((mode) => [mode, DEFAULT_RATING]));

/** 저장된 문서를 게임이 쓰는 프로필 모양으로 */
function toProfile(uid, data) {
  return {
    uid,
    nickname: data.nickname,
    ratings: { ...defaultRatings(), ...(data.ratings ?? {}) },
    ranked: { wins: data.ranked?.wins ?? 0, losses: data.ranked?.losses ?? 0 },
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
        ranked: { wins: 0, losses: 0 },
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
          ranked: { wins: FieldValue.increment(won ? 1 : 0), losses: FieldValue.increment(won ? 0 : 1) },
        },
        { merge: true },
      );
    }
    await batch.commit();
  }

  /** 모드별 순위표 */
  async leaderboard(mode, limit = 50) {
    const snap = await this.db.collection('users').orderBy(`ratings.${mode}`, 'desc').limit(limit).get();
    return snap.docs.filter((doc) => doc.data().nicknameKey).map((doc) => toProfile(doc.id, doc.data()));
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
    const data = { nickname: checked.nickname, nicknameKey: key, ratings: defaultRatings(), ranked: { wins: 0, losses: 0 } };
    this.names.set(key, uid);
    this.users.set(uid, data);
    return toProfile(uid, data);
  }

  async applyRatings(changes) {
    for (const { uid, mode, rating, won } of changes) {
      const data = this.users.get(uid);
      if (!data) continue;
      data.ratings = { ...data.ratings, [mode]: rating };
      data.ranked = { wins: data.ranked.wins + (won ? 1 : 0), losses: data.ranked.losses + (won ? 0 : 1) };
    }
  }

  async leaderboard(mode, limit = 50) {
    return [...this.users.entries()]
      .map(([uid, data]) => toProfile(uid, data))
      .sort((a, b) => b.ratings[mode] - a.ratings[mode])
      .slice(0, limit);
  }
}

/** Firebase가 설정돼 있으면 Firestore, 아니면 메모리 */
export function createProfileStore() {
  const db = getDb();
  return db ? new FirestoreProfileStore(db) : new MemoryProfileStore();
}
