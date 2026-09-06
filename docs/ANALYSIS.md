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
| 7 | `chip_wars/chip_wars.html` 原型仍在版控 | repo 根 | README 說「已被 `src/` 取代，僅留作參考」。留著沒害，但會讓新讀者困惑，建議搬到 `docs/` 或 tag 一個 `prototype` 後刪除 |
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

### 4.3 合併前檢查清單

- [ ] 安裝 Node ≥ 24
- [ ] `npm install`
- [ ] `npm run verify`（typecheck + check + check:browser 全綠）
- [ ] 手動：第二關選 PVD，確認「金屬鍍膜」顯示為灰色斜線「–」而非打勾
- [ ] 手動：第二關選 CVD，確認四個子步驟行為與外觀完全不變
- [ ] 手動：完成 PVD 關後看結業證書，晶圓／STL 仍正常（`devComplete` 未受影響）

---

## 5. 後續改進 Roadmap（依投報比排序）

### 第一優先：把品質網變成自動的

1. **加 CI**（P1 #1、#2）：`.github/workflows/verify.yml`，push / PR 觸發，
   Node 24，跑 `typecheck` + `check`。`check:browser` 開一個 `continue-on-error`
   的 job 或用 setup-chrome。**這是目前最缺的一塊** —— 專案已經有很好的檢查，
   只差沒人強制執行。

2. **`engines` + `.nvmrc`**：明講 Node 24。

### 第二優先：讓關卡狀態機可測（P1 #3、#4）

現況：關卡要完整 `StageContext`（DOM + canvas + UIManager）才跑得起來，所以
`onFrame()` 狀態機無法測，`devComplete` 鏈只能在檢查腳本裡重寫一份。

建議路徑：
1. 把 `StageContext` 依「關卡真正呼叫到的方法」縮成一個窄介面
   （目前關卡其實只用 `ui.setPanel/setArHint/...`、`desk.setWaferVisible/...`、`wafer.*`）。
2. 寫一個 `makeFakeContext()`：`ui` / `desk` 用記錄呼叫的 spy，`wafer` 用真的 `WaferState`。
3. 對每一關寫「餵一串 `HandFrame` → 斷言子步驟推進與 `wafer` 最終狀態」的測試。
4. `wafer-state.mjs` 的 `devComplete` 鏈改成 import 真的關卡 + `makeFakeContext()`，
   刪掉重寫的副本。

### 第三優先：小型體驗與擴充點

- **`ChoiceOption.preview`**（P2 #5）：加 `preview?: (ctx, w, h) => void`，
  `UIManager` 的 choice 分支若有 preview 就建一個小 canvas 呼叫它。
  之後第三、五關的自繪卡片可以收斂回標準 `choice` 面板。
- **`prefers-reduced-motion`**：粒子數量 / 爆炸動畫在此媒體查詢下降級。
- **`index.html` meta**（P2 #10）：補 `description` 與 OG／Twitter 卡。
- **`MixPanel` 去留**（P2 #6）：找關卡用它，或從主線移除。

### 不建議動

- 不要引入前端框架或狀態管理庫 —— 現有的宣告式 `PanelSpec` + 簽章比對已經解決了
  重繪問題，換 React 只會多一層。
- 不要把 `scene/*` 的純函式包成 class。
- 不要合併關卡檔 —— 「一關一檔、內聚優先」是刻意的取捨。

---

## 6. 一頁摘要

- **狀態**：健康。文件、分層、自建測試都在水準以上。
- **最大缺口**：有一整套 `npm run verify` 檢查，卻沒有 CI 去強制跑它。
- **次大缺口**：關卡互動狀態機無自動測試，`devComplete` 鏈是重寫的。
- **本次已改**：子步驟「略過」狀態（P1 blessed fix）+ 3 處文件同步。
- **下一步**：CI → 可測的 `StageContext` → `ChoiceOption.preview`。
