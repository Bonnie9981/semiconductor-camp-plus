# 已知風險與觸發條件

專案層級、需要主動追蹤的風險。程式碼裡「刻意保留的取捨」在
[`docs/IMPLEMENTATION.md` §7](IMPLEMENTATION.md)。

---

## R-01 · MediaPipe 手部追蹤釘在停更版本

| | |
| --- | --- |
| **現況** | `@mediapipe/hands@0.4.1675469240` + `@mediapipe/camera_utils@0.3.1675466862`（皆 2023）。這是舊版 **Solutions API**。 |
| **問題** | Google 已停止維護 Solutions，改推 **MediaPipe Tasks**（`@mediapipe/tasks-vision` 的 `HandLandmarker`）。舊版不會再收到修正。 |
| **影響面** | `src/core/CameraManager.ts`（載入與推論）、`src/core/GestureDetector.ts`（座標映射與 Pinch）、`scripts/copy-mediapipe.mjs`（把 wasm/tflite 複製到 `public/`）。 |
| **目前為何不動** | 運作正常、資產自架離線可用。現在遷移屬「還沒壞就先修」：Tasks API 的形狀不同（`FilesetResolver` + `HandLandmarker.detectForVideo`），要重測手勢對位、鏡像、`object-fit: cover` 映射，成本不小。 |

### 遷移觸發條件（滿足任一即排入）

1. **失效**：Chrome / Safari 的更新導致手部追蹤在主流瀏覽器上壞掉（WASM、`getUserMedia`、或 MediaPipe CDN 的相依變動）。
2. **需求**：要支援雙手、或 pinch 以外的手勢 —— 這些只有 Tasks API 有。
3. **維護**：`npm audit` 對 `@mediapipe/*` 出現無法忽略的高風險項。

### 遷移時的注意事項（給未來的自己）

- Tasks 的 `HandLandmarker` 回傳的 landmark 格式與 Solutions 幾乎一致（21 點、normalized），`GestureDetector` 的數學大致可沿用。
- `selfieMode` 對應 Tasks 沒有；鏡像仍由本專案自己處理（CSS 翻 `<video>` + 座標翻轉），不要開任何內建鏡像。
- `scripts/checks/` 不 import `CameraManager`，遷移不會動到現有自動化檢查；但要手動重跑「手勢對位」與「鏡像」的實測。
- `docs/IMPLEMENTATION.md` 的〈鏡像是怎麼做的〉與〈疑難排解〉表要同步更新版本字串。

---

## R-02 · 教學有效性尚未驗證

| | |
| --- | --- |
| **現況** | 五道製程完整、程式品質到位，但**沒有任何資料**顯示玩家真的建立了製程概念。 |
| **緩解中** | 見審查會議 R1／行動項目 A1–A3：有人陪同的實測 + 證書「觀念回顧」+ 各關「為什麼」。 |
| **升級條件** | 若實測顯示多數人「亂點過關、答不出為什麼」，需要重新檢視關卡的引導設計，而非只補文字。 |
