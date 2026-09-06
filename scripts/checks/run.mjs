/**
 * 檢查總入口 —— `npm run check`
 * ---------------------------------------------------------------------------
 * 這些檢查全部**直接 import 真正的原始碼**（透過 loader-hook 解析無副檔名的
 * .ts import，並用最小的 canvas 替身補上 DOM）。所以它們測的是實際會出貨的
 * 程式碼，不是抄過來的副本 —— 副本會隨原始碼改動而悄悄過期。
 *
 * stage-machine.mjs 用窄的假 StageContext 跑真正的 5 個 Stage，涵蓋了預設
 * 路線的 devComplete() 鏈。wafer-state.mjs 仍保留一份重寫的 8 組合矩陣，
 * 涵蓋 method / tone / etchMethod 三個 private 分支 —— 改到那些分支的
 * devComplete() 時要記得同步 wafer-state.mjs。
 */
const modules = ['wafer-state', 'stage-machine', 'stl', 'layout', 'pdf'];

let failed = 0;
for (const name of modules) {
  const mod = await import(`./${name}.mjs`);
  failed += mod.default();
}

console.log(failed === 0 ? '\n全部通過 ✓' : `\n${failed} 項檢查失敗 ✗`);
process.exit(failed === 0 ? 0 : 1);
