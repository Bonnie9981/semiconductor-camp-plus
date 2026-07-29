import type {
  InstructionStep,
  PanelSpec,
  Point,
  StageContext,
  StageFrame,
  StageResult,
  SubStep,
} from '../core/types';
import { drawFlatWafer, WAFER_SQUASH } from '../scene/Beaker';
import {
  chamberLayout,
  drawChamber,
  pointInCircle,
  type ChamberGeometry,
  type ChamberKind,
  type ChamberLayout,
  type ChamberState,
} from '../scene/Chamber';
import { DepositionField, type FieldConfig } from '../scene/Particles';
import { BaseStage } from './BaseStage';

/**
 * 第二關：薄膜沉積
 * ---------------------------------------------------------------------------
 * 三個子步驟，但實際上只有兩種畫面：
 *
 *   1. 製程選擇   兩台機器並排，把晶圓「拖進哪一台」就等於選了哪種製程
 *   2. 沉積反應   選中的那台放大到滿版，用手操作機台跑完一次沉積
 *   3. 金屬鍍膜   只有 CVD 路線需要（長完氧化層還要再鍍一層金屬）
 *                 PVD 路線會在 onSubEnter() 直接跳過這一步
 *
 * 設計原則：**能用手直接碰的就不要做成按鈕**。
 *   選製程   → 捏起晶圓拖進機台
 *   關腔門   → 捏住門把往左拖
 *   調功率   → 捏住拉桿上下拖（PVD）
 *   開氣閥   → 捏住旋鈕左右轉（CVD）
 *   啟動     → 按機台上的大按鈕（半徑至少 24px，好按）
 *
 * 兩種製程的差別在畫面上就是粒子怎麼走：
 *   PVD  電子束打靶材 → 金屬氣化 → 真空中**直線下落**凝結
 *   CVD  噴淋頭通入氣體 → 電漿激發 → 分子**亂走**後在表面反應成膜
 */

type Phase =
  /** 子步驟 1：等玩家把晶圓拖進某一台機器 */
  | 'choose'
  /** 關腔門 */
  | 'seal'
  /** 抽真空（自動） */
  | 'pump'
  /** 等待啟動：PVD 直接可按；CVD 要先開氣閥 */
  | 'ready'
  /** 沉積中 */
  | 'run'
  /** 洩壓開門（自動） */
  | 'vent'
  | 'done';

/** 玩家手上正抓著的東西。 */
type Grab = 'wafer' | 'door' | 'lever' | 'valve0' | 'valve1' | null;

/** PVD 電子束功率的製程窗口。 */
const POWER_WINDOW: [number, number] = [0.55, 0.8];
/** CVD 兩個氣閥的製程窗口（矽甲烷少、笑氣多，才長得出化學計量正確的 SiO₂）。 */
const VALVE_WINDOWS: [number, number][] = [
  [0.3, 0.55],
  [0.6, 0.85],
];

/** 沉積速率（厚度 / 秒），乘上製程品質。 */
const DEPOSIT_RATE = 0.14;

const FILM = {
  metal: { label: '金屬層 Al', color: '#c9ced6', thickness: 0.5 },
  oxide: { label: '二氧化矽 SiO₂', color: '#93b3c6', thickness: 0.7 },
} as const;

export class Stage2Deposition extends BaseStage {
  readonly id = 'deposition';
  readonly title = '薄膜沉積';
  readonly shortTitle = '薄膜沉積';
  readonly description =
    '把晶圓送進沉積腔體，長出一層薄膜。物理氣相沉積直接鍍上金屬；化學氣相沉積先長氧化層，還要再鍍一層金屬。';
  readonly hint = '用手把晶圓拖進機台就等於選擇製程；腔門、功率拉桿、氣閥旋鈕都可以直接捏住拖曳。';
  readonly primaryLabel = '完成沉積';
  readonly usesCrossSection = true;

  readonly substeps: readonly SubStep[] = [
    { id: 'method', title: '製程選擇', desc: '把晶圓拖進 e-gun 或 PECVD 機台' },
    { id: 'deposit', title: '沉積反應', desc: '關門抽真空後啟動，維持製程參數在綠色區間' },
    { id: 'metal', title: '金屬鍍膜', desc: 'CVD 路線才需要：在氧化層上再鍍一層金屬' },
  ];

  readonly instructions: InstructionStep[] = [
    { glyph: '🤏', title: '拖晶圓選製程', desc: '捏起晶圓放進 e-gun（PVD）或 PECVD（CVD）機台。' },
    { glyph: '🚪', title: '拖門把關腔門', desc: '捏住腔門把手往左拖到底，密閉後才會開始抽真空。' },
    { glyph: '🎛️', title: '操作機台控制', desc: 'PVD 上下拖拉桿調功率；CVD 左右轉兩顆氣閥旋鈕。' },
    { glyph: '🟢', title: '按下大按鈕', desc: '參數就緒後機台上的圓形按鈕會亮起，捏一下即可啟動。' },
  ];

  // ── 流程 ──
  private phase: Phase = 'choose';
  private method: ChamberKind | null = null;
  /** 目前這一輪在跑哪一種腔體（第三個子步驟固定是 PVD）。 */
  private runKind: ChamberKind = 'pvd';
  private timer = 0;

  // ── 機台狀態 ──
  private door = 1;
  private vacuum = 0;
  private power = 0;
  private valves: [number, number] = [0, 0];
  private thickness = 0;
  private running = false;
  /** 製程品質 0~1，由控制值離製程窗口多遠決定。 */
  private quality = 0;
  /** 沒有鏡頭時的輔助：自動把控制值維持在最佳點。 */
  private autoHold = false;

  // ── 手上抓的東西 ──
  private grab: Grab = null;
  private waferHold: Point | null = null;
  /** 轉旋鈕時記錄起始狀態，才不會一抓就跳值。 */
  private dragFrom = { x: 0, y: 0, value: 0 };

  private readonly field = new DepositionField();

  // ─────────────────────────────── 生命週期 ────────────────────────────────

  override onEnter(ctx: StageContext): void {
    super.onEnter(ctx);
    ctx.desk.setWaferVisible(false);
    ctx.desk.setDeskLabel('DEPOSITION BAY · 薄膜沉積區');
    this.resetSub();
    this.method = null;
    this.onSubEnter(0);
  }

  override onExit(): void {
    this.ctx?.ui.setPanel(null);
    this.ctx?.desk.setWaferVisible(true);
    this.ctx?.desk.setDeskLabel(null);
  }

  override restart(): void {
    super.restart();
    this.method = null;
    this.ctx?.wafer.removeLayer('metal');
    this.ctx?.wafer.removeLayer('oxide');
    this.onSubEnter(0);
  }

  protected override onSubEnter(index: number): void {
    const sub = this.substeps[index];

    // PVD 一次就鍍上金屬，不需要額外的金屬鍍膜步驟
    if (sub?.id === 'metal' && this.method === 'pvd') {
      this.nextSub();
      return;
    }

    this.resetMachine();

    if (!sub) {
      this.phase = 'done';
      this.ctx?.ui.setPanel(null);
      return;
    }

    if (sub.id === 'method') {
      this.phase = 'choose';
      return;
    }

    // deposit 用玩家選的製程；metal 固定走 PVD
    this.runKind = sub.id === 'metal' ? 'pvd' : (this.method ?? 'pvd');
    this.phase = 'seal';
  }

  private resetMachine(): void {
    this.door = 1;
    this.vacuum = 0;
    this.power = 0;
    this.valves = [0, 0];
    this.thickness = 0;
    this.running = false;
    this.quality = 0;
    this.autoHold = false;
    this.grab = null;
    this.waferHold = null;
    this.timer = 0;
    this.field.reset();
  }

  // ───────────────────────────────── 主迴圈 ────────────────────────────────

  override onFrame(frame: StageFrame): void {
    const { desk, ui, dt } = frame;
    this.timer += dt;

    const { deskTop, deskHeight } = desk.geometry;
    const groundY = deskTop + deskHeight * 0.44;

    if (this.phase === 'choose') this.frameChoose(frame, groundY);
    else if (this.currentSub) this.frameRun(frame, groundY);
    else {
      ui.setArHint('✅ 薄膜沉積完成 — 按右側「完成沉積」進入下一關', true);
      ui.setHandState('✨', '薄膜已成長', 'DEPOSITION COMPLETE', true);
    }

    this.ctx.ui.setPanel(this.buildPanel());
  }

  /** 場景可用範圍（避開左側互動面板），與第一關同一套規則。 */
  private sceneBounds(frame: StageFrame): { left: number; right: number; w: number } {
    const { width } = frame.desk.size;
    const inset = frame.ui.panelInset();
    const right = width - 14;
    const left = Math.min(inset > 0 ? inset + 26 : width * 0.06, width * 0.52);
    return { left, right, w: Math.max(180, right - left) };
  }

  // ───────────────────── 子步驟 1：拖晶圓選擇製程 ──────────────────────────

  private frameChoose(frame: StageFrame, groundY: number): void {
    const { ui, desk, dt, time, hand } = frame;
    const ctx = desk.context;
    const { height } = desk.size;
    const wafer = this.ctx.wafer;
    const scene = this.sceneBounds(frame);

    // 兩台機器並排在後方，晶圓放在前方的載盤上
    const gap = Math.max(14, scene.w * 0.04);
    const cw = (scene.w - gap) / 2;
    const ch = Math.min(cw * 0.78, height * 0.4);
    const top = groundY - 26 - ch;

    const geos: ChamberGeometry[] = [
      { x: scene.left, y: top, w: cw, h: ch },
      { x: scene.left + cw + gap, y: top, w: cw, h: ch },
    ];
    const kinds: ChamberKind[] = ['pvd', 'cvd'];
    const layouts = geos.map((g, i) => chamberLayout(g, kinds[i]));

    const waferR = Math.min(cw * 0.16, 42);
    const restPoint: Point = { x: scene.left + scene.w / 2, y: groundY + waferR * WAFER_SQUASH + 26 };

    // ── 抓取與放置 ──
    const held = this.waferHold;
    if (hand.present && hand.pinching && this.grab === null) {
      const anchor = held ?? restPoint;
      if (dist(hand.pinchPoint, anchor) < waferR + 34) {
        this.grab = 'wafer';
        this.waferHold = { ...hand.pinchPoint };
      }
    }
    if (this.grab === 'wafer') {
      if (hand.present && hand.pinching) {
        this.waferHold = { ...hand.pinchPoint };
      } else {
        // 放開：看看落在哪一台機器的晶圓座上
        const p = this.waferHold ?? restPoint;
        const hit = layouts.findIndex((l) => pointInCircle(p, l.wafer, waferR + 18));
        this.grab = null;
        this.waferHold = null;
        if (hit >= 0) {
          this.method = kinds[hit];
          this.nextSub();
          return;
        }
      }
    }
    if (!hand.present && this.grab === 'wafer') {
      this.grab = null;
      this.waferHold = null;
    }

    // ── 繪製 ──
    const carried = this.waferHold;
    layouts.forEach((layout, i) => {
      const hot = carried !== null && pointInCircle(carried, layout.wafer, waferR + 18);
      drawChamber(ctx, geos[i], layout, this.chamberState(kinds[i], layout, hot, true), time);
    });

    // 晶圓：拿在手上或躺在載盤上
    const p = carried ?? restPoint;
    if (!carried) this.drawTray(ctx, restPoint, waferR, groundY);
    drawFlatWafer(ctx, p, waferR, wafer.surfaceColor(), carried !== null);

    if (!carried) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 3);
      ctx.save();
      ctx.globalAlpha = 0.2 + pulse * 0.35;
      ctx.strokeStyle = '#2ecfc7';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, waferR + 8, waferR * WAFER_SQUASH + 7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ── 提示 ──
    if (carried) {
      const over = layouts.findIndex((l) => pointInCircle(carried, l.wafer, waferR + 18));
      ui.setArHint(
        over >= 0
          ? `✅ 放開手指，把晶圓送進${over === 0 ? ' e-gun（物理氣相沉積）' : ' PECVD（化學氣相沉積）'}`
          : '🤏 夾著晶圓 — 移到其中一台機台中央的虛線圈上',
        true,
      );
      ui.setHandState('🤏', '夾著晶圓', over >= 0 ? 'ON TARGET' : 'CARRYING', true);
    } else {
      ui.setArHint('🤏 捏合夾起晶圓，決定要送進哪一種沉積機台');
      ui.setHandState('✋', '（空手）', `PINCH ${hand.pinchDistance.toFixed(3)}`, false);
    }

    void dt;
  }

  private drawTray(ctx: CanvasRenderingContext2D, p: Point, r: number, groundY: number): void {
    const ry = r * WAFER_SQUASH;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + ry * 1.6, r * 1.25, ry * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#39434a';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + ry * 0.9, r * 1.2, ry * 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(224, 238, 243, 0.85)';
    ctx.font = "700 12px 'IBM Plex Sans', 'Noto Sans TC', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('待沉積晶圓', p.x, p.y + ry * 2.4);
    void groundY;
    ctx.restore();
  }

  // ────────────────── 子步驟 2 / 3：操作機台跑完一次沉積 ─────────────────────

  private frameRun(frame: StageFrame, groundY: number): void {
    const { ui, desk, dt, time, hand } = frame;
    const ctx = desk.context;
    const { height } = desk.size;
    const scene = this.sceneBounds(frame);

    // 滿版腔體：晶圓要「完整呈現」，所以盡量把垂直空間用滿
    const cw = scene.w * 0.98;
    const chMax = groundY - height * 0.19;
    const ch = clamp(Math.min(cw * 0.72, chMax), 200, 430);
    const geo: ChamberGeometry = {
      x: scene.left + (scene.w - cw) / 2,
      y: groundY - 16 - ch,
      w: cw,
      h: ch,
    };
    const layout = chamberLayout(geo, this.runKind);

    this.updateControls(hand, layout);
    this.advance(dt, layout);

    const state = this.chamberState(this.runKind, layout, false, false, hand);
    drawChamber(ctx, geo, layout, state, time);

    // 粒子畫在腔室內部，且要裁切在門後面看不到的部分
    if (this.running && this.door < 0.02) {
      const cfg = this.fieldConfig(layout);
      this.field.update(dt, cfg);
      ctx.save();
      ctx.beginPath();
      ctx.rect(layout.interior.x, layout.interior.y, layout.interior.w, layout.interior.h);
      ctx.clip();
      this.field.render(ctx, cfg, this.runKind === 'pvd' ? '#dfe6ec' : '#9fe0c4');
      ctx.restore();
    }

    this.drawProgress(ctx, layout);
    this.updateRunHints(ui, hand);
  }

  private fieldConfig(layout: ChamberLayout): FieldConfig {
    const it = layout.interior;
    const w = layout.wafer;
    return {
      mode: this.runKind === 'pvd' ? 'ballistic' : 'diffusive',
      rate: this.quality * 0.55 + 0.45,
      sourceY: layout.sourceY + 4,
      landY: w.cy - w.r * WAFER_SQUASH * 0.35,
      left: it.x + 8,
      right: it.x + it.w - 8,
      targetLeft: w.cx - w.r,
      targetRight: w.cx + w.r,
    };
  }

  // ── 實體控制元件：抓取與拖曳 ──

  private updateControls(hand: StageFrame['hand'], layout: ChamberLayout): void {
    if (!hand.present) {
      this.grab = null;
      return;
    }

    const p = hand.pinchPoint;

    // 抓取
    if (hand.justPinched && this.grab === null) {
      const handleX = lerp(layout.doorTrack.openX, layout.doorTrack.closedX, 1 - this.door);
      if (
        this.phase === 'seal' &&
        dist(p, { x: handleX, y: layout.doorHandle.cy }) < layout.doorHandle.r + 18
      ) {
        this.grab = 'door';
      } else if (this.runKind === 'pvd' && this.canAdjust()) {
        const y = layout.lever.bottom - this.power * (layout.lever.bottom - layout.lever.top);
        if (Math.abs(p.x - layout.lever.cx) < layout.lever.halfW + 22 && Math.abs(p.y - y) < 30) {
          this.grab = 'lever';
          this.autoHold = false;
        }
      } else if (this.runKind === 'cvd' && this.canAdjust()) {
        const idx = layout.valves.findIndex((v) => pointInCircle(p, v, 16));
        if (idx >= 0) {
          this.grab = idx === 0 ? 'valve0' : 'valve1';
          this.dragFrom = { x: p.x, y: p.y, value: this.valves[idx] };
          this.autoHold = false;
        }
      }

      // 大按鈕：可按時捏一下就啟動（判定半徑再放寬 14px，好按）
      if (this.grab === null && this.buttonLive() && pointInCircle(p, layout.button, 14)) {
        this.startRun();
      }
    }

    // 拖曳中
    if (this.grab !== null) {
      if (!hand.pinching) {
        this.grab = null;
      } else if (this.grab === 'door') {
        const t = layout.doorTrack;
        this.door = clamp((p.x - t.closedX) / (t.openX - t.closedX), 0, 1);
      } else if (this.grab === 'lever') {
        const L = layout.lever;
        this.power = clamp((L.bottom - p.y) / (L.bottom - L.top), 0, 1);
      } else if (this.grab === 'valve0' || this.grab === 'valve1') {
        const i = this.grab === 'valve0' ? 0 : 1;
        // 水平拖曳 = 轉動閥門，140px 走完全程
        this.valves[i] = clamp(this.dragFrom.value + (p.x - this.dragFrom.x) / 140, 0, 1);
      }
    }
  }

  /** 什麼時候可以動功率／氣閥：抽完真空之後（含沉積中，讓玩家隨時微調）。 */
  private canAdjust(): boolean {
    return this.phase === 'ready' || this.phase === 'run';
  }

  private buttonLive(): boolean {
    if (this.phase !== 'ready') return false;
    if (this.runKind === 'cvd') return this.valves[0] > 0.12 && this.valves[1] > 0.12;
    return true;
  }

  private startRun(): void {
    this.phase = 'run';
    this.running = true;
    this.timer = 0;
    // PVD 啟動時先給一點初始功率，玩家再用拉桿推進綠區
    if (this.runKind === 'pvd' && this.power < 0.05) this.power = 0.2;
  }

  // ── 流程推進 ──

  private advance(dt: number, layout: ChamberLayout): void {
    // 沒有鏡頭時的輔助：自動把控制值移到製程窗口中央
    if (this.autoHold) {
      if (this.runKind === 'pvd') {
        this.power = approach(this.power, mid(POWER_WINDOW), dt * 0.9);
      } else {
        this.valves[0] = approach(this.valves[0], mid(VALVE_WINDOWS[0]), dt * 0.9);
        this.valves[1] = approach(this.valves[1], mid(VALVE_WINDOWS[1]), dt * 0.9);
      }
    }

    this.quality = this.computeQuality();

    switch (this.phase) {
      case 'seal':
        if (this.door < 0.02) {
          this.door = 0;
          this.phase = 'pump';
          this.timer = 0;
        }
        break;

      case 'pump':
        this.vacuum = Math.min(1, this.vacuum + dt * 0.55);
        if (this.vacuum >= 1) {
          this.phase = 'ready';
          this.timer = 0;
        }
        break;

      case 'ready':
        break;

      case 'run': {
        this.thickness = Math.min(1, this.thickness + DEPOSIT_RATE * this.quality * dt);
        if (this.thickness >= 1) {
          this.running = false;
          this.phase = 'vent';
          this.timer = 0;
          this.field.reset();
        }
        break;
      }

      case 'vent':
        // 洩壓並自動開門
        this.vacuum = Math.max(0, this.vacuum - dt * 0.9);
        this.door = Math.min(1, this.door + dt * 0.8);
        if (this.door >= 1) {
          this.applyFilm();
          this.phase = 'done';
          this.nextSub();
        }
        break;

      default:
        break;
    }

    void layout;
  }

  /**
   * 製程品質：控制值落在窗口內就是 1，離開窗口後線性衰減。
   * PVD 超過上限代表過熱，衰減得比不足更快——這正是實際製程的行為。
   */
  private computeQuality(): number {
    if (this.runKind === 'pvd') return windowFit(this.power, POWER_WINDOW, 0.3, 0.18);
    const a = windowFit(this.valves[0], VALVE_WINDOWS[0], 0.28, 0.28);
    const b = windowFit(this.valves[1], VALVE_WINDOWS[1], 0.28, 0.28);
    return a * b;
  }

  private applyFilm(): void {
    const wafer = this.ctx.wafer;
    const isOxide = this.runKind === 'cvd';
    const spec = isOxide ? FILM.oxide : FILM.metal;
    wafer.addLayer({
      kind: isOxide ? 'oxide' : 'metal',
      label: spec.label,
      thickness: spec.thickness,
      color: spec.color,
      patterned: false,
    });
  }

  // ── 畫面上的進度與提示 ──

  /** 名牌下方的狀態列：厚度進度條 + 真空度 + 製程品質。 */
  private drawProgress(ctx: CanvasRenderingContext2D, layout: ChamberLayout): void {
    const { x, y, w, h } = layout.statusBar;

    ctx.save();

    // 厚度進度條
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = this.thickness >= 1 ? '#5ee9df' : '#5ee996';
    ctx.fillRect(x, y, w * this.thickness, h);
    ctx.strokeStyle = 'rgba(180, 210, 220, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    // 讀數放在進度條下方那一列
    const ty = y + h + 3;
    ctx.font = "700 12px 'IBM Plex Mono', monospace";
    ctx.textBaseline = 'top';

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(214, 230, 238, 0.9)';
    ctx.fillText(
      `真空 ${Math.round(this.vacuum * 100)}%　厚度 ${Math.round(this.thickness * 100)}%`,
      x,
      ty,
    );

    if (this.phase === 'run') {
      ctx.textAlign = 'right';
      ctx.fillStyle = this.quality > 0.75 ? '#5ee996' : this.quality > 0.35 ? '#e8c07a' : '#ff8a6a';
      ctx.fillText(`製程品質 ${Math.round(this.quality * 100)}%`, x + w, ty);
    }

    ctx.restore();
  }

  private updateRunHints(ui: StageFrame['ui'], hand: StageFrame['hand']): void {
    const pvd = this.runKind === 'pvd';

    switch (this.phase) {
      case 'seal':
        ui.setArHint('🚪 捏住腔門把手，往左拖到底把腔室密閉', this.grab === 'door');
        ui.setHandState(
          this.grab === 'door' ? '🤏' : '✋',
          this.grab === 'door' ? '拖曳腔門' : '（空手）',
          `DOOR ${Math.round((1 - this.door) * 100)}%`,
          this.grab === 'door',
        );
        break;

      case 'pump':
        ui.setArHint(`🌀 抽真空中… ${Math.round(this.vacuum * 100)}%`, true);
        ui.setHandState('🌀', '抽真空中', `VACUUM ${Math.round(this.vacuum * 100)}%`, true);
        break;

      case 'ready':
        if (pvd) {
          ui.setArHint('🟢 真空就緒 — 按下機台上的綠色大按鈕啟動電子槍', true);
          ui.setHandState('🟢', '待機中', 'READY', true);
        } else {
          const ok = this.buttonLive();
          ui.setArHint(
            ok
              ? '🟢 氣體已通入 — 按下大按鈕點燃電漿'
              : '🎛️ 捏住右邊兩顆旋鈕左右轉，把兩種氣體都打開',
            ok,
          );
          ui.setHandState(
            this.grab?.startsWith('valve') ? '🎛️' : ok ? '🟢' : '✋',
            ok ? '待機中' : '調整氣閥',
            `SiH₄ ${Math.round(this.valves[0] * 100)}% / N₂O ${Math.round(this.valves[1] * 100)}%`,
            ok || this.grab?.startsWith('valve') === true,
          );
        }
        break;

      case 'run': {
        const good = this.quality > 0.75;
        if (pvd) {
          const hot = this.power > POWER_WINDOW[1];
          ui.setArHint(
            hot
              ? '🔥 功率過高，靶材過熱 — 把拉桿往下拖回綠色區間'
              : good
                ? `⚡ 金屬蒸氣正在直線沉積 — 厚度 ${Math.round(this.thickness * 100)}%`
                : '🎚️ 捏住拉桿上下拖曳，把電子束功率調進綠色區間',
            good,
          );
          ui.setHandState('⚡', good ? '沉積中' : '功率不在窗口', `POWER ${Math.round(this.power * 100)}%`, good);
        } else {
          ui.setArHint(
            good
              ? `🟣 電漿激發中，氧化層正在成長 — 厚度 ${Math.round(this.thickness * 100)}%`
              : '🎛️ 轉動兩顆旋鈕，把氣體流量都調進綠色區間',
            good,
          );
          ui.setHandState('🟣', good ? '沉積中' : '氣體比例不對', `品質 ${Math.round(this.quality * 100)}%`, good);
        }
        break;
      }

      case 'vent':
        ui.setArHint('✅ 沉積完成 — 洩壓開門中', true);
        ui.setHandState('✅', '沉積完成', 'VENTING', true);
        break;

      default:
        ui.setHandState('✋', '（空手）', `PINCH ${hand.pinchDistance.toFixed(3)}`, false);
        break;
    }
  }

  // ── 組出腔體的繪圖狀態 ──

  private chamberState(
    kind: ChamberKind,
    layout: ChamberLayout,
    seatHot: boolean,
    compact: boolean,
    hand?: StageFrame['hand'],
  ): ChamberState {
    const wafer = this.ctx.wafer;
    const p = hand?.present ? hand.pinchPoint : null;
    const handleX = lerp(layout.doorTrack.openX, layout.doorTrack.closedX, 1 - this.door);
    const leverY = layout.lever.bottom - this.power * (layout.lever.bottom - layout.lever.top);

    return {
      kind,
      door: compact ? 1 : this.door,
      vacuum: compact ? 0 : this.vacuum,
      power: this.power,
      valves: this.valves,
      running: this.running,
      thickness: this.thickness,
      waferInside: !compact,
      waferColor: wafer.surfaceColor(),
      filmColor: compact ? null : this.runKind === 'cvd' ? FILM.oxide.color : FILM.metal.color,
      baseFilmColor:
        !compact && this.runKind === 'pvd' && wafer.hasLayer('oxide') ? FILM.oxide.color : null,
      title: kind === 'pvd' ? 'e-gun 蒸鍍機' : 'PECVD 電漿腔體',
      subtitle: kind === 'pvd' ? '物理氣相沉積 · PVD' : '化學氣相沉積 · CVD',
      compact,
      seatHot,
      hot: {
        door:
          this.grab === 'door' ||
          (p !== null &&
            this.phase === 'seal' &&
            dist(p, { x: handleX, y: layout.doorHandle.cy }) < layout.doorHandle.r + 18),
        lever:
          this.grab === 'lever' ||
          (p !== null &&
            this.canAdjust() &&
            Math.abs(p.x - layout.lever.cx) < layout.lever.halfW + 22 &&
            Math.abs(p.y - leverY) < 30),
        valve:
          this.grab === 'valve0'
            ? 0
            : this.grab === 'valve1'
              ? 1
              : p !== null && this.canAdjust()
                ? layout.valves.findIndex((v) => pointInCircle(p, v, 16))
                : -1,
        button: p !== null && pointInCircle(p, layout.button, 14),
      },
      buttonLive: this.buttonLive(),
      powerWindow: POWER_WINDOW,
      valveWindows: VALVE_WINDOWS,
    };
  }

  // ───────────────────────────── 互動面板 ─────────────────────────────────
  // 面板只是「說明 + 沒有鏡頭時的備援」，主要互動一律在機台上用手完成。

  private buildPanel(): PanelSpec | null {
    const sub = this.currentSub;
    if (!sub) return null;

    if (this.phase === 'choose') {
      return {
        kind: 'choice',
        title: '第一步 · 製程選擇',
        note: '把晶圓拖進哪一台機器，就等於選了哪種製程。\nPVD 用電子束加熱靶材，金屬氣化後直線下落凝結。\nCVD 通入氣體後以電漿促進反應長出氧化層，之後還要再鍍一層金屬。',
        options: [
          { id: 'pvd', label: '物理氣相沉積', sub: 'e-gun · PVD', color: '#ffd68a' },
          { id: 'cvd', label: '化學氣相沉積', sub: 'PECVD · CVD', color: '#8ae0ff' },
        ],
        selected: [],
        max: 1,
        confirmLabel: '（用手把晶圓放進機台）',
        confirmEnabled: false,
        onToggle: (id) => {
          this.method = id as ChamberKind;
          this.nextSub();
        },
        onConfirm: () => {},
      };
    }

    const pvd = this.runKind === 'pvd';
    const stepTitle = sub.id === 'metal' ? '第三步 · 金屬鍍膜' : '第二步 · 沉積反應';

    if (this.phase === 'seal') {
      return {
        kind: 'action',
        title: stepTitle,
        note: '捏住腔門把手往左拖到底。腔室必須密閉才能抽真空——殘留的空氣會讓薄膜氧化、附著不良。',
        label: '直接關閉腔門',
        enabled: true,
        onClick: () => {
          this.door = 0;
        },
      };
    }

    if (this.phase === 'pump') {
      return {
        kind: 'action',
        title: stepTitle,
        note: '正在把腔室抽到高真空。真空度不夠，氣化的原子會被空氣分子撞散，鍍不出均勻的膜。',
        label: `抽真空中… ${Math.round(this.vacuum * 100)}%`,
        enabled: false,
        onClick: () => {},
      };
    }

    if (this.phase === 'ready') {
      return {
        kind: 'action',
        title: stepTitle,
        note: pvd
          ? '按下機台上的綠色大按鈕啟動電子槍，再用拉桿把功率調進綠色區間。'
          : '先轉開兩顆氣閥（SiH₄ 少、N₂O 多），大按鈕才會亮起。比例正確才長得出化學計量正確的 SiO₂。',
        label: this.buttonLive() ? '直接啟動' : '請先轉開兩顆氣閥',
        enabled: this.buttonLive(),
        onClick: () => this.startRun(),
      };
    }

    if (this.phase === 'run') {
      return {
        kind: 'action',
        title: stepTitle,
        note: pvd
          ? '拉桿往上＝功率越高。太低長得慢，太高會讓靶材過熱、噴出顆粒。維持在綠帶內速度最快。'
          : '兩種氣體的流量都要落在綠帶內。比例不對，長出來的膜化學計量就不對。',
        label: this.autoHold ? '自動維持中…' : '自動維持最佳參數',
        enabled: !this.autoHold,
        onClick: () => {
          this.autoHold = true;
        },
      };
    }

    return {
      kind: 'action',
      title: stepTitle,
      note: '沉積完成，正在洩壓並開啟腔門。',
      label: '完成',
      enabled: false,
      onClick: () => {},
    };
  }

  // ─────────────────────────────── 過關判定 ────────────────────────────────

  override canComplete(): boolean {
    return this.subsFinished && this.ctx?.wafer.hasLayer('metal') === true;
  }

  override buildResult(): StageResult {
    return {
      method: this.method,
      layers: this.ctx.wafer.layers.map((l) => l.label),
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

function mid([a, b]: [number, number]): number {
  return (a + b) / 2;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 讓數值以固定速率接近目標（自動維持用）。 */
function approach(current: number, target: number, step: number): number {
  if (Math.abs(target - current) <= step) return target;
  return current + Math.sign(target - current) * step;
}

/**
 * 控制值落在製程窗口內回傳 1，超出後線性衰減到 0。
 * `belowSpan` / `aboveSpan` 分開設定，因為「不足」與「過量」的懲罰通常不對稱。
 */
function windowFit(
  value: number,
  [lo, hi]: [number, number],
  belowSpan: number,
  aboveSpan: number,
): number {
  if (value >= lo && value <= hi) return 1;
  const d = value < lo ? (lo - value) / belowSpan : (value - hi) / aboveSpan;
  return clamp(1 - d, 0, 1);
}
