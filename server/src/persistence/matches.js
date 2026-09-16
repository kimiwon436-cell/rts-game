import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '../firebase.js';

/**
 * 경기 결과를 Firestore에 남긴다. 실시간 상태는 절대 여기로 오지 않고,
 * 한 판이 끝날 때 한 번만 쓴다 (경기당 쓰기 1 + 인원 수).
 *
 * matches/{matchId} — 경기 한 판의 기록
 * users/{uid}       — 누적 전적 (increment로 더한다)
 *
 * Firebase가 설정되지 않은 개발 모드에서는 아무것도 하지 않고 null을 돌려준다.
 */
export async function saveMatchResult(record) {
  const db = getDb();
  if (!db || !record?.matchId) return null;

  const endedAt = Date.now();
  const batch = db.batch();

  batch.set(db.collection('matches').doc(record.matchId), {
    matchId: record.matchId,
    mapId: record.mapId,
    reason: record.reason,
    winnerSlot: record.winner ?? null,
    startedAt: new Date(record.startedAt),
    endedAt: new Date(endedAt),
    durationSec: record.durationSec,
    players: record.players.map(({ slot, uid, nickname, defeated }) => ({ slot, uid, nickname, defeated })),
    uids: record.players.map((p) => p.uid), // array-contains로 내 경기만 찾기 위한 색인용
  });

  for (const player of record.players) {
    const won = record.winner != null && player.slot === record.winner;
    batch.set(
      db.collection('users').doc(player.uid),
      {
        nickname: player.nickname,
        matches: FieldValue.increment(1),
        wins: FieldValue.increment(won ? 1 : 0),
        losses: FieldValue.increment(won ? 0 : 1),
        lastPlayedAt: new Date(endedAt),
      },
      { merge: true },
    );
  }

  await batch.commit();
  return record.matchId;
}

/** 최근 경기 기록 (전적 화면용). 개발 모드에서는 빈 배열. */
export async function recentMatches(uid, limit = 10) {
  const db = getDb();
  if (!db) return [];
  const snap = await db
    .collection('matches')
    .where('uids', 'array-contains', uid)
    .orderBy('endedAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((doc) => doc.data());
}
