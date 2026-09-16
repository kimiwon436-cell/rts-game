// 랭킹전 레이팅(팀 평균 Elo)과 매칭 규칙의 수치를 고정한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balanceTeams, findMatch, matchTolerance, ratingChanges, RATING_FLOOR } from '../src/rules/rating.js';

const veteran = (uid, team, rating) => ({ uid, team, rating, games: 30 });
const rookie = (uid, team, rating) => ({ uid, team, rating, games: 0 });
const byUid = (changes) => Object.fromEntries(changes.map((c) => [c.uid, c.delta]));

test('비슷한 실력끼리면 이긴 쪽 +16, 진 쪽 −16 (처음 10판은 ±24)', () => {
  assert.deepEqual(byUid(ratingChanges([veteran('a', 0, 1000), veteran('b', 1, 1000)], 0)), { a: 16, b: -16 });
  assert.deepEqual(byUid(ratingChanges([rookie('a', 0, 1000), rookie('b', 1, 1000)], 1)), { a: -24, b: 24 });
});

test('강한 상대를 이기면 많이 오르고, 약한 상대에게 지면 많이 내린다', () => {
  const upset = byUid(ratingChanges([veteran('strong', 0, 1400), veteran('weak', 1, 1000)], 1));
  assert.equal(upset.weak, 29);
  assert.equal(upset.strong, -29);
  const expected = byUid(ratingChanges([veteran('strong', 0, 1400), veteran('weak', 1, 1000)], 0));
  assert.equal(expected.strong, 3, '이길 게 뻔한 경기는 조금만 오른다');
});

test('팀전은 팀 평균으로 기대 승률을 계산하고, 팀원은 같은 만큼 움직인다 (무승부는 그대로)', () => {
  const changes = byUid(ratingChanges([veteran('a', 0, 1200), veteran('b', 0, 800), veteran('c', 1, 1000), veteran('d', 1, 1000)], 0));
  assert.deepEqual(changes, { a: 16, b: 16, c: -16, d: -16 });
  assert.ok(ratingChanges([veteran('a', 0, 1000), veteran('b', 1, 1000)], null).every((c) => c.delta === 0));
  const floored = ratingChanges([veteran('low', 0, RATING_FLOOR + 5), veteran('peer', 1, RATING_FLOOR + 5)], 1);
  assert.equal(floored[0].after, RATING_FLOOR, '바닥 밑으로는 내려가지 않는다');
});

test('팀 나누기: 레이팅 합의 차이가 가장 작은 조합', () => {
  const six = [1500, 1400, 1300, 1100, 1000, 900].map((rating, i) => ({ id: i, rating }));
  const [t0, t1] = balanceTeams(six);
  const sum = (team) => team.reduce((s, p) => s + p.rating, 0);
  assert.equal(t0.length, 3);
  assert.equal(Math.abs(sum(t0) - sum(t1)), 0, '3600 대 3600으로 나눌 수 있다');
});

test('매칭: 허용 차이는 기다릴수록 넓어지고, 가장 오래 기다린 사람이 들어간 묶음을 먼저 잡는다', () => {
  assert.equal(matchTolerance(0), 150);
  assert.equal(matchTolerance(60), 450);
  assert.equal(matchTolerance(10_000), 1000);

  const now = 1_000_000;
  const far = [{ rating: 1000, joinedAt: now - 5_000 }, { rating: 1600, joinedAt: now - 5_000 }];
  assert.equal(findMatch(far, 2, now), null, '600 차이는 바로 잡지 않는다');
  far[0].joinedAt = now - 100_000; // 100초 기다림 → 허용 650
  assert.equal(findMatch(far, 2, now)?.length, 2);

  const queue = [
    { id: 'new-close', rating: 1000, joinedAt: now - 1_000 },
    { id: 'new-close-2', rating: 1010, joinedAt: now - 1_000 },
    { id: 'old', rating: 1100, joinedAt: now - 30_000 },
  ];
  assert.deepEqual(findMatch(queue, 2, now).map((p) => p.id).sort(), ['new-close-2', 'old'], '오래 기다린 사람을 먼저');
  assert.equal(findMatch(queue.slice(0, 1), 2, now), null, '사람이 모자라면 없다');
});
