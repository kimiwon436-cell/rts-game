// 개발 모드 계정: 아이디로 가입·로그인·로그인 유지·로그아웃 (Firebase 모드와 같은 인터페이스)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authErrorMessage, createDevAuth } from '../src/auth.js';

/** localStorage 흉내 */
function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    dump: () => [...data.values()].join('\n'),
  };
}

const firstChange = (auth) => new Promise((resolve) => {
  const stop = auth.onChange((session) => {
    stop();
    resolve(session);
  });
});

const TEST_PASSWORD = 'correct-horse-7';

test('아이디로 가입하면 바로 로그인되고, 페이지를 다시 열어도 로그인이 유지된다', async () => {
  const storage = memoryStorage();
  const auth = createDevAuth(storage);
  assert.equal(await firstChange(auth), null, '처음에는 로그아웃 상태');

  const session = await auth.signUp('  Knight_01 ', TEST_PASSWORD);
  assert.equal(session.loginId, 'knight_01', '아이디는 소문자로 정리한다');
  assert.match(session.uid, /^dev:[0-9a-f]{32}$/, '개발 서버가 받는 토큰 형식');
  assert.equal(await session.getToken(), session.uid);
  assert.equal(storage.dump().includes(TEST_PASSWORD), false, '비밀번호 원문은 저장하지 않는다');

  // "나갔다 다시 들어오기": 같은 저장소로 새로 만든다
  const restored = await firstChange(createDevAuth(storage));
  assert.equal(restored?.uid, session.uid);
  assert.equal(restored.loginId, 'knight_01');
});

test('같은 아이디로 두 번 가입할 수 없고, 비밀번호나 아이디가 틀리면 로그인되지 않는다', async () => {
  const auth = createDevAuth(memoryStorage());
  const { uid } = await auth.signUp('paladin', TEST_PASSWORD);
  await auth.signOut();

  await assert.rejects(auth.signUp('PALADIN', TEST_PASSWORD), { code: 'auth/email-already-in-use' });
  await assert.rejects(auth.signIn('paladin', 'wrong-password-1'), { code: 'auth/invalid-credential' });
  await assert.rejects(auth.signIn('nobody', TEST_PASSWORD), { code: 'auth/invalid-credential' });
  await assert.rejects(auth.signIn('x', TEST_PASSWORD), { code: 'auth/invalid-credential' }, '형식이 틀린 아이디도 같은 답');

  const again = await auth.signIn('Paladin', TEST_PASSWORD);
  assert.equal(again.uid, uid, '같은 계정으로 돌아온다');
  assert.deepEqual(await auth.checkLoginId('PALADIN'), { available: false, reason: 'TAKEN' }, '중복 확인');
  assert.deepEqual(await auth.checkLoginId('mage01'), { available: true });
  assert.deepEqual(await auth.checkLoginId('a!'), { available: false, reason: 'TOO_SHORT' });
});

test('로그아웃하면 알림이 가고, 다시 열어도 로그아웃 상태다. 예전 이메일 개발 세션은 버린다', async () => {
  const storage = memoryStorage();
  const auth = createDevAuth(storage);
  await auth.signUp('mage01', TEST_PASSWORD);

  const changes = [];
  auth.onChange((session) => changes.push(session?.loginId ?? null));
  await new Promise((r) => queueMicrotask(r));
  await auth.signOut();
  assert.deepEqual(changes, ['mage01', null]);
  assert.equal(await firstChange(createDevAuth(storage)), null);

  const old = memoryStorage();
  old.setItem('rune.dev.session', JSON.stringify({ uid: 'dev:00000000000000000000000000000000', email: 'a@b.c' }));
  assert.equal(await firstChange(createDevAuth(old)), null);
});

test('입력 오류는 서버에 가기 전에 걸러 사람이 읽을 문장으로 알려 준다', async () => {
  const auth = createDevAuth(memoryStorage());
  await assert.rejects(auth.signUp('abc', TEST_PASSWORD), { code: 'id/TOO_SHORT' });
  await assert.rejects(auth.signUp('새벽기사', TEST_PASSWORD), { code: 'id/INVALID_CHARS' });
  await assert.rejects(auth.signUp('short01', '1234567'), { code: 'auth/weak-password' });
  assert.equal(authErrorMessage({ code: 'id/TOO_SHORT' }), '아이디는 4자 이상이어야 합니다.');
  assert.equal(authErrorMessage({ code: 'auth/weak-password' }), '비밀번호는 8자 이상이어야 합니다.');
  assert.equal(authErrorMessage({ code: 'auth/invalid-credential' }), '아이디 또는 비밀번호가 맞지 않습니다.');
  assert.match(authErrorMessage({ code: 'auth/email-already-in-use' }), /이미 있는 아이디/);
});
