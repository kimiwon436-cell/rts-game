// 랭킹전 레이팅 (팀 평균 Elo)과 매칭 규칙. 서버가 쓰고, 테스트로 수치를 고정한다.

export const DEFAULT_RATING = 1000;

/** 처음 몇 판은 실력에 빨리 다가가도록 크게 움직인다 */
export const K_PROVISIONAL = 48;
export const K_STANDARD = 32;
export const PROVISIONAL_GAMES = 10;
export const RATING_FLOOR = 100;

/** 팀 A가 이길 기대 확률 */
export const expectedScore = (ratingA, ratingB) => 1 / (1 + 10 ** ((ratingB - ratingA) / 400));

const average = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

/**
 * 경기 결과로 바뀌는 레이팅.
 * @param {Array<{ uid: string, team: number, rating: number, games: number }>} players games = 지금까지 한 랭킹전 수
 * @param {number | null} winnerTeam null이면 무승부 — 아무도 바뀌지 않는다
 * @returns {Array<{ uid, team, before, after, delta, won }>}
 */
export function ratingChanges(players, winnerTeam) {
  const teamRating = [0, 1].map((team) => average(players.filter((p) => p.team === team).map((p) => p.rating)));
  return players.map((p) => {
    if (winnerTeam == null) return { uid: p.uid, team: p.team, before: p.rating, after: p.rating, delta: 0, won: false };
    const won = p.team === winnerTeam;
    const expected = expectedScore(teamRating[p.team], teamRating[1 - p.team]);
    const k = p.games < PROVISIONAL_GAMES ? K_PROVISIONAL : K_STANDARD;
    const after = Math.max(RATING_FLOOR, Math.round(p.rating + k * ((won ? 1 : 0) - expected)));
    return { uid: p.uid, team: p.team, before: p.rating, after, delta: after - p.rating, won };
  });
}

/**
 * 오래 기다릴수록 넓어지는 허용 레이팅 차이.
 * 바로는 ±150, 10초마다 +50, 최대 1000 (사람이 적은 시간대에도 결국 잡히게)
 */
export const matchTolerance = (waitSec) => Math.min(1000, 150 + Math.floor(waitSec / 10) * 50);

/**
 * 한 경기에 묶을 사람들을 두 팀으로 나눈다. 팀 레이팅 합의 차이가 가장 작은 조합을 고른다.
 * (4명은 3가지, 6명은 10가지뿐이라 모두 따져 본다)
 * @param {Array<{ rating: number }>} group 인원은 짝수
 * @returns {[Array, Array]} [팀 0, 팀 1]
 */
export function balanceTeams(group) {
  const size = group.length / 2;
  let best = null;
  const choose = (start, picked) => {
    if (picked.length === size) {
      // 대칭인 조합(팀 0과 팀 1을 바꾼 것)을 두 번 보지 않도록 0번은 늘 팀 0에 둔다
      if (!picked.includes(0)) return;
      const team0 = picked.map((i) => group[i]);
      const team1 = group.filter((_, i) => !picked.includes(i));
      const diff = Math.abs(team0.reduce((s, p) => s + p.rating, 0) - team1.reduce((s, p) => s + p.rating, 0));
      if (!best || diff < best.diff) best = { diff, teams: [team0, team1] };
      return;
    }
    for (let i = start; i < group.length; i++) choose(i + 1, [...picked, i]);
  };
  choose(0, []);
  return best.teams;
}

/**
 * 대기열에서 한 경기를 찾는다: 레이팅 순으로 늘어놓고 연속한 need명씩 보되,
 * 그 안에서 가장 오래 기다린 사람의 허용 차이 안에 들어오는 묶음 중 가장 오래 기다린 사람이 있는 묶음을 고른다.
 * @param {Array<{ rating: number, joinedAt: number }>} queue
 * @param {number} need 한 경기 인원 (팀 크기 × 2)
 * @param {number} now ms
 * @returns {Array | null}
 */
export function findMatch(queue, need, now) {
  if (queue.length < need) return null;
  const sorted = [...queue].sort((a, b) => a.rating - b.rating);
  let best = null;
  for (let i = 0; i + need <= sorted.length; i++) {
    const window = sorted.slice(i, i + need);
    const spread = window[need - 1].rating - window[0].rating;
    const oldest = Math.min(...window.map((p) => p.joinedAt));
    if (spread > matchTolerance((now - oldest) / 1000)) continue;
    if (!best || oldest < best.oldest || (oldest === best.oldest && spread < best.spread)) best = { window, oldest, spread };
  }
  return best?.window ?? null;
}
