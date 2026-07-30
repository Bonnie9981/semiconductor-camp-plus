/**
 * MachineFit —— 機台在可用垂直空間裡的高度
 * ---------------------------------------------------------------------------
 * 沉積腔、蝕刻腔、曝光機、乾燥機都有同一個需求：
 * 「盡量畫大，但不能頂到上方的提示帶」。
 *
 * 原本各關都寫成 `clamp(min(寬 × 比例, groundY − height × 0.19), 200, 430)`。
 * 這個寫法在矮視窗上會壞掉，因為 **下限 200 會贏過真正的空間限制** ——
 * 空間只剩 160px 時它還是回 200，機台頂端就穿進提示帶裡。
 *
 * 這裡把「想要多大」與「最多能多大」分開：
 *   想要 = min(寬 × 比例, max)
 *   能給 = groundY − gap − bandTop      ← 量出來的，不是猜的比例
 *   結果 = clamp(想要, min(min, 能給), 能給)
 *
 * 也就是說下限只是「偏好」，遇到真的沒空間時要讓路。機台是不是還大得能操作
 * （按鈕半徑、拉桿長度）由 scripts/checks/layout.mjs 另外驗。
 */
export function machineHeight(opts: {
  /** 機台寬度。 */
  width: number;
  /** 高 / 寬 的目標比例。 */
  ratio: number;
  /** 機台站立的基準線。 */
  groundY: number;
  /** 上方帶狀 HTML（子步驟列 / AR 提示）的下緣，由 UIManager.sceneOverlay() 量得。 */
  bandTop: number;
  /** 機台底部離 groundY 的距離。 */
  gap?: number;
  /** 偏好的最小高度；空間不足時會讓路。 */
  min: number;
  /** 上限。 */
  max: number;
}): number {
  const { width, ratio, groundY, bandTop, min, max } = opts;
  const gap = opts.gap ?? 0;
  const room = Math.max(60, groundY - gap - bandTop);
  const want = Math.min(width * ratio, max);
  return Math.min(Math.max(want, Math.min(min, room)), room);
}

/**
 * 機台的完整外框。
 *
 * 除了高度，還要管**長寬比**：場景很寬但很矮時（例如 1920×460 的視窗），
 * 只算高度會得到 925×220 這種細長條 —— 腔室內部被壓扁，晶圓小到看不清，
 * 曝光機的光罩還會撞到 UV 燈管。
 *
 * 所以寬度也要讓步：超過 maxAspect 就把機台收窄並置中，
 * 寧可左右留白，也不要畫一個扁掉的機台。
 */
export function machineBox(opts: {
  /** 場景可用的水平範圍。 */
  scene: { left: number; right: number; w: number };
  /** 機台最多吃掉場景寬度的幾成。 */
  widthRatio: number;
  /** 高 / 寬 的目標比例。 */
  ratio: number;
  groundY: number;
  bandTop: number;
  gap?: number;
  min: number;
  max: number;
  /** 寬 / 高 的上限，超過就收窄。 */
  maxAspect: number;
}): { x: number; y: number; w: number; h: number } {
  const { scene, widthRatio, ratio, groundY, bandTop, min, max, maxAspect } = opts;
  const gap = opts.gap ?? 0;

  const wantW = scene.w * widthRatio;
  const h = machineHeight({ width: wantW, ratio, groundY, bandTop, gap, min, max });
  const w = Math.min(wantW, h * maxAspect);

  return { x: scene.left + (scene.w - w) / 2, y: groundY - gap - h, w, h };
}
