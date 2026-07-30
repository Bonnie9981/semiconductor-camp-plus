/**
 * 純粹的格式化工具。放在這裡而不是 UIManager 裡，是因為 main.ts（證書）
 * 與 UIManager（左側面板）都要用，而且純函式才方便被 scripts/checks 驗證。
 */

/**
 * 毫秒 → 顯示字串。
 * 一小時以內用 MM:SS，超過就補上小時 —— 營隊實際玩下來多半在十幾分鐘內，
 * 但總不能讓超時的人看到 73:20 這種讀不出來的數字。
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
