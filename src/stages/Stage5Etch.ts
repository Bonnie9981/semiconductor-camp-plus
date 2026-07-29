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
  type ChamberLayout,
} from '../scene/Chamber';
import { DepositionField, type FieldConfig } from '../scene/Particles';
import { DipStageBase, type DipRound } from './DipStageBase';

/**
 * 第五關：蝕刻
 * ---------------------------------------------------------------------------
 * 三個子步驟：
 *
 *   1. 氧氣電漿清潔  把晶圓送進電漿腔，用 O₂ 電漿掃掉殘留的光阻渣（descum），
 *                    確保要蝕刻的材料完全裸露
 *   2. 蝕刻選擇      把晶圓拖進「電漿腔」＝乾式，拖進「藥液槽」＝濕式。
 *                    放進哪一邊就是選了哪一種，不是按選項按鈕
 *   3. 去光阻與清洗  拖進正確的剝離液，再以去離子水沖洗
 *
 * 乾式 vs 濕式的差別做在結果上，不只是動畫：
 *   乾式 → 高能離子鉛直轟擊，非等向性，側壁筆直（undercut = 0）
 *   濕式 → 化學反應等向性進行，會往光阻底下橫向咬（undercut = 1）
 * 兩者在右下角的截面圖上長得完全不一樣。
 */

type Phase =
  /** descum：把晶圓放進電漿腔 */
  | 'descum-load'
  /** descum：關門 */
  | 'descum-seal'
  /** descum：抽真空 */
  | 'descum-pump'
  /** descum：等按鈕 */
  | 'descum-ready'
  /** descum：電漿掃描中 */
  | 'descum-run'
  /** 選蝕刻方式：拖到乾式或濕式站 */
  | 'choose'
  /** 乾式蝕刻的機台流程 */
  | 'dry-seal'
  | 'dry-pump'
  | 'dry-ready'
  | 'dry-run'
  /** 濕式蝕刻：拖進正確的蝕刻液 */
  | 'wet'
  /** 去光阻 */
  | 'strip'
  | 'done';

const RESIST_COLOR = '#2f7d5b';

export class Stage5Etch extends DipStageBase {
  readonly id = 'etching';
  readonly title = '蝕刻';
  readonly shortTitle = '蝕刻';
  readonly description =
    '先以氧氣電漿清掉光阻殘渣，再用乾式或濕式蝕刻把沒有光阻保護的材料移除，最後剝除光阻。';
  readonly hint = '把晶圓拖進電漿腔＝乾式蝕刻，拖進藥液槽＝濕式蝕刻。兩者的側壁形狀完全不同。';
  readonly primaryLabel = '完成蝕刻';
  readonly usesCrossSection = true;

  readonly substeps: readonly SubStep[] = [
    { id: 'descum', title: '氧氣電漿清潔', desc: 'O₂ 電漿掃掉光阻殘渣，讓目標材料完全裸露' },
    { id: 'etch', title: '蝕刻選擇', desc: '乾式＝鉛直蝕刻；濕式＝側向蝕刻' },
    { id: 'strip', title: '去光阻與清洗', desc: 'NMP 剝除光阻，再以去離子水沖洗' },
  ];

  readonly instructions: InstructionStep[] = [
    { glyph: '🤏', title: '把晶圓放進機台', desc: '捏起晶圓拖到腔體中央的虛線圈上放開。' },
    { glyph: '🚪', title: '關門、按大按鈕', desc: '拖門把關閉腔門，抽完真空後按下綠色圓鈕。' },
    { glyph: '⚖️', title: '選乾式或濕式', desc: '拖進電漿腔＝乾式；拖進藥液槽＝濕式。結果不一樣。' },
    { glyph: '🔍', title: '比較側壁形狀', desc: '乾式側壁筆直；濕式會往光阻底下橫向咬出凹陷。' },
  ];

  // ── 流程 ──
  private phase: Phase = 'descum-load';
  private method: 'dry' | 'wet' | null = null;
  private timer = 0;

  // ── 機台狀態（descum 與乾蝕刻共用） ──
  private door = 1;
  private vacuum = 0;
  private progress = 0;
  private running = false;
  private grab: 'wafer' | 'door' | null = null;
  private heldWafer: Point | null = null;
  private waferInside = false;

  private readonly field = new DepositionField();

  // ─────────────────────────────── 生命週期 ────────────────────────────────

  override onEnter(ctx: StageContext): void {
    super.onEnter(ctx);
    ctx.desk.setWaferVisible(false);
    ctx.desk.setDeskLabel('ETCH BAY · 蝕刻區');
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
    const w = this.ctx?.wafer;
    if (w) {
      w.etchedMask = w.etchedMask.map(() => 0);
      w.undercut = 0;
      if (!w.hasLayer('resist')) {
        w.addLayer({
          kind: 'resist',
          label: '光阻層',
          thickness: 0.45,
          color: RESIST_COLOR,
          patterned: true,
        });
      }
    }
    this.onSubEnter(0);
  }

  protected override onSubEnter(index: number): void {
    this.resetMachine();
    this.resetDip();

    const sub = this.substeps[index];
    if (!sub) {
      this.phase = 'done';
      this.ctx?.ui.setPanel(null);
      return;
    }
    if (sub.id === 'descum') this.phase = 'descum-load';
    else if (sub.id === 'etch') this.phase = 'choose';
    else this.phase = 'strip';
  }

  private resetMachine(): void {
    this.door = 1;
    this.vacuum = 0;
    this.progress = 0;
    this.running = false;
    this.grab = null;
    this.heldWafer = null;
    this.waferInside = false;
    this.timer = 0;
    this.field.reset();
  }

  // ───────────────────────────────── 主迴圈 ────────────────────────────────

  override onFrame(frame: StageFrame): void {
    const { desk, ui, dt } = frame;
    this.timer += dt;
    const { deskTop, deskHeight } = desk.geometry;
    const groundY = deskTop + deskHeight * 0.44;

    if (this.phase === 'done' || !this.currentSub) {
      ui.setArHint('✅ 蝕刻完成 — 按右側「完成蝕刻」結束整條製程', true);
      ui.setHandState('✨', '圖案已刻出', 'ETCH COMPLETE', true);
      this.ctx.ui.setPanel(null);
      return;
    }

    if (this.phase === 'choose') this.frameChoose(frame, groundY);
    else if (this.phase === 'wet') this.frameWet(frame, groundY);
    else if (this.phase === 'strip') this.frameStrip(frame, groundY);
    else this.frameMachine(frame, groundY);

    this.ctx.ui.setPanel(this.buildPanel());
  }

  // ───────────────── descum 與乾式蝕刻：同一套機台流程 ──────────────────────

  private isDry(): boolean {
    return this.phase.startsWith('dry');
  }

  private frameMachine(frame: StageFrame, groundY: number): void {
    const { ui, desk, dt, time, hand } = frame;
    const ctx = desk.context;
    const { height } = desk.size;
    const wafer = this.ctx.wafer;
    const scene = this.sceneBounds(frame);
    const dry = this.isDry();

    const cw = scene.w * 0.98;
    const ch = clamp(Math.min(cw * 0.72, groundY - height * 0.19), 200, 430);
    const geo: ChamberGeometry = {
      x: scene.left + (scene.w - cw) / 2,
      y: groundY - 16 - ch,
      w: cw,
      h: ch,
    };
    const layout = chamberLayout(geo, 'cvd');
    const waferR = layout.wafer.r * 0.9;
    const rest: Point = {
      x: clamp(geo.x - 10, scene.left + waferR + 10, geo.x + 40),
      y: groundY + waferR * WAFER_SQUASH + 20,
    };

    this.updateMachineInput(hand, layout, rest, waferR);
    this.advanceMachine(dt);

    drawChamber(
      ctx,
      geo,
      layout,
      {
        kind: 'cvd',
        door: this.door,
        vacuum: this.vacuum,
        power: 1,
        valves: [1, 1],
        running: this.running,
        thickness: this.progress,
        waferInside: this.waferInside,
        waferColor: wafer.surfaceColor(),
        filmColor: null,
        baseFilmColor: RESIST_COLOR,
        title: dry ? '乾式蝕刻腔體' : 'O₂ 電漿清潔腔',
        subtitle: dry ? '非等向性 · 鉛直蝕刻' : 'DESCUM · 去除光阻殘渣',
        compact: false,
        seatHot: this.grab === 'wafer' && this.overSeat(layout),
        hot: {
          door: this.grab === 'door' || this.nearDoor(hand, layout),
          button: hand.present && pointInCircle(hand.pinchPoint, layout.button, 16),
        },
        buttonLive: this.buttonLive(),
        powerWindow: [0, 1],
        valveWindows: [
          [0, 1],
          [0, 1],
        ],
      },
      time,
    );

    // 粒子：descum 是柔性的擴散電漿，乾蝕刻是鉛直的離子轟擊
    if (this.running && this.door < 0.02) {
      const cfg = this.fieldConfig(layout, dry);
      this.field.update(dt, cfg);
      ctx.save();
      ctx.beginPath();
      ctx.rect(layout.interior.x, layout.interior.y, layout.interior.w, layout.interior.h);
      ctx.clip();
      this.field.render(ctx, cfg, dry ? '#b6e2ff' : '#a9f0c4');
      ctx.restore();
    }

    // 還沒放進去的晶圓
    if (!this.waferInside) {
      const p = this.heldWafer ?? rest;
      drawFlatWafer(ctx, p, waferR, wafer.surfaceColor(), true);
      if (!this.heldWafer) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 3);
        ctx.save();
        ctx.globalAlpha = 0.2 + pulse * 0.35;
        ctx.strokeStyle = '#2ecfc7';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, waferR + 9, waferR * WAFER_SQUASH + 8, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    this.machineHints(ui, hand, dry);
  }

  private fieldConfig(layout: ChamberLayout, dry: boolean): FieldConfig {
    const it = layout.interior;
    const w = layout.wafer;
    return {
      mode: dry ? 'ballistic' : 'diffusive',
      rate: 1,
      sourceY: layout.sourceY + 4,
      landY: w.cy - w.r * WAFER_SQUASH * 0.35,
      left: it.x + 8,
      right: it.x + it.w - 8,
      targetLeft: w.cx - w.r,
      targetRight: w.cx + w.r,
    };
  }

  private overSeat(layout: ChamberLayout): boolean {
    const p = this.heldWafer;
    return p !== null && pointInCircle(p, { ...layout.wafer, r: layout.wafer.r * 0.8 }, 18);
  }

  private nearDoor(hand: StageFrame['hand'], layout: ChamberLayout): boolean {
    if (!hand.present || !this.phase.endsWith('seal')) return false;
    const hx = lerp(layout.doorTrack.openX, layout.doorTrack.closedX, 1 - this.door);
    return dist(hand.pinchPoint, { x: hx, y: layout.doorHandle.cy }) < layout.doorHandle.r + 20;
  }

  private buttonLive(): boolean {
    return this.phase === 'descum-ready' || this.phase === 'dry-ready';
  }

  private updateMachineInput(
    hand: StageFrame['hand'],
    layout: ChamberLayout,
    rest: Point,
    waferR: number,
  ): void {
    if (!hand.present) {
      this.grab = null;
      return;
    }
    const p = hand.pinchPoint;

    // 放入晶圓
    if (!this.waferInside) {
      if (hand.pinching && this.grab === null) {
        const anchor = this.heldWafer ?? rest;
        if (dist(p, anchor) < waferR + 40) {
          this.grab = 'wafer';
          this.heldWafer = { ...p };
        }
      }
      if (this.grab === 'wafer') {
        if (hand.pinching) {
          this.heldWafer = { ...p };
        } else {
          this.grab = null;
          if (this.overSeat(layout)) {
            this.waferInside = true;
            this.phase = this.phase.startsWith('dry') ? 'dry-seal' : 'descum-seal';
          }
          this.heldWafer = null;
        }
      }
      return;
    }

    // 關腔門
    if (this.phase.endsWith('seal')) {
      if (hand.justPinched && this.grab === null && this.nearDoor(hand, layout)) this.grab = 'door';
      if (this.grab === 'door') {
        if (hand.pinching) {
          const t = layout.doorTrack;
          this.door = clamp((p.x - t.closedX) / (t.openX - t.closedX), 0, 1);
        } else {
          this.grab = null;
        }
      }
    }

    // 大按鈕
    if (hand.justPinched && this.buttonLive() && pointInCircle(p, layout.button, 16)) {
      this.startRun();
    }
  }

  private startRun(): void {
    this.running = true;
    this.progress = 0;
    this.phase = this.phase.startsWith('dry') ? 'dry-run' : 'descum-run';
  }

  private advanceMachine(dt: number): void {
    const dry = this.isDry();

    if (this.phase.endsWith('seal') && this.door < 0.02) {
      this.door = 0;
      this.phase = dry ? 'dry-pump' : 'descum-pump';
      return;
    }
    if (this.phase.endsWith('pump')) {
      this.vacuum = Math.min(1, this.vacuum + dt * 0.6);
      if (this.vacuum >= 1) this.phase = dry ? 'dry-ready' : 'descum-ready';
      return;
    }
    if (this.phase.endsWith('run')) {
      this.progress = Math.min(1, this.progress + dt * (dry ? 0.24 : 0.34));
      if (this.progress >= 1) {
        this.running = false;
        this.field.reset();
        if (dry) {
          this.ctx.wafer.etch(0);
          this.method = 'dry';
        }
        this.nextSub();
      }
    }
  }

  private machineHints(ui: StageFrame['ui'], hand: StageFrame['hand'], dry: boolean): void {
    if (!this.waferInside) {
      ui.setArHint(
        this.grab === 'wafer'
          ? '🤏 夾著晶圓 — 放到腔體中央的虛線圈上'
          : '🤏 捏合夾起晶圓，放進腔體',
        this.grab === 'wafer',
      );
      ui.setHandState(this.grab === 'wafer' ? '🤏' : '✋', this.grab === 'wafer' ? '夾著晶圓' : '（空手）', 'LOADING', this.grab === 'wafer');
    } else if (this.phase.endsWith('seal')) {
      ui.setArHint('🚪 捏住腔門把手往左拖到底', this.grab === 'door');
      ui.setHandState('🚪', '關閉腔門', `DOOR ${Math.round((1 - this.door) * 100)}%`, this.grab === 'door');
    } else if (this.phase.endsWith('pump')) {
      ui.setArHint(`🌀 抽真空中… ${Math.round(this.vacuum * 100)}%`, true);
      ui.setHandState('🌀', '抽真空中', `VACUUM ${Math.round(this.vacuum * 100)}%`, true);
    } else if (this.phase.endsWith('ready')) {
      ui.setArHint(
        dry ? '🟢 按下大按鈕開始鉛直離子轟擊' : '🟢 按下大按鈕點燃 O₂ 電漿',
        true,
      );
      ui.setHandState('🟢', '待機中', 'READY', true);
    } else {
      ui.setArHint(
        dry
          ? `⬇️ 高能離子鉛直轟擊中 — ${Math.round(this.progress * 100)}%`
          : `🟣 O₂ 電漿掃除光阻殘渣 — ${Math.round(this.progress * 100)}%`,
        true,
      );
      ui.setHandState(dry ? '⬇️' : '🟣', dry ? '乾式蝕刻中' : '電漿清潔中', `${Math.round(this.progress * 100)}%`, true);
    }
    void hand;
  }

  // ──────────────────── 蝕刻選擇：拖到乾式站或濕式站 ────────────────────────

  private frameChoose(frame: StageFrame, groundY: number): void {
    const { ui, desk, time, hand } = frame;
    const ctx = desk.context;
    const { height } = desk.size;
    const wafer = this.ctx.wafer;
    const scene = this.sceneBounds(frame);

    const gap = Math.max(16, scene.w * 0.05);
    const cw = (scene.w - gap) / 2;
    const chH = Math.min(cw * 0.86, groundY - height * 0.22);
    const top = groundY - 30 - chH;

    const stations: { id: 'dry' | 'wet'; x: number; title: string; sub: string; color: string }[] = [
      { id: 'dry', x: scene.left, title: '乾式蝕刻', sub: '電漿腔 · 鉛直蝕刻', color: '#8ae0ff' },
      { id: 'wet', x: scene.left + cw + gap, title: '濕式蝕刻', sub: '藥液槽 · 側向蝕刻', color: '#ffd68a' },
    ];

    const waferR = Math.min(cw * 0.15, 44);
    const rest: Point = { x: scene.left + scene.w / 2, y: groundY + waferR * WAFER_SQUASH + 26 };

    // 抓取與放置
    if (hand.present && hand.pinching && this.grab === null) {
      const anchor = this.heldWafer ?? rest;
      if (dist(hand.pinchPoint, anchor) < waferR + 40) {
        this.grab = 'wafer';
        this.heldWafer = { ...hand.pinchPoint };
      }
    }
    let hoverIdx = -1;
    if (this.grab === 'wafer') {
      if (hand.present && hand.pinching) {
        this.heldWafer = { ...hand.pinchPoint };
      } else {
        const p = this.heldWafer;
        this.grab = null;
        this.heldWafer = null;
        if (p) {
          const idx = stations.findIndex(
            (st) => p.x >= st.x && p.x <= st.x + cw && p.y >= top && p.y <= top + chH,
          );
          if (idx >= 0) {
            this.method = stations[idx].id;
            this.phase = stations[idx].id === 'dry' ? 'dry-seal' : 'wet';
            this.resetMachine();
            this.resetDip();
            if (stations[idx].id === 'dry') this.waferInside = true;
            return;
          }
        }
      }
    }
    if (this.heldWafer) {
      const p = this.heldWafer;
      hoverIdx = stations.findIndex(
        (st) => p.x >= st.x && p.x <= st.x + cw && p.y >= top && p.y <= top + chH,
      );
    }

    // 兩個站的示意卡
    stations.forEach((st, i) => {
      this.drawStation(ctx, st, st.x, top, cw, chH, hoverIdx === i, time);
    });

    const p = this.heldWafer ?? rest;
    drawFlatWafer(ctx, p, waferR, wafer.surfaceColor(), this.heldWafer !== null);

    if (hoverIdx >= 0) {
      ui.setArHint(`✅ 放開手指，選擇「${stations[hoverIdx].title}」`, true);
      ui.setHandState('🤏', '夾著晶圓', stations[hoverIdx].title, true);
    } else if (this.heldWafer) {
      ui.setArHint('🤏 夾著晶圓 — 拖到左邊的電漿腔或右邊的藥液槽', true);
      ui.setHandState('🤏', '夾著晶圓', 'CARRYING', true);
    } else {
      ui.setArHint('🤏 捏起晶圓，決定要用乾式還是濕式蝕刻');
      ui.setHandState('✋', '（空手）', 'SELECT ETCH TYPE', false);
    }
  }

  /** 蝕刻方式的說明卡，含側壁形狀的剖面示意圖。 */
  private drawStation(
    ctx: CanvasRenderingContext2D,
    st: { id: 'dry' | 'wet'; title: string; sub: string; color: string },
    x: number,
    y: number,
    w: number,
    h: number,
    hot: boolean,
    time: number,
  ): void {
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

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = hot ? '#5ee9df' : st.color;
    ctx.font = `700 ${Math.round(clamp(w * 0.11, 19, 30))}px 'IBM Plex Sans', 'Noto Sans TC', sans-serif`;
    ctx.fillText(st.title, x + w / 2, y + 16);
    ctx.fillStyle = 'rgba(184, 204, 214, 0.85)';
    ctx.font = `600 ${Math.round(clamp(w * 0.055, 12, 15))}px 'IBM Plex Sans', 'Noto Sans TC', sans-serif`;
    ctx.fillText(st.sub, x + w / 2, y + 16 + clamp(w * 0.11, 19, 30) + 6);

    // 剖面示意：側壁形狀才是兩者真正的差別
    const dx = x + w * 0.16;
    const dw = w * 0.68;
    const dy = y + h * 0.46;
    const dh = h * 0.26;
    this.drawSidewall(ctx, dx, dy, dw, dh, st.id === 'wet');

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(214, 230, 238, 0.92)';
    ctx.font = `600 ${Math.round(clamp(w * 0.055, 12, 15))}px 'IBM Plex Sans', 'Noto Sans TC', sans-serif`;
    ctx.fillText(
      st.id === 'dry' ? '側壁筆直，線寬精準' : '會往光阻底下咬（undercut）',
      x + w / 2,
      y + h - 16,
    );
    ctx.restore();
  }

  private drawSidewall(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    undercut: boolean,
  ): void {
    const gapL = x + w * 0.36;
    const gapR = x + w * 0.64;
    const resistH = h * 0.3;

    ctx.save();
    // 基材
    ctx.fillStyle = '#6d7d86';
    ctx.fillRect(x, y + resistH, w, h - resistH);

    // 蝕出來的溝槽
    ctx.fillStyle = '#0f1418';
    if (undercut) {
      // 等向性：往兩側咬進光阻底下
      ctx.beginPath();
      ctx.moveTo(gapL, y + resistH);
      ctx.bezierCurveTo(
        gapL - w * 0.1, y + resistH + h * 0.2,
        gapL - w * 0.1, y + h,
        gapL + w * 0.04, y + h,
      );
      ctx.lineTo(gapR - w * 0.04, y + h);
      ctx.bezierCurveTo(
        gapR + w * 0.1, y + h,
        gapR + w * 0.1, y + resistH + h * 0.2,
        gapR, y + resistH,
      );
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(gapL, y + resistH, gapR - gapL, h - resistH);
    }

    // 光阻（兩側）
    ctx.fillStyle = RESIST_COLOR;
    ctx.fillRect(x, y, gapL - x, resistH);
    ctx.fillRect(gapR, y, x + w - gapR, resistH);

    ctx.restore();
  }

  // ─────────────────── 濕式蝕刻 / 去光阻：拖進正確的槽 ──────────────────────

  /**
   * 濕式蝕刻。這時候晶圓最上層是金屬鋁（PVD 直接鍍，CVD 也在氧化層上補鍍了一層），
   * 所以正解是鋁專用的 PAN 蝕刻液（磷酸 : 醋酸 : 硝酸 : 水 ≈ 80:15:3:2）。
   */
  private wetRound(): DipRound {
    return {
      tanks: [{ id: 'pan' }, { id: 'boe' }, { id: 'acetone' }, { id: 'di' }],
      answer: 'pan',
      seconds: 6,
      actionLabel: '蝕刻',
      wrongHint: (id) => {
        if (id === 'acetone') return '丙酮是有機溶劑，只溶得掉光阻，對金屬鋁完全沒有作用。';
        if (id === 'di') return '純水不會跟鋁反應，泡再久也蝕刻不動。';
        return 'BOE 是蝕刻二氧化矽用的，對金屬鋁無效。這片晶圓最上層是鋁，要用磷酸系的 PAN 蝕刻液。';
      },
    };
  }

  /**
   * 去光阻。業界標準是 NMP —— 它的閃點遠高於丙酮，可以加溫操作、殘留也少，
   * 早就取代了丙酮成為量產線的標準剝離液。丙酮雖然也剝得掉，但屬於早期做法。
   */
  private stripRound(): DipRound {
    return {
      tanks: [{ id: 'nmp' }, { id: 'acetone' }, { id: 'hf' }, { id: 'di' }],
      answer: 'nmp',
      seconds: 5,
      actionLabel: '去光阻',
      wrongHint: (id) => {
        if (id === 'acetone') return '丙酮確實剝得掉光阻，但閃點低、揮發快、容易留下殘渣，量產線已改用 NMP。';
        if (id === 'hf') return '氫氟酸會把你辛苦蝕出來的圖案連同下層材料一起吃掉。';
        return '純水洗不掉光阻，需要有機溶劑。';
      },
    };
  }

  private frameWet(frame: StageFrame, groundY: number): void {
    const wafer = this.ctx.wafer;
    const round = this.wetRound();
    const done = this.runDip(frame, groundY, round, {
      waferColor: wafer.surfaceColor(),
      filmColor: RESIST_COLOR,
    });
    if (done) {
      wafer.etch(1);
      this.method = 'wet';
      this.nextSub();
      return;
    }
    this.dipHints(frame, round);
  }

  private frameStrip(frame: StageFrame, groundY: number): void {
    const wafer = this.ctx.wafer;
    const round = this.stripRound();
    const done = this.runDip(frame, groundY, round, {
      waferColor: wafer.surfaceColor(),
      filmColor: RESIST_COLOR,
    });
    if (done) {
      wafer.removeLayer('resist');
      this.nextSub();
      return;
    }
    this.dipHints(frame, round);
  }

  // ───────────────────────────── 互動面板 ─────────────────────────────────

  private buildPanel(): PanelSpec | null {
    const sub = this.currentSub;
    if (!sub) return null;

    if (this.phase === 'choose') {
      return {
        kind: 'choice',
        title: '第二步 · 蝕刻選擇',
        note: '把晶圓拖進左邊的電漿腔＝乾式，拖進右邊的藥液槽＝濕式。\n乾式用高能離子鉛直轟擊，側壁筆直、線寬精準。\n濕式靠化學反應，方向性差，會往光阻底下橫向咬出凹陷。',
        options: [
          { id: 'dry', label: '乾式蝕刻', sub: '鉛直 · 非等向性', color: '#8ae0ff' },
          { id: 'wet', label: '濕式蝕刻', sub: '側向 · 等向性', color: '#ffd68a' },
        ],
        selected: [],
        max: 1,
        confirmLabel: '（用手把晶圓放進機台）',
        confirmEnabled: false,
        onToggle: (id) => {
          this.method = id as 'dry' | 'wet';
          this.resetMachine();
          this.resetDip();
          if (id === 'dry') {
            this.waferInside = true;
            this.phase = 'dry-seal';
          } else {
            this.phase = 'wet';
          }
        },
        onConfirm: () => {},
      };
    }

    if (this.phase === 'wet' || this.phase === 'strip') {
      const round = this.phase === 'wet' ? this.wetRound() : this.stripRound();
      if (this.dipIndex >= 0) {
        return {
          kind: 'action',
          title: this.phase === 'wet' ? '濕式蝕刻中' : '去光阻與清洗',
          note: '左右晃動手就是攪拌，能帶走反應產物、讓新鮮藥液接觸表面。',
          label: `${round.actionLabel}中… ${Math.round(this.reactT * 100)}%`,
          enabled: false,
          onClick: () => {},
        };
      }
      return {
        kind: 'action',
        title: this.phase === 'wet' ? '第二步 · 濕式蝕刻' : '第三步 · 去光阻與清洗',
        note:
          this.phase === 'wet'
            ? '選出能蝕刻最上層材料的藥液。蝕刻液要「吃得動目標材料、但吃不動光阻」，選錯不是沒反應就是把光阻也毀掉。'
            : '圖案已經刻進材料裡，光阻的任務結束了。用有機溶劑把它整層剝掉，再以去離子水沖乾淨。',
        error: this.error ?? undefined,
        label: '沒有鏡頭？直接放入正確的槽',
        enabled: true,
        onClick: () => {
          this.dipIndex = round.tanks.findIndex((t) => t.id === round.answer);
          this.dipDepth = 0;
          this.reactT = 0;
          this.error = null;
        },
      };
    }

    // 機台流程
    const dry = this.isDry();
    const title = dry ? '第二步 · 乾式蝕刻' : '第一步 · 氧氣電漿清潔';

    if (!this.waferInside) {
      return {
        kind: 'action',
        title,
        note: '捏起晶圓，放到腔體中央的虛線圈上。',
        label: '直接放入晶圓',
        enabled: true,
        onClick: () => {
          this.waferInside = true;
          this.heldWafer = null;
          this.grab = null;
          this.phase = dry ? 'dry-seal' : 'descum-seal';
        },
      };
    }
    if (this.phase.endsWith('seal')) {
      return {
        kind: 'action',
        title,
        note: '捏住腔門把手往左拖到底，密閉後才能抽真空。',
        label: '直接關閉腔門',
        enabled: true,
        onClick: () => {
          this.door = 0;
        },
      };
    }
    if (this.phase.endsWith('pump')) {
      return {
        kind: 'action',
        title,
        note: '電漿需要在低壓下才點得起來，正在抽真空。',
        label: `抽真空中… ${Math.round(this.vacuum * 100)}%`,
        enabled: false,
        onClick: () => {},
      };
    }
    if (this.phase.endsWith('ready')) {
      return {
        kind: 'action',
        title,
        note: dry
          ? '高能離子被電場加速後鉛直撞擊晶圓，只往下打不往旁邊擴散，所以側壁是直的。'
          : '顯影後表面會殘留一層薄薄的光阻渣，不清掉會讓蝕刻出來的圖案邊緣毛躁。',
        label: dry ? '啟動離子轟擊' : '點燃 O₂ 電漿',
        enabled: true,
        onClick: () => this.startRun(),
      };
    }
    return {
      kind: 'action',
      title,
      note: dry ? '離子正在鉛直移除沒有光阻保護的材料。' : 'O₂ 電漿正在氧化並帶走光阻殘渣。',
      label: `進行中… ${Math.round(this.progress * 100)}%`,
      enabled: false,
      onClick: () => {},
    };
  }

  // ─────────────────────────────── 過關判定 ────────────────────────────────

  override canComplete(): boolean {
    return this.subsFinished && this.ctx?.wafer.hasLayer('resist') === false;
  }

  override buildResult(): StageResult {
    return { etchMethod: this.method, undercut: this.ctx.wafer.undercut };
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
