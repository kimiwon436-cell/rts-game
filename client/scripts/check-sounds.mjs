// 사운드 파일 점검: 소리 목록(src/audio/soundList.js)과 폴더(src/assets/sounds)를 비교한다.
// 실행: npm run sounds:check -w client   (--strict: 빠진 소리가 있으면 실패로 끝난다)
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMAT, SECTIONS, SOUNDS, soundIdOf } from '../src/audio/soundList.js';

const ROOT = fileURLToPath(new URL('../src/assets/sounds/', import.meta.url));
const IGNORED = new Set(['.gitkeep', 'README.md', 'CREDITS.md']);
/** 이보다 크면 알려 준다 (내려받기가 느려진다) */
const SIZE_LIMIT = { music: 8 * 1024 * 1024, default: 300 * 1024 };

function walk(dir) {
  const files = [];
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const name of entries) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (!IGNORED.has(name)) files.push(path);
  }
  return files;
}

/** 폴더를 훑어 소리별 파일 수와 문제 있는 파일을 모은다 */
export function scanSounds(root = ROOT) {
  const found = new Map(); // id → 파일 수
  const unknown = [];
  const warnings = [];
  for (const file of walk(root)) {
    const rel = relative(root, file).replaceAll('\\', '/');
    const id = soundIdOf(rel);
    if (!id) {
      unknown.push(`${rel}  (이름 규칙이 틀렸다: 영어 소문자·숫자·_ 와 .${FORMAT.accepted.join('/.')} 만)`);
      continue;
    }
    if (!SOUNDS[id]) {
      unknown.push(`${rel}  (목록에 없는 이름 — 오타인지 확인)`);
      continue;
    }
    found.set(id, (found.get(id) ?? 0) + 1);
    if (!rel.endsWith(`.${FORMAT.extension}`)) warnings.push(`${rel}: .${FORMAT.extension}가 아니다 (아이폰에서 안 날 수 있다)`);
    const limit = SIZE_LIMIT[SOUNDS[id].channel] ?? SIZE_LIMIT.default;
    const size = statSync(file).size;
    if (size > limit) warnings.push(`${rel}: ${Math.round(size / 1024)}KB — ${Math.round(limit / 1024)}KB 넘으면 줄이는 게 좋다`);
  }
  return { found, unknown, warnings };
}

function main() {
  const strict = process.argv.includes('--strict');
  const { found, unknown, warnings } = scanSounds();
  const all = Object.values(SOUNDS);
  const missing = all.filter((s) => !found.has(s.id));
  const fewer = all.filter((s) => found.has(s.id) && found.get(s.id) < s.variants);

  const files = [...found.values()].reduce((a, b) => a + b, 0);
  console.log(`소리 ${all.length - missing.length} / ${all.length}개 있음 (파일 ${files}개)`);

  if (missing.length) {
    console.log(`\n빠진 소리 ${missing.length}개 — 이 이름으로 넣으면 된다:`);
    for (const section of SECTIONS) {
      const gone = section.sounds.filter((s) => !found.has(s.id));
      if (!gone.length) continue;
      console.log(`  [${section.title}]`);
      for (const s of gone) console.log(`    ${s.id}.${FORMAT.extension}${s.variants > 1 ? `  (권장 ${s.variants}개: _1 … _${s.variants})` : ''}  — ${s.when}`);
    }
  }
  if (fewer.length) {
    console.log(`\n권장 개수보다 적은 소리 ${fewer.length}개 (없어도 되지만, 같은 소리가 되풀이되면 덜 지겹다):`);
    for (const s of fewer) console.log(`    ${s.id}: ${found.get(s.id)} / ${s.variants}`);
  }
  if (unknown.length) {
    console.log(`\n목록에 없는 파일 ${unknown.length}개 (게임에서 쓰이지 않는다):`);
    for (const line of unknown) console.log(`    ${line}`);
  }
  if (warnings.length) {
    console.log(`\n확인할 것 ${warnings.length}개:`);
    for (const line of warnings) console.log(`    ${line}`);
  }
  if (!missing.length && !unknown.length) console.log('\n모든 소리가 제자리에 있다.');
  if (strict && missing.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
