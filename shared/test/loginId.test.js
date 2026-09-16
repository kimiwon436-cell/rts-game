import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOGIN_ID_ERROR, emailToLoginId, loginIdToEmail, validateLoginId } from '../src/rules/loginId.js';

test('아이디 규칙: 영문 소문자·숫자·밑줄 4~16자, 대소문자는 구분하지 않는다', () => {
  assert.deepEqual(validateLoginId('  Knight_01 '), { ok: true, loginId: 'knight_01' });
  assert.equal(validateLoginId('abc').reason, LOGIN_ID_ERROR.TOO_SHORT);
  assert.equal(validateLoginId('a'.repeat(17)).reason, LOGIN_ID_ERROR.TOO_LONG);
  assert.equal(validateLoginId('새벽기사1').reason, LOGIN_ID_ERROR.INVALID_CHARS, '한글 아이디는 안 된다');
  assert.equal(validateLoginId('knight.01').reason, LOGIN_ID_ERROR.INVALID_CHARS);
  assert.equal(validateLoginId('me@mail.com').reason, LOGIN_ID_ERROR.INVALID_CHARS, '이메일은 아이디가 아니다');
});

test('아이디는 프로젝트 전용 내부 주소로 바뀌고, 다시 아이디로 돌아온다', () => {
  const email = loginIdToEmail('Knight_01', 'rts-game-53596');
  assert.equal(email, 'knight_01@id.rts-game-53596.firebaseapp.com');
  assert.equal(emailToLoginId(email), 'knight_01');
});
