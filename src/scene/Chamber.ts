import type { Point } from '../core/types';
import { drawFlatWafer, WAFER_SQUASH } from './Beaker';

/**
 * Chamber —— 沉積腔體（PVD e-gun / PECVD）
 * ---------------------------------------------------------------------------
 * 造型刻意做成「一台真的機器」：左邊是可以看進去的腔室、右邊是控制面板。
 * 所有控制元件都是**用手拖／按**的實體，不是 HTML 按鈕：
 *
 *   ┌──────────────────────────┬────────┐
 *   │  ▓▓▓▓ 靶材／噴淋頭 ▓▓▓▓    │  ▲     │
 *   │                          │  ║ 拉桿 │ ← PVD：拖曳調電子束功率
 *   │       ↓ ↓ ↓ ↓ ↓          │  ▼     │   CVD：兩顆氣閥旋鈕
 *   │                          │        │
 *   │        ▁▁▁▁▁▁▁           │  (◉)   │ ← 大型啟動按鈕
 *   │     ═══晶圓═══           │  START │
 *   └──────────────────────────┴────────┘
 *          ↑ 腔門（拖把手關閉）
 *
 * 兩種製程共用同一個腔體外殼，差別在「上方是什麼」與「右邊有什麼控制」。
 *
 * 這個模組只負責畫與提供命中區域；製程邏輯全部留在 Stage2Deposition。
 */

export type ChamberKind = 'pvd' | 'cvd';

export interface ChamberGeometry {
  /** 機台外框左上角。 */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 可命中的區域，Stage 拿去做捏合判定。 */
export interface ChamberLayout {
  /** 腔室內部（粒子的裁切範圍）。 */
  interior: { x: number; y: number; w: number; h: number };
  /** 名牌下方的狀態列（真空度／厚度進度條畫在這裡）。 */
  statusBar: { x: number; y: number; w: number; h: number };
  /** 晶圓座（也是選製程時的放置目標）。 */
  wafer: { cx: number; cy: number; r: number };
  /** 靶材／噴淋頭的下緣 y（粒子從這裡出發）。 */
  sourceY: number;
  /** 腔門把手；拖曳它來開關門。 */
  doorHandle: { cx: number; cy: number; r: number };
  /** 門把在「全開」與「全關」時的 x，用來把拖曳位置換算成開合度。 */
  doorTrack: { openX: number; closedX: number };
  /** PVD：功率拉桿（垂直軌道）。 */
  lever: { cx: number; top: number; bottom: number; halfW: number };
  /** CVD：兩顆氣體閥門旋鈕。 */
  valves: { cx: number; cy: number; r: number }[];
  /** 大型啟動按鈕。 */
  button: { cx: number; cy: number; r: number };
}

export interface ChamberState {
  kind: ChamberKind;
  /** 腔門開合度：1 = 全開，0 = 密閉。 */
  door: number;
  /** 真空度 0~1。 */
  vacuum: number;
  /** PVD 的電子束功率 0~1。 */
  power: number;
  /** CVD 的兩個氣閥開度 0~1。 */
  valves: [number, number];
  /** 電漿／電子束是否已啟動。 */
  running: boolean;
  /** 已沉積厚度 0~1。 */
  thickness: number;
  /** 晶圓在不在腔內。 */
  waferInside: boolean;
  waferColor: string;
  /** 正在長的膜的顏色（null = 還沒開始長）。 */
  filmColor: string | null;
  /** 這片晶圓上原本就有的膜（例如 CVD 長完氧化層後再進來鍍金屬）。 */
  baseFilmColor: string | null;
  /** 名牌文字。 */
  title: string;
  subtitle: string;
  /** 簡化模式：只畫機台外觀與晶圓座，不畫控制元件（選製程畫面用）。 */
  compact: boolean;
  /** 高亮：晶圓正被拖到這台機器上。 */
  seatHot: boolean;
  /** 高亮：手靠近門把 / 拉桿 / 旋鈕 / 按鈕。 */
  hot: { door?: boolean; lever?: boolean; valve?: number; button?: boolean };
  /** 大按鈕是否可按。 */
  buttonLive: boolean;
  /** 控制值的目標區間（畫成綠帶），[min, max]。 */
  powerWindow: [number, number];
  valveWindows: [number, number][];
}

const PANEL_RATIO = 0.27;

/**
 * 機台由上到下切成四條互不重疊的橫列，避免元素互相蓋住：
 *
 *   NAMEPLATE_H  名牌（機台名稱 + 製程別）
 *   STATUS_H     狀態列（真空度 / 厚度進度條）
 *   （其餘）      腔室內部
 *   DOOR_ROW_H   腔門滑軌 + 把手 + 狀態文字
 */
const NAMEPLATE_H = 22;
const STATUS_H = 22;
/** 門把（半徑最大 20）+ 下方狀態文字，需要 18 + 20 + 6 + 14 ≈ 58，取 62 留餘裕。 */
const DOOR_ROW_H = 62;

export function chamberLayout(geo: ChamberGeometry, kind: ChamberKind): ChamberLayout {
  const panelW = geo.w * PANEL_RATIO;
  const pad = Math.max(8, geo.w * 0.028);
  const innerW = geo.w - panelW - pad * 2;

  const statusBar = {
    x: geo.x + pad,
    y: geo.y + 8 + NAMEPLATE_H + 4,
    w: innerW,
    h: 9,
  };

  const interior = {
    x: geo.x + pad,
    y: statusBar.y + STATUS_H,
    w: innerW,
    h: geo.h - (statusBar.y - geo.y) - STATUS_H - DOOR_ROW_H,
  };

  const waferR = Math.min(interior.w * 0.34, interior.h * 0.34);
  const wafer = {
    cx: interior.x + interior.w / 2,
    cy: interior.y + interior.h - waferR * WAFER_SQUASH - interior.h * 0.14,
    r: waferR,
  };

  const panelX = geo.x + geo.w - panelW;
  const panelCX = panelX + panelW / 2;

  // 大按鈕：使用者要求「夠大能夠輕鬆地按」，所以半徑下限 22px（直徑 44px），
  // 但也不能大到把控制欄擠掉，因此同時受機台高度限制。
  const buttonR = clamp(Math.min(panelW * 0.3, geo.h * 0.13), 22, 38);
  const button = {
    cx: panelCX,
    cy: geo.y + geo.h - pad - buttonR - 18,
    r: buttonR,
  };

  const ctrlTop = statusBar.y + STATUS_H + 16;
  const ctrlBottom = button.cy - buttonR - 24;
  const ctrlSpan = Math.max(40, ctrlBottom - ctrlTop);

  const lever = {
    cx: panelCX,
    top: ctrlTop,
    bottom: ctrlBottom,
    halfW: clamp(panelW * 0.22, 14, 24),
  };

  // 兩顆閥門平均分佈在控制欄內；半徑同時受欄寬與欄高限制，
  // 否則機台一變矮，旋鈕就會疊到大按鈕上。
  const valveR = clamp(Math.min(panelW * 0.24, ctrlSpan * 0.17), 14, 28);
  const valves = [
    { cx: panelCX, cy: ctrlTop + valveR + 14, r: valveR },
    { cx: panelCX, cy: ctrlBottom - valveR, r: valveR },
  ];

  const handleR = clamp(geo.w * 0.035, 13, 20);
  const doorHandle = {
    cx: interior.x + interior.w - handleR - 6,
    cy: interior.y + interior.h + 18,
    r: handleR,
  };

  return {
    interior,
    statusBar,
    wafer,
    sourceY: interior.y + interior.h * 0.16,
    doorHandle,
    doorTrack: {
      openX: interior.x + interior.w - handleR - 6,
      closedX: interior.x + handleR + 6,
    },
    lever,
    valves: kind === 'cvd' ? valves : [],
    button,
  };
}

export function drawChamber(
  ctx: CanvasRenderingContext2D,
  geo: ChamberGeometry,
  layout: ChamberLayout,
  s: ChamberState,
  time: number,
): void {
  ctx.save();

  // ── 機殼 ──
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(geo.x + geo.w / 2, geo.y + geo.h + 6, geo.w * 0.48, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  const body = ctx.createLinearGradient(geo.x, geo.y, geo.x, geo.y + geo.h);
  body.addColorStop(0, '#4d585f');
  body.addColorStop(0.45, '#3a444b');
  body.addColorStop(1, '#232b31');
  ctx.fillStyle = body;
  roundRect(ctx, geo.x, geo.y, geo.w, geo.h, 14);
  ctx.fill();
  ctx.strokeStyle = s.seatHot ? '#5ee9df' : '#171d21';
  ctx.lineWidth = s.seatHot ? 3 : 2;
  ctx.stroke();

  // ── 名牌 ──
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(ctx, geo.x + 10, geo.y + 8, geo.w - 20, 22, 6);
  ctx.fill();
  ctx.fillStyle = s.kind === 'pvd' ? '#ffd68a' : '#8ae0ff';
  ctx.font = `700 ${Math.round(clamp(geo.w * 0.042, 13, 17))}px 'IBM Plex Sans', 'Noto Sans TC', sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(s.title, geo.x + 18, geo.y + 19);
  ctx.fillStyle = 'rgba(200, 216, 224, 0.7)';
  ctx.font = `500 ${Math.round(clamp(geo.w * 0.03, 10, 12))}px 'IBM Plex Mono', monospace`;
  ctx.textAlign = 'right';
  ctx.fillText(s.subtitle, geo.x + geo.w - 18, geo.y + 19);

  // ── 腔室內部 ──
  const it = layout.interior;
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, it.x, it.y, it.w, it.h, 8);
  ctx.clip();

  // 真空越高越暗，視覺上直接表達「抽空了」
  const bg = ctx.createLinearGradient(it.x, it.y, it.x, it.y + it.h);
  bg.addColorStop(0, s.vacuum > 0.5 ? '#080d11' : '#141c22');
  bg.addColorStop(1, '#0c1318');
  ctx.fillStyle = bg;
  ctx.fillRect(it.x, it.y, it.w, it.h);

  if (s.kind === 'pvd') drawTarget(ctx, layout, s, time);
  else drawShowerhead(ctx, layout, s, time);

  // 電漿輝光（CVD 啟動後充滿腔室）
  if (s.kind === 'cvd' && s.running) {
    const glow = ctx.createLinearGradient(it.x, layout.sourceY, it.x, layout.wafer.cy);
    const a = 0.16 + 0.06 * Math.sin(time * 5);
    glow.addColorStop(0, `rgba(150, 110, 255, ${a})`);
    glow.addColorStop(0.5, `rgba(190, 120, 255, ${a * 1.5})`);
    glow.addColorStop(1, `rgba(120, 190, 255, ${a})`);
    ctx.fillStyle = glow;
    ctx.fillRect(it.x, layout.sourceY, it.w, layout.wafer.cy - layout.sourceY);
  }

  ctx.restore();

  // ── 晶圓（畫在裁切外面，這樣邊緣不會被切掉，「完整呈現」） ──
  if (s.waferInside) {
    drawWaferWithFilm(ctx, layout, s, time);
  } else if (!s.compact) {
    drawEmptySeat(ctx, layout, time);
  } else {
    drawEmptySeat(ctx, layout, time, s.seatHot);
  }

  // 腔室外框
  ctx.strokeStyle = 'rgba(140, 190, 210, 0.4)';
  ctx.lineWidth = 2;
  roundRect(ctx, it.x, it.y, it.w, it.h, 8);
  ctx.stroke();

  // ── 腔門 ──
  drawDoor(ctx, layout, s, time);

  // ── 控制面板 ──
  if (!s.compact) {
    if (s.kind === 'pvd') drawLever(ctx, layout, s, time);
    else drawValves(ctx, layout, s, time);
    drawBigButton(ctx, layout, s, time);
  }

  ctx.restore();
}

// ─────────────────────────────── 腔室內容 ────────────────────────────────

/** PVD：上方的金屬靶材 + 從側邊射入的電子束。 */
function drawTarget(
  ctx: CanvasRenderingContext2D,
  layout: ChamberLayout,
  s: ChamberState,
  time: number,
): void {
  const it = layout.interior;
  const y = layout.sourceY;
  const w = it.w * 0.5;
  const x = it.x + (it.w - w) / 2;

  // 靶材（坩堝裡的金屬）
  ctx.fillStyle = '#39434a';
  roundRect(ctx, x - 8, y - 20, w + 16, 20, 4);
  ctx.fill();

  const heat = s.running ? s.power : 0;
  const metal = ctx.createLinearGradient(x, y - 16, x, y);
  metal.addColorStop(0, mixHex('#9aa8b0', '#ffd9a0', heat));
  metal.addColorStop(1, mixHex('#6d7c85', '#ff9b45', heat));
  ctx.fillStyle = metal;
  ctx.fillRect(x, y - 16, w, 14);

  // 熔融發光
  if (heat > 0.05) {
    ctx.save();
    ctx.globalAlpha = 0.35 + heat * 0.4 + 0.1 * Math.sin(time * 9);
    ctx.fillStyle = '#ffb057';
    ctx.filter = 'blur(6px)';
    ctx.fillRect(x - 6, y - 18, w + 12, 20);
    ctx.restore();
  }

  ctx.fillStyle = 'rgba(214, 232, 240, 0.85)';
  ctx.font = "700 12px 'IBM Plex Sans', 'Noto Sans TC', sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('金屬靶材', it.x + it.w / 2, y - 24);

  // 電子槍與電子束：從左側射向靶材，磁場讓它彎成一條弧
  const gunX = it.x + 12;
  const gunY = y + it.h * 0.1;
  ctx.fillStyle = '#5b6870';
  roundRect(ctx, gunX - 6, gunY - 9, 20, 18, 3);
  ctx.fill();

  if (s.running && s.power > 0.03) {
    ctx.save();
    ctx.strokeStyle = '#7ee8ff';
    ctx.lineWidth = 1.6 + s.power * 2.6;
    ctx.globalAlpha = 0.55 + s.power * 0.4;
    ctx.shadowColor = '#7ee8ff';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(gunX + 14, gunY);
    ctx.quadraticCurveTo(x - 26, gunY - 26, x + w * 0.3, y - 12);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#8ff0ff';
    ctx.font = "600 10px 'IBM Plex Mono', monospace";
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('e⁻ BEAM', gunX - 4, gunY + 12);
  }
}

/** CVD：上方的噴淋頭氣體入口。 */
function drawShowerhead(
  ctx: CanvasRenderingContext2D,
  layout: ChamberLayout,
  s: ChamberState,
  time: number,
): void {
  const it = layout.interior;
  const y = layout.sourceY;
  const w = it.w * 0.78;
  const x = it.x + (it.w - w) / 2;

  ctx.fillStyle = '#414b52';
  roundRect(ctx, x, y - 18, w, 18, 4);
  ctx.fill();
  ctx.strokeStyle = '#232b31';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 噴嘴孔；閥門開得越大，孔越亮
  const open = (s.valves[0] + s.valves[1]) / 2;
  const holes = 11;
  for (let i = 0; i < holes; i++) {
    const hx = x + ((i + 0.5) / holes) * w;
    ctx.fillStyle = `rgba(140, 220, 255, ${0.25 + open * 0.65})`;
    ctx.beginPath();
    ctx.arc(hx, y - 2, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // 兩條進氣管，顏色對應右邊兩顆閥門
  const pipes: [string, string, number][] = [
    ['SiH₄', '#7fd4a8', s.valves[0]],
    ['N₂O', '#8fb8f0', s.valves[1]],
  ];
  pipes.forEach(([label, color, v], i) => {
    const px = x + (i === 0 ? w * 0.22 : w * 0.78);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35 + v * 0.6;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(px, it.y - 2);
    ctx.lineTo(px, y - 18);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = color;
    ctx.font = "700 11px 'IBM Plex Mono', monospace";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label, px, it.y + 2);
  });

  ctx.fillStyle = 'rgba(214, 232, 240, 0.85)';
  ctx.font = "700 12px 'IBM Plex Sans', 'Noto Sans TC', sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('氣體噴淋頭', it.x + it.w / 2, y + 3);

  void time;
}

/** 晶圓 + 正在長的膜。膜厚直接反映在盤面上，玩家不用看截面圖也知道在長。 */
function drawWaferWithFilm(
  ctx: CanvasRenderingContext2D,
  layout: ChamberLayout,
  s: ChamberState,
  time: number,
): void {
  const { cx, cy, r } = layout.wafer;
  const ry = r * WAFER_SQUASH;

  // 加熱基座
  ctx.save();
  ctx.fillStyle = '#2c343a';
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 0.9, r * 1.22, ry * 1.15, 0, 0, Math.PI * 2);
  ctx.fill();
  if (s.running && s.kind === 'cvd') {
    ctx.globalAlpha = 0.3 + 0.12 * Math.sin(time * 4);
    ctx.fillStyle = '#ff7a45';
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 1.5, r * 1.24, ry * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  drawFlatWafer(ctx, { x: cx, y: cy }, r, s.waferColor);

  // 既有的膜（例如 CVD 長好的氧化層）
  if (s.baseFilmColor) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = s.baseFilmColor;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 1.5, r * 0.985, ry * 0.985, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 正在長的膜：厚度用「不透明度 + 往上抬高」一起表現
  if (s.filmColor && s.thickness > 0.01) {
    const lift = s.thickness * ry * 0.28;
    ctx.save();
    ctx.globalAlpha = 0.25 + s.thickness * 0.7;
    ctx.fillStyle = s.filmColor;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 1.5 - lift, r * 0.985, ry * 0.985, 0, 0, Math.PI * 2);
    ctx.fill();

    // 膜的側面厚度
    ctx.globalAlpha = 0.55 + s.thickness * 0.4;
    ctx.fillStyle = shadeHex(s.filmColor, 0.6);
    ctx.beginPath();
    ctx.ellipse(cx, cy - 1.5, r * 0.985, ry * 0.985, 0, 0, Math.PI);
    ctx.lineTo(cx - r * 0.985, cy - 1.5 - lift);
    ctx.ellipse(cx, cy - 1.5 - lift, r * 0.985, ry * 0.985, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();

    // 薄膜干涉色的流動高光
    ctx.globalAlpha = 0.2 + 0.12 * Math.sin(time * 2.5);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.3, cy - 1.5 - lift - ry * 0.3, r * 0.34, ry * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 厚度標示，字級刻意放大
  ctx.save();
  ctx.font = "700 14px 'IBM Plex Mono', monospace";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const label = `${Math.round(s.thickness * 100)} nm`;
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = 'rgba(8, 14, 18, 0.9)';
  ctx.strokeText(label, cx, cy + ry * 1.9);
  ctx.fillStyle = s.thickness >= 1 ? '#5ee9df' : '#e8f2f6';
  ctx.fillText(label, cx, cy + ry * 1.9);
  ctx.restore();
}

/** 沒有晶圓時的放置目標圈。 */
function drawEmptySeat(
  ctx: CanvasRenderingContext2D,
  layout: ChamberLayout,
  time: number,
  hot = false,
): void {
  const { cx, cy, r } = layout.wafer;
  const ry = r * WAFER_SQUASH;
  const pulse = 0.5 + 0.5 * Math.sin(time * 4);

  ctx.save();
  ctx.fillStyle = '#2c343a';
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 0.9, r * 1.22, ry * 1.15, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.setLineDash([7, 6]);
  ctx.lineDashOffset = -time * 22;
  ctx.strokeStyle = hot ? '#5ee9df' : `rgba(94, 233, 223, ${0.3 + pulse * 0.4})`;
  ctx.lineWidth = hot ? 3.5 : 2.2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ─────────────────────────────── 控制元件 ────────────────────────────────

function drawDoor(
  ctx: CanvasRenderingContext2D,
  layout: ChamberLayout,
  s: ChamberState,
  time: number,
): void {
  const it = layout.interior;
  const track = layout.doorTrack;
  const h = layout.doorHandle;

  // 門板：由左往右滑出來把腔室蓋住。door=1 全開（縮在左邊看不到）
  const coverW = it.w * (1 - s.door);
  if (coverW > 2) {
    ctx.save();
    const g = ctx.createLinearGradient(it.x, it.y, it.x + coverW, it.y);
    g.addColorStop(0, 'rgba(62, 72, 80, 0.96)');
    g.addColorStop(0.7, 'rgba(48, 57, 64, 0.94)');
    g.addColorStop(1, 'rgba(78, 90, 98, 0.96)');
    ctx.fillStyle = g;
    ctx.fillRect(it.x, it.y, coverW, it.h);

    // 觀察窗：關上後還看得見一點裡面
    if (coverW > it.w * 0.55) {
      const wx = it.x + coverW * 0.5;
      const wr = Math.min(it.h * 0.3, coverW * 0.28);
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.ellipse(wx, it.y + it.h * 0.45, wr, wr * 0.86, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.clearRect(wx - wr, it.y, wr * 2, it.h);
      ctx.restore();
      ctx.strokeStyle = 'rgba(160, 210, 230, 0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(wx, it.y + it.h * 0.45, wr, wr * 0.86, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.strokeStyle = '#20272c';
    ctx.lineWidth = 2;
    ctx.strokeRect(it.x, it.y, coverW, it.h);
    ctx.restore();
  }

  // 選製程的畫面不需要腔門控制，只畫機台外觀
  if (s.compact) return;

  // 門軌
  ctx.save();
  ctx.strokeStyle = 'rgba(150, 170, 182, 0.4)';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(track.closedX, h.cy);
  ctx.lineTo(track.openX, h.cy);
  ctx.stroke();

  // 把手（可拖曳）
  const hx = lerp(track.openX, track.closedX, 1 - s.door);
  const live = s.hot.door;
  ctx.fillStyle = live ? '#1d7a70' : '#5a666e';
  ctx.beginPath();
  ctx.arc(hx, h.cy, h.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = live ? '#5ee9df' : '#8b99a2';
  ctx.lineWidth = live ? 3 : 2;
  ctx.stroke();

  // 握把紋路
  ctx.strokeStyle = live ? '#d8fffb' : '#c3ced5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = -1; i <= 1; i++) {
    ctx.moveTo(hx + i * 4, h.cy - h.r * 0.42);
    ctx.lineTo(hx + i * 4, h.cy + h.r * 0.42);
  }
  ctx.stroke();

  // 提示：門還開著時，箭頭往關閉方向脈動
  if (s.door > 0.02) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 4);
    ctx.globalAlpha = 0.35 + pulse * 0.5;
    ctx.strokeStyle = '#5ee9df';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(hx - h.r - 8, h.cy);
    ctx.lineTo(hx - h.r - 18, h.cy);
    ctx.moveTo(hx - h.r - 18, h.cy);
    ctx.lineTo(hx - h.r - 13, h.cy - 5);
    ctx.moveTo(hx - h.r - 18, h.cy);
    ctx.lineTo(hx - h.r - 13, h.cy + 5);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 狀態文字放在滑軌下方，不跟軌道與把手重疊
  ctx.fillStyle = s.door < 0.02 ? '#5ee9df' : 'rgba(214, 230, 238, 0.9)';
  ctx.font = "700 13px 'IBM Plex Sans', 'Noto Sans TC', sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(
    s.door < 0.02 ? '✓ 腔門已密閉' : '捏住把手往左拖，關閉腔門',
    it.x + it.w / 2,
    h.cy + h.r + 6,
  );

  ctx.restore();
}

/** PVD 的電子束功率拉桿。 */
function drawLever(
  ctx: CanvasRenderingContext2D,
  layout: ChamberLayout,
  s: ChamberState,
  time: number,
): void {
  const L = layout.lever;
  const h = L.bottom - L.top;

  ctx.save();

  // 軌道
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(ctx, L.cx - L.halfW * 0.45, L.top, L.halfW * 0.9, h, L.halfW * 0.45);
  ctx.fill();

  // 目標區間（綠帶）
  const [lo, hi] = s.powerWindow;
  const yHi = L.bottom - hi * h;
  const yLo = L.bottom - lo * h;
  ctx.fillStyle = 'rgba(94, 233, 150, 0.28)';
  ctx.fillRect(L.cx - L.halfW, yHi, L.halfW * 2, yLo - yHi);
  ctx.strokeStyle = 'rgba(94, 233, 150, 0.75)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(L.cx - L.halfW, yHi, L.halfW * 2, yLo - yHi);

  // 已輸出的功率
  const y = L.bottom - s.power * h;
  const inWindow = s.power >= lo && s.power <= hi;
  ctx.fillStyle = inWindow ? '#5ee996' : s.power > hi ? '#ff8a6a' : '#8fa3ad';
  roundRect(ctx, L.cx - L.halfW * 0.45, y, L.halfW * 0.9, L.bottom - y, L.halfW * 0.45);
  ctx.fill();

  // 把手
  const live = s.hot.lever;
  ctx.fillStyle = live ? '#1d7a70' : '#59656d';
  roundRect(ctx, L.cx - L.halfW, y - 11, L.halfW * 2, 22, 6);
  ctx.fill();
  ctx.strokeStyle = live ? '#5ee9df' : '#96a4ac';
  ctx.lineWidth = live ? 3 : 2;
  ctx.stroke();
  ctx.strokeStyle = live ? '#d8fffb' : '#c6d1d8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(L.cx - L.halfW * 0.55, y);
  ctx.lineTo(L.cx + L.halfW * 0.55, y);
  ctx.stroke();

  // 標籤 + 數值
  ctx.fillStyle = 'rgba(220, 234, 240, 0.9)';
  ctx.font = "700 12px 'IBM Plex Sans', 'Noto Sans TC', sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('電子束功率', L.cx, L.top - 6);

  ctx.font = "700 15px 'IBM Plex Mono', monospace";
  ctx.fillStyle = inWindow ? '#5ee996' : s.power > hi ? '#ff8a6a' : '#e8f2f6';
  ctx.textBaseline = 'top';
  ctx.fillText(`${Math.round(s.power * 100)}%`, L.cx, L.bottom + 6);

  if (s.running && s.power > hi) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 8);
    ctx.globalAlpha = 0.6 + pulse * 0.4;
    ctx.fillStyle = '#ff8a6a';
    ctx.font = "700 11px 'IBM Plex Sans', 'Noto Sans TC', sans-serif";
    ctx.fillText('過熱！', L.cx, L.bottom + 26);
  }

  ctx.restore();
}

/** CVD 的兩顆氣體閥門旋鈕；左右拖曳＝轉開。 */
function drawValves(
  ctx: CanvasRenderingContext2D,
  layout: ChamberLayout,
  s: ChamberState,
  time: number,
): void {
  const names = ['SiH₄ 矽甲烷', 'N₂O 笑氣'];
  const colors = ['#7fd4a8', '#8fb8f0'];

  layout.valves.forEach((v, i) => {
    const open = s.valves[i] ?? 0;
    const [lo, hi] = s.valveWindows[i] ?? [0.4, 0.7];
    const inWindow = open >= lo && open <= hi;
    const live = s.hot.valve === i;

    ctx.save();

    // 開度環：底環 + 目標綠弧 + 目前開度
    const A0 = Math.PI * 0.75;
    const A1 = Math.PI * 2.25;
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(v.cx, v.cy, v.r + 7, A0, A1);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(94, 233, 150, 0.55)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(v.cx, v.cy, v.r + 7, A0 + (A1 - A0) * lo, A0 + (A1 - A0) * hi);
    ctx.stroke();

    ctx.strokeStyle = inWindow ? '#5ee996' : colors[i];
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(v.cx, v.cy, v.r + 7, A0, A0 + (A1 - A0) * open);
    ctx.stroke();

    // 旋鈕本體
    const knob = ctx.createRadialGradient(
      v.cx - v.r * 0.3,
      v.cy - v.r * 0.3,
      v.r * 0.1,
      v.cx,
      v.cy,
      v.r,
    );
    knob.addColorStop(0, live ? '#3f8f88' : '#5d6a72');
    knob.addColorStop(1, live ? '#175f58' : '#2d363c');
    ctx.fillStyle = knob;
    ctx.beginPath();
    ctx.arc(v.cx, v.cy, v.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = live ? '#5ee9df' : '#8b99a2';
    ctx.lineWidth = live ? 3 : 1.8;
    ctx.stroke();

    // 指針：只畫外圈那一段，中間留給數值
    const ang = A0 + (A1 - A0) * open;
    ctx.strokeStyle = inWindow ? '#5ee996' : '#e6f2f6';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(v.cx + Math.cos(ang) * v.r * 0.5, v.cy + Math.sin(ang) * v.r * 0.5);
    ctx.lineTo(v.cx + Math.cos(ang) * v.r * 0.86, v.cy + Math.sin(ang) * v.r * 0.86);
    ctx.stroke();

    // 名稱在旋鈕上方；數值畫在旋鈕正中央，省下一整列的垂直空間
    ctx.fillStyle = colors[i];
    ctx.font = "700 11px 'IBM Plex Sans', 'Noto Sans TC', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(names[i], v.cx, v.cy - v.r - 4);

    ctx.font = `700 ${Math.round(clamp(v.r * 0.62, 11, 15))}px 'IBM Plex Mono', monospace`;
    ctx.fillStyle = inWindow ? '#5ee996' : '#e8f2f6';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(open * 100)}`, v.cx, v.cy + 1);

    ctx.restore();
  });

  void time;
}

/** 機台上的大型啟動按鈕。使用者要求「夠大能夠輕鬆地按」。 */
function drawBigButton(
  ctx: CanvasRenderingContext2D,
  layout: ChamberLayout,
  s: ChamberState,
  time: number,
): void {
  const b = layout.button;
  const live = s.buttonLive;
  const hot = s.hot.button;

  ctx.save();

  // 底座
  ctx.fillStyle = '#1b2126';
  ctx.beginPath();
  ctx.arc(b.cx, b.cy, b.r + 7, 0, Math.PI * 2);
  ctx.fill();

  // 按鈕面
  const face = ctx.createRadialGradient(
    b.cx - b.r * 0.3,
    b.cy - b.r * 0.35,
    b.r * 0.1,
    b.cx,
    b.cy,
    b.r,
  );
  if (s.running) {
    face.addColorStop(0, '#ff8f6a');
    face.addColorStop(1, '#a83c1e');
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

  ctx.strokeStyle = hot ? '#ffffff' : live || s.running ? 'rgba(255,255,255,0.7)' : '#4d5860';
  ctx.lineWidth = hot ? 4 : 2.5;
  ctx.stroke();

  // 可按時的呼吸光圈
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

  // 圖示
  ctx.fillStyle = live || s.running ? '#0d1a14' : 'rgba(160,180,190,0.6)';
  ctx.font = `700 ${Math.round(b.r * 0.9)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(s.running ? '■' : '▶', b.cx, b.cy + 1);

  // 標籤
  ctx.font = "700 12px 'IBM Plex Sans', 'Noto Sans TC', sans-serif";
  ctx.textBaseline = 'top';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = 'rgba(8, 14, 18, 0.9)';
  const label = s.running ? '停止' : s.kind === 'pvd' ? '啟動電子槍' : '點燃電漿';
  ctx.strokeText(label, b.cx, b.cy + b.r + 12);
  ctx.fillStyle = live ? '#5ee996' : s.running ? '#ff9b7a' : 'rgba(170, 190, 200, 0.75)';
  ctx.fillText(label, b.cx, b.cy + b.r + 12);

  ctx.restore();
}

// ─────────────────────────────── 小工具 ──────────────────────────────────

export function pointInCircle(p: Point, c: { cx: number; cy: number; r: number }, pad = 0): boolean {
  return Math.hypot(p.x - c.cx, p.y - c.cy) <= c.r + pad;
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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * clamp(t, 0, 1));
  return `rgb(${m(r1, r2)}, ${m(g1, g2)}, ${m(b1, b2)})`;
}

function shadeHex(color: string, factor: number): string {
  const m = color.match(/^#([0-9a-f]{3,6})$/i);
  if (!m) return color;
  const [r, g, b] = hexToRgb(color);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)));
  return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
}
