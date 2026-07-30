import { SECTION_CELLS } from '../core/WaferState';
import type {
  InstructionStep,
  PanelSpec,
  Point,
  StageContext,
  StageFrame,
  StageResult,
  SubStep,
} from '../core/types';
import {
  alignerLayout,
  drawAligner,
  ALIGN_TOLERANCE,
  type AlignerGeometry,
} from '../scene/Aligner';
import { pointInCircle } from '../scene/Chamber';
import { machineBox, machineHeight } from '../scene/MachineFit';
import { BaseStage } from './BaseStage';

/**
 * 第三關：微影製程
 * ---------------------------------------------------------------------------
 * 四個子步驟，每一步都用手直接操作，沒有一步是靠面板按鈕完成的：
 *
 *   1. 光阻劑塗抹  中心滴一滴，接著自動旋轉塗佈（光阻靠離心力鋪開，不是用抹的）
 *   2. 圖案設計    捏合畫出要刻的圖案（＝光罩上的鉻層）
 *   3. 正負光阻選擇 兩張大卡片各附剖面示意圖，捏一下選擇
 *   4. 曝光與烘烤  捏住光罩拖到對準記號重合，再按曝光機上的大按鈕
 *
 * 視角切換
 *   前兩步是**俯視**（設計圖案時就該從正上方看），第四步切到**正視**
 *   （才看得到 UV 燈 → 光罩 → 晶圓的上下關係）。
 *
 * 關鍵教學點：畫出來的圖案是**鉻層，會擋住光**。
 * 所以 UV 只從沒畫到的地方穿過去——這是初學者最容易搞反的地方，
 * 曝光動畫刻意用「先畫滿光、再用圖案挖掉」來表達。
 */

type Phase =
  | 'spread'
  | 'spin'
  | 'draw'
  | 'tone'
  | 'align'
  | 'expose'
  | 'bake'
  | 'done';

/** 光罩圖案至少要覆蓋晶圓面積的比例。 */
const PATTERN_MIN = 0.015;

const RESIST_COLOR = '#2f7d5b';
/** 同一個顏色的 rgb 分量，塗佈圖層要用 rgba() 疊出柔邊。 */
const RESIST_RGB = '47, 125, 91';
const CHROME_COLOR = '#1b232a';

export class Stage3Litho extends BaseStage {
  readonly id = 'litho';
  readonly title = '微影製程';
  readonly shortTitle = '微影';
  readonly description =
    '把光阻均勻塗上晶圓，畫出要刻的圖案，選擇正／負光阻，最後把光罩對準晶圓曝光並烘烤。';
  readonly hint = '在晶圓中心滴一滴光阻後會自動旋轉塗佈；曝光時捏住光罩拖到兩組十字記號重合。';
  readonly primaryLabel = '完成微影';
  readonly usesCrossSection = true;

  readonly substeps: readonly SubStep[] = [
    { id: 'spread', title: '光阻劑塗抹', desc: '中心滴一滴，再以旋轉塗佈鋪成均勻薄膜' },
    { id: 'draw', title: '圖案設計', desc: '畫出要刻在晶片上的圖案（＝光罩的鉻層）' },
    { id: 'tone', title: '正負光阻選擇', desc: '決定曝光區在顯影後要被移除還是保留' },
    { id: 'expose', title: '曝光與烘烤', desc: '對準光罩後曝光，再進行曝光後烘烤' },
  ];

  readonly instructions: InstructionStep[] = [
    { glyph: '💧', title: '滴一滴光阻', desc: '只滴在晶圓正中心，接著靠旋轉塗佈用離心力鋪開。' },
    { glyph: '✍️', title: '畫出圖案', desc: '畫的是光罩上的鉻層 —— 有畫到的地方會擋住 UV 光。' },
    { glyph: '🃏', title: '選正負光阻', desc: '兩張卡片下方有剖面示意圖，捏一下想用的那張。' },
    { glyph: '🎯', title: '對準後曝光', desc: '捏住光罩拖到十字記號重合，曝光按鈕才會亮起。' },
  ];

  // ── 流程 ──
  private phase: Phase = 'spread';
  private timer = 0;
  private tone: 'positive' | 'negative' = 'positive';

  // ── 光阻塗佈 ──
  private spinAngle = 0;
  /** 那一滴光阻：0 = 還沒滴，0~1 = 落下中，1 = 已落在晶圓中心。 */
  private dropT = 0;

  // ── 繪圖 ──
  private drawing = false;
  /**
   * 這一幀的圖案覆蓋率。
   * desk.coverage() 每次都會配置一張 72×72 canvas 並讀回像素，
   * 所以一幀只算一次，繪製與面板共用同一個值。
   */
  private patternCoverage = 0;

  // ── 曝光 ──
  private maskOffset: Point = { x: 0, y: 0 };
  private draggingMask = false;
  private dragFrom = { hand: { x: 0, y: 0 }, offset: { x: 0, y: 0 } };
  private exposeT = 0;
  private bakeT = 0;

  // ─────────────────────────────── 生命週期 ────────────────────────────────

  override onEnter(ctx: StageContext): void {
    super.onEnter(ctx);
    ctx.desk.setWaferVisible(false);
    ctx.desk.setDeskLabel('LITHOGRAPHY BAY · 微影區');
    ctx.desk.setPenColor(CHROME_COLOR);
    ctx.desk.setPenWidth(18);
    this.resetSub();
    this.onSubEnter(0);
  }

  override onExit(): void {
    this.ctx?.ui.setPanel(null);
    this.ctx?.desk.setWaferVisible(true);
    this.ctx?.desk.setDeskLabel(null);
    this.ctx?.desk.setWaferPlacement(null);
  }

  override restart(): void {
    super.restart();
    this.ctx?.desk.clear();
    this.ctx?.wafer.removeLayer('resist');
    this.resetCoat();
    this.onSubEnter(0);
  }

  protected override onSubEnter(index: number): void {
    this.timer = 0;
    this.drawing = false;
    this.draggingMask = false;
    this.exposeT = 0;
    this.bakeT = 0;
    this.maskOffset = { x: 0, y: 0 };

    const sub = this.substeps[index];
    if (!sub) {
      this.phase = 'done';
      this.ctx?.ui.setPanel(null);
      return;
    }

    switch (sub.id) {
      case 'spread':
        this.resetCoat();
        this.phase = 'spread';
        break;
      case 'draw':
        this.phase = 'draw';
        break;
      case 'tone':
        this.phase = 'tone';
        break;
      default:
        this.phase = 'align';
        // 一開始把光罩隨機偏一點，玩家才有東西可以對
        this.maskOffset = { x: 58, y: -22 };
        break;
    }
  }

  private resetCoat(): void {
    this.spinAngle = 0;
    this.dropT = 0;
  }

  // ───────────────────────────────── 主迴圈 ────────────────────────────────

  override onFrame(frame: StageFrame): void {
    const { desk, ui, dt } = frame;
    this.timer += dt;

    const { deskTop, deskHeight } = desk.geometry;
    const groundY = deskTop + deskHeight * 0.44;

    switch (this.phase) {
      case 'spread':
      case 'spin':
        this.frameSpread(frame, groundY);
        break;
      case 'draw':
        this.frameDraw(frame, groundY);
        break;
      case 'tone':
        this.frameTone(frame, groundY);
        break;
      case 'align':
      case 'expose':
      case 'bake':
        this.frameExpose(frame, groundY);
        break;
      default:
        ui.setArHint('✅ 微影完成 — 按右側「完成微影」進入下一關', true);
        ui.setHandState('✨', '圖案已轉印', 'LITHOGRAPHY COMPLETE', true);
        break;
    }

    this.ctx.ui.setPanel(this.buildPanel());
  }

  private sceneBounds(frame: StageFrame): { left: number; right: number; w: number } {
    const { width } = frame.desk.size;
    const inset = frame.ui.panelInset();
    const right = width - 14;
    const left = Math.min(inset > 0 ? inset + 26 : width * 0.06, width * 0.52);
    return { left, right, w: Math.max(180, right - left) };
  }

  /** 前兩步的俯視晶圓：畫面中央、盡量大。 */
  private topWafer(frame: StageFrame, groundY: number): { cx: number; cy: number; r: number } {
    const scene = this.sceneBounds(frame);
    const { height } = frame.desk.size;
    const top = height * 0.2;
    const r = Math.max(70, Math.min(scene.w * 0.36, (groundY - top) * 0.44));
    return { cx: scene.left + scene.w / 2, cy: (top + groundY) / 2, r };
  }

  // ────────────── 子步驟 1：中心滴一滴光阻 → 旋轉塗佈鋪開 ──────────────────

  /**
   * 真實的旋轉塗佈是「在晶圓正中心滴一滴，然後高速旋轉靠離心力鋪開」。
   * 玩家不會、也不該用手去抹 —— 手抹只會造成厚薄不均，這正是旋轉塗佈要避免的。
   * 所以這一步只有兩個動作：捏一下滴出來、然後看它被甩開。
   */
  private frameSpread(frame: StageFrame, groundY: number): void {
    const { ui, desk, dt, time, hand } = frame;
    const ctx = desk.context;
    const w = this.topWafer(frame, groundY);
    desk.setWaferPlacement(w);

    if (this.phase === 'spin') {
      this.spinAngle += dt * 16;
      if (this.timer > 2.6) {
        this.applyResistLayer();
        this.nextSub();
        return;
      }
    } else if (this.dropT > 0 && this.dropT < 1) {
      this.dropT = Math.min(1, this.dropT + dt * 0.9);
      if (this.dropT >= 1) {
        // 落到中心就直接進旋轉塗佈，中間沒有任何「抹」的步驟
        this.phase = 'spin';
        this.timer = 0;
      }
    } else if (this.dropT === 0 && hand.present && hand.justPinched) {
      this.dropT = 0.001;
    }

    // ── 繪製 ──
    this.drawTopWafer(ctx, w, time, this.phase === 'spin' ? this.spinAngle : 0);
    this.drawResistPuddle(ctx, w);
    this.drawNozzle(ctx, w, time);

    // ── 提示 ──
    if (this.phase === 'spin') {
      const rpm = Math.round(1200 + Math.min(1, this.timer / 1.2) * 2800);
      ui.setArHint(`🌀 旋轉塗佈中 ${rpm} RPM — 離心力把光阻鋪成厚度均勻的薄膜`, true);
      ui.setHandState('🌀', '旋轉塗佈中', `${rpm} RPM`, true);
    } else if (this.dropT > 0) {
      ui.setArHint('💧 光阻滴落中…', true);
      ui.setHandState('💧', '滴入光阻', 'DISPENSING', true);
    } else {
      ui.setArHint('🤏 捏合一下，在晶圓正中心滴一滴光阻');
      ui.setHandState('✋', '（空手）', `PINCH ${hand.pinchDistance.toFixed(3)}`, false);
    }
  }

  /**
   * 晶圓中心那一攤光阻。
   * 剛滴下去是中心一小攤；旋轉塗佈時半徑一路長到蓋滿整片，
   * 邊緣的透明度也跟著收斂 —— 這就是「厚度變均勻」的視覺表現。
   */
  private drawResistPuddle(
    ctx: CanvasRenderingContext2D,
    w: { cx: number; cy: number; r: number },
  ): void {
    if (this.dropT < 1) return;

    const spread = this.phase === 'spin' ? Math.min(1, this.timer / 1.6) : 0;
    const radius = w.r * (0.17 + spread * 0.83);
    const edge = 0.3 + spread * 0.52;

    ctx.save();
    ctx.beginPath();
    ctx.arc(w.cx, w.cy, w.r, 0, Math.PI * 2);
    ctx.clip();

    const g = ctx.createRadialGradient(w.cx, w.cy, 0, w.cx, w.cy, radius);
    g.addColorStop(0, `rgba(${RESIST_RGB}, 0.92)`);
    g.addColorStop(0.72, `rgba(${RESIST_RGB}, ${edge + 0.12})`);
    g.addColorStop(1, `rgba(${RESIST_RGB}, ${spread > 0.92 ? edge : 0})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(w.cx, w.cy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private applyResistLayer(): void {
    const wafer = this.ctx.wafer;
    if (wafer.hasLayer('resist')) return;
    wafer.addLayer({
      kind: 'resist',
      label: '光阻層',
      thickness: 0.45,
      color: RESIST_COLOR,
      patterned: false,
    });
  }

  // ────────────────────────── 子步驟 2：畫出圖案 ────────────────────────────

  private frameDraw(frame: StageFrame, groundY: number): void {
    const { ui, desk, time, hand } = frame;
    const ctx = desk.context;
    const w = this.topWafer(frame, groundY);
    desk.setWaferPlacement(w);

    const onWafer = hand.present && desk.isOnWafer(hand.pinchPoint.x, hand.pinchPoint.y);
    if (hand.present && hand.pinching && onWafer) {
      if (!this.drawing) {
        desk.beginStroke(hand.pinchPoint.x, hand.pinchPoint.y);
        this.drawing = true;
      } else {
        desk.strokeTo(hand.pinchPoint.x, hand.pinchPoint.y);
      }
    } else if (this.drawing) {
      desk.endStroke();
      this.drawing = false;
    }

    // ── 繪製 ──
    this.drawTopWafer(ctx, w, time, 0);
    this.drawResistFilm(ctx, w);

    // 已畫的鉻圖案
    ctx.save();
    ctx.beginPath();
    ctx.arc(w.cx, w.cy, w.r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(desk.getPatternCanvas(), w.cx - w.r, w.cy - w.r, w.r * 2, w.r * 2);
    ctx.restore();

    // 游標
    if (hand.present) {
      ctx.save();
      ctx.strokeStyle = this.drawing ? '#5ee9df' : 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hand.pinchPoint.x, hand.pinchPoint.y, this.drawing ? 13 : 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const cov = desk.coverage();
    this.patternCoverage = cov;
    this.drawCoverageRing(ctx, w, Math.min(1, cov / PATTERN_MIN), 1, '圖案完成度');

    if (this.drawing) {
      ui.setArHint('✍️ 正在畫光罩的鉻層 — 畫到的地方會擋住 UV 光', true);
      ui.setHandState('✍️', '繪製中', `覆蓋 ${(cov * 100).toFixed(1)}%`, true);
    } else {
      ui.setArHint(
        cov >= PATTERN_MIN
          ? '✅ 圖案夠了 — 可以按右側「完成繪製」，或繼續加細節'
          : '🤏 捏合後在晶圓上畫出你想刻的圖案',
        cov >= PATTERN_MIN,
      );
      ui.setHandState('✋', '（空手）', `覆蓋 ${(cov * 100).toFixed(1)}%`, false);
    }
  }

  // ──────────────────── 子步驟 3：正負光阻（兩張大卡片） ─────────────────────

  private frameTone(frame: StageFrame, groundY: number): void {
    const { ui, desk, time, hand } = frame;
    const ctx = desk.context;
    const scene = this.sceneBounds(frame);

    const gap = Math.max(16, scene.w * 0.04);
    const cw = (scene.w - gap) / 2;
    // 卡片做成「高瘦」而不是接近正方形 —— 三列剖面示意圖需要垂直空間，
    // 小螢幕上用 w*1.02 會讓每列只剩不到 30px，第一列的標籤還會壓到標題。
    const bandTop = frame.ui.sceneOverlay().top + 8;
    const chH = machineHeight({ width: cw, ratio: 1.32, groundY, bandTop, min: 150, max: 520 });
    const top = (bandTop + groundY) / 2 - chH / 2;

    const cards: { id: 'positive' | 'negative'; x: number }[] = [
      { id: 'positive', x: scene.left },
      { id: 'negative', x: scene.left + cw + gap },
    ];

    let hoverIdx = -1;
    cards.forEach((c, i) => {
      if (
        hand.present &&
        hand.pinchPoint.x >= c.x &&
        hand.pinchPoint.x <= c.x + cw &&
        hand.pinchPoint.y >= top &&
        hand.pinchPoint.y <= top + chH
      ) {
        hoverIdx = i;
      }
    });

    if (hand.present && hand.justPinched && hoverIdx >= 0) {
      this.tone = cards[hoverIdx].id;
      this.ctx.wafer.resistTone = this.tone;
      this.nextSub();
      return;
    }

    cards.forEach((c, i) => {
      this.drawToneCard(ctx, c.id, c.x, top, cw, chH, hoverIdx === i, time);
    });

    if (hoverIdx >= 0) {
      ui.setArHint(
        `🤏 捏一下選擇「${cards[hoverIdx].id === 'positive' ? '正型光阻' : '負型光阻'}」`,
        true,
      );
      ui.setHandState('🤏', '準備選擇', cards[hoverIdx].id.toUpperCase(), true);
    } else {
      ui.setArHint('🃏 把手移到卡片上，捏一下選擇要用的光阻類型');
      ui.setHandState('✋', '（空手）', 'SELECT RESIST TONE', false);
    }
  }

  /** 卡片：標題 + 剖面示意圖（曝光 → 顯影後）+ 說明。 */
  private drawToneCard(
    ctx: CanvasRenderingContext2D,
    id: 'positive' | 'negative',
    x: number,
    y: number,
    w: number,
    h: number,
    hot: boolean,
    time: number,
  ): void {
    const positive = id === 'positive';

    ctx.save();

    ctx.fillStyle = hot ? 'rgba(30, 58, 62, 0.95)' : 'rgba(22, 28, 33, 0.92)';
    roundRect(ctx, x, y, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = hot ? '#5ee9df' : 'rgba(120, 150, 165, 0.5)';
    ctx.lineWidth = hot ? 4 : 2;
    ctx.stroke();

    if (hot) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 5);
      ctx.globalAlpha = 0.25 + pulse * 0.4;
      ctx.strokeStyle = '#5ee9df';
      ctx.lineWidth = 3;
      roundRect(ctx, x - 6, y - 6, w + 12, h + 12, 18);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 標題
    ctx.fillStyle = hot ? '#5ee9df' : '#e8f2f6';
    ctx.font = `700 ${Math.round(clamp(w * 0.11, 18, 30))}px 'IBM Plex Sans', 'Noto Sans TC', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(positive ? '正型光阻' : '負型光阻', x + w / 2, y + 16);

    ctx.fillStyle = 'rgba(180, 200, 210, 0.8)';
    ctx.font = "600 14px 'IBM Plex Mono', monospace";
    ctx.fillText(positive ? 'POSITIVE' : 'NEGATIVE', x + w / 2, y + 16 + clamp(w * 0.11, 18, 30) + 4);

    // 示意圖區：三列（曝光 → 顯影後 → 蝕刻後）
    const dx = x + w * 0.1;
    const dw = w * 0.8;
    /*
      三列 + 每列上方的標籤 + 底部兩行結論，垂直空間很緊。
      這組數字是用腳本對 1280×800 ~ 1920×1080 逐一驗過的：
      最小卡片（211×279）時第一列標籤在 70、標題底在 57、三列結束在 206、
      結論從 235 開始，每一段都不重疊。
    */
    const top0 = y + h * 0.3;
    const rowH = h * 0.12;
    const rowGap = h * 0.04;

    this.drawToneDiagram(ctx, dx, top0, dw, rowH, 'expose', positive);
    this.drawToneDiagram(ctx, dx, top0 + (rowH + rowGap), dw, rowH, 'develop', positive);
    this.drawToneDiagram(ctx, dx, top0 + (rowH + rowGap) * 2, dw, rowH, 'etch', positive);

    // 結論：直接寫出「你畫的圖案最後會凸起還是凹陷」
    ctx.textAlign = 'center';
    ctx.fillStyle = positive ? '#ffd68a' : '#8ae0ff';
    ctx.font = `700 ${Math.round(clamp(w * 0.068, 14, 19))}px 'IBM Plex Sans', 'Noto Sans TC', sans-serif`;
    ctx.fillText(
      positive ? '你畫的圖案 → 凸起' : '你畫的圖案 → 凹陷',
      x + w / 2,
      y + h - 44,
    );

    ctx.fillStyle = 'rgba(200, 220, 230, 0.9)';
    ctx.font = `600 ${Math.round(clamp(w * 0.052, 12, 15))}px 'IBM Plex Sans', 'Noto Sans TC', sans-serif`;
    ctx.fillText(
      positive ? '曝光區溶掉，鉻下方的光阻留著保護' : '曝光區留下，鉻下方的光阻被洗掉',
      x + w / 2,
      y + h - 20,
    );

    ctx.restore();
  }

  /**
   * 一列剖面示意圖。
   *
   * 關鍵是**鉻層要畫在中間**——那塊鉻就是玩家畫出來的 pattern。
   * 之前把鉻畫在兩側、開口留在中間，玩家會把中間的凹槽誤讀成自己的圖案，
   * 於是正負光阻看起來剛好顛倒。
   *
   * 三列合起來回答同一個問題：「我畫的那塊，最後是凸起還是凹陷？」
   *   ① 曝光    UV 只從鉻的兩側穿過去，中間被擋住
   *   ② 顯影後  正光阻 → 曝光區溶掉，只剩中間（鉻下方）的光阻
   *             負光阻 → 曝光區交聯留下，中間反而被洗掉
   *   ③ 蝕刻後  有光阻保護的地方留著，其餘被蝕掉
   */
  private drawToneDiagram(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    kind: 'expose' | 'develop' | 'etch',
    positive: boolean,
  ): void {
    // 中間那塊鉻＝玩家畫的圖案
    const cL = x + w * 0.36;
    const cR = x + w * 0.64;
    const baseY = y + h;
    const subH = Math.max(7, h * 0.24);
    const resistH = Math.max(8, h * 0.3);
    const resistTop = baseY - subH - resistH;

    ctx.save();
    ctx.font = "600 12px 'IBM Plex Sans', 'Noto Sans TC', sans-serif";
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(150, 175, 188, 0.85)';
    ctx.fillText(
      kind === 'expose' ? '① 曝光' : kind === 'develop' ? '② 顯影後' : '③ 蝕刻後',
      x,
      y - 2,
    );

    if (kind === 'etch') {
      /*
        蝕刻後只畫基材的起伏，光阻已經剝掉。
        正光阻：中間有光阻保護 → 中間留著 → 凸起
        負光阻：中間沒有保護   → 中間被蝕掉 → 凹槽
      */
      ctx.fillStyle = '#6d7d86';
      if (positive) {
        ctx.fillRect(x, baseY - subH, w, subH);
        ctx.fillRect(cL, baseY - subH - resistH, cR - cL, resistH);
      } else {
        ctx.fillRect(x, baseY - subH, w, subH);
        ctx.fillRect(x, baseY - subH - resistH, cL - x, resistH);
        ctx.fillRect(cR, baseY - subH - resistH, x + w - cR, resistH);
      }

      // 用箭頭把「凸」「凹」再標一次
      ctx.strokeStyle = positive ? '#ffd68a' : '#8ae0ff';
      ctx.lineWidth = 2;
      const mid = (cL + cR) / 2;
      const tipY = positive ? baseY - subH - resistH - 4 : baseY - subH + 3;
      const tailY = positive ? tipY - 11 : tipY + 11;
      ctx.beginPath();
      ctx.moveTo(mid, tailY);
      ctx.lineTo(mid, tipY);
      ctx.moveTo(mid - 4, tipY + (positive ? 4 : -4));
      ctx.lineTo(mid, tipY);
      ctx.lineTo(mid + 4, tipY + (positive ? 4 : -4));
      ctx.stroke();

      ctx.restore();
      return;
    }

    // 矽基板
    ctx.fillStyle = '#5c6b74';
    ctx.fillRect(x, baseY - subH, w, subH);

    if (kind === 'expose') {
      // 光罩：中間一塊鉻（不透光），兩側是透明玻璃
      ctx.strokeStyle = 'rgba(190, 226, 240, 0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, 7);
      ctx.fillStyle = CHROME_COLOR;
      ctx.fillRect(cL, y, cR - cL, 7);
      ctx.strokeStyle = 'rgba(190, 226, 240, 0.8)';
      ctx.strokeRect(cL, y, cR - cL, 7);

      // UV 只從鉻的兩側穿過去
      ctx.strokeStyle = '#c49eff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [a, b] of [
        [x, cL],
        [cR, x + w],
      ]) {
        for (let i = 0; i < 2; i++) {
          const lx = a + ((i + 0.5) / 2) * (b - a);
          ctx.moveTo(lx, y + 10);
          ctx.lineTo(lx, resistTop - 2);
        }
      }
      ctx.stroke();

      // 整片光阻，兩側被光照到的部分標成亮色
      ctx.fillStyle = RESIST_COLOR;
      ctx.fillRect(x, resistTop, w, resistH);
      ctx.fillStyle = positive ? 'rgba(216, 232, 138, 0.9)' : 'rgba(94, 233, 150, 0.6)';
      ctx.fillRect(x, resistTop, cL - x, resistH);
      ctx.fillRect(cR, resistTop, x + w - cR, resistH);
    } else {
      // 顯影後：正光阻留中間（鉻下方），負光阻留兩側（曝光區）
      ctx.fillStyle = RESIST_COLOR;
      if (positive) {
        ctx.fillRect(cL, resistTop, cR - cL, resistH);
      } else {
        ctx.fillRect(x, resistTop, cL - x, resistH);
        ctx.fillRect(cR, resistTop, x + w - cR, resistH);
      }
    }

    ctx.restore();
  }

  // ───────────────── 子步驟 4：光罩對位 → 曝光 → 烘烤 ──────────────────────

  private frameExpose(frame: StageFrame, groundY: number): void {
    const { ui, desk, dt, time, hand } = frame;
    const ctx = desk.context;
    const scene = this.sceneBounds(frame);

    // 曝光機的內部（光罩 / UV 燈管 / 晶圓台）疊得很密，長寬比一失控就會互撞，
    // 所以 maxAspect 訂得比腔體更嚴。
    const geo: AlignerGeometry = machineBox({
      scene,
      widthRatio: 0.98,
      ratio: 0.72,
      groundY,
      bandTop: frame.ui.sceneOverlay().top + 8,
      gap: 16,
      min: 220,
      max: 440,
      maxAspect: 2.1,
    });
    const L = alignerLayout(geo);

    const maskCenter = {
      x: L.maskHome.x + this.maskOffset.x,
      y: L.maskHome.y + this.maskOffset.y,
    };
    const overMask =
      hand.present &&
      Math.abs(hand.pinchPoint.x - maskCenter.x) < L.mask.w / 2 + 10 &&
      Math.abs(hand.pinchPoint.y - maskCenter.y) < L.mask.h / 2 + 10;

    // ── 拖曳光罩 ──
    if (this.phase === 'align') {
      if (hand.present && hand.justPinched && overMask && !this.draggingMask) {
        this.draggingMask = true;
        this.dragFrom = {
          hand: { ...hand.pinchPoint },
          offset: { ...this.maskOffset },
        };
      }
      if (this.draggingMask) {
        if (hand.present && hand.pinching) {
          // 相對位移，避免一抓就跳位
          this.maskOffset = {
            x: clamp(this.dragFrom.offset.x + (hand.pinchPoint.x - this.dragFrom.hand.x), -220, 220),
            y: clamp(this.dragFrom.offset.y + (hand.pinchPoint.y - this.dragFrom.hand.y), -90, 90),
          };
        } else {
          this.draggingMask = false;
        }
      }
    }

    const aligned = Math.hypot(this.maskOffset.x, this.maskOffset.y) <= ALIGN_TOLERANCE;
    const buttonLive = this.phase === 'align' && aligned;

    // 大按鈕
    if (hand.present && hand.justPinched && buttonLive && pointInCircle(hand.pinchPoint, L.button, 14)) {
      this.startExposure();
    }

    // ── 推進 ──
    if (this.phase === 'expose') {
      this.exposeT = Math.min(1, this.exposeT + dt * 0.55);
      if (this.exposeT >= 1) {
        this.writeExposedMask();
        this.phase = 'bake';
        this.timer = 0;
      }
    } else if (this.phase === 'bake') {
      this.bakeT = Math.min(1, this.bakeT + dt * 0.5);
      if (this.bakeT >= 1) {
        this.phase = 'done';
        this.nextSub();
        return;
      }
    }

    drawAligner(
      ctx,
      geo,
      L,
      {
        phase: this.phase === 'align' ? 'align' : this.phase === 'expose' ? 'expose' : 'bake',
        offset: this.maskOffset,
        aligned,
        exposeT: this.exposeT,
        bakeT: this.bakeT,
        pattern: desk.getPatternCanvas(),
        waferColor: this.ctx.wafer.surfaceColor(),
        resistColor: RESIST_COLOR,
        tone: this.tone,
        buttonLive,
        hot: {
          mask: overMask || this.draggingMask,
          button: hand.present && pointInCircle(hand.pinchPoint, L.button, 14),
        },
        dragging: this.draggingMask,
      },
      time,
    );

    // ── 提示 ──
    if (this.phase === 'align') {
      const d = Math.hypot(this.maskOffset.x, this.maskOffset.y);
      ui.setArHint(
        aligned
          ? '🎯 已對準 — 按下曝光機上的大按鈕開始曝光'
          : this.draggingMask
            ? `🤏 拖曳中 — 讓兩組十字記號重合（偏移 ${d.toFixed(0)} µm）`
            : '🤏 捏住光罩，把它拖到晶圓正上方對準',
        aligned || this.draggingMask,
      );
      ui.setHandState(
        this.draggingMask ? '🤏' : aligned ? '🎯' : '✋',
        this.draggingMask ? '拖曳光罩' : aligned ? '已對準' : '（空手）',
        `偏移 ${d.toFixed(0)} µm / 容差 ${ALIGN_TOLERANCE}`,
        aligned || this.draggingMask,
      );
    } else if (this.phase === 'expose') {
      ui.setArHint('☀️ UV 曝光中 — 光只從沒有鉻的地方穿過去', true);
      ui.setHandState('☀️', '曝光中', `UV ${Math.round(this.exposeT * 100)}%`, true);
    } else {
      ui.setArHint('🔥 曝光後烘烤中 — 讓光化學反應完全進行', true);
      ui.setHandState('🔥', '烘烤中', `PEB ${Math.round(this.bakeT * 100)}%`, true);
    }
  }

  private startExposure(): void {
    this.phase = 'expose';
    this.exposeT = 0;
    this.timer = 0;
    this.draggingMask = false;
  }

  /**
   * 把光罩圖案換算成 WaferState.exposedMask。
   *
   * 取晶圓中心那一條水平帶做取樣：**有鉻的地方擋住光 → 沒被曝光**，
   * 所以 exposedMask = 1 是「沒畫到」的地方。第四關的顯影會用它決定哪裡的
   * 光阻被溶掉。
   */
  private writeExposedMask(): void {
    const pattern = this.ctx.desk.getPatternCanvas();
    const size = pattern.width;
    const strip = document.createElement('canvas');
    strip.width = SECTION_CELLS;
    strip.height = 1;
    const c = strip.getContext('2d');
    if (!c) return;

    // 從圖案中央取一條帶狀區域壓成一列
    c.drawImage(pattern, 0, size / 2 - size * 0.04, size, size * 0.08, 0, 0, SECTION_CELLS, 1);
    const data = c.getImageData(0, 0, SECTION_CELLS, 1).data;

    const wafer = this.ctx.wafer;
    for (let i = 0; i < SECTION_CELLS; i++) {
      const chrome = data[i * 4 + 3] > 40;
      wafer.exposedMask[i] = chrome ? 0 : 1;
    }
    wafer.resistTone = this.tone;
  }

  // ─────────────────────────────── 共用繪圖 ────────────────────────────────

  /** 俯視的晶圓（正圓）。設計圖案時就該從正上方看。 */
  private drawTopWafer(
    ctx: CanvasRenderingContext2D,
    w: { cx: number; cy: number; r: number },
    time: number,
    spin: number,
  ): void {
    ctx.save();
    ctx.translate(w.cx, w.cy);
    if (spin) ctx.rotate(spin);

    // 載盤陰影
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.arc(0, 6, w.r * 1.06, 0, Math.PI * 2);
    ctx.fill();

    const g = ctx.createRadialGradient(-w.r * 0.35, -w.r * 0.35, w.r * 0.08, 0, 0, w.r);
    g.addColorStop(0, '#f2f6f8');
    g.addColorStop(0.55, this.ctx.wafer.surfaceColor());
    g.addColorStop(1, '#8d9ea6');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, w.r, 0, Math.PI * 2);
    ctx.fill();

    // 定位平邊
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, w.r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#28313a';
    ctx.fillRect(-w.r, w.r * 0.9, w.r * 2, w.r * 0.2);
    ctx.restore();

    ctx.strokeStyle = 'rgba(240,248,250,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, w.r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
    void time;
  }

  /** 旋轉塗佈完成後、厚度均勻的整片光阻膜。 */
  private drawResistFilm(
    ctx: CanvasRenderingContext2D,
    w: { cx: number; cy: number; r: number },
  ): void {
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = RESIST_COLOR;
    ctx.beginPath();
    ctx.arc(w.cx, w.cy, w.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * 光阻噴嘴。**整關只滴一滴**——真實的旋轉塗佈就是在晶圓中心滴一滴，
   * 剩下全靠塗抹與離心力鋪開，一直滴反而會厚薄不均。
   * 滴完之後噴嘴就退到旁邊待命。
   */
  private drawNozzle(
    ctx: CanvasRenderingContext2D,
    w: { cx: number; cy: number; r: number },
    time: number,
  ): void {
    if (this.phase !== 'spread') return;

    const nozzleW = Math.max(26, w.r * 0.16);
    const nozzleH = nozzleW * 1.9;
    const x = w.cx;
    const top = w.cy - w.r - nozzleH - 34;

    ctx.save();

    // 噴嘴本體
    ctx.fillStyle = '#5a666e';
    roundRect(ctx, x - nozzleW / 2, top, nozzleW, nozzleH, 5);
    ctx.fill();
    ctx.strokeStyle = '#2a3238';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#8b99a2';
    roundRect(ctx, x - nozzleW * 0.16, top + nozzleH, nozzleW * 0.32, nozzleH * 0.34, 2);
    ctx.fill();

    // 那一滴：從噴嘴口落到晶圓中心。還沒捏合前不畫，落到中心後也不畫。
    if (this.dropT > 0 && this.dropT < 1) {
      const startY = top + nozzleH * 1.34;
      const endY = w.cy;
      const t = easeIn(this.dropT);
      const dy = startY + (endY - startY) * t;
      const rr = Math.max(7, w.r * 0.07);

      ctx.fillStyle = RESIST_COLOR;
      ctx.beginPath();
      // 下落時被拉長成水滴狀
      ctx.ellipse(x, dy, rr * (1 - t * 0.2), rr * (1 + t * 0.45), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(212, 230, 238, 0.9)';
    ctx.font = "700 15px 'IBM Plex Sans', 'Noto Sans TC', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(
      this.dropT === 0 ? '光阻噴嘴 · 待命' : this.dropT < 1 ? '滴入光阻…' : '已滴入 1 滴',
      x,
      top - 8,
    );
    ctx.restore();

    void time;
  }

  /** 晶圓外圈的進度環，兼作「還差多少」的視覺回饋。 */
  private drawCoverageRing(
    ctx: CanvasRenderingContext2D,
    w: { cx: number; cy: number; r: number },
    value: number,
    target: number,
    label: string,
  ): void {
    const r = w.r + 16;
    const done = value >= target;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(w.cx, w.cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = done ? '#5ee9df' : '#5ee996';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(w.cx, w.cy, r, -Math.PI / 2, -Math.PI / 2 + Math.min(1, value / target) * Math.PI * 2);
    ctx.stroke();

    ctx.font = "700 17px 'IBM Plex Sans', 'Noto Sans TC', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(8,14,18,0.9)';
    const text = `${label} ${Math.round(Math.min(1, value / target) * 100)}%`;
    ctx.strokeText(text, w.cx, w.cy + r + 12);
    ctx.fillStyle = done ? '#5ee9df' : '#e8f2f6';
    ctx.fillText(text, w.cx, w.cy + r + 12);
    ctx.restore();
  }

  // ───────────────────────────── 互動面板 ─────────────────────────────────

  private buildPanel(): PanelSpec | null {
    const sub = this.currentSub;
    if (!sub) return null;

    switch (this.phase) {
      case 'spread':
        return {
          kind: 'action',
          title: '第一步 · 光阻劑塗抹',
          note: '在晶圓正中心滴一滴光阻就好。\n光阻不是用抹的 —— 滴完之後晶圓高速旋轉，靠離心力把它鋪成厚度均勻的薄膜，轉速決定膜厚。用手抹反而會厚薄不均。',
          label: this.dropT > 0 ? '滴落中…' : '滴一滴光阻',
          enabled: this.dropT === 0,
          onClick: () => {
            this.dropT = 0.001;
          },
        };

      case 'spin':
        return {
          kind: 'action',
          title: '第一步 · 光阻劑塗抹',
          note: '旋轉塗佈中。中心那一攤光阻正被離心力往外鋪開，轉速決定膜厚——轉得越快，甩得越薄。',
          label: '旋轉塗佈中…',
          enabled: false,
          onClick: () => {},
        };

      case 'draw': {
        const ok = this.patternCoverage >= PATTERN_MIN;
        return {
          kind: 'action',
          title: '第二步 · 圖案設計',
          note: '你畫的是光罩上的**鉻層**。鉻不透光，所以畫到的地方在曝光時會擋住 UV，沒畫到的地方才會被照到。',
          label: ok ? '完成繪製' : '再畫多一點',
          enabled: ok,
          onClick: () => {
            if (this.drawing) {
              this.ctx.desk.endStroke();
              this.drawing = false;
            }
            this.nextSub();
          },
        };
      }

      case 'tone':
        return {
          kind: 'choice',
          title: '第三步 · 正負光阻選擇',
          note: '把手移到卡片上捏一下即可選擇。你畫的圖案就是光罩上那塊鉻，它會擋住 UV。\n正光阻：曝光區（鉻的兩側）斷鏈變可溶被洗掉，鉻下方的光阻留著保護 → 你畫的圖案最後**凸起**。\n負光阻：曝光區交聯硬化留下，鉻下方的光阻反而被洗掉 → 你畫的圖案最後**凹陷**。',
          options: [
            { id: 'positive', label: '正型光阻', sub: 'POSITIVE', color: '#d8e88a' },
            { id: 'negative', label: '負型光阻', sub: 'NEGATIVE', color: '#5ee996' },
          ],
          selected: [],
          max: 1,
          confirmLabel: '（用手捏卡片選擇）',
          confirmEnabled: false,
          onToggle: (id) => {
            this.tone = id as 'positive' | 'negative';
            this.ctx.wafer.resistTone = this.tone;
            this.nextSub();
          },
          onConfirm: () => {},
        };

      case 'align': {
        const d = Math.hypot(this.maskOffset.x, this.maskOffset.y);
        const aligned = d <= ALIGN_TOLERANCE;
        return {
          kind: 'action',
          title: '第四步 · 曝光與烘烤',
          note: `捏住光罩把它拖到晶圓正上方，兩組十字記號重合到 ${ALIGN_TOLERANCE} µm 以內，曝光按鈕才會亮起。對不準，圖案就會偏掉。`,
          label: aligned ? '直接曝光' : `尚未對準（偏移 ${d.toFixed(0)} µm）`,
          enabled: aligned,
          onClick: () => this.startExposure(),
        };
      }

      case 'expose':
        return {
          kind: 'action',
          title: '第四步 · 曝光與烘烤',
          note: 'UV 光穿過光罩沒有鉻的地方，照到下方的光阻並引發光化學反應。',
          label: '曝光中…',
          enabled: false,
          onClick: () => {},
        };

      default:
        return {
          kind: 'action',
          title: '第四步 · 曝光與烘烤',
          note: '曝光後烘烤（PEB）：讓光酸擴散、反應完全，圖案邊緣才會銳利。',
          label: '烘烤中…',
          enabled: false,
          onClick: () => {},
        };
    }
  }

  // ─────────────────────────────── 過關判定 ────────────────────────────────

  override canComplete(): boolean {
    return this.subsFinished && this.ctx?.wafer.hasLayer('resist') === true;
  }

  /**
   * 強制完成：補上光阻層，並把目前畫布上的圖案轉成曝光遮罩。
   * 什麼都沒畫時給一組條紋，第四關的顯影才看得出圖案。
   */
  override devComplete(): void {
    this.applyResistLayer();
    const wafer = this.ctx.wafer;
    if (this.ctx.desk.coverage() > 0) {
      this.writeExposedMask();
    } else {
      for (let i = 0; i < SECTION_CELLS; i++) {
        wafer.exposedMask[i] = Math.floor(i / 3) % 2 === 0 ? 1 : 0;
      }
    }
    wafer.resistTone = this.tone;
  }

  override buildResult(): StageResult {
    return {
      tone: this.tone,
      patternCoverage: this.ctx.desk.coverage(),
      patternDataURL: this.ctx.desk.getPatternDataURL(),
    };
  }
}

// ───────────────────────────────── 小工具 ──────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 重力加速感：一開始慢、越掉越快。 */
function easeIn(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
