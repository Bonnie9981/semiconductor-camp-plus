# 變更紀錄

格式依 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版本依 [SemVer](https://semver.org/lang/zh-TW/)。

## [0.2.0] — 2026-09-06

`semiconductor-camp` 的發表整理版（新 repo `semiconductor-camp-plus`）。功能不變，
補齊了工程與專案結構。

### 新增

- **GitHub Actions CI**（`.github/workflows/verify.yml`）：push / PR 觸發，
  `lint` + `check` + `check-browser` 三個 job。
- **GitHub Pages 自動部署**（`.github/workflows/deploy.yml`）：push `main` 後
  自動 build 並發佈線上 demo。
- **ESLint + Prettier + `.editorconfig` + `.gitattributes`**：`npm run lint` /
  `format` / `format:check`；全庫行尾統一 LF。
- **關卡狀態機自動測試**（`scripts/checks/stage-machine.mjs`）：import 真正的 5 個
  Stage 類別，測 `StageManager` 生命週期、預設路線的 `devComplete()` 鏈、
  每關 `onFrame` 冒煙、以及透過真實 choice 面板驅動的 method / tone / etch 三維分支
  （`BaseStage.goToSubForTest()` 跳到選擇子步驟）。
- **子步驟「略過」狀態**：PVD 路線的「金屬鍍膜」畫成灰色虛線「–」，不再假裝已完成。
- **`prefers-reduced-motion`**：CSS 關掉非必要動畫；突沸動畫（整片白光閃焰）
  在偏好開啟時改成靜態警示。
- **效能模式**（`src/core/perf.ts`）：「設定」裡可選 自動 / 高品質 / 效能優先；
  效能優先＝lite 手部模型 + 640×480 鏡頭 + DPR 1 + 隔幀推論 + 骨架不畫陰影。
  自動模式偵測到持續掉幀（< 40 FPS 約 2.5 秒）會自己降級並提示一次；選擇存 localStorage。
- **滑鼠 / 觸控拖曳**（`src/core/PointerHand.ts`）：按住鏡頭視窗上的空白處會被翻譯成
  等效的捏合手，沒有攝影機也能直接抓畫面上的藥瓶、光罩、旋鈕；按在真正的 HTML
  控制項上不接管。
- **「使用攝影機手勢」開關**（「設定」）：關掉＝純滑鼠／觸控玩，完全不啟動鏡頭與
  MediaPipe（最省效能）。存 localStorage。效能優先模式另把粒子上限從 140 降到 60。
- **提示音**（`src/core/sound.ts`）：Web Audio 即時合成（無音檔）—— 抓取 / 放開 /
  過關 / 全部完成 / 失敗。「設定」有開關，存 localStorage。
- **首次引導**：第一次進來自動彈一次「怎麼玩」（改寫成涵蓋手勢與滑鼠兩種玩法），
  看過就記住。
- **製程小百科**（Header 的 📖）：一頁講完五道製程各在做什麼、為什麼要這樣做。
- **結業評等**：證書多一列「評等」（S/A/B/C）—— 依失誤次數、圖案覆蓋率、用時計算。
- **證書「觀念回顧」**：證書上多一段，把你這次的選擇（PVD/CVD、正/負光阻、乾/濕蝕刻）
  對應回背後的原理，不評分、純複習。
- **各關「為什麼」**：每一關「操作說明」開頭多一條 💡，一句話講這一關在整條製程裡的角色，
  與製程小百科呼應。
- **demo GIF**（`docs/demo.gif`）：README 放一段走過五道製程 → 結業證書的示範動畫；
  `npm run screenshot` 會一起產生（用 `gifenc` + `pngjs`，dev 相依）。
- **`docs/RISKS.md`**：專案層級的已知風險與遷移觸發條件（MediaPipe 停更版本、教學有效性）。
- README 新增「這是什麼 / 給誰 / 怎麼玩」段落。
- `engines: node >=24`、`.nvmrc`、`CONTRIBUTING.md`、issue / PR 範本、
  MIT `LICENSE`、`index.html` 的 description / OG / Twitter meta。
- `docs/ANALYSIS.md`：程式碼分析與改進 roadmap。

### 變更

- `README.md` / `docs/IMPLEMENTATION.md` 多處與程式碼同步（`MIN_VIEWPORT`、
  重複的 `verify` 表列、`semiconductorAR` 舊名、自動化檢查清單）。
- 整個 `src/` 與 `scripts/` 用 Prettier 掃過一次（純格式，無語意變更）。

### 移除

- 未使用的 `mix` 互動面板（`MixPanel` type + `UIManager` 的 mix 分支 + 相關 CSS）。
  五關的配比互動全部是「動手倒藥瓶」的 `pour` 面板。
- `chip_wars/`（與本專案無關）。

### 修正

- `index.html` 寫死的步驟計數「已完成 0 / 6」→「0 / 5」、Header 的「關卡 1 / 6」→「1 / 5」、
  進度「16%」→「0%」（實際 5 關；JS 首次同步就會覆寫，但首幀前會閃錯的數字）。
- `scripts/checks/layout.mjs` 未使用的 `clamp` import。

[0.2.0]: https://github.com/Bonnie9981/semiconductor-camp-plus/releases/tag/v0.2.0
