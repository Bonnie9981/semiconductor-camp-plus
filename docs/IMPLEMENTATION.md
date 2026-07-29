# 實作概念與接手指南

這份文件寫給**接手第 2~5 關的人**。README 說明「這個專案是什麼、怎麼跑」，
這裡說明「為什麼這樣設計、你要怎麼加東西進去」。

---

## 目錄

1. [核心設計概念](#1-核心設計概念)
2. [四個關鍵抽象](#2-四個關鍵抽象)
3. [一個關卡的生命週期](#3-一個關卡的生命週期)
4. [互動模式工具箱](#4-互動模式工具箱)
5. [動手做：從 Stub 到完整關卡](#5-動手做從-stub-到完整關卡)
6. [第 2~5 關的實作建議](#6-第-25-關的實作建議)
7. [尚未解決的問題](#7-尚未解決的問題)

---

## 1. 核心設計概念

### 概念一：關卡不碰 DOM

關卡要玩家「選一個顯影液」時，**不會**去 `document.createElement` 做按鈕。
它回傳一份描述：

```ts
{
  kind: 'choice',
  title: '選擇顯影液',
  options: [/* … */],
  selected: this.picked,
  max: 1,
  confirmLabel: '開始顯影',
  confirmEnabled: this.picked.length === 1,
  onToggle: (id) => { this.picked = [id]; },
  onConfirm: () => this.startDevelop(),
}
```

`UIManager.setPanel()` 負責把它變成 HTML。這樣做的好處：

- **關卡可以每一幀都呼叫 `setPanel()`**，不用自己追蹤「什麼時候該重繪」。
  `UIManager` 內部用一個「簽章」字串比對，玩家看得見的東西沒變就不動 DOM
  （每秒 60 次 `replaceChildren` 會讓按鈕永遠點不到 —— 每次重建都會打斷 click 事件）。
- 面板長相要改版時，只改 `UIManager`，五個關卡都跟著變。
- 關卡的測試不需要 DOM。

⚠️ **陷阱**：回呼一定要從 `this.panelSpec` 讀最新的 spec，不要抓 closure 裡的舊值。
`setPanel()` 每次都會更新 `this.panelSpec`，即使它沒有重建 DOM。

### 概念二：晶圓只有一份

`WaferState` 是整條製程共用的同一個物件，透過 `StageContext.wafer` 傳給每一關。
第二關疊上去的氧化層，第五關才蝕得掉。

```ts
// 沉積關卡
ctx.wafer.addLayer({ kind: 'oxide', label: 'SiO₂', thickness: 0.6,
                     color: '#8fa8b8', patterned: false });

// 蝕刻關卡
ctx.wafer.topLayer.patterned = true;   // 截面圖會依 resistMask 切出溝槽
```

俯視晶圓與右下角的截面圖都是從這裡讀狀態去畫的，**關卡只改資料、不畫圖**。

### 概念三：場景模組是純函式

`src/scene/` 底下每個檔案都是「吃一份狀態、畫一格畫面」，不持有遊戲邏輯：

```ts
beaker.render(ctx, geo, { fillLevel, liquid, waferDip, bubbling, … }, dt, time);
```

`Beaker` 不知道什麼是 SC-1、不知道配方對不對，它只知道「液面 0.62、顏色 #8ab、正在冒泡」。
把化學留在 `Stage`、把畫圖留在 `scene/`，所以同一個燒杯能同時被 RCA、顯影、濕蝕刻三關重用。

### 概念四：版面從實測值推導，不寫死百分比

canvas 上的東西不能被 HTML 面板蓋住，但面板寬度會隨視窗大小改變。
與其在兩邊各維護一組斷點，關卡直接問 UI：

```ts
const inset = frame.ui.panelInset();   // 面板實際右緣，收起時為 0
```

同理，器材尺寸一律是 `clamp(依比例算出的值, 下限, 上限)`，而不是固定像素。

---

## 2. 四個關鍵抽象

| 抽象 | 檔案 | 一句話 |
| --- | --- | --- |
| `BaseStage` | `stages/BaseStage.ts` | 一關要回答：我是誰、每幀做什麼、何時算過、交出什麼結果 |
| `SubStep` | `core/types.ts` | 關卡內的子步驟；全部走完這關才算 done |
| `PanelSpec` | `core/types.ts` | 「我要玩家做什麼」的宣告式描述，共四種 |
| `WaferState` | `core/WaferState.ts` | 晶圓的層堆疊與污染狀態，五關共用 |

### PanelSpec 的四種面板

| kind | 用途 | 已用於 | 適合 |
| --- | --- | --- | --- |
| `choice` | 從 N 個選項挑 M 個 | — | 製程選擇、正負光阻、顯影液、蝕刻方式 |
| `mix` | 用 ＋/− 調份數 | — | 需要精確數值但不需要動手的場合 |
| `pour` | 唯讀顯示杯內容物 + 送出/倒掉 | RCA 前三步 | 配方是「動手倒出來」的場合 |
| `action` | 單一按鈕 | RCA 乾燥步驟 | 開始曝光、開始蝕刻、啟動機台 |

`choice` 與 `mix` 目前**還沒有任何關卡在用**，但都已實作完成並通過型別檢查。
第 2、3、4、5 關會需要 `choice`。

---

## 3. 一個關卡的生命週期

```
StageManager.goTo(i)
   │
   ├─▶ 前一關 onExit()          ← 收起面板、還原 VirtualDesk 的設定
   │
   ├─▶ 本關 onEnter(ctx)        ← 佈置場景、resetSub()、onSubEnter(0)
   │
   ├─▶ 每一幀 onFrame(frame)    ← 手勢 → 狀態 → 畫場景 → syncPanel()
   │      │
   │      └─ 子步驟做完 → nextSub()
   │            └─▶ onSubEnter(i+1)   ← 重設該步的狀態
   │            └─▶ stages.notifySubChange() → UI 更新子步驟列
   │
   ├─▶ 全部子步驟走完 → canComplete() 回傳 true → 右側主要按鈕亮起
   │
   └─▶ 玩家按下 → buildResult() → StageManager.completeCurrent()
```

**重點**：`canComplete()` 的預設實作是 `subsFinished`，所以只要宣告了 `substeps`，
玩家就不可能跳過中間的步驟。要加額外條件就覆寫它：

```ts
override canComplete(): boolean {
  return this.subsFinished && this.ctx?.wafer.isClean === true;
}
```

---

## 4. 互動模式工具箱

第一關已經把常見的手勢互動做出來了，可以直接抄。

### 模式 A：捏起道具、移動、放開

```ts
// 抓取：捏合且靠近道具
if (hand.present && hand.pinching && !this.held) {
  if (dist(hand.pinchPoint, restPoint) < grabRadius) this.held = true;
}
// 跟隨
if (this.held && hand.pinching) this.heldPos = { ...hand.pinchPoint };
// 放開：判斷落點
if (this.held && hand.justReleased) {
  this.held = false;
  if (overTarget) this.commit(); else this.heldPos = null;
}
```

參考 `Stage1RCA.updateBottles()` 與 `updateBeakerGrab()`。
`grabRadius` 要跟著道具大小走（`max(44, w * 1.15)`），道具放大時才不會變難抓。

### 模式 B：停留累積（倒液）

比「放開就完成」更適合需要「量」的動作：

```ts
if (inZone) {
  this.accum += dt;
  if (this.accum >= INTERVAL) { this.accum -= INTERVAL; this.addOnePart(); }
} else {
  this.accum = 0;
}
```

一定要搭配**可見的進度指示**（`drawPourGauge()` 畫的那個圓環），
否則玩家不知道下一份什麼時候進去。

### 模式 C：畫面上的 canvas 按鈕

canvas 是 `pointer-events: none`，滑鼠點不到，所以要自己做命中測試：

```ts
if (hand.present && hand.justPinched &&
    dist(hand.pinchPoint, buttonCenter) < buttonR + 12) {
  this.start();
}
```

⚠️ 一定要**同時**在面板提供等效按鈕，否則沒有攝影機就卡關。

### 模式 D：捏合當滑鼠（自動）

`UIManager.updatePinchPointer()` 已經把捏合點對到 HTML 按鈕上了 ——
懸停會亮、捏一下就是 click。**關卡不用做任何事**，面板按鈕自動就能用手勢按。

### 模式 E：解出對位，不要用估的

RCA 的「倒廢液」一開始是寫死偏移量，結果杯嘴永遠對不準桶口。
正解是把它當成反運算：

```ts
// lip = beakerPos + R(tilt) · offset  →  beakerPos = targetLip − R(tilt) · offset
const probe = { ...bench, cx: 0, top: 0 };
const offset = this.beaker.lipPoint(probe, tilt);   // 該傾角下杯嘴的相對位移
return { x: mouth.x - offset.x, y: mouth.y - drop - offset.y };
```

因為傾角在動，**每一幀都要重算**。任何「道具 A 要對準道具 B 的某個點」都適用。

---

## 5. 動手做：從 Stub 到完整關卡

以第四關「顯影」為例。

### 步驟 1 — 建立關卡類別

```ts
// src/stages/Stage4Develop.ts
import type { InstructionStep, PanelSpec, StageContext, StageFrame, SubStep } from '../core/types';
import { toChoice } from '../data/solutions';
import { Beaker, type BeakerGeometry } from '../scene/Beaker';
import { BaseStage } from './BaseStage';

const ANSWER = 'tmah';   // 半導體標準顯影液

export class Stage4Develop extends BaseStage {
  readonly id = 'develop';
  readonly title = '顯影';
  readonly shortTitle = '顯影';
  readonly description = '泡入顯影液溶解光阻，使被曝光的區域被選擇性移除。';
  readonly hint = '選出正確的顯影液，再把晶圓浸進去。';
  readonly primaryLabel = '完成顯影';
  readonly usesCrossSection = true;

  readonly substeps: readonly SubStep[] = [
    { id: 'reagent', title: '顯影液選擇', desc: '選出能溶解曝光區光阻的試劑' },
    { id: 'react',   title: '顯影反應', desc: '浸泡並觀察圖案顯現' },
  ];

  readonly instructions: InstructionStep[] = [/* … */];

  private picked: string[] = [];
  private error: string | null = null;
  private readonly beaker = new Beaker();

  override onEnter(ctx: StageContext): void {
    super.onEnter(ctx);
    ctx.desk.setWaferVisible(false);        // 自己畫場景
    ctx.desk.setDeskLabel('DEVELOPER BENCH');
    this.resetSub();
    this.onSubEnter(0);
  }

  override onExit(): void {
    this.ctx?.ui.setPanel(null);            // ★ 一定要收面板
    this.ctx?.desk.setWaferVisible(true);
    this.ctx?.desk.setDeskLabel(null);
  }

  protected override onSubEnter(index: number): void {
    this.error = null;
    if (index === 0) this.picked = [];
  }

  override onFrame(frame: StageFrame): void {
    // 1. 畫場景（用 frame.desk.context）
    // 2. 更新 AR 提示（frame.ui.setArHint / setHandState）
    // 3. 同步面板
    this.ctx.ui.setPanel(this.buildPanel());
  }

  private buildPanel(): PanelSpec | null {
    if (this.currentSub?.id !== 'reagent') return null;
    return {
      kind: 'choice',
      title: '選擇顯影液',
      note: '正光阻曝光後會斷鏈變得可溶，需要鹼性顯影液把它洗掉。',
      error: this.error ?? undefined,
      options: ['tmah', 'koh', 'acetone', 'hf'].map(toChoice),
      selected: this.picked,
      max: 1,
      confirmLabel: '開始顯影',
      confirmEnabled: this.picked.length === 1,
      onToggle: (id) => { this.picked = [id]; this.error = null; },
      onConfirm: () => {
        if (this.picked[0] !== ANSWER) { this.error = '這個試劑溶不掉曝光後的光阻。'; return; }
        this.nextSub();
      },
    };
  }
}
```

### 步驟 2 — 換掉 Stub

```diff
// src/main.ts
- .register(new StagePlaceholder({ id: 'develop', /* … */ }))
+ .register(new Stage4Develop())
```

**只需要改這一行**，`StageManager`、`UIManager`、主迴圈都不用動。

### 步驟 3 — 檢查清單

- [ ] `onExit()` 有呼叫 `ui.setPanel(null)`
- [ ] `onExit()` 有還原 `desk.setWaferVisible(true)` / `setDeskLabel(null)`
- [ ] 需要手勢的動作，面板上有等效按鈕（沒攝影機也玩得下去）
- [ ] 器材尺寸用 `clamp()`，位置從 `sceneBounds()` 推導
- [ ] `restart()` 有呼叫 `super.restart()`（重設子步驟指標）
- [ ] `npm run build` 通過

---

## 6. 第 2~5 關的實作建議

### 第二關 · 薄膜沉積

**唯一的架構難題：分支。** PVD 選完就直接沉積，CVD 要多一步鍍金屬層。
但 `BaseStage` 的子步驟目前是線性的。

建議做法 —— **在 `onSubEnter()` 裡跳過不需要的步驟**：

```ts
protected override onSubEnter(index: number): void {
  if (this.substeps[index]?.id === 'metal' && this.method === 'pvd') {
    this.nextSub();     // PVD 不需要，直接跳過
    return;
  }
  // …
}
```

子步驟列上那一格會顯示成「已完成」。若希望它顯示為「不適用」，
需要在 `UIManager.renderSubsteps()` 加一個 `skipped` 狀態。

**動畫**：兩種沉積都是粒子系統，但運動方式不同 ——

| | PVD（e-gun） | CVD（PECVD） |
| --- | --- | --- |
| 粒子來源 | 底部靶材被電子束打中後氣化 | 上方通入的氣體分子 |
| 運動 | **直線**上升後落在晶圓上凝結 | **布朗式**亂走，被電漿激發後才反應 |
| 結果 | 金屬層 | 氧化層（之後還要再鍍金屬） |

粒子系統可參考 `SpinDryer.updateDroplets()` 的寫法（物件池 + 重生），
不要每幀 new 陣列。

### 第三關 · 微影製程

四個子步驟裡有三個是全新的互動，但**「圖案設計」可以直接沿用
`Stage1DrawPattern.ts`** —— 它已經有完整的捏合繪圖 + 覆蓋率判定 + Pattern 圖層，
把它從「一個關卡」改成「一個子步驟的處理器」即可。

- **光阻劑塗抹**：捏合在晶圓上塗抹，記錄覆蓋率。可重用 `VirtualDesk.beginStroke/strokeTo`，
  只是換成一支很粗的筆刷，並要求覆蓋率 > 90%。
- **正負光阻選擇**：`choice` 面板，兩個選項各配一張示意圖。
  目前 `ChoiceOption` 只有 `color` 與 `glyph`，要放示意圖需要擴充成
  `preview?: (ctx, w, h) => void` 之類的 callback。
- **曝光與烘烤**：把畫好的 Pattern 當成一張可拖曳的半透明光罩疊在晶圓上，
  用捏合移動對位，對準後按鈕才啟用。對位計算參考[模式 E](#模式-e解出對位不要用估的)。

選完正負光阻後要寫進 `wafer.resistTone`，第四關的顯影結果才會正確。

### 第四關 · 顯影

最單純的一關，[步驟 5](#5-動手做從-stub-到完整關卡) 的範例就是它。
重點在顯影後要更新 `wafer.resistMask`：

```ts
// 正光阻：曝光區被移除；負光阻：曝光區保留
for (let i = 0; i < SECTION_CELLS; i++) {
  const exposed = wafer.exposedMask[i] > 0.5;
  wafer.resistMask[i] = (wafer.resistTone === 'positive') === exposed ? 0 : 1;
}
```

### 第五關 · 蝕刻

- **氧氣電漿清潔**：一道掃過晶圓表面的光帶動畫，純過場。
- **蝕刻選擇**：`choice` 面板選乾式或濕式。
  - 乾式 → 粒子**垂直**轟擊，蝕出來的溝槽側壁是直的
  - 濕式 → 先選蝕刻液（重用 `pour`／`choice` + `Beaker`），溝槽會**側向**擴大
    （在截面圖上把溝槽畫寬一點，這就是「等向性蝕刻」的教學點）
- **去光阻與清洗**：`wafer.removeLayer('resist')`，可重用 RCA 的燒杯與藥瓶模組。

---

## 7. 尚未解決的問題

接手前請先知道這些：

| 問題 | 影響 | 建議 |
| --- | --- | --- |
| **子步驟是線性的** | 第二關的 PVD/CVD 分支只能用「跳過」模擬 | 若之後分支變多，考慮讓 `substeps` 變成可由關卡動態回傳的 getter |
| **`Stage1DrawPattern.ts` 目前沒被註冊** | 它還在 repo 裡但不在流程中 | 併進第三關的「圖案設計」子步驟後即可刪除或改名 |
| **`ChoiceOption` 不支援示意圖** | 第三關的正負光阻需要圖解 | 加一個 `preview?: (ctx, w, h) => void` 讓選項自己畫縮圖 |
| **`WaferState.exposedMask` 沒有人寫入** | 第四關的顯影邏輯還沒有輸入 | 第三關的曝光步驟要負責填它 |
| **截面圖只有一種圖案化方式** | `CrossSection` 目前只依 `resistMask` 切最上層 | 濕蝕刻的側向擴大需要額外的寬度參數 |
| **沒有自動化測試** | 只有 `tsc --noEmit` 把關 | 至少替 `WaferState` 的層操作與配方驗證加單元測試 |

---

## 附錄：常用 API 速查

```ts
// ── 關卡拿得到的東西（StageFrame）──
frame.hand         // 手勢：present / pinching / justPinched / justReleased / pinchPoint
frame.ar           // AR 層 context（畫吸附在手上的道具）
frame.desk         // VirtualDesk
frame.desk.context // 桌面層 context（畫場景）
frame.desk.size    // { width, height } CSS px
frame.desk.geometry// { deskTop, deskHeight, waferCX, waferCY, waferR, … }
frame.ui           // UIManager
frame.wafer        // WaferState
frame.dt           // 距上一幀的秒數
frame.time         // 累積秒數（做週期動畫用）

// ── UI ──
ui.setPanel(spec | null)          // 左側互動面板
ui.setArHint(text, highlight?)    // 畫面上緣的提示橫幅
ui.setHandState(icon, label, sub, attached?)  // 右側手部狀態卡
ui.panelInset()                   // 面板佔用的寬度（佈局用）

// ── 桌面 ──
desk.setWaferVisible(false)       // 關掉預設晶圓，改由關卡自繪
desk.setDeskLabel('…')            // 桌沿標籤
desk.isOnWafer(x, y)              // 命中測試

// ── 晶圓 ──
wafer.addLayer({ kind, label, thickness, color, patterned })
wafer.removeLayer('resist')
wafer.hasLayer('oxide')
wafer.topLayer
wafer.surfaceColor()              // 俯視表面色（截面圖與場景共用）

// ── 場景繪圖 ──
drawFlatWafer(ctx, point, r, color, withTweezers?)   // 平放的晶圓（scene/Beaker.ts）
drawBottle(ctx, bottleVisual, time)                  // 藥瓶
drawPourStream(ctx, mouth, landY, color, time, w?)   // 液柱
drawDrain(ctx, geo, state, time)                     // 廢液桶
```
