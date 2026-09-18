// 게임에 쓰는 모든 소리의 목록. 이 파일이 기준이다:
// - 게임은 여기 있는 id로 소리를 낸다 (client/src/audio/gameSounds.js)
// - docs/SOUNDS.md(넣을 파일 목록)는 이 목록으로 만든다 (npm run sounds:doc -w client)
// - 빠진 파일 점검도 이 목록으로 한다 (npm run sounds:check -w client)
//
// 소리는 다섯 가지뿐이다: 배경 음악(로비·게임) · 유닛별 공격 · 짓는 중 · 건설 완료 · 알람
// 짓는 중·건설 완료·알람은 소리 하나를 모든 건물·상황이 같이 쓴다.
// 파일 자리: client/src/assets/sounds/<id>.mp3 (예: attack/pikeman.mp3, alarm.mp3)
// 같은 소리를 여러 개 넣고 싶으면 <id>_1.mp3, <id>_2.mp3 … → 날 때마다 그중 하나가 무작위로 난다 (넣지 않아도 된다)

import { UNITS, UNIT_TYPES } from '@rune/shared/data/units.js';

/** 소리 갈래(채널). 설정에서 갈래마다 크기를 따로 조절한다 */
export const CHANNELS = Object.freeze({
  music: { name: '배경 음악', volume: 0.55 },
  alarm: { name: '알람', volume: 0.9 },
  sfx: { name: '공격·건물 소리', volume: 0.8 },
});

/** 파일 형식 규칙 (docs/SOUNDS.md에 그대로 싣는다) */
export const FORMAT = Object.freeze({
  extension: 'mp3',
  accepted: Object.freeze(['mp3', 'ogg', 'wav', 'm4a']),
  sampleRate: '44.1kHz',
  rules: Object.freeze({
    music: '스테레오 · 128–192kbps · 끝과 처음이 자연스럽게 이어지게 (끝나면 처음부터 다시 튼다) · 한 곡 5MB 이하',
    alarm: '모노 · 0.5–2초 · 앞 무음 없이 바로 시작 · 짧고 또렷하게 (여러 상황이 같이 쓰니 특정 대사보다 경고음·뿔나팔·종이 어울린다)',
    sfx: '모노 · 앞 무음 없이 바로 시작 · 공격 0.2–1초 · 짓는 중 2–4초 (끝과 처음이 이어지게, 되풀이된다) · 건설 완료 1–3초',
  }),
});

/** 받침이 있으면 앞의 조사, 없으면 뒤의 조사를 붙인다 (이/가) */
const josa = (word, withFinal, withoutFinal) => {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return word + (code >= 0 && code < 11172 && code % 28 !== 0 ? withFinal : withoutFinal);
};

// 소리 하나: { id, channel, when(언제), sound(어떤 소리), variants(여러 판 권장 수), length, loop? }
const S = (id, channel, when, sound, { length = '', loop = false } = {}) =>
  Object.freeze({ id, channel, when, sound, variants: 1, length, loop });

// ---------- 배경 음악 ----------

const BGM = [
  S('bgm/lobby', 'music', '첫 화면 · 로비 · 대기실', '중세 판타지풍. 차분하고 오래 들어도 지치지 않게', { length: '1–3분', loop: true }),
  S('bgm/game', 'music', '경기 중 (튜토리얼·리플레이·결과 화면 포함)', '잔잔하지만 살짝 긴장감 있는 중세풍', { length: '2–4분', loop: true }),
];

// ---------- 유닛별 공격 ----------
// 공격하는 순간 공격하는 유닛 자리에서 난다 (화면 속만, 화면 가장자리일수록 작게·그쪽 스피커로).
// 싸우지 않는 유닛(수송선·매 정찰병)은 공격이 없으니 소리도 없다. 감시탑은 장궁병 소리를 같이 쓴다.

const ATTACK_SOUND = {
  peasant: '곡괭이·도끼로 치는 소리',
  pikeman: '창으로 찌르는 소리',
  longbowman: '활시위를 당겼다 놓는 소리',
  scout_rider: '말 위에서 칼을 휘두르는 소리',
  knight: '긴 칼이 무겁게 휘둘리는 소리',
  royal_guard: '칼로 내려치는 소리 (방패 부딪힘)',
  battlemage: '마법 탄을 던지는 소리',
  solarion: '빛나는 창이 크게 휘둘리는 소리',
  etheria: '연쇄 번개가 튀는 소리',
  arkanon: '땅을 내리찍는 굉음',
  war_galley: '화살 여러 발을 한꺼번에 쏘는 소리',
  catapult_ship: '투석기 팔이 튕겨 돌을 날리는 소리',
  gryphon_rider: '발톱으로 할퀴며 내리꽂는 소리',
  storm_wyvern: '번개를 내리꽂는 폭격 소리',
};

const ATTACKS = UNIT_TYPES.filter((type) => UNITS[type].attack).map((type) =>
  S(`attack/${type}`, 'sfx', `${josa(UNITS[type].name, '이', '가')} 공격할 때`, ATTACK_SOUND[type] ?? '무기 소리', { length: '0.2–1초' }),
);

/** 공격 소리를 따로 두지 않고 빌려 쓰는 것. 감시탑은 장궁병처럼 활을 쏜다 */
export const BORROWED_ATTACK = Object.freeze({ watchtower: 'longbowman' });

/** 공격한 유닛·건물 종류 → 공격 소리 id */
export const attackSoundOf = (type) => `attack/${BORROWED_ATTACK[type] ?? type}`;

// ---------- 건물 (모든 건물이 같이 쓴다) ----------

const BUILDING = [
  S('construction', 'sfx', '농노가 건물을 짓는 동안 그 자리에서 되풀이 (화면 속 공사 터 가까운 2곳까지)', '망치질·톱질 같은 공사 소리', { length: '2–4초', loop: true }),
  S('complete', 'sfx', '우리 건물이 다 지어진 순간 (화면 밖이어도 들린다)', '완공을 알리는 밝은 종이나 짧은 팡파르', { length: '1–3초' }),
];

// ---------- 알람 (모든 상황이 같이 쓴다) ----------

/**
 * 알람이 울리는 경우. 소리는 alarm 하나를 같이 쓰고, 무슨 일인지는 화면 글로 알린다.
 * gap: 같은 경우를 이 간격(ms)보다 자주 울리지 않는다. priority: 알람끼리 겹치면 급한 쪽(큰 수)이 이긴다
 */
export const ALARM_CASES = Object.freeze({
  under_attack: { when: '화면 밖의 우리 병력이 공격받을 때', gap: 12000, priority: 2 },
  base_under_attack: { when: '화면 밖의 우리 건물이 공격받을 때', gap: 12000, priority: 2 },
  ally_under_attack: { when: '화면 밖의 팀원이 공격받을 때 (팀전)', gap: 20000, priority: 2 },
  no_gold: { when: '금이 모자랄 때', gap: 1500, priority: 1 },
  no_wood: { when: '목재가 모자랄 때', gap: 1500, priority: 1 },
  no_mana: { when: '마나가 모자랄 때', gap: 1500, priority: 1 },
  no_pop: { when: '인구가 가득 차 생산이 멈췄을 때', gap: 10000, priority: 1 },
  cannot_build: { when: '그 자리에 지을 수 없을 때', gap: 1000, priority: 1 },
  denied: { when: '그 밖의 이유로 명령이 안 될 때 (시대·건물 조건, 대기열 가득 …)', gap: 800, priority: 1 },
  mine_depleted: { when: '우리가 캐던 금광이 바닥났을 때', gap: 5000, priority: 2 },
  age_up: { when: '다음 시대로 발전했을 때', gap: 0, priority: 2 },
  oath: { when: '누군가 맹세를 맺었을 때 (모두에게 알리는 공지)', gap: 0, priority: 2 },
  resources_received: { when: '팀원이 자원을 보내왔을 때 (팀전)', gap: 0, priority: 2 },
  crown_falling: { when: '우리(팀) 영주관을 모두 잃어 왕관이 흔들릴 때', gap: 0, priority: 3 },
  crown_restored: { when: '영주관을 다시 세워 왕관을 지켰을 때', gap: 0, priority: 3 },
  enemy_crown_falling: { when: '적의 영주관이 모두 무너졌을 때', gap: 0, priority: 3 },
  ally_defeated: { when: '팀원이 쓰러졌을 때 (팀전)', gap: 0, priority: 3 },
  enemy_defeated: { when: '적 하나를 쓰러뜨렸을 때 (팀전)', gap: 0, priority: 3 },
  ultimate_lost: { when: '우리 궁극 유닛(솔라리온·에테리아·아르카논)이 쓰러졌을 때', gap: 0, priority: 3 },
});

const ALARM = [
  S('alarm', 'alarm', '알려야 할 일이 생겼을 때 (공격받음·자원 부족·지을 수 없음 등 모든 경우)', '짧고 또렷한 경고음 · 뿔나팔 · 종', { length: '0.5–2초' }),
];

/** 소리 갈래 순서 (문서 목차) */
export const SECTIONS = Object.freeze([
  { title: '배경 음악', sounds: BGM },
  { title: '유닛별 공격', sounds: ATTACKS },
  { title: '건물', sounds: BUILDING },
  { title: '알람', sounds: ALARM },
]);

/** 모든 소리 (id → 소리) */
export const SOUNDS = Object.freeze(Object.fromEntries(SECTIONS.flatMap((section) => section.sounds).map((s) => [s.id, s])));

/**
 * 파일 경로(sounds 폴더 기준, 예: 'attack/pikeman_2.mp3')에서 소리 id를 뽑는다.
 * 끝의 _숫자는 같은 소리의 여러 판이다. 형식이 틀리면 null.
 */
export function soundIdOf(path) {
  const match = /^(.+?)(?:_(\d+))?\.([a-z0-9]+)$/i.exec(path.replaceAll('\\', '/'));
  if (!match || !FORMAT.accepted.includes(match[3].toLowerCase())) return null;
  return match[1];
}
