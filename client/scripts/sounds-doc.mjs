// docs/SOUNDS.md를 소리 목록(src/audio/soundList.js)으로 다시 만든다. 목록을 고치면 다시 돌린다.
// 실행: npm run sounds:doc -w client
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALARM_CASES, BORROWED_ATTACK, CHANNELS, FORMAT, SECTIONS, SOUNDS } from '../src/audio/soundList.js';
import { UNITS } from '@rune/shared/data/units.js';
import { BUILDINGS } from '@rune/shared/data/buildings.js';

const DOC = fileURLToPath(new URL('../../docs/SOUNDS.md', import.meta.url));
const SOUND_ROOT = fileURLToPath(new URL('../src/assets/sounds/', import.meta.url));

const all = Object.values(SOUNDS);
const ext = FORMAT.extension;
const cell = (text) => String(text).replaceAll('|', '\\|');
const fileOf = (id) => `${id}.${ext}`;

// 폴더 그림: 폴더는 무엇이 몇 개 들어가는지, 맨 위의 파일은 이름 그대로
const LABEL = {
  bgm: '배경 음악',
  attack: '유닛별 공격',
  construction: '짓는 중 (모든 건물, 반복)',
  complete: '건설 완료 (모든 건물)',
  alarm: '알람 (모든 상황)',
};
const folders = new Map(); // 폴더 → 소리들
const rootFiles = [];
for (const sound of all) {
  const slash = sound.id.lastIndexOf('/');
  if (slash < 0) {
    rootFiles.push(sound);
    continue;
  }
  const folder = sound.id.slice(0, slash);
  if (!folders.has(folder)) folders.set(folder, []);
  folders.get(folder).push(sound);
}
const nameOf = (s) => fileOf(s.id.split('/').pop());
const treeRows = [
  ...[...folders].map(([folder, sounds]) => [
    `${folder}/`,
    `${LABEL[folder] ?? folder} ${sounds.length}개: ${sounds.slice(0, 3).map(nameOf).join(', ')}${sounds.length > 3 ? ' …' : ''}`,
  ]),
  ...rootFiles.map((s) => [fileOf(s.id), LABEL[s.id] ?? s.when]),
];
const width = Math.max(...treeRows.map(([name]) => name.length)) + 2;
const tree = treeRows.map(([name, note], i) => `${i === treeRows.length - 1 ? '└─' : '├─'} ${name.padEnd(width)}${note}`);

const borrowed = Object.entries(BORROWED_ATTACK)
  .map(([type, from]) => `${BUILDINGS[type]?.name ?? UNITS[type]?.name ?? type} → \`${fileOf(`attack/${from}`)}\` (${UNITS[from].name})`)
  .join(', ');
const silentUnits = Object.entries(UNITS)
  .filter(([, def]) => !def.attack)
  .map(([, def]) => def.name)
  .join('·');

const lines = [
  '# 사운드 넣는 법',
  '',
  '> 이 문서는 `client/src/audio/soundList.js`에서 만든다 (`npm run sounds:doc -w client`). 직접 고치지 말고 목록을 고친다.',
  '',
  `소리 파일 **${all.length}개**. 만든 파일을 아래 이름 그대로 \`client/src/assets/sounds/\`에 넣으면 게임이 알아서 쓴다.`,
  '빠진 소리는 조용히 건너뛰므로 만드는 대로 하나씩 넣어도 된다.',
  '',
  '## 1. 넣는 곳과 이름',
  '',
  '```',
  'client/src/assets/sounds/',
  ...tree,
  '```',
  '',
  `- 이름은 아래 표의 **파일** 그대로: 영어 소문자·숫자·\`_\`만 (한글·빈칸·대문자 X). 예: \`${fileOf('attack/pikeman')}\`, \`${fileOf('alarm')}\``,
  '- 폴더(`bgm/`, `attack/`)는 만들어 두었다. 폴더 안의 `.gitkeep`은 지우지 않아도 된다.',
  '- 짓는 중·건설 완료·알람은 **파일 하나를 모든 건물·상황이 같이 쓴다.**',
  `- 공격이 없는 유닛(${silentUnits})은 공격 소리가 없다. 공격하는 건물은 유닛 소리를 빌려 쓴다: ${borrowed}`,
  `- (선택) 같은 소리를 여러 개 넣으면 날 때마다 무작위로 하나가 난다: \`${fileOf('attack/pikeman').replace('.', '_1.')}\`, \`${fileOf('attack/pikeman').replace('.', '_2.')}\``,
  '',
  '## 2. 파일 만들 때',
  '',
  `- 형식: **.${ext}** · ${FORMAT.sampleRate} (모든 브라우저·아이폰에서 난다. .${FORMAT.accepted.filter((e) => e !== ext).join('/.')}도 읽지만 아이폰에서 안 날 수 있다)`,
  ...Object.entries(FORMAT.rules).map(([channel, rule]) => `- ${CHANNELS[channel].name}: ${rule}`),
  '- 소리끼리 크기를 비슷하게 맞춘다 (어떤 것만 튀지 않게). 게임 안 **소리** 버튼에서 전체·배경 음악·알람·공격·건물 소리 크기를 따로 줄일 수 있다.',
  '- 효과음은 300KB, 음악은 8MB를 넘지 않게 (넘으면 점검이 알려 준다).',
  '',
  '## 3. 넣은 뒤',
  '',
  '1. 확인: 빠진 소리·이름이 틀린 파일·너무 큰 파일을 알려 준다.',
  '   ```bash',
  '   npm run sounds:check -w client',
  '   ```',
  '2. 개발 서버(`npm run dev`)를 켜 두었으면 브라우저를 **새로 고침**만 하면 들린다.',
  '3. 사이트에 올리기: GitHub에 올라가면 Netlify가 다시 빌드한다. 둘 중 편한 쪽으로.',
  '   - GitHub 웹: 저장소에서 `client/src/assets/sounds/` 폴더로 들어가 **Add file → Upload files**로 올린다.',
  '     공격 소리는 `attack/`, 음악은 `bgm/` 폴더 안에서 올린다.',
  '   - 터미널:',
  '     ```bash',
  '     git add client/src/assets/sounds',
  '     ```',
  '     ```bash',
  '     git commit -m "사운드 추가"',
  '     ```',
  '     ```bash',
  '     git push',
  '     ```',
  '4. 소리는 브라우저 정책 때문에 화면을 한 번 누른 뒤부터 난다.',
  '',
  '## 4. 전체 목록',
  '',
];

for (const section of SECTIONS) {
  lines.push(`### ${section.title}`, '');
  lines.push('| 파일 | 언제 | 어떤 소리 (예시) | 길이 |', '|---|---|---|---|');
  for (const s of section.sounds) {
    lines.push(`| \`${fileOf(s.id)}\` | ${cell(s.when)} | ${cell(s.sound)} | ${cell([s.length, s.loop ? '반복' : ''].filter(Boolean).join(' · '))} |`);
  }
  lines.push('');
}

lines.push('### 알람이 울리는 경우', '');
lines.push(`모두 \`${fileOf('alarm')}\` 하나가 난다. 무슨 일인지는 화면 글로 알린다. 알람끼리 겹치면 급한 쪽이 먼저다.`, '');
lines.push('| 경우 | 같은 경우 다시 울리기까지 | 급한 정도 |', '|---|---|---|');
const URGENCY = { 1: '보통', 2: '높음', 3: '가장 높음' };
for (const alarmCase of Object.values(ALARM_CASES)) {
  lines.push(`| ${cell(alarmCase.when)} | ${alarmCase.gap ? `${alarmCase.gap / 1000}초` : '바로'} | ${URGENCY[alarmCase.priority]} |`);
}
lines.push('');

writeFileSync(DOC, `${lines.join('\n')}\n`);

// 폴더 뼈대: 소리가 들어갈 폴더마다 .gitkeep (빈 폴더도 저장소에 남게)
for (const folder of folders.keys()) {
  const dir = join(SOUND_ROOT, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.gitkeep'), '');
}

// 목록에서 빠진 폴더는 치운다. 단 .gitkeep 말고 파일이 하나라도 있으면 그대로 두고 알린다
const wanted = (rel) => [...folders.keys()].some((folder) => folder === rel || folder.startsWith(`${rel}/`));
function tidy(dir, rel) {
  let empty = true;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const child = rel ? `${rel}/${name}` : name;
    if (statSync(path).isDirectory()) {
      if (wanted(child) || !tidy(path, child)) empty = false;
      else rmSync(path, { recursive: true });
    } else if (name !== '.gitkeep' || !rel) {
      empty = false;
    }
  }
  if (!empty && rel && !wanted(rel)) console.warn(`목록에 없는 폴더에 파일이 있다 (쓰이지 않는다): ${rel}/`);
  return empty;
}
tidy(SOUND_ROOT, '');

console.log(`docs/SOUNDS.md: 소리 파일 ${all.length}개, 폴더 ${folders.size}개`);
