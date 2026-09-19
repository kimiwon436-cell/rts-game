import { io } from 'socket.io-client';
import { EV } from '@rune/shared/protocol.js';
import { SERVER_URL } from '../config.js';

/**
 * 게임 서버에 연결한다. auth를 함수로 넘겨서 재연결할 때마다 새 토큰을 넣는다.
 * (Firebase ID 토큰은 1시간마다 만료된다. getIdToken이 알아서 새로 받는다)
 * 닉네임은 보내지 않는다 — 서버에 저장된 프로필의 닉네임만 쓴다.
 */
export function connectToServer({ getToken }) {
  return io(SERVER_URL, {
    transports: ['websocket'],
    auth: (cb) => {
      getToken().then(
        (token) => cb({ token }),
        () => cb({ token: '' }),
      );
    },
  });
}

/**
 * 가입 화면의 아이디 중복 확인. 서버가 모르면(개발 모드 서버, 연결 실패) { available: null }
 */
export async function checkLoginId(name) {
  try {
    const res = await fetch(`${SERVER_URL}/api/login-id?name=${encodeURIComponent(name)}`);
    if (!res.ok) return { available: null };
    return await res.json();
  } catch {
    return { available: null };
  }
}

/**
 * 가입 화면에서 닉네임을 쓸 수 있는지 미리 묻는다.
 * 서버에 닿지 않으면 { available: null } — 확인을 건너뛰고 가입할 때 서버가 다시 판정한다.
 */
export async function checkNickname(name) {
  try {
    const res = await fetch(`${SERVER_URL}/api/nickname?name=${encodeURIComponent(name)}`);
    if (!res.ok) return { available: null };
    return await res.json();
  } catch {
    return { available: null };
  }
}

/** ack 응답을 기다린다. 시간이 지나면 { ok: false, error: 'TIMEOUT' } */
export async function request(socket, event, payload, timeoutMs = 5000) {
  try {
    const timed = socket.timeout(timeoutMs);
    return payload === undefined ? await timed.emitWithAck(event) : await timed.emitWithAck(event, payload);
  } catch {
    return { ok: false, error: 'TIMEOUT' };
  }
}

/** 주기적으로 왕복 지연(ms)을 잰다. 멈추는 함수를 돌려준다. */
export function startPing(socket, onPing, intervalMs = 2000) {
  let stopped = false;
  const measure = async () => {
    if (stopped || !socket.connected) return;
    const started = performance.now();
    const res = await request(socket, EV.NET_PING, undefined, intervalMs);
    if (!stopped && res.ok) onPing(Math.round(performance.now() - started));
  };
  const timer = setInterval(measure, intervalMs);
  measure();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
