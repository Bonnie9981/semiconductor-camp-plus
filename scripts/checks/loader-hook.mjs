/**
 * Node ESM 解析 hook：把無副檔名的相對 import 補上 `.ts`。
 *
 * 專案的 tsconfig 用 `moduleResolution: "bundler"`，所以原始碼裡寫的是
 * `import { … } from './Beaker'`（沒有副檔名）—— Vite 解得開，Node ESM 解不開。
 * 補上這個 hook 之後，檢查腳本就能**直接 import 真正的原始碼**，
 * 不必複製一份邏輯（複製品會隨著原始碼改動而悄悄過期）。
 *
 * Node 24 原生就會剝除 TypeScript 型別，所以 .ts 檔可以直接載入。
 */
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-zA-Z]+$/.test(specifier)) {
    try {
      return await next(`${specifier}.ts`, context);
    } catch {
      // 落回原本的解析（例如目錄 index 或 node_modules）
    }
  }
  return next(specifier, context);
}
