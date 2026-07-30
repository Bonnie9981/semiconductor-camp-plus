import type { Point } from '../core/types';
import { solution } from '../data/solutions';
import { drawFlatWafer, WAFER_SQUASH } from './Beaker';

/**
 * TankBench —— 一排藥液槽
 * ---------------------------------------------------------------------------
 *   ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
 *   │ TMAH   │  │ 二甲苯 │  │ 丙酮   │  │  DI    │
 *   │▒▒▒▒▒▒▒▒│  │▒▒▒▒▒▒▒▒│  │▒▒▒▒▒▒▒▒│  │▒▒▒▒▒▒▒▒│
 *   └────────┘  └────────┘  └────────┘  └────────┘
 *              ◯ 晶圓（捏起來拖進去）
 *
 * 「選試劑」這個動作不做成選項按鈕——玩家把晶圓拖進哪一槽，就是選了哪一槽。
 * 第四關的顯影液、第五關的蝕刻液與去光阻液都共用這個場景。
 */

export interface TankBenchGeometry {
  left: number;
  right: number;
  /** 槽底所在的基準線。 */
  baseY: number;
  /** 單一槽的高度。 */
  height: number;
}

export interface TankSpec {
  /** solutions.ts 的 id。 */
  id: string;
  /** 覆寫顯示名稱；預設用藥液表的名字。 */
  label?: string;
}

export interface TankRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  /** 液面 y。 */
  surfaceY: number;
}

export interface TankBenchState {
  /** 晶圓目前的位置；null = 待在原位的載盤上。 */
  heldWafer: Point | null;
  waferR: number;
  waferColor: string;
  /** 晶圓表面那層膜的顏色（光阻等），null = 沒有。 */
  filmColor: string | null;
  /** 手上的晶圓正對著第幾槽；-1 = 沒有。 */
  hotIndex: number;
  /** 正在浸泡的槽；-1 = 沒有。 */
  dipIndex: number;
  /** 浸入深度 0~1。 */
  dipDepth: number;
  /** 反應進度 0~1，用來冒泡與畫進度環。 */
  progress: number;
  /** 攪拌強度 0~1（玩家左右晃動晶圓時上升）。 */
  agitation: number;
  /** 答錯的那一槽會閃紅色。 */
  wrongIndex: number;
}

/**
 * 依場景範圍推出整排藥液槽的幾何。
 *
 * 槽名與化學式是掛在槽底**下方**的，所以整排要往上退 TANK_LABEL_H，
 * 名稱才不會跟下面待命的晶圓疊在一起。抽成純函式讓 scripts/checks 驗得到。
 */
export const TANK_LABEL_H = 52;

export function tankBenchGeometry(opts: {
  scene: { left: number; right: number; w: number };
  height: number;
  groundY: number;
}): { geo: TankBenchGeometry; waferR: number; rest: Point; labelBottom: number } {
  const { scene, height, groundY } = opts;
  const geo: TankBenchGeometry = {
    left: scene.left,
    right: scene.right,
    baseY: groundY - TANK_LABEL_H,
    height: clamp(Math.min(height * 0.24, scene.w * 0.3), 96, 170),
  };
  const first = tankRects(geo, [{ id: 'di' }, { id: 'di' }, { id: 'di' }, { id: 'di' }])[0];
  const waferR = clamp(Math.min(first.w * 0.34, geo.height * 0.34), 34, 74);

  // 標籤：名稱一行 + 化學式一行，字級跟槽寬走（與 drawTankBench 一致）
  const nameFont = clamp(first.w * 0.15, 14, 20);
  const formulaFont = clamp(first.w * 0.11, 12, 15);
  const labelBottom = geo.baseY + 10 + nameFont + 4 + formulaFont;

  /*
    待命晶圓擺在標籤下方。矮視窗上 groundY 之下的空間很薄，
    所以位置要同時滿足兩邊：不壓到槽名、也不掉出畫面下緣（下方還有 20px 的字）。
  */
  const restRY = waferR * WAFER_SQUASH;
  const restY = clamp(
    groundY + restRY + 34,
    labelBottom + restRY + 6,
    height - restRY - 22,
  );

  return {
    geo,
    waferR,
    rest: { x: scene.left + scene.w / 2, y: restY },
    labelBottom,
  };
}

export function tankRects(geo: TankBenchGeometry, tanks: readonly TankSpec[]): TankRect[] {
  const n = tanks.length;
  const gap = Math.max(10, (geo.right - geo.left) * 0.025);
  const w = (geo.right - geo.left - gap * (n - 1)) / n;
  return tanks.map((t, i) => {
    const x = geo.left + i * (w + gap);
    const y = geo.baseY - geo.height;
    return {
      id: t.id,
      x,
      y,
      w,
      h: geo.height,
      cx: x + w / 2,
      surfaceY: y + geo.height * 0.26,
    };
  });
}

export function drawTankBench(
  ctx: CanvasRenderingContext2D,
  rects: readonly TankRect[],
  tanks: readonly TankSpec[],
  s: TankBenchState,
  time: number,
): void {
  ctx.save();

  rects.forEach((r, i) => {
    const sol = solution(r.id);
    const hot = s.hotIndex === i;
    const wrong = s.wrongIndex === i;
    const active = s.dipIndex === i;

    // 槽體陰影
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(r.cx, r.y + r.h + 4, r.w * 0.5, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // 液體
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, r.x + 3, r.y + 3, r.w - 6, r.h - 6, 7);
    ctx.clip();
    ctx.fillStyle = sol.color;
    ctx.globalAlpha = 0.82;
    ctx.fillRect(r.x, r.surfaceY, r.w, r.y + r.h - r.surfaceY);

    // 液面波紋
    ctx.globalAlpha = 1;
    ctx.fillStyle = shade(sol.color, 1.3);
    ctx.beginPath();
    ctx.moveTo(r.x, r.surfaceY + 3);
    for (let x = r.x; x <= r.x + r.w; x += 4) {
      const amp = active ? 2.6 + s.agitation * 3 : 1.6;
      ctx.lineTo(x, r.surfaceY + Math.sin((x - r.x) * 0.1 + time * (active ? 5 : 2)) * amp);
    }
    ctx.lineTo(r.x + r.w, r.surfaceY + 5);
    ctx.lineTo(r.x, r.surfaceY + 5);
    ctx.closePath();
    ctx.fill();

    // 浸在這一槽裡的晶圓
    if (active && s.heldWafer === null) {
      const p = dipPoint(r, s);
      drawWaferWithFilm(ctx, p, s, true);
      if (s.progress > 0) drawBubbles(ctx, r, s, time);
    }
    ctx.restore();

    // 槽壁
    ctx.strokeStyle = wrong
      ? '#ff8a6a'
      : hot
        ? '#5ee9df'
        : active
          ? '#5ee996'
          : 'rgba(196, 226, 236, 0.7)';
    ctx.lineWidth = hot || wrong || active ? 3.5 : 2;
    roundRect(ctx, r.x, r.y, r.w, r.h, 8);
    ctx.stroke();

    // 對準時的呼吸提示
    if (hot) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 5);
      ctx.globalAlpha = 0.3 + pulse * 0.45;
      ctx.strokeStyle = '#5ee9df';
      ctx.lineWidth = 3;
      roundRect(ctx, r.x - 6, r.y - 6, r.w + 12, r.h + 12, 12);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 標籤：中文名 + 化學式，字級刻意放大
    const name = tanks[i].label ?? sol.name;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `700 ${Math.round(clamp(r.w * 0.15, 14, 20))}px 'IBM Plex Sans', 'Noto Sans TC', sans-serif`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(8,14,18,0.9)';
    ctx.strokeText(name, r.cx, r.y + r.h + 10);
    ctx.fillStyle = wrong ? '#ff8a6a' : hot || active ? '#5ee9df' : '#e8f2f6';
    ctx.fillText(name, r.cx, r.y + r.h + 10);

    ctx.font = `600 ${Math.round(clamp(r.w * 0.11, 12, 15))}px 'IBM Plex Mono', monospace`;
    ctx.fillStyle = 'rgba(196, 214, 222, 0.85)';
    ctx.fillText(sol.formula, r.cx, r.y + r.h + 10 + clamp(r.w * 0.15, 14, 20) + 4);
  });

  // 玩家手上拿著的晶圓（畫在最上層）
  if (s.heldWafer) drawWaferWithFilm(ctx, s.heldWafer, s, true);

  ctx.restore();
}

/** 晶圓浸入某一槽時的中心位置。 */
export function dipPoint(r: TankRect, s: TankBenchState): Point {
  const ry = s.waferR * WAFER_SQUASH;
  const above = r.y - ry - 24;
  const under = Math.min(r.surfaceY + ry + 18, r.y + r.h - ry - 10);
  return { x: r.cx, y: above + (under - above) * clamp(s.dipDepth, 0, 1) };
}

function drawWaferWithFilm(
  ctx: CanvasRenderingContext2D,
  p: Point,
  s: TankBenchState,
  tweezers: boolean,
): void {
  drawFlatWafer(ctx, p, s.waferR, s.waferColor, tweezers);
  if (!s.filmColor) return;
  const ry = s.waferR * WAFER_SQUASH;
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = s.filmColor;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y - 2, s.waferR * 0.985, ry * 0.985, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBubbles(
  ctx: CanvasRenderingContext2D,
  r: TankRect,
  s: TankBenchState,
  time: number,
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  const n = Math.round(10 + s.agitation * 14);
  for (let i = 0; i < n; i++) {
    const seed = (i * 37) % 100 / 100;
    const t = (time * (0.5 + seed * 0.7) + seed) % 1;
    const x = r.x + 8 + seed * (r.w - 16);
    const y = r.y + r.h - 8 - t * (r.y + r.h - r.surfaceY - 12);
    const rr = 1.4 + seed * 2.4;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
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

function shade(color: string, factor: number): string {
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)));
  return `rgb(${f((n >> 16) & 255)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}
