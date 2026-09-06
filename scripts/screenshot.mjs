/**
 * 產生 README 用的截圖、社群分享圖（OG image）與 demo GIF。
 * ---------------------------------------------------------------------------
 *   node scripts/screenshot.mjs
 *
 * 需要系統裝有 Google Chrome（跟 npm run check:browser 一樣用 channel: 'chrome'）。
 * 產出：
 *   docs/screenshots/app.png   1440×900，遊戲主畫面
 *   public/og-image.png        1200×630，社群分享卡（會一起部署到 Pages）
 *   docs/demo.gif              約 640×380，走過五道製程 → 結業證書
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import gifenc from 'gifenc';
import { createServer } from 'vite';

const { GIFEncoder, quantize, applyPalette } = gifenc;

const server = await createServer({ logLevel: 'silent', server: { port: 5223 } });
await server.listen();
const url = 'http://localhost:5223/';

const browser = await chromium.launch({
  channel: 'chrome',
  // 給一個假的攝影機串流，UI 才不會停在「鏡頭無法使用」的斜紋畫面
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

// ── 主畫面截圖 ──
{
  await mkdir('docs/screenshots', { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    permissions: ['camera'],
  });
  page.on('pageerror', () => {});
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500); // 等關卡把面板與場景畫出來
  await page.screenshot({ path: 'docs/screenshots/app.png' });
  await page.close();
  console.log('✓ docs/screenshots/app.png');
}

// ── OG 分享卡 ──
{
  const og = `<!doctype html><meta charset="utf-8"><style>
    *{margin:0;box-sizing:border-box}
    body{width:1200px;height:630px;overflow:hidden;
      font-family:'Noto Sans TC','IBM Plex Sans',system-ui,sans-serif;
      background:radial-gradient(120% 120% at 15% 0%,#12333a 0%,#0b1416 55%,#070d0f 100%);
      color:#eef4f5;display:flex;flex-direction:column;justify-content:center;
      padding:96px;position:relative}
    .kicker{font-family:'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.32em;
      font-size:22px;color:#5fd0c4;text-transform:uppercase}
    h1{font-size:82px;font-weight:700;line-height:1.12;margin:26px 0 22px;max-width:14ch}
    p{font-size:30px;color:#9fb6b8;line-height:1.55;max-width:30ch}
    .steps{position:absolute;right:96px;bottom:90px;display:flex;gap:14px}
    .steps span{font-family:'IBM Plex Mono',monospace;font-size:19px;color:#7fd8cd;
      border:1px solid #2f5b5b;border-radius:999px;padding:9px 18px}
    .bar{position:absolute;left:0;top:0;height:8px;width:100%;
      background:linear-gradient(90deg,#3aa89b,#8ee6da)}
  </style>
  <div class="bar"></div>
  <div class="kicker">WebAR · Gesture · MediaPipe Hands</div>
  <h1>半導體製程<br>沉浸式模擬</h1>
  <p>用捏合手勢走完 RCA 清洗、薄膜沉積、微影、顯影、蝕刻五道製程</p>
  <div class="steps"><span>RCA</span><span>沉積</span><span>微影</span><span>顯影</span><span>蝕刻</span></div>`;

  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(og, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const buf = await page.screenshot();
  await writeFile('public/og-image.png', buf);
  await page.close();
  console.log('✓ public/og-image.png');
}

// ── demo GIF：走過五道製程 → 結業證書 ──
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 760 },
    deviceScaleFactor: 0.5, // 輸出約 640×380，控制 GIF 檔案大小
    permissions: ['camera'],
  });
  page.on('pageerror', () => {});
  // 跳過首次「怎麼玩」彈窗
  await page.addInitScript(() => {
    try {
      localStorage.setItem('semiconductor-camp:seen-intro', '1');
    } catch {
      /* ignore */
    }
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__camp), null, { timeout: 8000 });
  await page.waitForTimeout(1800);

  const frames = [];
  const grab = async () => frames.push(await page.screenshot({ type: 'png' }));

  await grab();
  await grab(); // RCA 開場多停一下

  // 依序強制完成五關；每一關 devComplete 會把晶圓推進一層，截面圖 HUD 跟著變
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => {
      const c = window.__camp;
      c.stages.forceCompleteCurrent();
      if (c.stages.hasNext()) c.stages.advance();
    });
    await page.waitForTimeout(260);
    await grab();
    await page.waitForTimeout(260);
    await grab();
  }

  // 五關完成後會延遲 1.6s 開結業證書
  await page.waitForTimeout(2200);
  await grab();
  await grab();
  await grab();

  await page.close();

  // PNG → RGBA → 量化 → GIF
  const decoded = frames.map((buf) => PNG.sync.read(buf));
  const { width, height } = decoded[0];
  const enc = GIFEncoder();
  const palette = quantize(decoded[0].data, 256);
  for (const png of decoded) {
    const index = applyPalette(png.data, palette);
    enc.writeFrame(index, width, height, { palette, delay: 320 });
  }
  enc.finish();
  await writeFile('docs/demo.gif', Buffer.from(enc.bytes()));
  const kb = Math.round(enc.bytes().length / 1024);
  console.log(`✓ docs/demo.gif  (${width}×${height}, ${decoded.length} 幀, ${kb} KB)`);
} catch (err) {
  console.warn(`⚠ demo.gif 產生失敗（略過）：${err.message}`);
}

await browser.close();
await server.close();
