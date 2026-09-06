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
  每關 `onFrame` 冒煙、以及透過真實 choice 面板驅動的 CVD 分支。
- **子步驟「略過」狀態**：PVD 路線的「金屬鍍膜」畫成灰色虛線「–」，不再假裝已完成。
- **`prefers-reduced-motion`**：CSS 關掉非必要動畫；突沸動畫（整片白光閃焰）
  在偏好開啟時改成靜態警示。
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

- `index.html` 寫死的步驟計數「已完成 0 / 6」→「0 / 5」（實際 5 關）。
- `scripts/checks/layout.mjs` 未使用的 `clamp` import。

[0.2.0]: https://github.com/Bonnie9981/semiconductor-camp-plus/releases/tag/v0.2.0
