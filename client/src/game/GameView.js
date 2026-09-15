import { PLAYER_COLORS, TILE_SIZE } from '@rune/shared/constants.js';
import { loadMap } from '@rune/shared/map/maps/index.js';
import { TERRAIN_NAMES, footprintCenter } from '@rune/shared/map/grid.js';
import { h } from '../ui/dom.js';
import { Camera } from '../render/Camera.js';
import { Renderer } from '../render/Renderer.js';
import { Minimap } from '../render/minimap.js';
import { Input } from '../input/Input.js';

const PAN_SPEED = 1100; // 화면 픽셀/초

/**
 * 게임 화면: 캔버스 렌더 루프 + HUD.
 * 3-1에서는 맵과 시작 위치를 보여주고 카메라를 움직일 수 있다.
 */
export function createGameView({ canvas, mapId, players, me, roomName, onLeave }) {
  const map = loadMap(mapId);
  const mySlot = players.find((p) => p.uid === me.uid)?.slot ?? 0;

  const camera = new Camera(map.width * TILE_SIZE, map.height * TILE_SIZE);
  const renderer = new Renderer(canvas, map, camera, players);
  const minimap = new Minimap(map, camera);
  const input = new Input(canvas);

  // ---------- HUD ----------
  const playerTags = new Map();
  const versus = h('div', { class: 'versus' });
  players.forEach((player, i) => {
    if (i > 0) versus.append(h('span', { class: 'vs' }, 'VS'));
    const tag = h(
      'span',
      { class: player.uid === me.uid ? 'player-tag is-me' : 'player-tag' },
      h('i', { class: 'swatch', style: `--c: ${PLAYER_COLORS[player.slot]}` }),
      `P${player.slot + 1} ${player.nickname}`,
    );
    playerTags.set(player.uid, tag);
    versus.append(tag);
  });

  const ping = h('span', { class: 'mono' }, '— ms');
  const tileInfo = h('span', { class: 'mono' }, '—');
  const zoomInfo = h('span', { class: 'mono' }, '100%');
  const banner = h('div', { class: 'hud-banner', role: 'status', hidden: true });

  const el = h(
    'div',
    { class: 'hud' },
    h(
      'header',
      { class: 'hud-top' },
      versus,
      h(
        'div',
        { class: 'hud-right' },
        h('span', {}, roomName),
        ping,
        h('button', { class: 'btn btn-sm', type: 'button', onClick: onLeave }, '나가기'),
      ),
    ),
    banner,
    h('div', { class: 'hud-minimap' }, minimap.canvas),
    h(
      'div',
      { class: 'hud-info' },
      h('span', {}, '타일 ', tileInfo),
      h('span', {}, '확대 ', zoomInfo),
      h('span', {}, 'WASD·가장자리 이동 · 휠 확대 · 가운데 버튼 드래그'),
    ),
  );

  // ---------- 시작 ----------
  canvas.hidden = false;
  renderer.resize();
  const myKeep = map.starts.find((s) => s.slot === mySlot).keep;
  const keepCenter = footprintCenter(myKeep);
  camera.centerOn(keepCenter.x, keepCenter.y);

  const onResize = () => renderer.resize();
  window.addEventListener('resize', onResize);

  let rafId = 0;
  let lastTime = performance.now();
  let infoTimer = 0;

  function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    const [kx, ky] = input.keyAxis();
    const [ex, ey] = input.edgeAxis(camera.viewWidth, camera.viewHeight);
    const mx = Math.sign(kx + ex);
    const my = Math.sign(ky + ey);
    if (mx || my) {
      const length = Math.hypot(mx, my);
      camera.pan((mx / length) * PAN_SPEED * dt, (my / length) * PAN_SPEED * dt);
    }
    const drag = input.consumeDrag();
    if (drag.x || drag.y) camera.pan(-drag.x, -drag.y);
    const wheel = input.consumeWheel();
    if (wheel) camera.zoomAt(wheel, input.mouse.x, input.mouse.y);

    if (input.mouse.inside) {
      const world = camera.screenToWorld(input.mouse.x, input.mouse.y);
      renderer.hoverTile = { x: Math.floor(world.x / TILE_SIZE), y: Math.floor(world.y / TILE_SIZE) };
    } else {
      renderer.hoverTile = null;
    }

    renderer.draw(now);
    minimap.draw();

    infoTimer -= dt;
    if (infoTimer <= 0) {
      infoTimer = 0.1;
      updateInfo();
    }
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  function updateInfo() {
    const t = renderer.hoverTile;
    tileInfo.textContent =
      t && t.x >= 0 && t.y >= 0 && t.x < map.width && t.y < map.height
        ? `${t.x}, ${t.y} · ${TERRAIN_NAMES[map.tiles[t.y * map.width + t.x]]}`
        : '—';
    zoomInfo.textContent = `${Math.round(camera.zoom * 100)}%`;
  }

  /** 방 상태가 바뀌면(상대가 나가면) HUD에 표시한다 */
  function updateRoom(room) {
    const present = new Set(room.players.map((p) => p.uid));
    let opponentLeft = false;
    for (const [uid, tag] of playerTags) {
      const gone = !present.has(uid);
      tag.classList.toggle('is-gone', gone);
      if (gone && uid !== me.uid) opponentLeft = true;
    }
    banner.textContent = '상대가 나갔습니다. 나가기를 눌러 로비로 돌아가세요.';
    banner.hidden = !opponentLeft;
  }

  return {
    el,
    updateRoom,
    setPing: (ms) => {
      ping.textContent = `${ms} ms`;
    },
    destroy() {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      input.destroy();
      canvas.hidden = true;
    },
  };
}
