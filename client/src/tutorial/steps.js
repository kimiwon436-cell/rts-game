import { UNITS } from '@rune/shared/data/units.js';

/**
 * 튜토리얼 단계. ctx = { match, sim(서버 월드), view(GameView), slot, touch, data(단계마다 쓰는 메모) }
 * - text: 마우스와 터치 안내가 다르면 { mouse, touch }
 * - start(ctx): 단계를 시작할 때 (자원 주기, 적 배치 등)
 * - done(ctx): 틱마다 확인. 참이면 다음 단계로
 * - manual: 참이면 '다음' 버튼으로 넘어간다
 */

const mine = (ctx, predicate) => [...ctx.sim.units.values()].filter((u) => u.owner === ctx.slot && predicate(u));
const selectedOwn = (ctx) =>
  [...ctx.view.selection].map((id) => ctx.sim.units.get(id)).filter((u) => u && u.owner === ctx.slot);
const keepOf = (ctx) => [...ctx.sim.buildings.values()].find((b) => b.owner === ctx.slot && b.type === 'keep');
const player = (ctx) => ctx.sim.players[ctx.slot];

export const TUTORIAL_STEPS = [
  {
    title: '화면 움직이기',
    text: {
      mouse: '방향키를 누르거나 마우스를 화면 가장자리로 가져가 화면을 움직여 보세요. 마우스 휠로 확대·축소합니다.',
      touch: '한 손가락으로 화면을 끌어 움직여 보세요. 두 손가락을 벌리고 오므리면 확대·축소합니다.',
    },
    start(ctx) {
      ctx.data.camera = { x: ctx.view.camera.x, y: ctx.view.camera.y, zoom: ctx.view.camera.zoomIndex };
    },
    done(ctx) {
      const { camera } = ctx.view;
      return Math.hypot(camera.x - ctx.data.camera.x, camera.y - ctx.data.camera.y) > 150 || camera.zoomIndex !== ctx.data.camera.zoom;
    },
  },
  {
    title: '유닛 고르기',
    text: {
      mouse: '영주관 옆의 농노 한 기를 클릭해 고르세요. 아래 명령 카드에 농노의 정보와 명령이 나옵니다.',
      touch: '영주관 옆의 농노 한 기를 눌러 고르세요. 아래 명령 카드에 농노의 정보와 명령이 나옵니다.',
    },
    done: (ctx) => selectedOwn(ctx).some((u) => UNITS[u.type].worker),
  },
  {
    title: '금 캐기',
    text: {
      mouse: '농노를 고른 채 금광(노란 바위)을 오른쪽 클릭하세요. 농노가 금을 캐서 영주관으로 나릅니다.',
      touch: '농노를 고른 채 금광(노란 바위)을 누르세요. 농노가 금을 캐서 영주관으로 나릅니다.',
    },
    done: (ctx) => mine(ctx, (u) => u.order?.type === 'gather' && u.order.mineId).length > 0,
  },
  {
    title: '여러 유닛 한 번에 고르기',
    text: {
      mouse: '빈 땅에서 마우스를 누른 채 끌어 사각형으로 농노 여럿을 한꺼번에 고르세요.',
      touch: '빈 땅을 길게 누른 채 끌어 사각형으로 농노 여럿을 한꺼번에 고르세요.',
    },
    done: (ctx) => selectedOwn(ctx).length >= 2,
  },
  {
    title: '나무 베기',
    text: {
      mouse: '고른 농노들로 나무를 오른쪽 클릭하세요. 목재는 건물을 짓는 데 가장 많이 듭니다.',
      touch: '고른 농노들로 나무를 누르세요. 목재는 건물을 짓는 데 가장 많이 듭니다.',
    },
    done: (ctx) => mine(ctx, (u) => u.order?.type === 'gather' && u.order.tile != null).length >= 1,
  },
  {
    title: '농가 짓기',
    text: {
      mouse: '농노를 고르고 명령 카드에서 "농가"(단축키 Q)를 누른 뒤, 영주관 근처 빈 땅을 클릭해 지으세요. 농가는 인구 상한을 8 늘립니다.',
      touch: '농노를 고르고 명령 카드에서 "농가"를 누른 뒤, 영주관 근처 빈 땅을 누른 채 끌어 자리를 맞추고 손을 떼세요.',
    },
    start(ctx) {
      player(ctx).wood = Math.max(player(ctx).wood, 250);
    },
    done: (ctx) => [...ctx.sim.buildings.values()].some((b) => b.owner === ctx.slot && b.type === 'farmstead'),
  },
  {
    title: '건설 기다리기',
    text: '농노가 농가를 짓고 있습니다. 튜토리얼에서는 시간을 빨리 감습니다…',
    start(ctx) {
      ctx.match.speed = 4;
    },
    done(ctx) {
      const built = [...ctx.sim.buildings.values()].some((b) => b.owner === ctx.slot && b.type === 'farmstead' && b.complete);
      if (built) ctx.match.speed = 1;
      return built;
    },
  },
  {
    title: '병영과 병력',
    text: {
      mouse: '농노로 "병영"(E)을 짓고, 다 지어지면 병영을 클릭해 "창병"(Q)을 뽑으세요. 짓고 뽑는 동안은 빨리 감습니다.',
      touch: '농노로 "병영"을 짓고, 다 지어지면 병영을 눌러 "창병"을 뽑으세요. 짓고 뽑는 동안은 빨리 감습니다.',
    },
    start(ctx) {
      Object.assign(player(ctx), { gold: Math.max(player(ctx).gold, 300), wood: Math.max(player(ctx).wood, 400) });
    },
    done(ctx) {
      const busy = [...ctx.sim.buildings.values()].some(
        (b) => b.owner === ctx.slot && ((b.type === 'barracks' && !b.complete) || b.queue.length > 0),
      );
      ctx.match.speed = busy ? 4 : 1;
      const trained = mine(ctx, (u) => u.type === 'pikeman').length > 0;
      if (trained) ctx.match.speed = 1;
      return trained;
    },
  },
  {
    title: '전투',
    text: {
      mouse: '적 척후 기병이 쳐들어옵니다! 창병을 모두 고르고 적을 오른쪽 클릭해 공격하세요. 창병은 기병에게 3배로 강합니다. (A 뒤 클릭은 공격 이동)',
      touch: '적 척후 기병이 쳐들어옵니다! 창병을 모두 고르고 적을 눌러 공격하세요. 창병은 기병에게 3배로 강합니다.',
    },
    start(ctx) {
      const keep = keepOf(ctx);
      const toward = { x: ctx.sim.width / 2, y: ctx.sim.height / 2 };
      for (let i = 0; i < 3; i++) ctx.sim.spawnUnitNear('pikeman', ctx.slot, keep, toward);
      const cx = keep.x + keep.w / 2;
      const cy = keep.y + keep.h / 2;
      ctx.data.raiders = [];
      for (let i = 0; i < 3; i++) {
        const spot = ctx.sim.nearestFreeTile(cx + 14 + i, cy - 12 + i) ?? [Math.floor(cx + 10), Math.floor(cy - 10)];
        const raider = ctx.sim.spawnUnit('scout_rider', 1 - ctx.slot, spot[0] + 0.5, spot[1] + 0.5);
        ctx.data.raiders.push(raider.id);
      }
      ctx.match.command(1 - ctx.slot, { type: 'attackMove', unitIds: ctx.data.raiders, x: cx, y: cy + 3 });
    },
    done: (ctx) => ctx.data.raiders.every((id) => !ctx.sim.units.has(id)),
  },
  {
    title: '더 알아 두기',
    text:
      '영주관을 고르면 "성채 시대로 발전"할 수 있습니다. 시대가 오르면 기사·왕실 근위병·전투 마법사가 열리고, ' +
      '왕국 시대에는 "맹세의 성소"에서 세 맹세 중 하나를 골라 궁극 유닛을 부릅니다. ' +
      '영주관은 하나뿐이라 새로 짓거나 팔 수 없고, 무너지면 그 자리에서 집니다. ' +
      '다른 건물은 골라서 "판매"(X, 두 번 누르기)하면 비용의 절반을 돌려받습니다.',
    manual: true,
  },
];
