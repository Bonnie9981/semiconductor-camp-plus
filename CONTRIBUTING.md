# 參與開發

謝謝你想幫忙。這份文件說明環境需求、送 PR 前要跑什麼、以及專案的幾條硬規則。
架構層面的「為什麼這樣設計、怎麼加關卡」在 [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md)。

## 環境

- **Node ≥ 24**（`.nvmrc` 有寫）。檢查腳本靠 Node 24 原生剝除 TypeScript 型別。
- `npm install`（`postinstall` 會把 MediaPipe 資產複製到 `public/mediapipe/`，約 26 MB）
- `npm run dev` → http://localhost:5173

## 送 PR 前

```bash
npm run verify
```

它會依序跑：

| 步驟 | 內容 |
| --- | --- |
| `lint` | ESLint |
| `format:check` | Prettier 格式（不合就先 `npm run format`） |
| `typecheck` | `tsc --noEmit` |
| `check` | 晶圓狀態機、關卡狀態機、STL 幾何、版面矩陣、證書 PDF —— 全部 import 真正的原始碼 |
| `check:browser` | 開系統的 Google Chrome，量 HUD 版面在 8 種視窗尺寸下沒有互相壓到 |

CI（`.github/workflows/verify.yml`）會在 PR 上跑同一套。`check:browser` 需要本機裝有
Google Chrome；沒有的話至少把前四步跑過。

## 硬規則

1. **關卡不碰 DOM。** 關卡回傳宣告式的 `PanelSpec`，由 `UIManager` 渲染。
2. **晶圓只有一份。** 狀態都在 `WaferState`，關卡只改資料、不畫圖。
3. **`scene/` 是純函式。** 吃一份狀態、畫一格畫面，不放遊戲邏輯。
4. **版面從實測值推導**，不要在 TypeScript 裡寫死斷點 —— 問 `panelInset()` /
   `sceneOverlay()`，不要自己算。
5. **需要手勢的操作，面板上一定要有等效按鈕**（沒有攝影機也要玩得完）。
6. 改到任何一關的 `devComplete()`，記得同步 `scripts/checks/wafer-state.mjs` 的
   分支矩陣（tone / etch 那兩維目前仍是重寫的）。

## 新增一關

照 `docs/IMPLEMENTATION.md` 的〈動手做：從 Stub 到完整關卡〉。摘要：寫一個
`BaseStage` 子類別、在 `src/main.ts` 多 `register()` 一行，其餘不用動。

## Commit 訊息

沿用現有風格的中文 conventional commits：`feat(關卡): …`、`fix(蝕刻): …`、
`test(版面): …`、`chore: …`、`docs: …`。

## 回報問題

用 [issue 範本](https://github.com/Bonnie9981/semiconductor-camp-plus/issues/new/choose)。
版面 / 手勢對位的問題，附上瀏覽器、作業系統、視窗大小與截圖會快很多。
