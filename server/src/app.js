import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createAuthMiddleware } from './net/auth.js';
import { Lobby } from './net/lobby.js';

function handleHttp(req, res) {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, uptime: Math.round(process.uptime()) }));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Rune & Crown game server');
}

/** HTTP 서버와 Socket.IO를 만들고 인증·로비를 연결한다. listen은 호출한 쪽에서 한다. */
export function createGameServer({ authMode, clientOrigins, countdownSec }) {
  const httpServer = createServer(handleHttp);
  const io = new Server(httpServer, {
    cors: { origin: clientOrigins },
    perMessageDeflate: { threshold: 1024 },
  });

  io.use(createAuthMiddleware(authMode));

  const lobby = new Lobby(io, { countdownSec });
  io.on('connection', (socket) => {
    console.log(`[접속] uid=${socket.data.uid} 닉네임=${socket.data.nickname}`);
    lobby.attach(socket);
  });

  const close = () =>
    new Promise((resolve) => {
      lobby.dispose();
      io.close(() => resolve());
    });

  return { httpServer, io, lobby, close };
}
