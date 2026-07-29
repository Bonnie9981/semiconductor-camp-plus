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
import { blendColor, solution, toMixRow } from '../data/solutions';
import { Beaker, type BeakerGeometry } from '../scene/Beaker';
import { bottleMouth, drawBottle, drawPourStream, type BottleVisual } from '../scene/Bottle';
import { drainMouth, drawDrain, type DrainGeometry } from '../scene/Drain';
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
/** 調配杯最多裝幾份，避免玩家一直倒到溢出。 */
const MAX_PARTS = 12;
/** 傾倒時的瓶身角度（負值＝往左倒，因為藥瓶排在杯子右邊）。 */
const POUR_TILT = -2.0;

export class Stage1RCA extends BaseStage {
  readonly id = 'rca-clean';
  readonly title = 'RCA 清洗';
  readonly shortTitle = 'RCA 清洗';
  readonly description =
    '晶圓進廠時表面有微粒、原生氧化層與金屬離子。親手配出三種清洗液把它們洗掉，最後甩乾。';
  readonly hint = '捏合把藥瓶拿起來，移到調配杯上方就會開始倒；配錯了要整杯倒進廢液桶重來。';
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

  // ────────────────────── 前三步：配液 → 浸泡（或倒掉重來） ────────────────────

  private frameWet(frame: StageFrame, groundY: number): void {
    const { ui, desk, dt, time, hand } = frame;
    const ctx = desk.context;
    const { width, height } = desk.size;
    const wafer = this.ctx.wafer;
    const recipe = RECIPES[this.currentSub!.id];

    this.splash = Math.max(0, this.splash - dt * 3);

    // ── 幾何佈局 ──
    const bh = clamp(height * 0.26, 110, 172);
    const benchGeo: BeakerGeometry = {
      cx: width * 0.52,
      top: groundY - bh,
      width: bh * 0.76,
      height: bh,
    };
    const drainGeo: DrainGeometry = {
      cx: width * 0.87,
      baseY: groundY,
      width: clamp(width * 0.07, 52, 78),
    };
    const waferR = benchGeo.width * 0.3;

    // 調配杯目前的位置與傾角（可能被拿在手上、或正在倒廢液）
    const { geo, tilt } = this.beakerTransform(benchGeo, drainGeo, dt);

    // ── 互動 ──
    if (this.phase === 'pour') {
      this.updateBottles(hand, recipe, geo, width, height, dt);
    }
    if (this.phase === 'pour' || this.phase === 'wrong') {
      this.updateBeakerGrab(hand, benchGeo, drainGeo);
    }
    if (this.phase === 'dip') this.advanceDip(recipe, dt);

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

    // 等待中的晶圓（還沒輪到它下水）
    if (this.waferDip < 0) {
      this.drawWaferStand(ctx, width * 0.38, groundY, waferR, wafer.surfaceColor(), time);
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

    // 倒廢液的水流
    if (this.phase === 'dumping' && drainFactor < 1 && drainFactor > 0) {
      const lip = this.beaker.lipPoint(geo, tilt);
      drawPourStream(ctx, lip, drainMouth(drainGeo).y, liquid, time);
    }

    this.drawBottles(ctx, recipe, geo, width, height, hand, time);

    // 杯口上方的倒液進度環
    if (this.pouring) this.drawPourGauge(ctx, geo, totalParts);

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
      const mouth = drainMouth(drain);
      const from = this.dumpFrom ?? { x: bench.cx, y: bench.top };
      const to = { x: mouth.x - bench.width * 0.55, y: mouth.y - bench.height * 0.85 };

      // 0~0.3 移到桶口 → 0.3~0.8 傾倒排空 → 0.8~1 放回檯面
      let p: Point;
      let tilt: number;
      if (this.dumpT < 0.3) {
        const t = easeInOut(this.dumpT / 0.3);
        p = { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
        tilt = 0;
      } else if (this.dumpT < 0.8) {
        p = to;
        tilt = easeInOut(Math.min(1, (this.dumpT - 0.3) / 0.22)) * 1.15;
      } else {
        const t = easeInOut((this.dumpT - 0.8) / 0.2);
        p = { x: lerp(to.x, bench.cx, t), y: lerp(to.y, bench.top, t) };
        tilt = 1.15 * (1 - t);
      }

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

  /** 藥瓶在檯面上的靜置位置。 */
  private bottleRest(index: number, count: number, width: number, height: number): Point {
    const x0 = width * 0.4;
    const x1 = width * 0.96;
    const step = count > 1 ? (x1 - x0) / (count - 1) : 0;
    return { x: x0 + index * step, y: height * 0.42 };
  }

  private updateBottles(
    hand: StageFrame['hand'],
    recipe: WetRecipe,
    geo: BeakerGeometry,
    width: number,
    height: number,
    dt: number,
  ): void {
    const count = recipe.pool.length;

    // 抓取：捏合且靠近某個瓶子
    if (hand.present && hand.pinching && !this.heldBottle && !this.heldBeaker) {
      for (let i = 0; i < count; i++) {
        const rest = this.bottleRest(i, count, width, height);
        if (dist(hand.pinchPoint, rest) < 46) {
          this.heldBottle = recipe.pool[i];
          break;
        }
      }
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

    this.bottlePos = { x: hand.pinchPoint.x, y: hand.pinchPoint.y };

    // 判斷瓶口是否在杯口上方（用瓶口而不是瓶身，玩家才能直觀對準）
    const mouth = bottleMouth(this.bottlePos, this.bottleTilt);
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
        this.addPart(this.heldBottle);
      }
    } else {
      this.pourAccum = 0;
    }
  }

  /** 把一份藥液加進調配杯（依倒入順序排列）。 */
  private addPart(id: string): void {
    const row = this.mix.find((r) => r.id === id);
    if (row) row.parts += 1;
    else this.mix.push(toMixRow(id, 1));
    this.splash = 1;
    this.error = null;
  }

  private drawBottles(
    ctx: CanvasRenderingContext2D,
    recipe: WetRecipe,
    geo: BeakerGeometry,
    width: number,
    height: number,
    hand: StageFrame['hand'],
    time: number,
  ): void {
    const count = recipe.pool.length;
    const grabbable = this.phase === 'pour' && !this.heldBeaker;

    recipe.pool.forEach((id, i) => {
      const s = solution(id);
      const held = this.heldBottle === id;
      const rest = this.bottleRest(i, count, width, height);
      const pos = held && this.bottlePos ? this.bottlePos : rest;

      const visual: BottleVisual = {
        pos,
        color: s.color,
        formula: s.formula,
        name: s.name,
        tilt: held ? this.bottleTilt : 0,
        held,
        hot:
          grabbable &&
          !this.heldBottle &&
          hand.present &&
          dist(hand.pinchPoint, rest) < 52,
        used: this.mix.some((r) => r.id === id),
      };

      drawBottle(ctx, visual, time);

      // 液柱：從瓶口流到杯內液面
      if (held && this.pouring) {
        const mouth = bottleMouth(visual.pos, visual.tilt);
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

  /** 等待下水的晶圓，立在檯面的晶圓架上。 */
  private drawWaferStand(
    ctx: CanvasRenderingContext2D,
    cx: number,
    groundY: number,
    r: number,
    color: string,
    time: number,
  ): void {
    const cy = groundY - r - 10;

    ctx.save();
    // 架子
    ctx.strokeStyle = '#7d8d95';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.8, groundY);
    ctx.lineTo(cx - r * 0.3, cy + r * 0.5);
    ctx.moveTo(cx + r * 0.8, groundY);
    ctx.lineTo(cx + r * 0.3, cy + r * 0.5);
    ctx.stroke();

    // 晶圓（側立，跟浸泡時同一個造型）
    const grad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    grad.addColorStop(0, '#f0f5f7');
    grad.addColorStop(0.5, color);
    grad.addColorStop(1, '#8d9ea6');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.34, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(240,248,250,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = 'rgba(214, 230, 236, 0.65)';
    ctx.font = "500 9px 'IBM Plex Mono', monospace";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('待清洗', cx, groundY + 5);

    // 待命呼吸
    const pulse = 0.5 + 0.5 * Math.sin(time * 2);
    ctx.globalAlpha = 0.15 + pulse * 0.2;
    ctx.strokeStyle = '#2ecfc7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.34 + 5, r + 5, 0, 0, Math.PI * 2);
    ctx.stroke();
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
    const { width } = desk.size;
    const wafer = this.ctx.wafer;

    const dw = clamp(width * 0.22, 150, 240);
    const geo: DryerGeometry = { cx: width * 0.63, cy: groundY - (dw * 0.92) / 2, width: dw };
    const drum = this.dryer.drumCircle(geo);
    const button = this.dryer.buttonCircle(geo);
    const waferR = drum.r * 0.55;

    const restPoint: Point = { x: geo.cx - dw * 0.72, y: groundY - waferR - 4 };
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

    const target = recipe.answer
      .map((id) => `${solution(id).name} ${recipe.ratio[id]} 份`)
      .join('、');

    return {
      kind: 'pour',
      title: recipe.title,
      note: `${recipe.note}\n目標配方：${target}`,
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
