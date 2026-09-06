/**
 * Viewport —— 螢幕尺寸偵測
 * ---------------------------------------------------------------------------
 * 整個場景（藥液槽、腔體、曝光機）都是從「鏡頭視窗扣掉左右三欄之後剩下的寬度」
 * 推導出來的，所以視窗一小，道具就會小到看不清、甚至互相壓到。
 * style.css 的三段寬度級距（1420 / 1280 / 1180）已經把側欄一路收窄，
 * 但收到底之後還是有下限。
 *
 * 低於下限時**不要硬畫**——畫出來的畫面是壞的，玩家會以為程式有問題。
 * 改成在載入時就偵測並明確告訴他怎麼處理（放大視窗、關掉顯示縮放、全螢幕）。
 *
 * 常見的觸發原因是 Windows 的「顯示縮放 125%」：
 * 1920×1080 的螢幕回報成 1536×864，1440×900 回報成 1152×720。
 * 這兩個尺寸都還在支援範圍內（scripts/checks 有驗），
 * 但 1280×1024 開 125% 就會變成 1024×819，寬度不足。
 */

/**
 * 支援的最小可視區域。
 *
 * **高度**下限 460px 是實測值，不是猜的：scripts/checks/layout.mjs 會在
 * 1100×460、1366×470、1920×460 等尺寸上驗證所有器材都還畫得下、操作得動，
 * 再低就會出現晶圓小到看不清、拉桿短到拖不動。
 *
 * 之所以訂得這麼低，是因為 16:10 的 Mac（2560×1600 → 1440×900）
 * 非全螢幕又開著書籤列時只剩約 500px 高，那是很常見的機器，
 * 不能用「請放大視窗」把它擋掉。矮視窗的版面由 style.css 的
 * `max-height: 620px` / `540px` 兩級距負責讓出空間。
 *
 * **寬度**下限則守在 1100px，因為寬度不足是真的沒救：左右三欄加上
 * 面板的覆蓋範圍是固定成本，1024px 寬時中間只剩約 330px，
 * 四個藥液槽一個只有 76px，字都排不下。
 */
export const MIN_VIEWPORT = { w: 1100, h: 460 } as const;

export interface ViewportStatus {
  ok: boolean;
  w: number;
  h: number;
  /** 瀏覽器縮放 / 系統顯示縮放的合成倍率，約略值。 */
  scale: number;
  /** 給玩家看的說明；ok 時為 null。 */
  message: string | null;
}

export function checkViewport(w = window.innerWidth, h = window.innerHeight): ViewportStatus {
  const scale = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const tooNarrow = w < MIN_VIEWPORT.w;
  const tooShort = h < MIN_VIEWPORT.h;

  if (!tooNarrow && !tooShort) return { ok: true, w, h, scale, message: null };

  const lack: string[] = [];
  if (tooNarrow) lack.push(`寬度 ${w}px（需要 ${MIN_VIEWPORT.w}px）`);
  if (tooShort) lack.push(`高度 ${h}px（需要 ${MIN_VIEWPORT.h}px）`);

  return { ok: false, w, h, scale, message: lack.join('、') };
}

/**
 * 掛上偵測。載入時先驗一次，之後每次 resize 再驗，
 * 尺寸恢復就自動把提示收掉，玩家不用重新整理。
 */
export function watchViewport(overlay: HTMLElement, detail: HTMLElement): void {
  const sync = (): void => {
    const s = checkViewport();
    overlay.classList.toggle('hidden', s.ok);
    if (!s.ok && s.message) {
      const zoom = s.scale > 1.15 ? `（偵測到顯示縮放約 ${Math.round(s.scale * 100)}%）` : '';
      detail.textContent = `目前可視範圍不足：${s.message}${zoom}`;
    }
  };
  sync();
  window.addEventListener('resize', sync);
}
