/**
 * 檢查總入口 —— `npm run check`
 * ---------------------------------------------------------------------------
 * 這些檢查全部**直接 import 真正的原始碼**（透過 loader-hook 解析無副檔名的
 * .ts import，並用最小的 canvas 替身補上 DOM）。所以它們測的是實際會出貨的
 * 程式碼，不是抄過來的副本 —— 副本會隨原始碼改動而悄悄過期。
 *
 * 唯一的例外是 wafer-state.mjs 裡的 devComplete 鏈：各關的 devComplete()
 * 需要完整的 StageContext，只能在該檔重現。改動任何一關的 devComplete()
 * 時要記得同步。
 */
const modules = ['wafer-state', 'stl', 'layout', 'pdf'];

let failed = 0;
for (const name of modules) {
  const mod = await import(`./${name}.mjs`);
  failed += mod.default();
}

console.log(
  failed === 0
    ? '\n全部通過 ✓'
    : `\n${failed} 項檢查失敗 ✗`,
);
process.exit(failed === 0 ? 0 : 1);
