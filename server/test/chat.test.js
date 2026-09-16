// 방 채팅: 전체·팀, 거르기, 도배 제한, 들어올 때 받는 대화 기록
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io as connect } from 'socket.io-client';
import { EV, ERR } from '@rune/shared/protocol.js';
import { createGameServer } from '../src/app.js';

let server;
let url;
const sockets = [];

before(async () => {
  server = createGameServer({ authMode: 'dev', clientOrigins: ['http://localhost'], countdownSec: 0.05 });
  server.httpServer.listen(0);
  await once(server.httpServer, 'listening');
  url = `http://localhost:${server.httpServer.address().port}`;
});

after(async () => {
  sockets.forEach((s) => s.close());
  await server.close();
});

async function player(name) {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, auth: { token: `dev:${name}-chat-0001` } });
  sockets.push(socket);
  socket.inbox = [];
  socket.on(EV.CHAT_MESSAGE, (m) => socket.inbox.push(m));
  const [profile] = await once(socket, EV.SESSION_PROFILE);
  if (!profile) await socket.emitWithAck(EV.PROFILE_CREATE, { nickname: name });
  return socket;
}

const settle = () => new Promise((r) => setTimeout(r, 60));
const texts = (socket) => socket.inbox.filter((m) => m.from).map((m) => m.text);

test('대기실 전체 채팅: 방의 모두가 받고, 들어오고 나가는 것은 안내로 남는다', async () => {
  const anna = await player('anna');
  const bert = await player('bert');
  const { room } = await anna.emitWithAck(EV.LOBBY_CREATE, { name: '수다방' });
  await bert.emitWithAck(EV.LOBBY_JOIN, { roomId: room.id });
  await settle();
  assert.ok(anna.inbox.some((m) => m.from === null && m.text === 'bert님이 들어왔습니다.'));

  const res = await bert.emitWithAck(EV.CHAT_SEND, { text: '안녕하세요!', scope: 'all' });
  assert.equal(res.ok, true);
  await settle();
  for (const socket of [anna, bert]) {
    const message = socket.inbox.find((m) => m.text === '안녕하세요!');
    assert.deepEqual(message?.from, { nickname: 'bert', team: 1, slot: null });
    assert.equal(message.scope, 'all');
  }

  await bert.emitWithAck(EV.LOBBY_LEAVE);
  await settle();
  assert.ok(anna.inbox.some((m) => m.from === null && m.text === 'bert님이 나갔습니다.'));
});

test('서버가 거른다: 방 밖, 빈 글, 보이지 않는 문자·욕설, 5초에 5개', async () => {
  const cara = await player('cara');
  assert.deepEqual(await cara.emitWithAck(EV.CHAT_SEND, { text: '여보세요' }), { ok: false, error: ERR.NOT_IN_ROOM });
  await cara.emitWithAck(EV.LOBBY_CREATE, { name: '혼자' });
  assert.deepEqual(await cara.emitWithAck(EV.CHAT_SEND, { text: '   ' }), { ok: false, error: ERR.CHAT_EMPTY });

  const tab = String.fromCharCode(9);
  const zeroWidth = String.fromCharCode(0x200b);
  await cara.emitWithAck(EV.CHAT_SEND, { text: `  씨${zeroWidth}발${tab}${tab}뭐야   ` });
  await settle();
  assert.equal(texts(cara).at(-1), '*** 뭐야', '제로폭 문자를 끼워도 욕설로 잡고, 공백은 하나로');

  for (let i = 0; i < 4; i++) assert.equal((await cara.emitWithAck(EV.CHAT_SEND, { text: `도배 ${i}` })).ok, true);
  assert.deepEqual(await cara.emitWithAck(EV.CHAT_SEND, { text: '여섯 번째' }), { ok: false, error: ERR.CHAT_RATE_LIMITED });
});

test('팀 채팅은 같은 팀만 받고, 나중에 들어온 사람은 볼 수 있는 기록만 받는다', async () => {
  const [dora, egon, finn] = await Promise.all(['dora', 'egon', 'finn'].map(player));
  const { room } = await dora.emitWithAck(EV.LOBBY_CREATE, { name: '팀 수다', mode: '2v2' });
  await egon.emitWithAck(EV.LOBBY_JOIN, { roomId: room.id }); // 팀 1
  await finn.emitWithAck(EV.LOBBY_JOIN, { roomId: room.id }); // 팀 0 (dora와 같은 팀)
  await settle();

  await dora.emitWithAck(EV.CHAT_SEND, { text: '우리끼리 작전', scope: 'team' });
  await dora.emitWithAck(EV.CHAT_SEND, { text: '다들 잘 부탁해요', scope: 'all' });
  await settle();
  assert.ok(texts(finn).includes('우리끼리 작전'), '같은 팀은 받는다');
  assert.equal(texts(egon).includes('우리끼리 작전'), false, '상대 팀은 못 받는다');
  assert.ok(texts(egon).includes('다들 잘 부탁해요'));

  // 팀 1로 들어오는 사람: 기록에서 팀 0의 팀 채팅은 빠진다
  const gwen = await player('gwen');
  const history = once(gwen, EV.CHAT_HISTORY);
  await gwen.emitWithAck(EV.LOBBY_JOIN, { roomId: room.id });
  const [{ roomId, messages }] = await history;
  assert.equal(roomId, room.id);
  const said = messages.filter((m) => m.from).map((m) => m.text);
  assert.deepEqual(said, ['다들 잘 부탁해요']);
});
