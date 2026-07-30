/**
 * 真實瀏覽器版面檢查
 * ---------------------------------------------------------------------------
 * 為什麼需要它：`layout.mjs` 算的是 canvas 上道具的座標，但畫面上還有一整層
 * **HTML 的 HUD 卡片**（手勢參考、晶圓截面、圖案預覽、互動面板）疊在 canvas 上面。
 * 那一層完全由 CSS 決定，數值模型看不到 —— 所以「手勢參考卡把最右邊兩個藥瓶
 * 蓋掉」「互動面板文字被裁掉」這類 bug 一路溜過去，直到使用者截圖才發現。
 *
 * 這支檢查真的開 Chrome、真的載入頁面，然後：
 *   ① 量每個 HUD 元素的 getBoundingClientRect()
 *   ② 問頁面裡的 canvas 佈局函式「道具畫在哪裡」
 *   ③ 檢查兩者有沒有相交、有沒有超出畫面、文字有沒有被裁掉
 *
 * 用系統已安裝的 Chrome（channel: 'chrome'），不下載 Playwright 自帶的瀏覽器。
 *
 * 因為要起 dev server 又要開瀏覽器，它跟 `npm run check` 分開，用
 * `npm run check:browser` 執行。
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

import { Report } from './lib.mjs';

/**
 * 要驗的視窗尺寸。刻意分成 16:9 與 16:10 兩組，因為兩者的**可用高度**差很多：
 * 同樣 1440 寬，16:10 的 Mac 在非全螢幕下只剩約 500px 高，
 * 而 16:9 的 Windows 筆電通常有 650~900px。高度才是這個版面真正的瓶頸。
 */
const VIEWPORTS = [
  // ── 16:9 ──
  { name: '1920×1080 全螢幕 16:9', w: 1920, h: 1010 },
  { name: '1920×1080 有網址列', w: 1920, h: 880 },
  { name: '1536×864  1920@125%', w: 1536, h: 700 },
  { name: '1366×768  Win 筆電', w: 1366, h: 640 },
  // ── 16:10 ──
  { name: '1680×1050 Mac 全螢幕', w: 1680, h: 980 },
  { name: '1440×900  Mac 有網址列', w: 1440, h: 700 },
  { name: '1440×900  Mac 含書籤列', w: 1440, h: 511 },
  { name: '1280×800  Mac 小視窗', w: 1280, h: 520 },
];

const report = new Report('真實瀏覽器版面（Chrome）');

const server = await createServer({ logLevel: 'silent', server: { port: 5199 } });
await server.listen();
const url = `http://localhost:5199/`;

const browser = await chromium.launch({ channel: 'chrome' });

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({
    viewport: { width: vp.w, height: vp.h },
    // 沒有鏡頭權限也要能量版面；假的媒體串流讓啟動流程不會卡住
    permissions: [],
  });
  // 手勢偵測與鏡頭在這裡都不需要，靜音掉 console 噪音
  page.on('pageerror', () => {});
  await page.goto(url, { waitUntil: 'load' });
  // 等 rAF 跑幾輪，讓關卡把面板與 canvas 都畫出來
  await page.waitForTimeout(900);

  const m = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el || el.classList.contains('hidden')) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right };
    };
    const el = (sel) => document.querySelector(sel);

    /** 元素內容有沒有被容器裁掉（且沒有可捲動的出口）。 */
    const clipped = (sel) => {
      const n = el(sel);
      if (!n) return null;
      const over = n.scrollHeight - n.clientHeight;
      const canScroll = getComputedStyle(n).overflowY;
      return { over, canScroll };
    };

    return {
      viewport: { w: innerWidth, h: innerHeight },
      slot: rect('#viewport-slot'),
      stageView: rect('#stage-view'),
      panel: rect('#stage-panel'),
      panelClip: clipped('#stage-panel'),
      noteClip: clipped('#stage-panel .sp-note'),
      sidebar: rect('#sidebar'),
      handRef: rect('.gesture-ref') ?? rect('#gesture-ref-canvas'),
      section: rect('#hud-cross-section'),
      strip: rect('#substep-strip'),
      arHint: rect('#ar-hint'),
      chips: rect('.vp-top-left'),
      action: rect('#btn-stage-action'),
      warning: rect('#viewport-warning'),
      // 面板裡的操作鈕與標題（黏在頂/底），以及右欄的主要行動鈕
      spConfirm: rect('#stage-panel .sp-confirm'),
      spTitle: rect('#stage-panel .sp-title'),
      rightAction: rect('#btn-primary'),
      rightPanelClip: clipped('#right-panel'),
      sidebarClip: clipped('#sidebar'),
      // canvas 上道具的實際座標，直接問頁面裡的關卡
      props: window.__layoutProbe?.() ?? null,
      docScrollX: document.documentElement.scrollWidth - innerWidth,
    };
  });

  const errs = [];
  const overlap = (a, b, label) => {
    if (!a || !b) return;
    const ox = Math.min(a.r, b.r) - Math.max(a.x, b.x);
    const oy = Math.min(a.b, b.b) - Math.max(a.y, b.y);
    if (ox > 2 && oy > 2) errs.push(`${label} 重疊 ${Math.round(ox)}×${Math.round(oy)}px`);
  };

  // ── HUD 卡片彼此不可以疊 ──
  overlap(m.panel, m.section, '互動面板 / 晶圓截面');
  overlap(m.panel, m.handRef, '互動面板 / 手勢參考');
  overlap(m.panel, m.strip, '互動面板 / 子步驟列');
  overlap(m.panel, m.arHint, '互動面板 / AR 提示');
  overlap(m.panel, m.action, '互動面板 / 完成按鈕');
  overlap(m.handRef, m.strip, '手勢參考 / 子步驟列');
  overlap(m.chips, m.strip, '鏡頭設定列 / 子步驟列');
  overlap(m.chips, m.arHint, '鏡頭設定列 / AR 提示');
  overlap(m.chips, m.panel, '鏡頭設定列 / 互動面板');
  overlap(m.strip, m.arHint, '子步驟列 / AR 提示');
  overlap(m.section, m.action, '晶圓截面 / 完成按鈕');

  // ── HUD 卡片不可以蓋掉 canvas 上的道具 ──
  if (m.props && m.stageView) {
    const toPage = (p) => ({
      x: m.stageView.x + p.x,
      y: m.stageView.y + p.y,
      r: m.stageView.x + p.x + p.w,
      b: m.stageView.y + p.y + p.h,
    });
    for (const prop of m.props) {
      const box = toPage(prop);
      for (const [name, card] of [
        ['手勢參考', m.handRef],
        ['晶圓截面', m.section],
        ['互動面板', m.panel],
        ['子步驟列', m.strip],
        ['AR 提示', m.arHint],
        ['鏡頭設定列', m.chips],
      ]) {
        overlap(box, card, `${name} 蓋住「${prop.label}」`);
      }
    }
  }

  /*
    互動面板本身不捲動（標題與操作鈕要固定看得到），所以：
      · 面板整體不可以有被裁掉的內容
      · 說明文字那一段如果放不下，必須自己能捲
  */
  if (m.panelClip && m.panelClip.over > 4) {
    errs.push(`互動面板內容溢出 ${Math.round(m.panelClip.over)}px`);
  }
  if (m.noteClip && m.noteClip.over > 4 && m.noteClip.canScroll === 'hidden') {
    errs.push(`說明文字被裁掉 ${Math.round(m.noteClip.over)}px（且不能捲動）`);
  }

  // ── 元素不可以掉出畫面 ──
  for (const [name, r] of [
    ['互動面板', m.panel],
    ['晶圓截面', m.section],
    ['手勢參考', m.handRef],
    ['完成按鈕', m.action],
  ]) {
    if (!r) continue;
    if (r.b > m.viewport.h + 2) errs.push(`${name} 超出畫面下緣 ${Math.round(r.b - m.viewport.h)}px`);
    if (r.r > m.viewport.w + 2) errs.push(`${name} 超出畫面右緣 ${Math.round(r.r - m.viewport.w)}px`);
    if (r.y < -2) errs.push(`${name} 超出畫面上緣 ${Math.round(-r.y)}px`);
  }
  /*
    面板可以捲動，但「現在在做哪一步」與「可以按什麼」必須永遠看得到 ——
    捲不到底就以為沒有按鈕。所以標題與操作鈕都設成 sticky，這裡驗它們真的在框內。
  */
  if (m.panel) {
    for (const [name, r] of [['面板標題', m.spTitle], ['面板操作鈕', m.spConfirm]]) {
      if (!r) continue;
      if (r.b > m.panel.b + 2 || r.y < m.panel.y - 2) {
        errs.push(`${name}被捲出面板外，玩家看不到`);
      }
    }
  }
  // 右欄不捲動（設計如此），所以裡面的東西一定要放得下
  if (m.rightPanelClip && m.rightPanelClip.over > 4 && m.rightPanelClip.canScroll === 'hidden') {
    errs.push(`右欄內容被裁掉 ${Math.round(m.rightPanelClip.over)}px（且不能捲動）`);
  }
  if (m.rightAction && m.rightAction.b > m.viewport.h + 2) {
    errs.push(`右欄的主要行動鈕超出畫面 ${Math.round(m.rightAction.b - m.viewport.h)}px`);
  }
  if (m.docScrollX > 2) errs.push(`整頁出現水平捲軸 ${Math.round(m.docScrollX)}px`);
  if (m.warning) errs.push('跳出了「請放大視窗」提示 —— 這個尺寸應該要能玩');

  report.add(
    vp.name,
    errs,
    m.panel ? `面板 ${Math.round(m.panel.w)}×${Math.round(m.panel.h)}` : '（無面板）',
  );

  // ── 結業證書那一頁：整張證書都要看得到 ──
  const cert = await page.evaluate(() => {
    const root = document.getElementById('modal-root');
    const modal = document.getElementById('modal-cert');
    const canvas = document.getElementById('cert-canvas');
    if (!root || !modal || !canvas) return null;
    // 直接把證書視窗打開來量（不必真的走完五關）
    root.classList.remove('hidden');
    for (const m of root.querySelectorAll('.modal')) m.classList.add('hidden');
    modal.classList.remove('hidden');
    // 觸發真正的尺寸同步（UIManager.syncCertificateSize 掛在 resize 上），
    // 這樣驗的就是實際會跑的程式碼，不是另一份估算
    window.dispatchEvent(new Event('resize'));
    const r = canvas.getBoundingClientRect();
    const mr = modal.getBoundingClientRect();
    const btn = document.getElementById('btn-cert-close')?.getBoundingClientRect();
    return {
      canvas: { w: r.width, h: r.height, top: r.top, bottom: r.bottom },
      modal: { top: mr.top, bottom: mr.bottom, scroll: modal.scrollHeight - modal.clientHeight },
      playAgainBottom: btn?.bottom ?? 0,
      natural: { w: canvas.width, h: canvas.height },
      vh: innerHeight,
    };
  });

  if (cert) {
    const e = [];
    // 整張證書要落在畫面內
    if (cert.canvas.top < -1) e.push(`證書上緣被切掉 ${Math.round(-cert.canvas.top)}px`);
    if (cert.canvas.bottom > cert.vh + 1) {
      e.push(`證書下緣被切掉 ${Math.round(cert.canvas.bottom - cert.vh)}px`);
    }
    // 視窗本身不可以需要捲動才看得完
    if (cert.modal.scroll > 2) e.push(`證書視窗需要捲動 ${Math.round(cert.modal.scroll)}px 才看得完`);
    if (cert.modal.bottom > cert.vh + 1) {
      e.push(`證書視窗超出畫面下緣 ${Math.round(cert.modal.bottom - cert.vh)}px`);
    }
    // 「再玩一次」按鈕也要看得到，不然玩家會以為卡住了
    if (cert.playAgainBottom > cert.vh + 1) {
      e.push(`「再玩一次」被切掉 ${Math.round(cert.playAgainBottom - cert.vh)}px`);
    }
    // 等比縮放：長寬比不能變形
    const want = cert.natural.w / cert.natural.h;
    const got = cert.canvas.w / cert.canvas.h;
    if (Math.abs(want - got) > 0.02) e.push(`證書變形（${got.toFixed(2)} vs ${want.toFixed(2)}）`);
    if (cert.canvas.w < 320) e.push(`證書縮到只有 ${Math.round(cert.canvas.w)}px 寬，看不清`);

    report.add(
      `${vp.name}  結業證書`,
      e,
      `${Math.round(cert.canvas.w)}×${Math.round(cert.canvas.h)}`,
    );
  }

  await page.close();
}

await browser.close();
await server.close();

process.exit(report.print() === 0 ? 0 : 1);
