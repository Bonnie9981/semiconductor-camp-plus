import type { HandFrame, Landmark, Point } from './types';

/**
 * GestureDetector
 * ---------------------------------------------------------------------------
 * 負責兩件事：
 *   1. 座標轉換 —— 把 MediaPipe 的 normalized landmark 轉成 AR canvas 的 CSS px，
 *      並且正確處理「鏡像」與 video 的 `object-fit: cover` 裁切。
 *   2. Pinch 判斷 —— 用 Landmark 4（拇指尖）與 Landmark 8（食指尖）的歐氏距離，
 *      加上遲滯（hysteresis）避免在門檻附近瘋狂閃爍。
 *
 * 鏡像（照鏡子感）的正確作法
 * ---------------------------------------------------------------------------
 * 只有 <video> 套 CSS `transform: scaleX(-1)`；AR canvas **不翻轉**。
 * 座標則做 X 翻轉映射：X_canvas = (1 - X_landmark) * CanvasWidth。
 * 兩者都翻的話會互相抵消（畫筆跑到反方向），而且 canvas 上的畫筆圖示與文字
 * 也會左右顛倒 —— 這是 WebAR 專案最常見的鏡像 bug。
 */

/** MediaPipe Hands 的骨架連線（21 點）。自行定義以避免相依套件的 export 差異。 */
export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],            // 拇指
  [0, 5], [5, 6], [6, 7], [7, 8],            // 食指
  [5, 9], [9, 10], [10, 11], [11, 12],       // 中指
  [9, 13], [13, 14], [14, 15], [15, 16],     // 無名指
  [13, 17], [17, 18], [18, 19], [19, 20],    // 小指
  [0, 17],                                    // 掌根
];

export const THUMB_TIP = 4;
export const INDEX_TIP = 8;

/** Pinch 門檻：小於 ON 判定捏合，大於 OFF 才放開（遲滯區間）。 */
const DEFAULT_PINCH_ON = 0.05;
const HYSTERESIS = 1.5;

/** 指尖位置平滑係數（0 = 完全不動，1 = 完全不平滑）。 */
const SMOOTHING = 0.45;

export interface GestureDetectorOptions {
  pinchOn?: number;
}

const EMPTY_HAND: HandFrame = {
  present: false,
  landmarks: [],
  normalized: [],
  pinching: false,
  justPinched: false,
  justReleased: false,
  pinchPoint: { x: 0, y: 0 },
  pinchDistance: 1,
  handedness: '',
};

export class GestureDetector {
  private mirror = true;
  private canvasW = 1;
  private canvasH = 1;
  private videoW = 0;
  private videoH = 0;

  private pinchOn: number;
  private pinching = false;
  private smoothed: Point | null = null;

  constructor(options: GestureDetectorOptions = {}) {
    this.pinchOn = options.pinchOn ?? DEFAULT_PINCH_ON;
  }

  setMirror(mirror: boolean): void {
    if (this.mirror === mirror) return;
    this.mirror = mirror;
    // 翻轉會讓座標瞬間跳到畫面另一側。若沿用舊的平滑狀態，指標會「滑」過去；
    // 玩家正在捏合時，那就會在晶圓上拖出一整條假線。所以一律重置。
    this.reset();
  }

  isMirrored(): boolean {
    return this.mirror;
  }

  /** Pinch 門檻，數值越大越容易捏合成功。 */
  setPinchThreshold(value: number): void {
    this.pinchOn = value;
  }

  getPinchThreshold(): number {
    return this.pinchOn;
  }

  /** AR canvas 的 CSS 尺寸。 */
  setCanvasSize(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    if (w === this.canvasW && h === this.canvasH) return;
    this.canvasW = w;
    this.canvasH = h;
    this.reset(); // 同 setMirror：視窗改變會讓座標跳動，別讓平滑把它變成一條線
  }

  /** <video> 的原生解析度，用來計算 object-fit:cover 的裁切量。 */
  setVideoSize(width: number, height: number): void {
    if (width === this.videoW && height === this.videoH) return;
    this.videoW = width;
    this.videoH = height;
    this.reset();
  }

  reset(): void {
    this.pinching = false;
    this.smoothed = null;
  }

  /**
   * 把 normalized landmark 轉成 canvas CSS px。
   *
   * <video> 用 object-fit: cover 填滿視窗，所以影像會被等比放大再左右／上下裁切；
   * 若直接用 x * width 會讓骨架與真實影像對不上（畫面越不 16:9 偏移越大）。
   */
  private project(x: number, y: number): Point {
    const cw = this.canvasW;
    const ch = this.canvasH;

    let px: number;
    let py: number;

    if (this.videoW > 0 && this.videoH > 0) {
      const scale = Math.max(cw / this.videoW, ch / this.videoH);
      const dw = this.videoW * scale;
      const dh = this.videoH * scale;
      const ox = (cw - dw) / 2;
      const oy = (ch - dh) / 2;
      px = ox + x * dw;
      py = oy + y * dh;
    } else {
      // 尚未拿到 video metadata 時的退化路徑：X_canvas = x * CanvasWidth
      px = x * cw;
      py = y * ch;
    }

    // 鏡像：X_canvas = (1 - X_landmark) * CanvasWidth（cover 版本為對視窗中線鏡射）
    if (this.mirror) px = cw - px;

    return { x: px, y: py };
  }

  /** 只做鏡像、不做 cover 映射的 0~1 座標，給手勢參考小視窗使用。 */
  private projectNormalized(x: number, y: number): Point {
    return { x: this.mirror ? 1 - x : x, y };
  }

  /**
   * 每一幀呼叫一次。傳入 MediaPipe 的 landmark 陣列（沒偵測到手時傳 null）。
   */
  update(landmarks: Landmark[] | null, handedness = ''): HandFrame {
    if (!landmarks || landmarks.length < 21) {
      const wasPinching = this.pinching;
      this.pinching = false;
      this.smoothed = null;
      return { ...EMPTY_HAND, justReleased: wasPinching };
    }

    const projected = landmarks.map((lm) => this.project(lm.x, lm.y));
    const normalized = landmarks.map((lm) => this.projectNormalized(lm.x, lm.y));

    // ── Pinch 判斷：Landmark 4 與 8 的 normalized 歐氏距離 ──
    const thumb = landmarks[THUMB_TIP];
    const index = landmarks[INDEX_TIP];
    const dx = thumb.x - index.x;
    const dy = thumb.y - index.y;
    const pinchDistance = Math.hypot(dx, dy);

    const wasPinching = this.pinching;
    const onThreshold = this.pinchOn;
    const offThreshold = this.pinchOn * HYSTERESIS;
    if (!wasPinching && pinchDistance < onThreshold) this.pinching = true;
    else if (wasPinching && pinchDistance > offThreshold) this.pinching = false;

    // ── Pinch 中心點：拇指尖與食指尖的中點，再做指數平滑（消抖） ──
    const rawPoint: Point = {
      x: (projected[THUMB_TIP].x + projected[INDEX_TIP].x) / 2,
      y: (projected[THUMB_TIP].y + projected[INDEX_TIP].y) / 2,
    };
    if (!this.smoothed || (!wasPinching && this.pinching)) {
      // 剛捏下去的瞬間直接跳到目標點，避免起筆時被平滑拖出一條假線
      this.smoothed = { ...rawPoint };
    } else {
      this.smoothed = {
        x: this.smoothed.x + (rawPoint.x - this.smoothed.x) * SMOOTHING,
        y: this.smoothed.y + (rawPoint.y - this.smoothed.y) * SMOOTHING,
      };
    }

    return {
      present: true,
      landmarks: projected,
      normalized,
      pinching: this.pinching,
      justPinched: this.pinching && !wasPinching,
      justReleased: !this.pinching && wasPinching,
      pinchPoint: { ...this.smoothed },
      pinchDistance,
      // 鏡像後 MediaPipe 標的「Left」其實就是玩家自己的左手
      handedness,
    };
  }
}

/* ==========================================================================
   繪圖工具：手部骨架（所有關卡共用的 AR chrome）
   ========================================================================== */

export function drawHandSkeleton(
  ctx: CanvasRenderingContext2D,
  hand: HandFrame,
  options: { color?: string; activeColor?: string } = {},
): void {
  if (!hand.present) return;

  const color = options.color ?? 'rgba(150, 235, 232, 0.75)';
  const active = options.activeColor ?? 'rgba(120, 255, 236, 1)';
  const lm = hand.landmarks;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 連線
  ctx.strokeStyle = hand.pinching ? active : color;
  ctx.lineWidth = hand.pinching ? 3.5 : 2.5;
  ctx.shadowColor = hand.pinching ? active : 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = hand.pinching ? 10 : 4;
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.moveTo(lm[a].x, lm[a].y);
    ctx.lineTo(lm[b].x, lm[b].y);
  }
  ctx.stroke();

  // 關節點
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(10, 22, 26, 0.85)';
  ctx.strokeStyle = hand.pinching ? active : color;
  ctx.lineWidth = 2;
  for (let i = 0; i < lm.length; i++) {
    const isTip = i === THUMB_TIP || i === INDEX_TIP;
    const r = isTip ? 6 : 3.5;
    ctx.beginPath();
    ctx.arc(lm[i].x, lm[i].y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // 拇指尖 ↔ 食指尖的「捏合距離」輔助線
  const t = lm[THUMB_TIP];
  const idx = lm[INDEX_TIP];
  ctx.setLineDash(hand.pinching ? [] : [4, 5]);
  ctx.strokeStyle = hand.pinching ? active : 'rgba(150, 235, 232, 0.4)';
  ctx.lineWidth = hand.pinching ? 3 : 1.5;
  ctx.beginPath();
  ctx.moveTo(t.x, t.y);
  ctx.lineTo(idx.x, idx.y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();
}
