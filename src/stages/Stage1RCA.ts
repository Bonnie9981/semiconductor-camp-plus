import type { Contamination } from '../core/WaferState';
import type {
  InstructionStep,
  MixRow,
  PanelSpec,
  Point,
  StageContext,
  StageFrame,
  StageResult,
  SubStep,
} from '../core/types';
import { blendColor, isUnsafePour, solution, toMixRow } from '../data/solutions';
import { Beaker, drawFlatWafer, WAFER_SQUASH, type BeakerGeometry } from '../scene/Beaker';
import { bottleMouth, drawBottle, drawPourStream, type BottleVisual } from '../scene/Bottle';
import { drainMouth, drawDrain, type DrainGeometry } from '../scene/Drain';
import { Explosion } from '../scene/Explosion';
import { SpinDryer, type DryerGeometry, type DryerPhase } from '../scene/SpinDryer';
import { BaseStage } from './BaseStage';

/**
 * 第一關：RCA 清洗
 * ---------------------------------------------------------------------------
 * 四個子步驟，前三步是「濕式化學槽」、第四步是「旋轉乾燥」：
 *
 *   1. 去微粒    SC-1   DI : NH₄OH : H₂O₂ = 5 : 1 : 1
 *   2. 去氧化層  HF dip 氫氟酸水溶液（唯一能溶解 SiO₂ 的酸）
 *   3. 去離子    SC-2   DI : HCl : H₂O₂ = 6 : 1 : 1
 *   4. 乾燥      旋轉甩乾 + 熱風
 *
 * 前三步不是在面板上選選項，而是真的動手配液：
 *
 *   捏起藥瓶 ─▶ 移到調配杯上方 ─▶ 瓶身自動傾倒、液柱流下、每 0.8 秒進 1 份
 *        │                                    │
 *        └── 放開＝放回檯面                    └── 杯子的液面高度與顏色即時改變
 *
 *   送去浸泡 ─▶ 配方對 ─▶ 浸泡動畫 ─▶ 下一步
 *              └ 配方錯 ─▶ 鎖住，只能把整杯拿去廢液桶倒掉重來
 *
 * 第四步改用手勢：捏合把晶圓夾進滾筒，再按下 START。
 */

type Phase =
  /** 配液中：藥瓶可以拿起來倒 */
  | 'pour'
  /** 配錯了：只能倒掉重來 */
  | 'wrong'
  /** 倒廢液動畫進行中 */
  | 'dumping'
  /** 配液順序錯誤導致突沸，爆炸動畫進行中 */
  | 'boom'
  /** 浸泡動畫進行中 */
  | 'dip'
  /** 乾燥：等玩家把晶圓夾進滾筒 */
  | 'load'
  /** 乾燥：等玩家按下 START */
  | 'ready'
  /** 乾燥：甩乾中 */
  | 'spin'
  /** 全部做完 */
  | 'finished';

interface WetRecipe {
  title: string;
  note: string;
  /** 檯面上會出現哪些藥瓶（含干擾項），順序即排列順序。 */
  pool: string[];
  /** 正確配方的成分順序（決定面板上比例的讀法）。 */
  answer: string[];
  /** 正確份數。 */
  ratio: Record<string, number>;
  /** 這一步清掉哪一項污染。 */
  clears: keyof Contamination;
  beakerLabel: string;
  dipSeconds: number;
  /** 配錯時的提示。 */
  wrongHint: string;
}

const RECIPES: Record<string, WetRecipe> = {
  particle: {
    title: '第一步 · 去微粒（SC-1）',
    note: '微粒靠靜電吸附在晶圓上。要配出能讓微粒與晶圓「同性相斥」的鹼性溶液，並把有機物氧化掉。',
    pool: ['di', 'nh4oh', 'h2o2', 'hcl', 'hf', 'acetone'],
    answer: ['di', 'nh4oh', 'h2o2'],
    ratio: { di: 5, nh4oh: 1, h2o2: 1 },
    clears: 'particles',
    beakerLabel: 'SC-1 · 去微粒槽 75°C',
    dipSeconds: 6,
    wrongHint: 'SC-1 需要「超純水 + 鹼 + 氧化劑」三者，比例 5 : 1 : 1。酸性藥液只會讓微粒更黏。',
  },
  oxide: {
    title: '第二步 · 去除氧化層',
    // 這一步只有一種藥液，杯子裡不會有兩種東西相遇，所以不涉及突沸。
    note: '矽一接觸空氣就會長出一層原生二氧化矽（SiO₂）。只有一種酸溶得掉它，倒 1 份就夠。',
    pool: ['hf', 'hcl', 'nh4oh', 'h2o2', 'hno3', 'di'],
    answer: ['hf'],
    ratio: { hf: 1 },
    clears: 'oxide',
    beakerLabel: 'HF DIP · 氫氟酸水溶液',
    dipSeconds: 5,
    wrongHint: '只有氫氟酸能與 SiO₂ 反應生成可溶的 H₂SiF₆，其他酸對氧化層無效。這一步只需要 1 份。',
  },
  ions: {
    title: '第三步 · 去除離子（SC-2）',
    note: '前一步殘留的金屬離子必須帶走。要配出能與金屬離子形成可溶錯合物的酸性溶液。',
    pool: ['di', 'hcl', 'h2o2', 'nh4oh', 'hf', 'nmp'],
    answer: ['di', 'hcl', 'h2o2'],
    ratio: { di: 6, hcl: 1, h2o2: 1 },
    clears: 'ions',
    beakerLabel: 'SC-2 · 去離子槽 75°C',
    dipSeconds: 6,
    wrongHint: 'SC-2 需要「超純水 + 酸 + 氧化劑」，比例 6 : 1 : 1。鹼性的氨水會讓金屬再沉積回去。',
  },
};

/** 瓶口停在杯口上方多久算「倒進 1 份」。 */
const POUR_INTERVAL = 0.8;
/** 調配杯最多裝幾份，避免玩家一直倒到溢出。最長的配方是 SC-2 的 8 份。 */
const MAX_PARTS = 12;
/** 傾倒時的瓶身角度（負值＝往左倒，因為藥瓶排在杯子右邊）。 */
const POUR_TILT = -2.0;
/** 把整杯廢液倒進桶子時，調配杯的傾角（正值＝往右倒）。 */
const DUMP_TILT = 1.2;

/** 場景可用的水平範圍（已避開左側的互動面板）。 */
interface SceneBounds {
  left: number;
  right: number;
  w: number;
}

/** 藥瓶那一排的擺放參數。 */
interface ShelfLayout {
  scene: SceneBounds;
  /** 瓶底所在的 y（＝層板高度）。 */
  y: number;
  /** 單一瓶身寬度。 */
  w: number;
}

export class Stage1RCA extends BaseStage {
  readonly id = 'rca-clean';
  readonly title = 'RCA 清洗';
  readonly shortTitle = 'RCA 清洗';
  readonly description =
    '晶圓進廠時表面有微粒、原生氧化層與金屬離子。親手配出三種清洗液把它們洗掉，最後甩乾。';
  readonly hint = '先加去離子水！沒有水墊底就把兩種藥液混在一起會突沸。配錯了要整杯倒進廢液桶重來。';
  readonly primaryLabel = '完成清洗';
  readonly usesCrossSection = true;

  readonly substeps: readonly SubStep[] = [
    { id: 'particle', title: '去微粒', desc: 'SC-1：DI : NH₄OH : H₂O₂ = 5 : 1 : 1' },
    { id: 'oxide', title: '去氧化層', desc: '氫氟酸水溶液溶解原生 SiO₂' },
    { id: 'ions', title: '去離子', desc: 'SC-2：DI : HCl : H₂O₂ = 6 : 1 : 1' },
    { id: 'dry', title: '乾燥', desc: '離心力甩乾 + 80°C 熱風' },
  ];

  readonly instructions: InstructionStep[] = [
    { glyph: '🤏', title: '捏起藥瓶', desc: '瓶子下方亮起光暈就代表抓得到，捏合即可拿起來。' },
    { glyph: '💧', title: '先倒去離子水', desc: '杯子裡沒有水就倒濃藥液會突沸噴濺 —— 整杯報廢重配。' },
    { glyph: '🫗', title: '倒進調配杯', desc: '移到杯口上方瓶身會自動傾倒，每停留 0.8 秒進 1 份。' },
    { glyph: '💧', title: '送去浸泡', desc: '配方正確才會通過；配錯會鎖住，要整杯倒掉重來。' },
    { glyph: '🌀', title: '夾進乾燥機', desc: '最後一步捏合抓起晶圓，放進滾筒後按 START 甩乾。' },
  ];

  // ── 流程 ──
  private phase: Phase = 'pour';
  private error: string | null = null;
  /** 動畫計時（秒），每次換 phase 歸零。 */
  private timer = 0;

  // ── 配液 ──
  /** 已倒入的成分，依倒入順序。 */
  private mix: MixRow[] = [];
  private heldBottle: string | null = null;
  private bottlePos: Point | null = null;
  private bottleTilt = 0;
  /** 瓶口停在杯口上方的累積秒數。 */
  private pourAccum = 0;
  private pouring = false;
  /** 剛倒進一份時的閃爍動畫 0~1。 */
  private splash = 0;

  // ── 倒廢液 ──
  private heldBeaker = false;
  private beakerHand: Point | null = null;
  /** 倒廢液動畫進度 0~1。 */
  private dumpT = 0;
  private dumpFrom: Point | null = null;

  // ── 場景 ──
  private readonly beaker = new Beaker();
  private readonly dryer = new SpinDryer();
  private readonly explosion = new Explosion();
  private waferDip = -1;
  private bubbling = 0;

  // ── 乾燥 ──
  private holding = false;
  private heldPoint: Point | null = null;
  private dryPhase: DryerPhase = 'loading';
  private spinAngle = 0;
  private spinSpeed = 0;

  // ─────────────────────────────── 生命週期 ────────────────────────────────

  override onEnter(ctx: StageContext): void {
    super.onEnter(ctx);
    ctx.desk.setWaferVisible(false);
    ctx.desk.setDeskLabel('RCA WET BENCH · 濕式清洗檯');
    this.resetSub();
    this.onSubEnter(0);
  }

  override onExit(): void {
    this.ctx?.ui.setPanel(null);
    this.ctx?.desk.setWaferVisible(true);
    this.ctx?.desk.setDeskLabel(null);
  }

  override restart(): void {
    super.restart();
    this.ctx?.wafer.reset();
    this.beaker.reset();
    this.dryer.reset();
    this.onSubEnter(0);
  }

  protected override onSubEnter(index: number): void {
    this.error = null;
    this.timer = 0;
    this.waferDip = -1;
    this.bubbling = 0;
    this.beaker.reset();
    this.clearMix();

    const sub = this.substeps[index];
    if (!sub) {
      this.phase = 'finished';
      this.ctx?.ui.setPanel(null);
      return;
    }

    if (sub.id === 'dry') {
      this.phase = 'load';
      this.dryPhase = 'loading';
      this.holding = false;
      this.heldPoint = null;
      this.spinAngle = 0;
      this.spinSpeed = 0;
      this.dryer.reset();
      // 前一步剛從水槽拿出來，表面是濕的
      if (this.ctx) this.ctx.wafer.contamination.water = 1;
      return;
    }

    this.phase = 'pour';
  }

  /** 清空調配杯與所有手上的東西。 */
  private clearMix(): void {
    this.mix = [];
    this.heldBottle = null;
    this.bottlePos = null;
    this.bottleTilt = 0;
    this.pourAccum = 0;
    this.pouring = false;
    this.splash = 0;
    this.heldBeaker = false;
    this.beakerHand = null;
    this.dumpT = 0;
    this.dumpFrom = null;
    this.explosion.reset();
  }

  // ───────────────────────────────── 主迴圈 ────────────────────────────────

  override onFrame(frame: StageFrame): void {
    const { desk, ui, dt } = frame;
    this.timer += dt;

    const { deskTop, deskHeight } = desk.geometry;
    // 器材站立的基準線：桌面上緣往下一點，讓機台看起來「站在桌上」
    const groundY = deskTop + deskHeight * 0.44;
    const sub = this.currentSub;

    if (sub?.id === 'dry') {
      this.frameDry(frame, groundY);
    } else if (sub) {
      this.frameWet(frame, groundY);
    } else {
      ui.setArHint('✅ RCA 清洗完成 — 按右側「完成清洗」進入下一關', true);
      ui.setHandState('✨', '晶圓已潔淨', 'RCA COMPLETE', true);
    }

    this.syncPanel();
  }

  /**
   * 場景（燒杯／藥瓶／機台）可用的水平範圍。
   *
   * 左界必須避開 UI 的互動面板，否則視窗一縮小，最左邊的藥瓶就會被面板蓋住。
   * 面板寬度在 CSS 裡會隨斷點改變，所以這裡直接跟 UIManager 問「實際佔用了多少」，
   * 而不是在 canvas 這邊再複製一份斷點——只要改 CSS 的 --panel-scene-w，
   * 場景就會自動跟著讓位。
   */
  private sceneBounds(frame: StageFrame): SceneBounds {
    const { width } = frame.desk.size;
    const inset = frame.ui.panelInset();
    const right = width - 14;
    // 面板真的很寬（極窄視窗）時不讓場景被壓到沒有空間
    const left = Math.min(inset > 0 ? inset + 26 : width * 0.06, width * 0.52);
    return { left, right, w: Math.max(180, right - left) };
  }

  // ────────────────────── 前三步：配液 → 浸泡（或倒掉重來） ────────────────────

  private frameWet(frame: StageFrame, groundY: number): void {
    const { ui, desk, dt, time, hand } = frame;
    const ctx = desk.context;
    const { width, height } = desk.size;
    const wafer = this.ctx.wafer;
    const recipe = RECIPES[this.currentSub!.id];

    this.splash = Math.max(0, this.splash - dt * 3);

    // ── 幾何佈局 ──
    const scene = this.sceneBounds(frame);
    const bh = clamp(Math.min(height * 0.29, scene.w * 0.46), 110, 196);
    const benchGeo: BeakerGeometry = {
      cx: scene.left + scene.w * 0.26,
      top: groundY - bh,
      width: bh * 0.76,
      height: bh,
    };
    const drainW = clamp(scene.w * 0.13, 46, 78);
    const drainGeo: DrainGeometry = {
      cx: scene.right - drainW * 0.55,
      baseY: groundY,
      width: drainW,
    };
    const waferR = benchGeo.width * 0.34;

    // 藥瓶：尺寸依可用寬度算，但設下限，小螢幕上也要看得清標籤
    const shelf: ShelfLayout = {
      scene,
      y: benchGeo.top - clamp(height * 0.045, 14, 40),
      w: clamp((scene.w / recipe.pool.length) * 0.74, 38, 70),
    };

    // 調配杯目前的位置與傾角（可能被拿在手上、或正在倒廢液）
    const { geo, tilt } = this.beakerTransform(benchGeo, drainGeo, dt);

    // 爆點固定在杯口，縮放跟著杯子大小走
    this.boomOrigin = { x: geo.cx, y: geo.top + geo.height * 0.15 };
    this.boomScale = clamp(geo.width / 120, 0.8, 1.6);

    // ── 互動（爆炸期間全部停掉） ──
    if (this.phase === 'pour') {
      this.updateBottles(hand, recipe, geo, shelf, dt);
    }
    if (this.phase === 'pour' || this.phase === 'wrong') {
      this.updateBeakerGrab(hand, benchGeo, drainGeo);
    }
    if (this.phase === 'dip') this.advanceDip(recipe, dt);

    if (this.phase === 'boom') {
      this.explosion.update(dt);
      // 閃焰過去之後杯子就空了 —— 玩家看得到「整杯報廢」
      if (this.explosion.progress > 0.16 && this.mix.length > 0) {
        this.mix = [];
        this.beaker.reset();
      }
      if (!this.explosion.active) {
        this.explosion.reset();
        this.phase = 'pour';
        // error 保留著，面板會繼續顯示為什麼炸掉
      }
    }

    // ── 液體狀態 ──
    const totalParts = this.mix.reduce((s, r) => s + r.parts, 0);
    const drainFactor = this.phase === 'dumping' ? this.dumpDrainFactor() : 1;
    const fillLevel = clamp((totalParts / MAX_PARTS) * 0.88, 0, 0.88) * drainFactor;
    const liquid = blendColor(this.mix);

    // ── 繪製 ──
    drawDrain(
      ctx,
      drainGeo,
      {
        hot: this.heldBeaker && this.overDrain(geo, drainGeo),
        draining: this.phase === 'dumping' ? 1 - drainFactor : 0,
        wasteColor: liquid,
      },
      time,
    );

    // 等待中的晶圓（還沒輪到它下水），擺在調配杯左邊的載盤上
    if (this.waferDip < 0) {
      const standX = clamp(
        benchGeo.cx - benchGeo.width * 0.5 - waferR - 26,
        scene.left + waferR + 8,
        benchGeo.cx,
      );
      this.drawWaferStand(ctx, standX, groundY, waferR, wafer.surfaceColor(), time);
    }

    this.beaker.render(
      ctx,
      geo,
      {
        fillLevel,
        liquid,
        waferDip: this.waferDip,
        waferR,
        waferColor: wafer.surfaceColor(),
        bubbling: this.bubbling,
        label: totalParts === 0 ? '調配杯 · 空' : this.phase === 'dip' ? recipe.beakerLabel : '調配杯',
        tilt,
        held: this.heldBeaker,
        hot: !this.heldBeaker && this.canGrabBeaker(hand, benchGeo),
      },
      dt,
      time,
    );

    // 倒廢液的水流：從杯嘴一路流進桶口
    if (this.phase === 'dumping' && drainFactor < 1 && drainFactor > 0) {
      const lip = this.beaker.lipPoint(geo, tilt);
      drawPourStream(ctx, lip, drainMouth(drainGeo).y + drainGeo.width * 0.1, liquid, time, 1.15);
    }

    this.drawBottles(ctx, recipe, geo, shelf, hand, time);

    // 杯口上方的倒液進度環
    if (this.pouring) this.drawPourGauge(ctx, geo, totalParts);

    // 爆炸畫在最上層，才蓋得住器材
    this.explosion.render(ctx, width, height);

    this.updateWetHints(ui, hand, recipe, totalParts);
  }

  /** 調配杯此刻的位置與傾角：靜置在檯面、被拿在手上、或倒廢液的動畫中。 */
  private beakerTransform(
    bench: BeakerGeometry,
    drain: DrainGeometry,
    dt: number,
  ): { geo: BeakerGeometry; tilt: number } {
    if (this.phase === 'dumping') {
      this.dumpT = Math.min(1, this.dumpT + dt * 0.45);
      const from = this.dumpFrom ?? { x: bench.cx, y: bench.top };

      // 0~0.3 移到桶口 → 0.3~0.8 傾倒排空 → 0.8~1 放回檯面
      let tilt: number;
      let t: number;
      if (this.dumpT < 0.3) {
        tilt = 0;
        t = easeInOut(this.dumpT / 0.3);
      } else if (this.dumpT < 0.8) {
        tilt = easeInOut(Math.min(1, (this.dumpT - 0.3) / 0.22)) * DUMP_TILT;
        t = 1;
      } else {
        tilt = DUMP_TILT * (1 - easeInOut((this.dumpT - 0.8) / 0.2));
        t = 1 - easeInOut((this.dumpT - 0.8) / 0.2);
      }

      // 目標位置是「解」出來的，不是估的：先算出這個傾角下杯嘴相對杯子的位移，
      // 再反推杯子要放哪裡，杯嘴才會正好落在桶口上方。傾角在動、杯口位置也
      // 跟著動，所以每一幀都要重算——之前寫死偏移量才會對不準。
      const to = this.pourPose(bench, drain, tilt);
      const p = { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };

      if (this.dumpT >= 1) this.finishDump();
      return { geo: { ...bench, cx: p.x, top: p.y }, tilt };
    }

    if (this.heldBeaker && this.beakerHand) {
      return {
        geo: { ...bench, cx: this.beakerHand.x, top: this.beakerHand.y - bench.height * 0.5 },
        tilt: 0,
      };
    }

    return { geo: bench, tilt: 0 };
  }

  /**
   * 給定傾角，算出調配杯要擺在哪裡，杯嘴才會對準廢液桶口。
   *
   * Beaker.lipPoint() 是把杯嘴（右上角）繞杯底中心旋轉 tilt 得到的：
   *     lip = beakerPos + R(tilt) · (杯嘴相對杯底中心的位移)
   * 這裡要的是反運算——已知想要的 lip（桶口正上方），求 beakerPos。
   * 因為旋轉是線性的，直接把「tilt=0 且杯子在原點時算出的杯嘴位移」轉一次再減掉即可。
   */
  private pourPose(bench: BeakerGeometry, drain: DrainGeometry, tilt: number): Point {
    const mouth = drainMouth(drain);
    // 杯嘴相對「杯子左上角(cx- w/2, top)」原點的偏移，在指定傾角下的值
    const probe: BeakerGeometry = { ...bench, cx: 0, top: 0 };
    const offset = this.beaker.lipPoint(probe, tilt);
    // 讓杯嘴落在桶口正上方一點點，水流才有一小段可見的落差
    return {
      x: mouth.x - offset.x,
      y: mouth.y - drain.width * 0.55 - offset.y,
    };
  }

  /** 倒廢液時杯內剩餘液體的比例。 */
  private dumpDrainFactor(): number {
    if (this.dumpT < 0.34) return 1;
    if (this.dumpT > 0.74) return 0;
    return 1 - (this.dumpT - 0.34) / 0.4;
  }

  private finishDump(): void {
    this.clearMix();
    this.error = null;
    this.phase = 'pour';
    this.beaker.reset();
  }

  private startDump(bench: BeakerGeometry): void {
    if (this.mix.length === 0) return;
    this.dumpFrom = this.beakerHand
      ? { x: this.beakerHand.x, y: this.beakerHand.y - bench.height * 0.5 }
      : { x: bench.cx, y: bench.top };
    this.heldBeaker = false;
    this.beakerHand = null;
    this.heldBottle = null;
    this.bottlePos = null;
    this.dumpT = 0;
    this.phase = 'dumping';
  }

  // ── 藥瓶：抓取與傾倒 ──

  /** 藥瓶在層板上的靜置位置（瓶底中心）。 */
  private bottleRest(index: number, count: number, shelf: ShelfLayout): Point {
    const half = shelf.w / 2 + 4;
    const x0 = shelf.scene.left + half;
    const x1 = shelf.scene.right - half;
    const step = count > 1 ? (x1 - x0) / (count - 1) : 0;
    return { x: x0 + index * step, y: shelf.y };
  }

  /** 抓取判定半徑：跟著瓶身大小走，瓶子放大時也要跟著好抓。 */
  private grabRadius(shelf: ShelfLayout): number {
    return Math.max(52, shelf.w * 1.2);
  }

  private updateBottles(
    hand: StageFrame['hand'],
    recipe: WetRecipe,
    geo: BeakerGeometry,
    shelf: ShelfLayout,
    dt: number,
  ): void {
    const count = recipe.pool.length;
    const bottleH = shelf.w * 1.7;

    // 抓取：捏合且靠近某個瓶子
    if (hand.present && hand.pinching && !this.heldBottle && !this.heldBeaker) {
      let best: { id: string; d: number } | null = null;
      for (let i = 0; i < count; i++) {
        const rest = this.bottleRest(i, count, shelf);
        // 判定點取瓶身中段，比瓶底更接近玩家視覺上的「瓶子」
        const grip = { x: rest.x, y: rest.y - bottleH * 0.45 };
        const d = dist(hand.pinchPoint, grip);
        if (d < this.grabRadius(shelf) && (!best || d < best.d)) {
          best = { id: recipe.pool[i], d };
        }
      }
      if (best) this.heldBottle = best.id;
    }

    if (!this.heldBottle) {
      this.bottlePos = null;
      this.bottleTilt = 0;
      this.pouring = false;
      this.pourAccum = 0;
      return;
    }

    // 放開＝放回檯面
    if (!hand.present || !hand.pinching) {
      this.heldBottle = null;
      this.bottlePos = null;
      this.bottleTilt = 0;
      this.pouring = false;
      this.pourAccum = 0;
      return;
    }

    // 限制在場景範圍內：拖出去會跑到左側面板底下或畫面外，看起來像瓶子消失了
    this.bottlePos = {
      x: clamp(hand.pinchPoint.x, shelf.scene.left + shelf.w * 0.5, shelf.scene.right - shelf.w * 0.5),
      y: hand.pinchPoint.y,
    };

    /*
      判斷瓶口是否在杯口上方 —— 用**瓶口**而不是瓶身，玩家才能直觀地對準。

      這個寫法有個已知的副作用：瓶身一傾倒，瓶口就往左甩約 0.9×瓶高，
      有機會甩出判定區而讓傾倒中斷，那一瞬間液柱是落在杯子外面的。
      曾經改成「用手的位置判定 + 傾倒時把瓶子吸附到杯口正上方」來根除它，
      但那樣瓶子會自己滑走，手感變得不像在倒東西 —— 依實測回饋改回這個版本，
      寧可留著這個小瑕疵，也要保住「自己拿著瓶子對準」的手感。
    */
    const mouth = bottleMouth(this.bottlePos, this.bottleTilt, bottleH);
    const total = this.mix.reduce((s, r) => s + r.parts, 0);
    const inZone =
      Math.abs(mouth.x - geo.cx) < geo.width * 0.62 &&
      mouth.y > geo.top - geo.height * 1.1 &&
      mouth.y < geo.top + geo.height * 0.45;

    this.pouring = inZone && total < MAX_PARTS;

    // 瓶身傾角平滑過渡，看起來像手腕慢慢轉過去
    const target = this.pouring ? POUR_TILT : 0;
    this.bottleTilt += (target - this.bottleTilt) * Math.min(1, dt * 9);

    if (this.pouring) {
      this.pourAccum += dt;
      if (this.pourAccum >= POUR_INTERVAL) {
        this.pourAccum -= POUR_INTERVAL;
        if (!this.addPart(this.heldBottle)) return; // 突沸，這一幀後面都不用跑了
      }
    } else {
      this.pourAccum = 0;
    }
  }

  /**
   * 把一份藥液加進調配杯。
   * 回傳 false 代表這一倒違反了安全順序（杯子裡還沒有水），已觸發突沸。
   */
  private addPart(id: string): boolean {
    if (isUnsafePour(id, this.mix.map((r) => r.id))) {
      this.triggerBoom(id);
      return false;
    }
    const row = this.mix.find((r) => r.id === id);
    if (row) row.parts += 1;
    else this.mix.push(toMixRow(id, 1));
    this.splash = 1;
    this.error = null;
    return true;
  }

  /**
   * 突沸：在沒有去離子水的狀態下，讓第二種藥液碰到第一種。
   * 兩種濃藥液直接相遇是劇烈放熱反應，沒有水吸熱，界面瞬間到達沸點把液體噴出來。
   * 懲罰是整杯報廢 —— 跟真實實驗室一樣，這種事發生了就是重配。
   */
  private triggerBoom(id: string): void {
    this.phase = 'boom';
    this.explosion.trigger(this.boomOrigin, solution(id).color, this.boomScale);
    const others = this.mix.map((r) => solution(r.id).name).join('、');
    this.error = `⚠ 突沸！杯子裡已經有${others}，在**沒有去離子水**的情況下又倒進${solution(id).name}。兩種濃藥液直接相遇是劇烈放熱反應 —— 沒有水吸熱與對流帶走熱量，界面瞬間到達沸點，把高溫腐蝕液整團噴出來。**先加去離子水墊底，再加其他藥液**。`;
    // 手上的瓶子被嚇掉
    this.heldBottle = null;
    this.bottlePos = null;
    this.bottleTilt = 0;
    this.pouring = false;
    this.pourAccum = 0;
  }

  /** 爆點與縮放；由 frameWet 每幀依燒杯位置更新。 */
  private boomOrigin: Point = { x: 0, y: 0 };
  private boomScale = 1;

  private drawBottles(
    ctx: CanvasRenderingContext2D,
    recipe: WetRecipe,
    geo: BeakerGeometry,
    shelf: ShelfLayout,
    hand: StageFrame['hand'],
    time: number,
  ): void {
    const count = recipe.pool.length;
    const grabbable = this.phase === 'pour' && !this.heldBeaker;
    const bottleH = shelf.w * 1.7;
    const grab = this.grabRadius(shelf);

    // 層板：讓藥瓶看起來是「站在架子上」而不是浮在半空
    ctx.save();
    const plankY = shelf.y + shelf.w * 0.2;
    ctx.fillStyle = 'rgba(38, 46, 52, 0.72)';
    ctx.fillRect(shelf.scene.left, plankY, shelf.scene.w, 5);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(shelf.scene.left, plankY, shelf.scene.w, 1.5);
    ctx.restore();

    recipe.pool.forEach((id, i) => {
      const s = solution(id);
      const held = this.heldBottle === id;
      const rest = this.bottleRest(i, count, shelf);
      const pos = held && this.bottlePos ? this.bottlePos : rest;

      const visual: BottleVisual = {
        pos,
        w: shelf.w,
        h: bottleH,
        color: s.color,
        formula: s.formula,
        name: s.name,
        tilt: held ? this.bottleTilt : 0,
        held,
        hot:
          grabbable &&
          !this.heldBottle &&
          hand.present &&
          dist(hand.pinchPoint, { x: rest.x, y: rest.y - bottleH * 0.45 }) < grab,
        used: this.mix.some((r) => r.id === id),
      };

      drawBottle(ctx, visual, time);

      // 液柱：從瓶口流到杯內液面
      if (held && this.pouring) {
        const mouth = bottleMouth(visual.pos, visual.tilt, bottleH);
        const total = this.mix.reduce((sum, r) => sum + r.parts, 0);
        const surface = this.beaker.liquidSurfaceY(
          geo,
          clamp((total / MAX_PARTS) * 0.88, 0, 0.88),
        );
        drawPourStream(ctx, mouth, surface, s.color, time);
      }
    });
  }

  /** 杯口上方的倒液進度環：讓玩家知道「再 0.3 秒就會進 1 份」。 */
  private drawPourGauge(
    ctx: CanvasRenderingContext2D,
    geo: BeakerGeometry,
    total: number,
  ): void {
    const cx = geo.cx;
    const cy = geo.top - 26;
    const r = 15;
    const t = this.pourAccum / POUR_INTERVAL;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#5ee9df';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
    ctx.stroke();

    // 剛進一份時放大閃一下
    const pop = 1 + this.splash * 0.5;
    ctx.fillStyle = this.splash > 0.1 ? '#5ee9df' : '#e6f4f7';
    ctx.font = `600 ${Math.round(13 * pop)}px 'IBM Plex Mono', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(total), cx, cy + 0.5);
    ctx.restore();
  }

  // ── 調配杯：抓取與拖去廢液桶 ──

  private canGrabBeaker(hand: StageFrame['hand'], bench: BeakerGeometry): boolean {
    if (this.mix.length === 0 || this.heldBottle) return false;
    if (!hand.present) return false;
    return (
      Math.abs(hand.pinchPoint.x - bench.cx) < bench.width * 0.8 &&
      Math.abs(hand.pinchPoint.y - (bench.top + bench.height * 0.5)) < bench.height * 0.8
    );
  }

  private overDrain(geo: BeakerGeometry, drain: DrainGeometry): boolean {
    const mouth = drainMouth(drain);
    return Math.abs(geo.cx - mouth.x) < drain.width * 0.95 && geo.top + geo.height > mouth.y - 90;
  }

  private updateBeakerGrab(
    hand: StageFrame['hand'],
    bench: BeakerGeometry,
    drain: DrainGeometry,
  ): void {
    if (!this.heldBeaker) {
      if (hand.present && hand.justPinched && this.canGrabBeaker(hand, bench)) {
        this.heldBeaker = true;
        this.beakerHand = { x: hand.pinchPoint.x, y: hand.pinchPoint.y };
      }
      return;
    }

    if (hand.present && hand.pinching) {
      this.beakerHand = { x: hand.pinchPoint.x, y: hand.pinchPoint.y };
      return;
    }

    // 放開：在廢液桶上方就倒掉，否則放回檯面
    const geo: BeakerGeometry = {
      ...bench,
      cx: this.beakerHand?.x ?? bench.cx,
      top: (this.beakerHand?.y ?? bench.top) - bench.height * 0.5,
    };
    const shouldDump = this.overDrain(geo, drain);
    this.heldBeaker = false;
    if (shouldDump) this.startDump(bench);
    else this.beakerHand = null;
  }

  /** 等待下水的晶圓，平放在檯面的載盤上。 */
  private drawWaferStand(
    ctx: CanvasRenderingContext2D,
    cx: number,
    groundY: number,
    r: number,
    color: string,
    time: number,
  ): void {
    const ry = r * WAFER_SQUASH;
    const trayH = Math.max(8, r * 0.22);
    const cy = groundY - trayH - ry;

    ctx.save();

    // 載盤：一個矮矮的圓形托盤，晶圓平躺在上面
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx, groundY + 2, r * 1.2, ry * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#3a454b';
    ctx.beginPath();
    ctx.ellipse(cx, groundY - trayH, r * 1.18, ry * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a3238';
    ctx.fillRect(cx - r * 1.18, groundY - trayH, r * 2.36, trayH);
    ctx.beginPath();
    ctx.ellipse(cx, groundY, r * 1.18, ry * 1.05, 0, 0, Math.PI);
    ctx.fill();

    drawFlatWafer(ctx, { x: cx, y: cy }, r, color);

    // 待命呼吸
    const pulse = 0.5 + 0.5 * Math.sin(time * 2);
    ctx.globalAlpha = 0.15 + pulse * 0.22;
    ctx.strokeStyle = '#2ecfc7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r + 6, ry + 5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(224, 238, 243, 0.8)';
    ctx.font = "600 13px 'IBM Plex Sans', 'Noto Sans TC', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('待清洗晶圓', cx, groundY + 8);

    ctx.restore();
  }

  private updateWetHints(
    ui: StageFrame['ui'],
    hand: StageFrame['hand'],
    recipe: WetRecipe,
    totalParts: number,
  ): void {
    if (this.phase === 'dip') {
      ui.setArHint('💧 浸泡中 — 觀察右下角截面圖上的污染物被洗掉', true);
      ui.setHandState('💧', '浸泡中', `DIP ${this.timer.toFixed(1)}s`, true);
      return;
    }
    if (this.phase === 'boom') {
      ui.setArHint('💥 突沸！整杯報廢 —— 沒有水墊底就不能混兩種藥液', true);
      ui.setHandState('💥', '突沸', 'RUNAWAY REACTION', false);
      return;
    }
    if (this.phase === 'dumping') {
      ui.setArHint('🫗 正在倒掉整杯廢液…', true);
      ui.setHandState('🫗', '倒廢液中', 'DUMPING', true);
      return;
    }
    if (this.phase === 'wrong') {
      ui.setArHint('❌ 配方不正確 — 捏起調配杯，倒進右邊的廢液桶重來');
      ui.setHandState('❌', '配方錯誤', 'DUMP REQUIRED', false);
      return;
    }

    // pour
    if (this.heldBeaker) {
      ui.setArHint('🫗 拿著調配杯 — 移到廢液桶上方放開就會倒掉', true);
      ui.setHandState('🫗', '拿著調配杯', `${totalParts} 份`, true);
    } else if (this.pouring) {
      ui.setArHint(`🫗 倒入中 — 目前 ${totalParts} 份`, true);
      ui.setHandState('🫗', solution(this.heldBottle!).name, `POURING ${totalParts} 份`, true);
    } else if (this.heldBottle) {
      ui.setArHint('🍶 拿著藥瓶 — 移到調配杯上方就會開始倒', true);
      ui.setHandState('🍶', solution(this.heldBottle).name, '移到杯口上方', true);
    } else if (totalParts >= MAX_PARTS) {
      ui.setArHint('⚠️ 調配杯滿了 — 送去浸泡，或倒掉重來');
      ui.setHandState('⚠️', '杯子已滿', `${totalParts} / ${MAX_PARTS} 份`, false);
    } else {
      ui.setArHint(`🤏 捏合拿起藥瓶，配出 ${recipe.title.replace(/^第.步 · /, '')} 需要的溶液`);
      ui.setHandState(
        '✋',
        '（空手）',
        `PINCH ${hand.pinchDistance.toFixed(3)} / ${totalParts} 份`,
        false,
      );
    }
  }

  /** 浸泡的三個階段：下沉 → 反應 → 上提。 */
  private advanceDip(recipe: WetRecipe, dt: number): void {
    const total = recipe.dipSeconds;
    const sink = 0.9;
    const rise = 0.9;
    const react = total - sink - rise;
    const c = this.ctx.wafer.contamination;

    if (this.timer < sink) {
      this.waferDip = easeInOut(this.timer / sink);
      this.bubbling = 0.15;
    } else if (this.timer < sink + react) {
      this.waferDip = 1;
      this.bubbling = 1;
      c[recipe.clears] = Math.max(0, c[recipe.clears] - dt / react);
    } else if (this.timer < total) {
      this.waferDip = 1 - easeInOut((this.timer - sink - react) / rise);
      this.bubbling = 0.2;
      c[recipe.clears] = 0;
    } else {
      c[recipe.clears] = 0;
      // 洗完會殘留水分，最後的乾燥步驟要處理
      c.water = 1;
      this.bubbling = 0;
      this.waferDip = -1;
      this.nextSub();
    }
  }

  // ────────────────────────── 第四步：旋轉乾燥 ──────────────────────────────

  private frameDry(frame: StageFrame, groundY: number): void {
    const { ui, desk, dt, time, hand } = frame;
    const ctx = desk.context;
    const { height } = desk.size;
    const wafer = this.ctx.wafer;

    // 乾燥機擺在場景右半邊，左邊留給待放入的晶圓
    const scene = this.sceneBounds(frame);
    const dw = clamp(Math.min(scene.w * 0.44, height * 0.42), 130, 250);
    const geo: DryerGeometry = {
      cx: scene.right - dw * 0.6,
      cy: groundY - (dw * 0.92) / 2,
      width: dw,
    };
    const drum = this.dryer.drumCircle(geo);
    const button = this.dryer.buttonCircle(geo);
    const waferR = drum.r * 0.55;

    const restPoint: Point = {
      x: clamp(geo.cx - dw * 0.85, scene.left + waferR + 10, geo.cx - dw * 0.6),
      y: groundY - waferR - 6,
    };
    let targetHot = false;

    if (this.phase === 'load') {
      const pinch = hand.pinchPoint;

      if (hand.present && hand.pinching) {
        const anchor = this.heldPoint ?? restPoint;
        if (!this.holding && dist(pinch, anchor) < waferR + 26) this.holding = true;
        if (this.holding) this.heldPoint = { x: pinch.x, y: pinch.y };
      }

      const held = this.heldPoint ?? restPoint;
      targetHot = this.holding && dist(held, { x: drum.cx, y: drum.cy }) < drum.r * 0.62;

      if (this.holding && hand.justReleased) {
        this.holding = false;
        this.heldPoint = null;
        if (targetHot) {
          this.phase = 'ready';
          this.dryPhase = 'ready';
          this.timer = 0;
        }
      }
      if (!hand.present) this.holding = false;
    }

    if (this.phase === 'spin') this.advanceSpin(dt);

    this.dryer.render(
      ctx,
      geo,
      {
        phase: this.dryPhase,
        spin: this.spinAngle,
        speed: this.spinSpeed,
        water: wafer.contamination.water,
        waferR,
        waferColor: wafer.surfaceColor(),
        heldWafer: this.phase === 'load' ? (this.heldPoint ?? restPoint) : null,
        targetHot,
      },
      dt,
      time,
    );

    // 畫面上的 START 按鈕也可以用捏合直接按（跟左側面板按鈕等效）
    if (this.phase === 'ready' && hand.present && hand.justPinched) {
      if (dist(hand.pinchPoint, { x: button.cx, y: button.cy }) < button.r + 12) this.startSpin();
    }

    if (this.phase === 'load') {
      ui.setArHint(
        this.holding
          ? targetHot
            ? '✅ 對準了 — 張開手指把晶圓放進滾筒'
            : '🤏 夾著晶圓 — 移到滾筒中央的虛線圈'
          : '🤏 捏合拇指與食指，夾起檯面上的晶圓',
        this.holding,
      );
      ui.setHandState(
        this.holding ? '🤏' : '✋',
        this.holding ? '夾著晶圓' : '（空手）',
        `PINCH ${hand.pinchDistance.toFixed(3)} / ${targetHot ? 'ON TARGET' : 'LOADING'}`,
        this.holding,
      );
    } else if (this.phase === 'ready') {
      ui.setArHint('🔘 門已關上 — 按下 START 開始烘乾', true);
      ui.setHandState('🔘', '待機中', 'READY TO SPIN', true);
    } else if (this.phase === 'spin') {
      ui.setArHint(
        `🌀 甩乾中 ${Math.round(this.spinSpeed * 3000)} RPM — 水分 ${Math.round(
          wafer.contamination.water * 100,
        )}%`,
        true,
      );
      ui.setHandState('🌀', '甩乾中', `RPM ${Math.round(this.spinSpeed * 3000)}`, true);
    }
  }

  private startSpin(): void {
    this.phase = 'spin';
    this.dryPhase = 'spin';
    this.timer = 0;
  }

  private advanceSpin(dt: number): void {
    const c = this.ctx.wafer.contamination;

    if (c.water > 0.001) {
      this.spinSpeed = Math.min(1, this.spinSpeed + dt * 1.1);
      c.water = Math.max(0, c.water - dt * 0.28 * this.spinSpeed);
    } else {
      this.spinSpeed = Math.max(0, this.spinSpeed - dt * 0.7);
      if (this.spinSpeed < 0.01) {
        this.spinSpeed = 0;
        this.dryPhase = 'done';
        this.nextSub();
        return;
      }
    }
    this.spinAngle += this.spinSpeed * 20 * dt;
  }

  // ───────────────────────────── 互動面板同步 ──────────────────────────────

  private syncPanel(): void {
    this.ctx.ui.setPanel(this.buildPanel());
  }

  private buildPanel(): PanelSpec | null {
    const sub = this.currentSub;
    if (!sub) return null;

    if (sub.id === 'dry') return this.buildDryPanel();

    const recipe = RECIPES[sub.id];

    if (this.phase === 'dip') {
      return {
        kind: 'action',
        title: `${recipe.title} — 浸泡中`,
        note: recipe.beakerLabel,
        label: '反應進行中…',
        enabled: false,
        onClick: () => {},
      };
    }

    if (this.phase === 'boom') {
      return {
        kind: 'action',
        title: '💥 突沸！',
        note: this.error ?? '',
        label: '整杯已報廢…',
        enabled: false,
        onClick: () => {},
      };
    }

    const target = recipe.answer
      .map((id) => `${solution(id).name} ${recipe.ratio[id]} 份`)
      .join('、');

    return {
      kind: 'pour',
      title: recipe.title,
      note: `${recipe.note}\n目標配方：${target}\n⚠ 安全規則：沒有去離子水墊底時，**不可以把兩種藥液混在一起**（會突沸）。習慣上先加水。`,
      error: this.error ?? undefined,
      rows: this.mix,
      confirmLabel: '送去浸泡',
      confirmEnabled: this.phase === 'pour' && this.mix.length > 0,
      onConfirm: () => this.validateMix(recipe),
      dumpLabel: this.phase === 'wrong' ? '倒掉重做' : '倒掉',
      dumpEnabled: this.phase !== 'dumping' && this.mix.length > 0,
      onDump: () => this.requestDump(),
    };
  }

  private buildDryPanel(): PanelSpec {
    if (this.phase === 'load') {
      return {
        kind: 'action',
        title: '第四步 · 乾燥',
        note: '捏合拇指與食指夾起檯面上的晶圓，移到滾筒中央的虛線圈再放開。沒有鏡頭時也可以按下面的按鈕直接放入。',
        label: '直接放入晶圓',
        enabled: true,
        onClick: () => {
          this.holding = false;
          this.heldPoint = null;
          this.phase = 'ready';
          this.dryPhase = 'ready';
          this.timer = 0;
        },
      };
    }
    if (this.phase === 'ready') {
      return {
        kind: 'action',
        title: '第四步 · 乾燥',
        note: '晶圓已就位、門已關上。啟動後滾筒高速旋轉，用離心力把水滴甩向筒壁，同時吹 80°C 熱風。',
        label: '開始烘乾',
        enabled: true,
        onClick: () => this.startSpin(),
      };
    }
    return {
      kind: 'action',
      title: '第四步 · 乾燥',
      note: '離心力正在把水滴甩離晶圓表面，熱風同時帶走殘留的水氣。',
      label: '甩乾中…',
      enabled: false,
      onClick: () => {},
    };
  }

  /**
   * 送出配方。成分或份數任一不符就鎖進 'wrong'，玩家只剩「倒掉重做」這條路——
   * 這是刻意的：真實製程配錯藥液也不可能微調，只能整槽報廢重配。
   */
  private validateMix(recipe: WetRecipe): void {
    const poured = [...this.mix].sort((a, b) => a.id.localeCompare(b.id));
    const wanted = Object.keys(recipe.ratio).sort();

    const sameSet =
      poured.length === wanted.length && poured.every((row, i) => row.id === wanted[i]);
    const sameParts = sameSet && poured.every((row) => row.parts === recipe.ratio[row.id]);

    if (!sameSet) {
      this.error = `配方的成分不對。${recipe.wrongHint}`;
      this.phase = 'wrong';
      return;
    }
    if (!sameParts) {
      this.error = `成分對了，但份數不對。${recipe.wrongHint}`;
      this.phase = 'wrong';
      return;
    }

    this.error = null;
    this.phase = 'dip';
    this.timer = 0;
  }

  /** 面板上的「倒掉」按鈕；實際位移動畫在 beakerTransform() 裡跑。 */
  private requestDump(): void {
    if (this.mix.length === 0 || this.phase === 'dumping') return;
    this.dumpFrom = null;
    this.heldBeaker = false;
    this.beakerHand = null;
    this.heldBottle = null;
    this.bottlePos = null;
    this.dumpT = 0;
    this.phase = 'dumping';
  }

  // ─────────────────────────────── 過關判定 ────────────────────────────────

  override canComplete(): boolean {
    return this.subsFinished && this.ctx?.wafer.isClean === true;
  }

  /** 強制完成：直接把四項污染歸零，晶圓視為已洗淨。 */
  override devComplete(): void {
    const c = this.ctx.wafer.contamination;
    c.particles = 0;
    c.oxide = 0;
    c.ions = 0;
    c.water = 0;
  }

  override buildResult(): StageResult {
    return {
      cleaned: true,
      recipes: {
        particle: '5 : 1 : 1（DI : NH₄OH : H₂O₂）',
        oxide: 'HF 水溶液',
        ions: '6 : 1 : 1（DI : HCl : H₂O₂）',
      },
    };
  }
}

// ───────────────────────────────── 小工具 ──────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 平滑的 0→1 曲線，讓移動與傾倒不會是等速的機械感。 */
function easeInOut(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}
