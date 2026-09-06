/**
 * 動態效果偏好
 * ---------------------------------------------------------------------------
 * 使用者可以在系統設定裡要求「減少動態效果」（macOS：輔助使用 → 顯示；
 * Windows：設定 → 協助工具 → 視覺效果；Linux 各桌面環境類似）。
 * CSS 那一層由 style.css 的 `@media (prefers-reduced-motion: reduce)` 處理，
 * canvas 上自繪的動畫則呼叫這裡。
 *
 * 目前唯一的用途是突沸動畫（`scene/Explosion.ts`）：它有整片畫面的白光閃焰
 * 與擴散衝擊波，對光敏感的使用者不友善。開啟偏好時改成靜態的警示。
 */

/** 系統要求「減少動態效果」時為 true；無 matchMedia 的環境（如檢查腳本）回 false。 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
