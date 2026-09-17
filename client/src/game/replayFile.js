// 리플레이 녹화와 파일 입출력.
//
// 서버가 보내 준 스냅샷을 그대로 모아 둔다. 시뮬레이션을 다시 돌리는 방식이 아니라
// "그때 내가 본 화면"을 그대로 다시 트는 방식이라, 규칙이 바뀌어도 옛 리플레이가 깨지지 않는다.
// 대신 녹화한 사람의 시점이다 (내 자원·생산 대기열만 들어 있다).

export const REPLAY_FORMAT = 'rune-replay';
export const REPLAY_VERSION = 2; // 2: 유닛 위치를 움직인 만큼(MOVE)으로 담는다 (1도 읽는다)
export const REPLAY_EXTENSION = '.rcr';

/** 한 경기의 스냅샷을 모은다 */
export function createRecorder({ mapId, players, mySlot }) {
  const snapshots = [];
  let result = null;
  let bytes = 0;

  return {
    add(snap) {
      snapshots.push(snap);
      bytes += 40; // 대략치 (파일 크기 표시용)
    },
    finish(matchResult) {
      result = matchResult;
    },
    get count() {
      return snapshots.length;
    },
    get lastTick() {
      return snapshots.length ? snapshots[snapshots.length - 1].t : 0;
    },
    /** 저장할 리플레이 객체. uid 같은 개인 정보는 담지 않는다. */
    build() {
      return {
        format: REPLAY_FORMAT,
        version: REPLAY_VERSION,
        recordedAt: Date.now(),
        mapId,
        mySlot,
        players: players.map(({ nickname, slot, team }) => ({ nickname, slot, team: team ?? slot })),
        result,
        snapshots,
      };
    },
  };
}

const supportsGzip = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

/** 리플레이를 파일로 만든다. 가능하면 gzip으로 줄인다 (보통 1/8 크기) */
export async function encodeReplay(replay) {
  const json = JSON.stringify(replay);
  if (!supportsGzip()) return new Blob([json], { type: 'application/json' });
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Blob([await new Response(stream).arrayBuffer()], { type: 'application/gzip' });
}

/** 파일에서 리플레이를 읽는다. gzip이면 풀고, 형식이 아니면 예외를 던진다. */
export async function decodeReplay(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;

  let text;
  if (gzipped) {
    if (!supportsGzip()) throw new Error('이 브라우저에서는 압축된 리플레이를 열 수 없습니다.');
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(stream).text();
  } else {
    text = new TextDecoder().decode(buffer);
  }

  let replay;
  try {
    replay = JSON.parse(text);
  } catch {
    throw new Error('리플레이 파일을 읽을 수 없습니다.');
  }
  if (replay?.format !== REPLAY_FORMAT) throw new Error('룬 & 크라운 리플레이 파일이 아닙니다.');
  if (replay.version > REPLAY_VERSION) throw new Error('더 새로운 버전의 리플레이입니다. 게임을 새로고침해 보세요.');
  if (!Array.isArray(replay.snapshots) || !replay.snapshots.length) throw new Error('빈 리플레이입니다.');
  return replay;
}

/** 파일 이름: rune-2026-09-16-1432-새벽기사-vs-폭풍.rcr */
export function replayFileName(replay) {
  const d = new Date(replay.recordedAt);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const names = replay.players
    .map((p) => p.nickname.replace(/[^\p{L}\p{N}_-]/gu, ''))
    .filter(Boolean)
    .join('-vs-');
  return `rune-${stamp}-${names || 'match'}${REPLAY_EXTENSION}`;
}

/** 브라우저에서 파일로 내려받는다 */
export async function downloadReplay(replay) {
  const blob = await encodeReplay(replay);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = replayFileName(replay);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return blob.size;
}

/** 파일 고르기 창을 열어 리플레이 하나를 읽는다. 취소하면 null */
export function pickReplayFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${REPLAY_EXTENSION},.json,application/gzip,application/json`;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    });
    // 취소는 브라우저가 알려 주지 않는 경우가 있어, 창이 다시 활성화되면 정리한다
    window.addEventListener(
      'focus',
      () => setTimeout(() => {
        if (!input.files?.length) {
          input.remove();
          resolve(null);
        }
      }, 500),
      { once: true },
    );
    document.body.append(input);
    input.click();
  });
}
