<!-- 標題用中文 conventional commit 風格：feat(關卡): … / fix(蝕刻): … / chore: … -->

## 這個 PR 做了什麼

<!-- 一兩句話。若修 bug，說明根因，不只是症狀 -->

## 為什麼

<!-- 連到 issue，或說明動機 -->

## 怎麼驗證

- [ ] `npm run verify` 全綠（lint + format:check + typecheck + check + check:browser）
- [ ] 手動玩過受影響的關卡（有攝影機 / 沒攝影機各試一次）
- [ ] 動到版面的話，1920×1080 與 1440×900 含書籤列都看過

## 有沒有動到硬規則

<!-- 關卡碰 DOM 了嗎？scene/ 放邏輯了嗎？寫死斷點了嗎？
     動到某關的 devComplete() 有沒有同步 scripts/checks/wafer-state.mjs？ -->
