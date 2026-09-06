import type { Point } from '../core/types';

/**
 * VirtualDesk —— 中央畫面下方的虛擬桌面（#desk-canvas, z-index:3）
 * ---------------------------------------------------------------------------
 * 職責：
 *   1. 畫出桌面、Chuck（承載盤）與晶圓（Wafer）。
 *   2. 保存一張與螢幕解析度無關的「Pattern 圖層」（PATTERN_SIZE × PATTERN_SIZE），
 *      所有筆畫都畫在這張離螢幕 canvas 上。這樣視窗縮放、匯出 PNG / STL、
 *      左下角預覽框都共用同一份資料，不會因為 resize 而遺失圖形。
 *   3. 提供 isOnWafer() 讓關卡判斷「筆尖是否在晶圓上」。
 *
 * 座標系統
 *   螢幕座標 (CSS px, 以 #ar-canvas 左上角為原點)
 *        ↕ toPattern() / 縮放比 = PATTERN_SIZE / (2 * waferR)
 *   Pattern 座標 (0 ~ PATTERN_SIZE，晶圓外接正方形)
 */

/** Pattern 圖層解析度。夠高才能匯出漂亮的 PNG / STL。 */
const PATTERN_SIZE = 720;

/** 桌面佔視窗高度的比例（設計稿為 26%，即「下方約 1/4」）。 */
const DESK_RATIO = 0.26;

/** 覆蓋率取樣解析度。 */
const COVERAGE_SAMPLE = 72;

/** 視窗底部保留的邊距（px）。 */
const BOTTOM_MARGIN = 12;
/** 晶圓最多可以高出桌面線多少（以桌面高度為單位）。 */
const MAX_RISE_ABOVE_DESK = 0.55;
/** 晶圓半徑相對視窗寬度的上限，避免超寬螢幕上晶圓大到誇張。 */
const WAFER_WIDTH_RATIO = 0.12;

const COLORS = {
  deskBg: 'rgba(46, 40, 35, 0.92)', // oklch(0.22 0.015 70 / 0.92)
  deskLine: '#4a4138', // oklch(0.30 0.02 70)
  deskGrid: 'rgba(255, 236, 210, 0.05)',
  deskText: 'rgba(232, 226, 218, 0.75)', // oklch(0.90 0.01 70)
  chuckBody: '#252c30',
  chuckTop: '#39454b',
  chuckEdge: '#151a1d',
  waferEdge: '#7d8d95',
  accent: '#2ecfc7', // oklch(0.75 0.14 190)
  accentBright: '#5ee9df', // oklch(0.85 0.13 190)
} as const;

export interface DeskGeometry {
  deskTop: number;
  deskHeight: number;
  waferCX: number;
  waferCY: number;
  waferR: number;
  chuckTop: number;
  chuckHeight: number;
}

export class VirtualDesk {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly preview: HTMLCanvasElement | null;
  private readonly previewCtx: CanvasRenderingContext2D | null;

  /** 離螢幕的 Pattern 圖層（所有筆畫的唯一真實來源）。 */
  private readonly pattern: HTMLCanvasElement;
  private readonly patternCtx: CanvasRenderingContext2D;

  private width = 1;
  private height = 1;
  private geo: DeskGeometry = {
    deskTop: 0,
    deskHeight: 0,
    waferCX: 0,
    waferCY: 0,
    waferR: 1,
    chuckTop: 0,
    chuckHeight: 0,
  };

  private drawing = false;
  private lastPatternPoint: Point | null = null;
  private strokes = 0;
  private coverageCache: number | null = null;

  private penColor = '#0f6b5c';
  /** 畫筆粗細，單位是螢幕 CSS px（畫進 Pattern 時會換算）。 */
  private penWidth = 18;

  /** false 時只畫桌面，不畫晶圓與圖形（自行繪製場景的關卡設 false）。 */
  private waferVisible = true;

  /** 桌沿標籤；null 代表沿用預設。 */
  private deskLabel: string | null = null;

  /** 關卡自訂的晶圓位置；null = 用預設（立在 Chuck 上）。 */
  private placement: { cx: number; cy: number; r: number } | null = null;

  constructor(canvas: HTMLCanvasElement, preview: HTMLCanvasElement | null = null) {
    this.canvas = canvas;
    this.ctx = require2d(canvas);
    this.preview = preview;
    this.previewCtx = preview ? require2d(preview) : null;

    this.pattern = document.createElement('canvas');
    this.pattern.width = PATTERN_SIZE;
    this.pattern.height = PATTERN_SIZE;
    this.patternCtx = require2d(this.pattern);
    this.patternCtx.lineCap = 'round';
    this.patternCtx.lineJoin = 'round';

    this.renderPreview();
  }

  // ─────────────────────────────── 尺寸 / 幾何 ──────────────────────────────

  /** 由 main.ts 在視窗尺寸改變時呼叫；width/height 為 CSS px。 */
  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;

    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const deskHeight = height * DESK_RATIO;
    const deskTop = height - deskHeight;

    // Chuck 貼著視窗底部（留一點邊距），晶圓再「立」在 Chuck 頂面上。
    const chuckHeight = deskHeight * 0.36;
    const chuckTop = height - BOTTOM_MARGIN - chuckHeight;

    // 晶圓允許往上超出桌面線，才有立體擺放感，也讓可繪圖面積不被 26% 的桌面高度綁死；
    // 但整顆圓必須完全落在視窗內，否則筆畫會畫到畫布外面。
    const waferBottom = chuckTop + chuckHeight * 0.12;
    const waferTopLimit = deskTop - deskHeight * MAX_RISE_ABOVE_DESK;
    const waferR = clamp(
      Math.min((waferBottom - waferTopLimit) / 2, width * WAFER_WIDTH_RATIO),
      40,
      200,
    );

    this.geo = {
      deskTop,
      deskHeight,
      waferCX: width / 2,
      waferCY: waferBottom - waferR,
      waferR,
      chuckTop,
      chuckHeight,
    };

    this.applyPlacement();
  }

  /**
   * 覆寫晶圓在螢幕上的位置與半徑；null 代表回到預設。
   *
   * 自繪場景的關卡（例如微影製程要把晶圓放大到畫面中央）用它把 isOnWafer()
   * 與筆畫的座標轉換一起搬過去，就能沿用 Pattern 圖層、覆蓋率計算與
   * PNG / STL 匯出這一整套既有機制，不必自己再實作一份。
   *
   * 關卡會每一幀呼叫（場景尺寸隨視窗變動），所以這裡刻意做得很便宜。
   */
  setWaferPlacement(p: { cx: number; cy: number; r: number } | null): void {
    this.placement = p;
    this.applyPlacement();
  }

  private applyPlacement(): void {
    if (!this.placement) return;
    this.geo.waferCX = this.placement.cx;
    this.geo.waferCY = this.placement.cy;
    this.geo.waferR = this.placement.r;
  }

  get geometry(): Readonly<DeskGeometry> {
    return this.geo;
  }

  /** 視窗尺寸（CSS px），關卡佈置自己的場景時需要。 */
  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /**
   * 桌面層的 2D context。自行繪製場景的關卡（燒杯、乾燥機、腔體…）
   * 在 renderBase() 之後拿它來畫，畫出來的東西會蓋在桌面上、位於 UI 之下。
   */
  get context(): CanvasRenderingContext2D {
    return this.ctx;
  }

  setWaferVisible(visible: boolean): void {
    this.waferVisible = visible;
  }

  /** 桌面標籤文字，關卡可覆寫成自己的機台名稱。 */
  setDeskLabel(label: string | null): void {
    this.deskLabel = label;
  }

  // ─────────────────────────────── 畫筆設定 ────────────────────────────────

  setPenColor(color: string): void {
    this.penColor = color;
  }

  getPenColor(): string {
    return this.penColor;
  }

  setPenWidth(width: number): void {
    this.penWidth = width;
  }

  getPenWidth(): number {
    return this.penWidth;
  }

  // ─────────────────────────── 座標判斷 / 轉換 ─────────────────────────────

  /** 螢幕座標是否落在晶圓（可繪圖區）上。 */
  isOnWafer(x: number, y: number): boolean {
    const { waferCX, waferCY, waferR } = this.geo;
    return Math.hypot(x - waferCX, y - waferCY) <= waferR;
  }

  /** 螢幕座標是否落在下方桌面區域。 */
  isOnDesk(_x: number, y: number): boolean {
    return y >= this.geo.deskTop;
  }

  private get patternScale(): number {
    return PATTERN_SIZE / (this.geo.waferR * 2);
  }

  private toPattern(x: number, y: number): Point {
    const { waferCX, waferCY, waferR } = this.geo;
    const s = this.patternScale;
    return { x: (x - (waferCX - waferR)) * s, y: (y - (waferCY - waferR)) * s };
  }

  // ───────────────────────────────── 繪圖 ──────────────────────────────────

  beginStroke(x: number, y: number): void {
    this.drawing = true;
    this.lastPatternPoint = this.toPattern(x, y);
    this.strokes += 1;
    this.coverageCache = null;

    // 起筆先點一個圓點，短促的點擊也能留下痕跡
    const p = this.lastPatternPoint;
    const ctx = this.patternCtx;
    ctx.fillStyle = this.penColor;
    ctx.beginPath();
    ctx.arc(p.x, p.y, (this.penWidth * this.patternScale) / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  strokeTo(x: number, y: number): void {
    if (!this.drawing) {
      this.beginStroke(x, y);
      return;
    }
    const from = this.lastPatternPoint;
    if (!from) return;
    const to = this.toPattern(x, y);

    const ctx = this.patternCtx;
    ctx.strokeStyle = this.penColor;
    ctx.lineWidth = this.penWidth * this.patternScale;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    this.lastPatternPoint = to;
    this.coverageCache = null;
  }

  endStroke(): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.lastPatternPoint = null;
    this.renderPreview();
  }

  clear(): void {
    this.patternCtx.clearRect(0, 0, PATTERN_SIZE, PATTERN_SIZE);
    this.drawing = false;
    this.lastPatternPoint = null;
    this.strokes = 0;
    this.coverageCache = null;
    this.renderPreview();
  }

  get strokeCount(): number {
    return this.strokes;
  }

  hasInk(): boolean {
    return this.strokes > 0 && this.coverage() > 0;
  }

  /** 圖形佔晶圓面積的比例（0~1）。用來判斷「畫得夠不夠」。 */
  coverage(): number {
    if (this.coverageCache !== null) return this.coverageCache;

    const s = COVERAGE_SAMPLE;
    const tmp = document.createElement('canvas');
    tmp.width = s;
    tmp.height = s;
    const tctx = require2d(tmp);
    tctx.drawImage(this.pattern, 0, 0, s, s);

    const data = tctx.getImageData(0, 0, s, s).data;
    const r = s / 2;
    let inside = 0;
    let inked = 0;
    for (let j = 0; j < s; j++) {
      for (let i = 0; i < s; i++) {
        const dx = i + 0.5 - r;
        const dy = j + 0.5 - r;
        if (dx * dx + dy * dy > r * r) continue;
        inside++;
        if (data[(j * s + i) * 4 + 3] > 24) inked++;
      }
    }
    this.coverageCache = inside === 0 ? 0 : inked / inside;
    return this.coverageCache;
  }

  // ───────────────────────────────── 渲染 ──────────────────────────────────

  /** 每一幀由主迴圈呼叫：清空 desk canvas 並畫出桌面 + Chuck + 晶圓 + 圖形。 */
  renderBase(): void {
    const ctx = this.ctx;
    const { deskTop, deskHeight } = this.geo;
    ctx.clearRect(0, 0, this.width, this.height);

    // 桌面
    ctx.fillStyle = COLORS.deskBg;
    ctx.fillRect(0, deskTop, this.width, deskHeight);

    // 桌沿高光
    ctx.fillStyle = COLORS.deskLine;
    ctx.fillRect(0, deskTop, this.width, 2);

    // 桌面上的透視格線（純裝飾，強化「桌面」的空間感）
    ctx.save();
    ctx.strokeStyle = COLORS.deskGrid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const x = t * this.width;
      ctx.moveTo(x, deskTop + 2);
      ctx.lineTo(this.width * 0.5 + (x - this.width * 0.5) * 1.35, this.height);
    }
    for (let i = 1; i <= 3; i++) {
      const y = deskTop + (deskHeight * i) / 3.2;
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
    }
    ctx.stroke();
    ctx.restore();

    if (!this.waferVisible) {
      this.drawDeskLabel(ctx, this.deskLabel ?? '此步驟由關卡自行佈置場景');
      return;
    }

    this.drawChuck(ctx);
    this.drawWafer(ctx);
    this.drawDeskLabel(ctx, this.deskLabel ?? 'WAFER · 200mm  |  CHUCK');
  }

  /** 關卡在 renderBase() 之後呼叫，畫出筆尖游標（在最上層 canvas 才不會被桌面蓋住）。 */
  drawCursor(x: number, y: number, active: boolean): void {
    const ctx = this.ctx;
    const onWafer = this.isOnWafer(x, y);
    const r = (this.penWidth / 2) * (active ? 1 : 0.8);

    ctx.save();
    ctx.strokeStyle = active && onWafer ? COLORS.accentBright : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, Math.PI * 2);
    ctx.stroke();

    if (active && onWafer) {
      ctx.fillStyle = this.penColor;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      // 十字準心
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - r - 12, y);
      ctx.lineTo(x - r - 3, y);
      ctx.moveTo(x + r + 3, y);
      ctx.lineTo(x + r + 12, y);
      ctx.moveTo(x, y - r - 12);
      ctx.lineTo(x, y - r - 3);
      ctx.moveTo(x, y + r + 3);
      ctx.lineTo(x, y + r + 12);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 晶圓外圍的呼吸光暈，提示「這裡可以畫」。 */
  highlightWafer(time: number): void {
    if (!this.waferVisible) return;
    const { waferCX, waferCY, waferR } = this.geo;
    const pulse = 0.5 + 0.5 * Math.sin(time * 3);
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = COLORS.accent;
    ctx.globalAlpha = 0.25 + pulse * 0.5;
    ctx.lineWidth = 2 + pulse * 2;
    ctx.beginPath();
    ctx.arc(waferCX, waferCY, waferR + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawChuck(ctx: CanvasRenderingContext2D): void {
    const { waferCX, chuckTop: top, chuckHeight: h, waferR } = this.geo;
    const w = waferR * 2.3;

    ctx.save();
    // 陰影
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(waferCX, top + h, w * 0.56, h * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();

    // 本體（上寬下窄的梯形）
    const grad = ctx.createLinearGradient(0, top, 0, top + h);
    grad.addColorStop(0, COLORS.chuckTop);
    grad.addColorStop(1, COLORS.chuckBody);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(waferCX - w / 2, top);
    ctx.lineTo(waferCX + w / 2, top);
    ctx.lineTo(waferCX + w / 2.5, top + h);
    ctx.lineTo(waferCX - w / 2.5, top + h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = COLORS.chuckEdge;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 頂面高光
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(waferCX - w / 2, top, w, 3);
    ctx.restore();
  }

  private drawWafer(ctx: CanvasRenderingContext2D): void {
    const { waferCX, waferCY, waferR } = this.geo;

    ctx.save();

    // 晶圓底色（金屬矽晶反光）
    const grad = ctx.createRadialGradient(
      waferCX - waferR * 0.35,
      waferCY - waferR * 0.4,
      waferR * 0.1,
      waferCX,
      waferCY,
      waferR,
    );
    grad.addColorStop(0, '#eef3f5');
    grad.addColorStop(0.55, '#c6d2d8');
    grad.addColorStop(1, '#93a4ac');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(waferCX, waferCY, waferR, 0, Math.PI * 2);
    ctx.fill();

    // Pattern 圖層（裁切在晶圓內）
    ctx.save();
    ctx.beginPath();
    ctx.arc(waferCX, waferCY, waferR, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(this.pattern, waferCX - waferR, waferCY - waferR, waferR * 2, waferR * 2);
    ctx.restore();

    // 邊緣
    ctx.strokeStyle = COLORS.waferEdge;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(waferCX, waferCY, waferR, 0, Math.PI * 2);
    ctx.stroke();

    // 定位平邊（primary flat）：把圓的下緣切掉一小塊弦，因此要裁切在圓內
    ctx.save();
    ctx.beginPath();
    ctx.arc(waferCX, waferCY, waferR, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = COLORS.chuckBody;
    ctx.fillRect(waferCX - waferR, waferCY + waferR * 0.9, waferR * 2, waferR * 0.2);
    ctx.restore();

    ctx.restore();
  }

  /** 桌面標籤貼在桌沿下方，避開左下／右下的 HUD 卡片。 */
  private drawDeskLabel(ctx: CanvasRenderingContext2D, text: string): void {
    ctx.save();
    ctx.fillStyle = COLORS.deskText;
    ctx.font = "500 13px 'IBM Plex Mono', monospace";
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(text, 16, this.geo.deskTop + 10);
    ctx.restore();
  }

  // ───────────────────────── 預覽 / 匯出用的合成 ────────────────────────────

  /** 更新左下角「已繪製圖形」小預覽框。 */
  renderPreview(): void {
    const ctx = this.previewCtx;
    const canvas = this.preview;
    if (!ctx || !canvas) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const r = Math.min(w, h) / 2 - 2;
    const cx = w / 2;
    const cy = h / 2;

    ctx.fillStyle = '#f2f5f6';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.clip();
    ctx.drawImage(this.pattern, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();

    ctx.strokeStyle = '#9aa8ae';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** 取得原始 Pattern 圖層（Exporter 產生 STL 時使用）。 */
  getPatternCanvas(): HTMLCanvasElement {
    return this.pattern;
  }

  /**
   * 合成一張「白底圓形晶圓 + 圖案」的方形點陣圖。
   * 結算 Modal 的預覽與 PNG 下載共用同一份輸出，所見即所得。
   */
  composeWaferImage(size = 1024): HTMLCanvasElement {
    const out = document.createElement('canvas');
    out.width = size;
    out.height = size;
    const ctx = require2d(out);

    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - size * 0.02;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = '#eef2f4';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(this.pattern, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();

    ctx.strokeStyle = '#8d9aa1';
    ctx.lineWidth = Math.max(2, size * 0.004);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    return out;
  }

  getPatternDataURL(): string {
    return this.composeWaferImage(1024).toDataURL('image/png');
  }
}

function require2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法取得 2D context（瀏覽器不支援或 canvas 已被釋放）');
  return ctx;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
