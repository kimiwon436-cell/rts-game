import { config } from './config.js';
import { initFirebaseAdmin } from './firebase.js';
import { createGameServer } from './app.js';

if (config.authMode === 'firebase') {
  const { projectId } = initFirebaseAdmin(config.firebaseServiceAccount);
  console.log(`[Firebase] Admin SDK 초기화 — 프로젝트 ${projectId}`);
} else {
  console.warn('[개발 모드] FIREBASE_SERVICE_ACCOUNT가 없어 게스트 토큰(dev:...)으로 인증합니다.');
}

const { httpServer, close } = createGameServer({
  authMode: config.authMode,
  clientOrigins: config.clientOrigins,
});

httpServer.listen(config.port, () => {
  console.log(`[서버] http://localhost:${config.port} 에서 대기 중 — 허용 출처: ${config.clientOrigins.join(', ')}`);
});

function shutdown(signal) {
  console.log(`[서버] ${signal} — 종료합니다`);
  close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
