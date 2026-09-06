# 程式碼分析與改進建議

> 產出日期：2026-09-06
> 對象版本：`main` @ `db53e8b`（分析在分支 `improve/analysis-pass`）
> 分析方式：純靜態閱讀。**這台機器沒有 Node**，因此 `npm run verify`（typecheck +
> check + check:browser）尚未跑過 —— 合併前務必補跑。

---

## 1. 專案概觀

| 項目 | 內容 |
| --- | --- |
| 技術棧 | Vite 8 + TypeScript 5.6（`strict`）+ MediaPipe Hands，無前端框架 |
| 程式規模 | `src/` 約 18.5k 行；最大檔 `style.css`(1954)、`Stage1RCA.ts`(1277)、`UIManager.ts`(1120) |
| 執行入口 | `src/main.ts` 單一 rAF 主迴圈：手勢 → 關卡 → 繪製 → UI |
| 自動化檢查 | `scripts/checks/`：晶圓狀態機、STL 幾何、版面矩陣、證書 PDF、真 Chrome 量版面 |
| 相依 | runtime 僅 `@mediapipe/*` 兩包；其餘都是自寫（含最小 PDF 產生器） |
| 文件 | `README.md` + `docs/IMPLEMENTATION.md` 品質很高，接手門檻低 |

**整體評語**：這是一個成熟度遠高於一般 side project 的專案。架構分層清楚、
坑都有註解、還為「型別檢查抓不到的版面錯誤」自建了兩層測試。以下的問題多屬
「錦上添花」而非「救火」。

---

## 2. 架構優點（值得保留、別重構掉）

1. **單向資料流 + 單一主迴圈**：`CameraManager` 只存推論結果不觸發渲染，
   幀率與推論速度解耦，關卡邏輯每幀只跑一次。
2. **關卡不碰 DOM**：關卡回傳宣告式 `PanelSpec`，`UIManager` 用「簽章比對」
   決定要不要重建 DOM —— 解決了「每秒 60 次 replaceChildren 導致按鈕點不到」。
3. **`WaferState` 是唯一真實來源**：截面圖與俯視圖都從它讀，關卡只改資料。
4. **場景模組是純函式**：`scene/*` 吃狀態畫一格，燒杯能被 RCA／顯影／濕蝕刻三關共用。
5. **版面「問 DOM，不要算」**：`panelInset()` / `flushBands()` / `sceneOverlay()`
   把 canvas 佈局錨定到實測的 HTML 位置，而不是寫死斷點。
6. **檢查直接 import `src/`**：用 Node 24 原生剝型別 + ESM loader hook，
   測到的就是出貨的那份程式，不是複製品。

---

## 3. 發現的問題

### P1 — 建議近期處理

| # | 問題 | 位置 | 影響 | 建議 |
| --- | --- | --- | --- | --- |
| 1 | **沒有 CI** | 無 `.github/` | `npm run verify` 全靠人記得跑；README 花大篇幅講的檢查在 PR 上不會自動把關 | 加 GitHub Actions：`npm ci` → `npm run typecheck && npm run check`（`check:browser` 需要 Chrome，可用 `browser-actions/setup-chrome` 或標為 optional job） |
| 2 | **`package.json` 沒有 `engines`** | `package.json` | 檢查腳本依賴 Node 24 的原生型別剝除（`IMPLEMENTATION.md` 有寫），但沒有在 `engines` 宣告，用 Node 20/22 的人會拿到看不懂的錯誤 | 加 `"engines": { "node": ">=24" }`，並在 CI 固定 Node 24 |
| 3 | **關卡狀態機零測試** | `stages/*.onFrame()` | `WaferState`／STL／版面都有檢查，但五關的互動狀態機完全靠手動玩迴歸 | 見 §5「測試」——先把 `StageContext` 縮到可造假物件 |
| 4 | **`devComplete` 鏈是重寫的** | `scripts/checks/wafer-state.mjs` | 改任一關 `devComplete()` 忘了同步腳本，測試會過但行為已變 | 同 #3，能造假 `StageContext` 就能 import 真的 |

### P2 — 可排入 backlog

| # | 問題 | 位置 | 說明 |
| --- | --- | --- | --- |
| 5 | `ChoiceOption` 不支援縮圖 | `core/types.ts` | 第三關正負光阻、第五關乾濕蝕刻都得自己在 canvas 畫卡片繞過。加 `preview?: (ctx, w, h) => void` 讓選項自畫縮圖（`IMPLEMENTATION.md` 已列此建議） |
| 6 | `MixPanel` 是死程式 | `types.ts` / `UIManager.setPanel` | `mix` 面板實作完整、通過型別檢查，但沒有任何關卡在用。要嘛找關卡用它，要嘛移到分支保存、從主線拿掉以縮小 `setPanel()` |
| ~~7~~ | ~~`chip_wars/` 仍在版控~~ | — | 已刪除（與本專案無關） |
| 8 | 沒有 `LICENSE` | repo 根 | 教學用途建議補一個（MIT / CC-BY 之類），否則預設「保留全部權利」，別人不能合法 fork 教學 |
| 9 | 文件與程式不同步（本次已修 3 處） | 見 §4 | `MIN_VIEWPORT` 寫成 1100×600（實為 1100×460）、README 重複的 `npm run verify` 表格列、`semiconductorAR` vs `semiconductor-camp` 舊名 |
| 10 | `index.html` 缺 `description` / social meta | `index.html` | 已有 `lang="zh-Hant"` 與 viewport，但沒有 `<meta name="description">` 和 OG／Twitter 卡片，分享連結時沒有預覽 |

### P3 — 觀察，未必要動

- `style.css` 1954 行單檔。有清楚的分節註解，暫時可讀；若再長建議依 Dashboard 區塊拆檔。
- `Stage1RCA.ts` / `Stage3Litho.ts` 都逾 1100 行。內聚性高（一關一檔是專案原則），
  但 `Stage1RCA` 的配液互動或許可再抽一層 `MixingBench` 基底，和 `DipStageBase` 對稱。
- MediaPipe 版本釘在 2023 的 `0.4.x`。能動就別碰，但知道它已不再更新、未來瀏覽器 API 變動有風險。
- 無 `prefers-reduced-motion` 處理：粒子場、爆炸動畫對前庭敏感的使用者可能不適。

---

## 4. 本次已做的改進（分支 `improve/analysis-pass`）

### 4.1 子步驟「略過」狀態（原 `IMPLEMENTATION.md` §7 待解問題 #1）

**問題**：第二關走 PVD 時「金屬鍍膜」子步驟被 `nextSub()` 跳過，進度列卻把它
畫成打勾的「已完成」，學生會以為自己做過那一步。

**改法**（純加法，不動既有行為）：

| 檔案 | 變更 |
| --- | --- |
| `stages/BaseStage.ts` | 新增 `readonly skippedSubs = new Set<number>()`；新增 `protected skipSub()`（標記目前 index 為略過再 `nextSub()`）；`resetSub()` 順手 `clear()` |
| `stages/Stage2Deposition.ts` | PVD 路線的 metal 步驟改呼叫 `skipSub()` 而非 `nextSub()` |
| `ui/UIManager.ts` | `renderSubsteps()` 多收 `skipped: ReadonlySet<number>`；略過的畫 `is-skipped`、編號顯示「–」、簽章 key 納入 skipped 集合 |
| `style.css` | 新增 `.substep.is-skipped`（灰、虛線框、標題刪除線）；label 加 `.substep-label` class |

**為何安全**：`skipSub()` 是新方法沒有既有呼叫者；`renderSubsteps()` 第三參數有預設值；
`skipped` 集合只影響 class 與編號字元，不改版面尺寸（虛線框仍 1px），
`scripts/checks/browser.mjs` 只量 `#substep-strip` 的外框，不受影響。

### 4.2 文件修正（零風險）

- `docs/IMPLEMENTATION.md`：`MIN_VIEWPORT` 1100×600 → **1100×460**（對齊 `core/Viewport.ts` 與 README）
- `README.md`：刪掉兩處重複又矛盾的 `npm run verify` 表格列（`package.json` 定義為 typecheck + check + check:browser）
- `README.md`：`cd semiconductorAR` / `semiconductorAR/` → `semiconductor-camp`（對齊 `package.json` name）
- `docs/IMPLEMENTATION.md`：把 #1 從「仍然存在」移到「已解決」

### 4.3 第二批改進（同分支，2026-09-06 稍晚）

| 項目 | 檔案 | 對應 |
| --- | --- | --- |
| **GitHub Actions CI** | `.github/workflows/verify.yml` | P1 #1 — push / PR 觸發，Node 24；`check` job 跑 typecheck + check + build，`check-browser` job 裝 Chrome 跑 `check:browser` |
| **`engines` + `.nvmrc`** | `package.json`、`.nvmrc` | P1 #2 — 明講 Node ≥ 24 |
| **MIT LICENSE** | `LICENSE` | P2 #8 — Copyright 2026 Bonnie9981 |
| **社群分享 meta** | `index.html` | P2 #10 — description / OG / Twitter / theme-color |
| **關卡狀態機測試** | `scripts/checks/stage-machine.mjs`（新）、`run.mjs` | P1 #3／#4 — ① 用窄的 `makeStubContext()` 跑完整條 `StageManager` 生命週期，驗預設路線的 `devComplete()` 鏈與 `buildResult()`；② 用 `makeFrameStubs()` + permissive 2D context 替身跑每一關 `onEnter` + 8 幀 `onFrame`（不丟例外、不自己過關）。原本「零真實關卡覆蓋」→ 現在生命週期與逐幀繪圖路徑都跑會出貨的程式。分支路線（cvd/negative/wet）因 private 欄位仍由 `wafer-state.mjs` 重寫矩陣涵蓋 |
| **`prefers-reduced-motion`** | `src/core/motion.ts`（新）、`style.css`、`scene/Explosion.ts` | P2 — CSS 一段 blanket 關掉非必要轉場／動畫；突沸動畫（整片白光閃焰 + 擴散衝擊波，對光敏感者不友善）在偏好開啟時改成靜態警示 |
| **移除 `chip_wars/`** | 刪除 | P2 #7 — 與本專案無關 |

### 4.4 第三批：發表整理（scope「做到可發表」）

| 項目 | 檔案 | 說明 |
| --- | --- | --- |
| **ESLint + Prettier + `.editorconfig` + `.gitattributes`** | 4 個設定檔、`eslint.config.js` | 保守設定；全庫行尾統一 LF；`npm run lint` / `format` / `format:check`；`verify` 串進去；CI 加最前面的 `lint` job。整個 `src/`+`scripts/` 用 Prettier 掃過一次（純格式）。 |
| **移除 `mix` 面板** | `types.ts`、`UIManager.ts`、`style.css` | `MixPanel` 五關都沒用；配比互動全是「動手倒藥瓶」的 `pour` 面板。 |
| **修寫死的步驟計數** | `index.html` | `已完成 0 / 6` → `0 / 5`。 |
| **CVD 分支測試** | `stage-machine.mjs` | 透過關卡「真的那份」`choice` 面板的 `onToggle` 回呼選 CVD，驗 `devComplete()` 補氧化層 —— 不用在關卡上加測試專用注入點。 |
| **GitHub Pages 自動部署** | `.github/workflows/deploy.yml` | push `main` → build → 發佈。需在 repo Settings → Pages 把來源設成「GitHub Actions」。 |
| **截圖 + OG 分享圖** | `scripts/screenshot.mjs`、`docs/screenshots/app.png`、`public/og-image.png` | `npm run screenshot` 產生；README 放主畫面截圖；`index.html` 的 og:image 指向 Pages。 |
| **貢獻者文件** | `CONTRIBUTING.md`、`.github/ISSUE_TEMPLATE/`、`PULL_REQUEST_TEMPLATE.md`、`CHANGELOG.md` | 版本升到 **0.2.0**。 |

### 4.5 驗證結果（本機 + GitHub Actions）

Node 24.20.0（官方 zip，SHA256 對過）已裝到 `%LOCALAPPDATA%\nodejs` 並加入使用者 PATH。

```
npm run lint          ✓  0 problems
npm run format:check  ✓  全庫符合 Prettier
npm run typecheck     ✓  0 errors
npm run check         ✓  全部通過（含 stage-machine：生命週期 + onFrame 冒煙 + CVD 分支）
npm run check:browser ✓  8 種視窗尺寸 + 結業證書
npm run build         ✓  dist/ 產出正常（js 182 kB / gzip 60 kB）
```

GitHub Actions：`verify`（`lint` + `check` + `check-browser`）全綠。`deploy` 需要你先開 Pages。

### 4.6 第四批：效能 + 體驗打磨

| 項目 | 檔案 | 說明 |
| --- | --- | --- |
| **效能模式** | `src/core/perf.ts`（新）、`CameraManager`、`GestureDetector`、`main.ts`、`index.html` | 「你的電腦跑起來很卡」。auto / high / lite 三檔；lite＝lite 手部模型 + 640×480 鏡頭 + DPR 1 + 隔幀推論 + 骨架不畫陰影；auto 偵測到持續 < 40 FPS 約 2.5 秒自動降級並提示。存 localStorage。 |
| **滑鼠 / 觸控拖曳** | `src/core/PointerHand.ts`（新）、`main.ts` | 按住鏡頭視窗 → 翻成等效捏合手，關卡命中判定不用改。沒鏡頭也能直接抓器材。 |
| **提示音** | `src/core/sound.ts`（新）、`main.ts`、`index.html` | Web Audio 即時合成、無音檔。抓取 / 放開 / 過關 / 完成 / 失敗。設定有開關。 |
| **首次引導** | `index.html`、`UIManager.showIntroOnce()`、`browser.mjs` | 第一次進來自動彈「怎麼玩」（改寫涵蓋兩種玩法）。`browser.mjs` 加 initScript 跳過它，版面檢查才量得到面板。 |

### 4.8 第五批：backlog 清掃（「所有主軸自動下去」）

| 項目 | 檔案 | 說明 |
| --- | --- | --- |
| **純滑鼠模式** | `main.ts`、`index.html` | 「設定 → 使用攝影機手勢」關掉＝`camera.stop()`，完全不跑 MediaPipe。存 localStorage。 |
| **精簡模式降粒子上限** | `scene/Particles.ts` | `setParticleCap()`；lite 140→60。 |
| **製程小百科** | `index.html`、`UIManager` | Header 📖 開一頁 modal，五道製程的「為什麼」。 |
| **結業評等** | `Certificate.ts`、`main.ts` | 證書多「評等」列（S/A/B/C）：失誤次數 + 圖案覆蓋率 + 用時。 |
| **tone / etch 分支測試跑真程式** | `stage-machine.mjs`、`BaseStage.goToSubForTest()` | 透過真實 choice 面板 `onToggle` 驅動 Stage3 正/負光阻、Stage5 乾/濕蝕刻；`wafer-state.mjs` 的重寫矩陣只剩「驗整條鏈最終狀態」的角色。 |
| 修 Header 寫死的「關卡 1 / 6」→「1 / 5」 | `index.html` | |

### 4.9 驗證

```
npm run verify  ✓  lint + format:check + typecheck + check（stage-machine 17 項）+ check:browser
npm run build   ✓  js 189 kB / gzip 62 kB
```

瀏覽器實測（Browser pane）：首次自動彈「怎麼玩」+ localStorage 記住不再彈；
效能模式切 lite → DPR 從 1.5 降到 1；設定有提示音開關；pointerdown 在
`#stage-area` 空白處會被 `PointerHand` 接管、在按鈕上不會。無 console error。
（rendering 的視覺確認被 Browser pane 隱藏時的 rAF 暫停擋住，改靠邏輯驗證。）

**待你在真實裝置上確認**：

- 你原本會卡的那台電腦：設定 → 效能模式 → 「效能優先」是否順了；或留「自動」看會不會自己切
- 手機 / 平板：按住畫面上的藥瓶能不能拖
- 提示音會不會太吵（設定可關）

---

## 5. 後續改進 Roadmap（依投報比排序）

### ✅ 已完成

原始 P1 / P2 缺口、工程結構（CI、Pages、ESLint/Prettier、貢獻者文件、CHANGELOG、
v0.2.0）、效能（效能模式、純滑鼠模式、降粒子）、體驗（滑鼠／觸控拖曳、提示音、
首次引導、製程小百科、結業評等）、關卡測試（生命週期 + onFrame 冒煙 + 三維分支）
都做完了。細節見 §4.1–4.9。

### 只剩兩項，都非發表阻礙

1. **「拖對了 → 子步驟推進」的座標互動測試**：目前 `stage-machine.mjs` 靠 choice
   面板驅動分支、靠 devComplete 驗結果，但「捏著藥瓶拖進正確的槽」這種靠像素命中的
   流程還是只有手動玩會測到。要補就得餵「有座標的 `HandFrame` 序列」，並讓
   `makeFrameStubs()` 的假 `desk.geometry` 與各關 hit-box 對得起來 —— 這一塊天生偏
   brittle（版面微調就可能弄壞測試而 gameplay 沒事），投報比偏低。

2. **`ChoiceOption.preview`**（原 P2 #5）：加 `preview?: (ctx, w, h) => void` 讓
   choice 選項自畫縮圖。**建議不做** —— 第三關的正負光阻卡片有三列剖面示意圖
   （曝光 / 顯影 / 蝕刻），是重要的教學內容，收斂成一個小縮圖是降級不是改善；
   第五關的乾濕蝕刻卡片同理。這兩處的「自繪卡片」是刻意比 choice 面板豐富的。

### 不建議動

- 不要引入前端框架或狀態管理庫 —— 現有的宣告式 `PanelSpec` + 簽章比對已經解決了
  重繪問題，換 React 只會多一層。
- 不要把 `scene/*` 的純函式包成 class。
- 不要合併關卡檔 —— 「一關一檔、內聚優先」是刻意的取捨。

---

## 6. 一頁摘要

- **狀態**：已發表、線上 demo 上線、CI（verify + deploy）全綠、v0.2.0。
- **做完的（15 個工作項、~30 個 commit）**：
  - 工程：CI（lint + check + check-browser）+ GitHub Pages 自動部署、ESLint + Prettier
    + `.editorconfig` + `.gitattributes`(LF)、`engines`/`.nvmrc`、MIT LICENSE、
    社群 meta + OG 圖、CONTRIBUTING/issue・PR 範本/CHANGELOG/README 截圖
  - 測試：`stage-machine.mjs`（真關卡生命週期 + `devComplete` 鏈 + `onFrame` 冒煙
    + method/tone/etch 三維分支）
  - 效能：效能模式（auto/high/lite + 掉幀自動降級）、純滑鼠模式、精簡模式降粒子
  - 體驗：子步驟「略過」狀態、`prefers-reduced-motion`、滑鼠／觸控拖曳、提示音、
    首次引導、製程小百科、結業評等
  - 清理：移除 `mix` 面板、移除 `chip_wars/`、修寫死的步驟計數
- **已驗證**：`npm run verify` + `npm run build` 全綠（本機 Node 24.20.0 + GitHub Actions）。
- **要你在真機上試**：會卡的那台電腦切「效能優先」（或「使用攝影機手勢」關掉）；
  手機按住拖藥瓶；提示音音量；走完一輪看結業證書上的評等。
- **留給之後（都非阻礙）**：座標命中的互動測試（偏 brittle）、`ChoiceOption.preview`
  （建議不做，會犧牲第三、五關的教學剖面圖）。
