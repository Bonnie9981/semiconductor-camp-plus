import type { Point } from '../core/types';
import { drawFlatWafer, WAFER_SQUASH } from './Beaker';

/**
 * Aligner —— 光罩對準曝光機（Mask Aligner）
 * ---------------------------------------------------------------------------
 *   ┌───────────────────────────────┬────────┐
 *   │        ▓▓▓ UV 燈管 ▓▓▓         │        │
 *   │         ↓ ↓ ↓ ↓ ↓             │  (◉)   │ ← 大型曝光按鈕
 *   │   ╔═══════════════════╗       │ EXPOSE │
 *   │   ║  光罩（鉻 / 玻璃） ║ ← 拖曳 │        │
 *   │   ╚═══════════════════╝       │        │
 *   │        ▁▁▁▁▁▁▁▁▁▁              │        │
 *   │     ═══ 晶圓 + 光阻 ═══        │        │
 *   └───────────────────────────────┴────────┘
 *
 * 玩家捏住光罩把它拖到晶圓正上方；兩組十字對準記號重合到容差內，
 * 曝光按鈕才會亮起。光穿過鉻層的「空白處」照到光阻上——
 * 所以畫出來的圖案是**擋光**的，這是初學者最容易搞反的地方。
 *
 * 只負責畫與提供命中區域，曝光的化學結果由 Stage3Litho 寫進 WaferState。
 */

export interface AlignerGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AlignerLayout {
  /** UV 燈管外殼。 */
  lamp: { x: number; y: number; w: number; h: number };
  /** 晶圓（含光阻）。 */
  wafer: { cx: number; cy: number; r: number };
  /** 光罩完全對準時的中心位置。 */
  maskHome: Point;
  /** 光罩玻璃板的尺寸。 */
  mask: { w: number; h: number; r: number };
  /** 大型曝光按鈕。 */
  button: { cx: number; cy: number; r: number };
  /** 光罩可以被拖到的範圍。 */
  bounds: { x: number; y: number; w: number; h: number };
}

export type AlignerPhase = 'align' | 'expose' | 'bake' | 'done';

export interface AlignerState {
  phase: AlignerPhase;
  /** 光罩相對 maskHome 的位移。 */
  offset: Point;
  /** 對準容差內。 */
  aligned: boolean;
  /** 曝光動畫進度 0~1。 */
  exposeT: number;
  /** 烘烤動畫進度 0~1。 */
  bakeT: number;
  /** 光罩圖案（鉻層），來自 VirtualDesk 的 Pattern 圖層。 */
  pattern: HTMLCanvasElement;
  waferColor: string;
  resistColor: string;
  tone: 'positive' | 'negative';
  buttonLive: boolean;
  hot: { mask?: boolean; button?: boolean };
  /** 玩家正拖著光罩。 */
  dragging: boolean;
}

const PANEL_RATIO = 0.24;
/** 對準容差（px）。 */
export const ALIGN_TOLERANCE = 14;

/** 低於這個高度就進入「矮機台」模式，把固定列收窄讓給晶圓。 */
const SHORT_ALIGNER_H = 300;

export function alignerLayout(geo: AlignerGeometry): AlignerLayout {
  const panelW = geo.w * PANEL_RATIO;
  const pad = Math.max(10, geo.w * 0.025);
  const innerW = geo.w - panelW - pad * 2;
  const innerX = geo.x + pad;

  /*
    矮機台（矮視窗）上要把固定成本擠出來給晶圓與光罩，做法跟 Chamber 一樣：
    UV 燈管變薄、燈管與頂緣的距離縮短、晶圓下方的預留變少。
    這幾樣縮了還看得懂，但晶圓一小就沒得玩，光罩也會撞上燈管。
  */
  const short = geo.h < SHORT_ALIGNER_H;
  const lampH = Math.max(short ? 12 : 20, geo.h * (short ? 0.07 : 0.1));
  const lampDrop = short ? 6 : 16;
  const waferFloor = short ? 18 : 30;
  const maskGap = short ? 10 : 18;

  const lamp = { x: innerX + innerW * 0.1, y: geo.y + pad + lampDrop, w: innerW * 0.8, h: lampH };

  /*
    晶圓半徑不再用「geo.h × 固定比例」猜，而是由**實際剩下的垂直空間反解**：

      燈管下緣 ── 間隙 16 ── 光罩(1.5r) ── 間隙 maskGap ── 晶圓(0.6r) ── 底部預留

    光罩上緣 = geo.y + geo.h − pad − waferFloor − maskGap − r×(0.3 + 0.3 + 1.53)
    要求它 ≥ 燈管下緣 + 16 = geo.y + pad + lampDrop + lampH + 16
    解出 r ≤ (geo.h − 2×pad − waferFloor − maskGap − lampDrop − lampH − 16) / 2.13
    （上下各有一個 pad，兩個都要扣）

    這樣光罩就不可能撞到燈管 —— 那是幾何上被排除的，不是靠參數調出來的。
    除數用 2.2 而不是 2.13，多留一點餘裕免得卡在臨界。
  */
  const vSpace = geo.h - pad * 2 - lampDrop - lampH - 16 - maskGap - waferFloor;
  // 高機台仍受 geo.h × 0.225 限制（維持原本的視覺比例）；
  // 矮機台上那個上限只會讓晶圓小到看不清，交給上面的反解值決定就好。
  const waferR = short
    ? Math.min(innerW * 0.34, vSpace / 2.2)
    : Math.min(innerW * 0.34, geo.h * 0.225, vSpace / 2.2);
  const wafer = {
    cx: innerX + innerW / 2,
    cy: geo.y + geo.h - pad - waferFloor - waferR * WAFER_SQUASH,
    r: waferR,
  };

  const maskR = waferR * 1.02;
  const mask = { w: maskR * 2.5, h: maskR * 1.5, r: maskR };
  const maskHome = { x: wafer.cx, y: wafer.cy - waferR * WAFER_SQUASH - mask.h * 0.5 - maskGap };

  const panelCX = geo.x + geo.w - panelW + panelW / 2;
  const buttonR = clamp(Math.min(panelW * 0.36, geo.h * 0.15), 26, 44);

  return {
    lamp,
    wafer,
    maskHome,
    mask,
    button: { cx: panelCX, cy: geo.y + geo.h * 0.52, r: buttonR },
    bounds: {
      x: innerX,
      y: lamp.y + lamp.h + 8,
      w: innerW,
      h: wafer.cy - (lamp.y + lamp.h) - 8,
    },
  };
}

export function drawAligner(
  ctx: CanvasRenderingContext2D,
  geo: AlignerGeometry,
  L: AlignerLayout,
  s: AlignerState,
  time: number,
): void {
  ctx.save();

  // ── 機殼 ──
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(geo.x + geo.w / 2, geo.y + geo.h + 6, geo.w * 0.48, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  const body = ctx.createLinearGradient(geo.x, geo.y, geo.x, geo.y + geo.h);
  body.addColorStop(0, '#485258');
  body.addColorStop(0.5, '#363f45');
  body.addColorStop(1, '#212930');
  ctx.fillStyle = body;
  roundRect(ctx, geo.x, geo.y, geo.w, geo.h, 14);
  ctx.fill();
  ctx.strokeStyle = '#161c20';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 名牌
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(ctx, geo.x + 10, geo.y + 8, geo.w - 20, 22, 6);
  ctx.fill();
  ctx.fillStyle = '#c9a6ff';
  ctx.font = `700 ${Math.round(clamp(geo.w * 0.036, 13, 17))}px 'IBM Plex Sans', 'Noto Sans TC', sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('光罩對準曝光機', geo.x + 18, geo.y + 19);
  ctx.fillStyle = 'rgba(200, 216, 224, 0.7)';
  ctx.font = "500 13px 'IBM Plex Mono', monospace";
  ctx.textAlign = 'right';
  ctx.fillText('MASK ALIGNER · UV 365nm', geo.x + geo.w - 18, geo.y + 19);

  drawLamp(ctx, L, s, time);

  // ── UV 光束（曝光中） ──
  if (s.phase === 'expose') drawUVBeam(ctx, L, s, time);

  // ── 晶圓 + 光阻 ──
  drawCoatedWafer(ctx, L, s, time);

  // ── 光罩（畫在晶圓之上，因為它懸在上方） ──
  drawMask(ctx, L, s, time);

  // ── 對準讀數 ──
  if (s.phase === 'align') drawAlignReadout(ctx, geo, L, s);

  // ── 大型曝光按鈕 ──
  drawExposeButton(ctx, L, s, time);

  ctx.restore();
}

function drawLamp(
  ctx: CanvasRenderingContext2D,
  L: AlignerLayout,
  s: AlignerState,
  time: number,
): void {
  const { x, y, w, h } = L.lamp;
  const on = s.phase === 'expose';

  ctx.save();
  ctx.fillStyle = '#2b333a';
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = '#171d21';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 燈管
  const tube = ctx.createLinearGradient(x, y, x, y + h);
  if (on) {
    const flick = 0.85 + 0.15 * Math.sin(time * 30);
    tube.addColorStop(0, `rgba(226, 208, 255, ${flick})`);
    tube.addColorStop(1, `rgba(168, 120, 255, ${flick})`);
    ctx.shadowColor = '#b98cff';
    ctx.shadowBlur = 26;
  } else {
    tube.addColorStop(0, '#4c545c');
    tube.addColorStop(1, '#333a41');
  }
  ctx.fillStyle = tube;
  roundRect(ctx, x + 8, y + h * 0.28, w - 16, h * 0.44, h * 0.22);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = on ? '#e2d0ff' : 'rgba(190, 206, 214, 0.7)';
  ctx.font = "700 14px 'IBM Plex Sans', 'Noto Sans TC', sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(on ? 'UV 曝光中' : 'UV 燈管', x + w / 2, y + h + 4);

  ctx.restore();
}

/**
 * UV 光束：只從光罩的「空白處」穿過去。
 * 作法是先畫滿一層光，再用光罩圖案把被鉻擋住的地方挖掉——
 * 這樣視覺上就直接表達了「畫出來的圖案是擋光的」。
 */
function drawUVBeam(
  ctx: CanvasRenderingContext2D,
  L: AlignerLayout,
  s: AlignerState,
  time: number,
): void {
  const mx = L.maskHome.x + s.offset.x;
  const my = L.maskHome.y + s.offset.y;
  const top = L.lamp.y + L.lamp.h;
  const bottom = L.wafer.cy;
  const r = L.mask.r;

  const a = (0.3 + 0.1 * Math.sin(time * 26)) * Math.min(1, s.exposeT * 4);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // 燈管到光罩之間：光還沒被擋，整片都是亮的
  ctx.fillStyle = `rgba(196, 158, 255, ${a * 0.8})`;
  ctx.fillRect(mx - r, top, r * 2, my - top);

  // 光罩到晶圓之間：先鋪滿光，再用鉻層把被擋住的地方挖掉。
  // 「畫到的地方擋光」這件事就是在這裡表達的。
  ctx.save();
  ctx.beginPath();
  ctx.rect(mx - r, my, r * 2, bottom - my);
  ctx.clip();

  const beam = ctx.createLinearGradient(0, my, 0, bottom);
  beam.addColorStop(0, `rgba(206, 172, 255, ${a})`);
  beam.addColorStop(1, `rgba(150, 110, 255, ${a * 0.55})`);
  ctx.fillStyle = beam;
  ctx.fillRect(mx - r, my, r * 2, bottom - my);

  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(s.pattern, mx - r, my, r * 2, bottom - my);
  ctx.restore();

  ctx.restore();
}

/** 晶圓 + 已塗佈的光阻 + 曝光後變色的區域。 */
function drawCoatedWafer(
  ctx: CanvasRenderingContext2D,
  L: AlignerLayout,
  s: AlignerState,
  time: number,
): void {
  const { cx, cy, r } = L.wafer;
  const ry = r * WAFER_SQUASH;

  // 載台
  ctx.save();
  ctx.fillStyle = '#2c343a';
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 1.1, r * 1.3, ry * 1.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawFlatWafer(ctx, { x: cx, y: cy }, r, s.waferColor);

  // 光阻層
  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = s.resistColor;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 2, r * 0.985, ry * 0.985, 0, 0, Math.PI * 2);
  ctx.fill();

  // 曝光後：被光照到的地方變色（正光阻斷鏈、負光阻交聯）
  if (s.exposeT > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy - 2, r * 0.985, ry * 0.985, 0, 0, Math.PI * 2);
    ctx.clip();

    // 畫一層「已曝光」顏色，再用鉻層挖掉沒被照到的地方
    const off = document.createElement('canvas');
    off.width = 128;
    off.height = 128;
    const o = off.getContext('2d');
    if (o) {
      o.fillStyle = s.tone === 'positive' ? '#d8e88a' : '#1f5f45';
      o.fillRect(0, 0, 128, 128);
      o.globalCompositeOperation = 'destination-out';
      o.drawImage(s.pattern, 0, 0, 128, 128);
    }
    ctx.globalAlpha = Math.min(1, s.exposeT) * 0.9;
    ctx.drawImage(off, cx - r, cy - 2 - ry, r * 2, ry * 2);
    ctx.restore();
  }

  // 烘烤：暖色輝光
  if (s.bakeT > 0) {
    ctx.globalAlpha = 0.25 + 0.12 * Math.sin(time * 5);
    ctx.fillStyle = '#ff8a4a';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 2, r * 1.05, ry * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 晶圓上的對準記號（左右各一個十字）
  drawAlignMarks(ctx, cx, cy, r, ry, '#5ee9df', 0.75);

  ctx.save();
  ctx.font = "700 15px 'IBM Plex Sans', 'Noto Sans TC', sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = 'rgba(8,14,18,0.9)';
  ctx.strokeText('晶圓（已塗光阻）', cx, cy + ry * 1.6);
  ctx.fillStyle = '#e8f2f6';
  ctx.fillText('晶圓（已塗光阻）', cx, cy + ry * 1.6);
  ctx.restore();
}

/** 光罩：玻璃板 + 鉻圖案 + 兩個對準記號。 */
function drawMask(
  ctx: CanvasRenderingContext2D,
  L: AlignerLayout,
  s: AlignerState,
  time: number,
): void {
  const cx = L.maskHome.x + s.offset.x;
  const cy = L.maskHome.y + s.offset.y;
  const { w, h, r } = L.mask;

  ctx.save();

  // 玻璃板
  ctx.fillStyle = 'rgba(150, 200, 220, 0.16)';
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = s.dragging ? '#5ee9df' : s.aligned ? '#5ee996' : 'rgba(190, 226, 240, 0.8)';
  ctx.lineWidth = s.dragging || s.aligned ? 3 : 1.8;
  ctx.stroke();

  // 鉻圖案（不透明的深色，會擋住 UV）
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.62, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalAlpha = 0.92;
  ctx.drawImage(s.pattern, cx - r, cy - r * 0.62, r * 2, r * 1.24);
  ctx.restore();

  // 圖案區外框
  ctx.strokeStyle = 'rgba(190, 226, 240, 0.45)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.62, 0, 0, Math.PI * 2);
  ctx.stroke();

  // 對準記號
  drawAlignMarks(ctx, cx, cy, r, r * 0.62, s.aligned ? '#5ee996' : '#ffd68a', 1);

  // 可抓取提示
  if (s.phase === 'align' && !s.dragging) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 4);
    ctx.globalAlpha = 0.3 + pulse * 0.45;
    ctx.strokeStyle = s.hot.mask ? '#5ee9df' : '#9fd8ff';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 6]);
    ctx.lineDashOffset = -time * 20;
    roundRect(ctx, cx - w / 2 - 5, cy - h / 2 - 5, w + 10, h + 10, 8);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }

  ctx.fillStyle = s.aligned ? '#5ee996' : '#e8f2f6';
  ctx.font = "700 15px 'IBM Plex Sans', 'Noto Sans TC', sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = 'rgba(8,14,18,0.9)';
  ctx.strokeText('光罩（鉻）', cx, cy - h / 2 - 8);
  ctx.fillText('光罩（鉻）', cx, cy - h / 2 - 8);

  ctx.restore();
}

/** 左右各一組十字對準記號。 */
function drawAlignMarks(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  const s = Math.max(6, rx * 0.09);
  for (const dir of [-1, 1]) {
    const x = cx + dir * rx * 0.78;
    const y = cy;
    ctx.beginPath();
    ctx.moveTo(x - s, y);
    ctx.lineTo(x + s, y);
    ctx.moveTo(x, y - s);
    ctx.lineTo(x, y + s);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, s * 0.62, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  void ry;
}

function drawAlignReadout(
  ctx: CanvasRenderingContext2D,
  geo: AlignerGeometry,
  L: AlignerLayout,
  s: AlignerState,
): void {
  const d = Math.hypot(s.offset.x, s.offset.y);
  ctx.save();
  ctx.font = "700 15px 'IBM Plex Mono', monospace";
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = s.aligned ? '#5ee996' : d < ALIGN_TOLERANCE * 2.5 ? '#e8c07a' : '#ff8a6a';
  ctx.fillText(
    `對準偏移 ${d.toFixed(0)} µm　${s.aligned ? '✓ 已對準' : `容差 ${ALIGN_TOLERANCE}`}`,
    L.bounds.x,
    geo.y + 36,
  );
  ctx.restore();
}

function drawExposeButton(
  ctx: CanvasRenderingContext2D,
  L: AlignerLayout,
  s: AlignerState,
  time: number,
): void {
  const b = L.button;
  const live = s.buttonLive;
  const busy = s.phase === 'expose' || s.phase === 'bake';

  ctx.save();
  ctx.fillStyle = '#1b2126';
  ctx.beginPath();
  ctx.arc(b.cx, b.cy, b.r + 7, 0, Math.PI * 2);
  ctx.fill();

  const face = ctx.createRadialGradient(
    b.cx - b.r * 0.3,
    b.cy - b.r * 0.35,
    b.r * 0.1,
    b.cx,
    b.cy,
    b.r,
  );
  if (busy) {
    face.addColorStop(0, '#d0a8ff');
    face.addColorStop(1, '#6b3fb0');
  } else if (live) {
    face.addColorStop(0, '#5ee996');
    face.addColorStop(1, '#127a4a');
  } else {
    face.addColorStop(0, '#4a555c');
    face.addColorStop(1, '#262e34');
  }
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(b.cx, b.cy, b.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = s.hot.button ? '#ffffff' : live || busy ? 'rgba(255,255,255,0.7)' : '#4d5860';
  ctx.lineWidth = s.hot.button ? 4 : 2.5;
  ctx.stroke();

  if (live) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    ctx.globalAlpha = 0.28 + pulse * 0.45;
    ctx.strokeStyle = '#5ee996';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, b.r + 10 + pulse * 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = live || busy ? '#0d1a14' : 'rgba(160,180,190,0.6)';
  ctx.font = `700 ${Math.round(b.r * 0.8)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('☀', b.cx, b.cy + 1);

  ctx.font = "700 14px 'IBM Plex Sans', 'Noto Sans TC', sans-serif";
  ctx.textBaseline = 'top';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = 'rgba(8,14,18,0.9)';
  const label = s.phase === 'expose' ? '曝光中…' : s.phase === 'bake' ? '烘烤中…' : '開始曝光';
  ctx.strokeText(label, b.cx, b.cy + b.r + 12);
  ctx.fillStyle = live ? '#5ee996' : busy ? '#d0a8ff' : 'rgba(170, 190, 200, 0.75)';
  ctx.fillText(label, b.cx, b.cy + b.r + 12);

  ctx.restore();
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

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
