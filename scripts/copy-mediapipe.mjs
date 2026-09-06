/**
 * 把 MediaPipe 的 runtime 資產從 node_modules 複製到 public/mediapipe/。
 * 由 package.json 的 postinstall 自動執行。
 *
 * 為什麼要複製？
 *   @mediapipe/hands 與 @mediapipe/camera_utils 是 Closure 編譯的 UMD script：
 *   它們把 Hands / Camera 掛在 globalThis 上，**沒有** module.exports，
 *   而且 package.json 標了 "sideEffects": []。也就是說
 *       import { Hands } from '@mediapipe/hands'
 *   在 TypeScript 編譯期完全正常（因為有 index.d.ts），
 *   但在 runtime 會拿到 undefined，而且 side-effect import 還可能被 tree-shaking 移除。
 *
 *   因此我們改成：型別用 `import type` 從 npm 套件取得（型別安全），
 *   實際程式碼則以 <script> 標籤載入本地的 hands.js / camera_utils.js（保證掛上全域）。
 *   模型與 wasm 也一起複製，整個專案因此可以離線執行，不依賴任何 CDN。
 */

import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  { from: join(root, 'node_modules/@mediapipe/hands'), to: join(root, 'public/mediapipe/hands') },
  {
    from: join(root, 'node_modules/@mediapipe/camera_utils'),
    to: join(root, 'public/mediapipe/camera_utils'),
  },
];

/** 不需要放進 public/ 的檔案。 */
const SKIP = new Set(['package.json', 'README.md', 'index.d.ts']);

let copied = 0;
let skipped = 0;

for (const target of targets) {
  if (!existsSync(target.from)) {
    console.warn(`[mediapipe] 找不到 ${target.from}，請先執行 npm install`);
    continue;
  }
  await mkdir(target.to, { recursive: true });

  for (const name of await readdir(target.from)) {
    if (SKIP.has(name)) continue;

    const src = join(target.from, name);
    const dest = join(target.to, name);
    const srcStat = await stat(src);

    // 大小相同就當作已是最新，避免每次 install 都重複搬 24MB
    if (existsSync(dest) && (await stat(dest)).size === srcStat.size) {
      skipped++;
      continue;
    }

    await cp(src, dest, { recursive: true });
    copied++;
  }
}

console.log(
  `[mediapipe] 資產就緒（新複製 ${copied} 個、已是最新 ${skipped} 個）→ public/mediapipe/`,
);
