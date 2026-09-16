import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { NICKNAME_ERROR, validateNickname } from '@rune/shared/rules/nickname.js';
import { createAuthMiddleware } from './net/auth.js';
import { Lobby } from './net/lobby.js';
import { Matchmaker } from './net/matchmaking.js';
import { MemoryProfileStore } from './persistence/profiles.js';

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

/**
 * HTTP 요청 (Socket.IO가 아닌 것).
 * - GET /health
 * - GET /api/nickname?name=… — 가입 화면에서 닉네임을 미리 확인한다 (실제 예약은 가입할 때 트랜잭션으로)
 */
function createHttpHandler({ profiles, clientOrigins }) {
  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const origin = req.headers.origin;
    const cors = origin && clientOrigins.includes(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};

    if (url.pathname === '/health') {
      sendJson(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
      return;
    }
    if (url.pathname === '/api/nickname' && req.method === 'GET') {
      const checked = validateNickname(url.searchParams.get('name') ?? '');
      if (!checked.ok) {
        sendJson(res, 200, { available: false, reason: checked.reason }, cors);
        return;
      }
      try {
        const available = await profiles.isAvailable(checked.nickname);
        sendJson(res, 200, available ? { available: true } : { available: false, reason: NICKNAME_ERROR.TAKEN }, cors);
      } catch (err) {
        console.error('[닉네임 확인 실패]', err);
        sendJson(res, 503, { error: 'UNAVAILABLE' }, cors);
      }
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Rune & Crown game server');
  };
}

/** HTTP 서버와 Socket.IO를 만들고 인증·로비를 연결한다. listen은 호출한 쪽에서 한다. */
export function createGameServer({
  authMode,
  clientOrigins,
  countdownSec,
  reconnectGraceSec,
  profiles = new MemoryProfileStore(),
  matchIntervalMs = 1000,
  random = Math.random,
}) {
  const httpServer = createServer(createHttpHandler({ profiles, clientOrigins }));
  const io = new Server(httpServer, {
    cors: { origin: clientOrigins },
    perMessageDeflate: { threshold: 1024 },
  });

  io.use(createAuthMiddleware(authMode, profiles));

  const lobby = new Lobby(io, { countdownSec, reconnectGraceSec, profiles });
  const matchmaker = new Matchmaker({ lobby, profiles, intervalMs: matchIntervalMs, random });
  io.on('connection', (socket) => {
    console.log(`[접속] uid=${socket.data.uid} 닉네임=${socket.data.nickname ?? '(아직 없음)'}`);
    lobby.attach(socket);
  });

  const close = () =>
    new Promise((resolve) => {
      matchmaker.dispose();
      lobby.dispose();
      io.close(() => resolve());
    });

  return { httpServer, io, lobby, matchmaker, profiles, close };
}
