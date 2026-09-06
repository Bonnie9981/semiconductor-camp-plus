# 實作概念與接手指南

這份文件寫給**接手這個專案的人**。README 說明「這個專案是什麼、怎麼跑」，
這裡說明「為什麼這樣設計、你要怎麼加東西進去」。

---

## 目錄

1. [核心設計概念](#1-核心設計概念)
2. [四個關鍵抽象](#2-四個關鍵抽象)
3. [一個關卡的生命週期](#3-一個關卡的生命週期)
4. [互動模式工具箱](#4-互動模式工具箱)
5. [動手做：從 Stub 到完整關卡](#5-動手做從-stub-到完整關卡)
6. [各關卡的實作筆記](#6-各關卡的實作筆記)
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

而**同一段空間裡的多個元素要交給一個純函式一起分配**，不能各自算自己那份。
`wetBenchLayout()` 與 `tankBenchGeometry()` 就是為此存在：它們由上往下依序切
「提示帶 → 藥瓶 → 瓶名 → 燒杯 → 檯面」，所以不管視窗多矮都不會互相壓到。
各自獨立算是這個專案踩過最多次的 bug 類型。

同樣的道理往上推一層：**HTML 覆蓋物的位置也要量，不要在 CSS 裡寫死**。
`UIManager.flushBands()` 把鏡頭設定列 → 子步驟列 → AR 提示 → 互動面板
依序疊起來（量前一條的下緣寫進 CSS 變數），`sceneOverlay()` 再把這些位置
換算成 canvas 座標交給關卡。這樣 CSS 那一層怎麼變，canvas 上的道具都會讓開。

純函式還有第二個好處：`npm run check` 能 import 真正的計算，
在整個尺寸矩陣上驗證「有沒有重疊、有沒有掉出畫面」。版面錯誤沒辦法靠 `tsc` 抓，
只能算給它看。低於 `MIN_VIEWPORT`（`core/Viewport.ts`，1100×460）的尺寸就不硬畫，
改成蓋上提示叫玩家放大視窗（1100×460 是實測出來的，不是猜的）。

而 CSS 那一層的重疊只有真瀏覽器量得到，所以另外有 `npm run check:browser`：
開系統已安裝的 Chrome、跑 8 種視窗尺寸（16:9 與 16:10 各四種），
驗 HUD 卡片有沒有互相壓到、有沒有蓋住 canvas 上的道具、
互動面板的操作鈕有沒有被擠掉、結業證書整張看不看得到。

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
| `choice` | 從 N 個選項挑 M 個 | 沉積的製程選擇（備援） | 正負光阻、顯影液、蝕刻方式 |
| `mix` | 用 ＋/− 調份數 | — | 需要精確數值但不需要動手的場合 |
| `pour` | 唯讀顯示杯內容物 + 送出/倒掉 | RCA 前三步 | 配方是「動手倒出來」的場合 |
| `action` | 單一按鈕 | RCA 乾燥、沉積各階段 | 說明目前該做什麼 + 沒有鏡頭時的備援 |

**面板的定位是「說明 + 備援」，不是主要互動。** 第二關的所有操作都在機台上用手完成，
面板只負責解釋為什麼要這麼做，並在沒有攝影機時提供等效按鈕。新關卡請延續這個原則。

`mix` 目前沒有任何關卡在用，但已實作完成並通過型別檢查。

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
懸停會亮、捏一下就是 click。**關卡不用做任何事**，任何標了 `data-pinch` 的
按鈕自動就能用手勢按（含 Modal 上的按鈕）。

⚠️ 但**手只到得了鏡頭視窗那一格**。座標是從 video 映射過來的，
右側面板、Header 都在視野外，手指不過去。所以任何「非按不可」的操作
都必須在視窗裡也有一份 —— 這就是 `#btn-stage-action` 存在的理由。

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
  .register(new Stage3Litho())
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

## 6. 各關卡的實作筆記

### 第二關 · 薄膜沉積 ✅ 已完成

已實作，可以當成「機台型關卡」的範本。三件值得抄的事：

**1. 用「把東西放進哪裡」取代選擇題。**
製程選擇沒有做成選項按鈕，而是兩台機器並排、玩家把晶圓拖進哪一台就選了哪一種。
放置判定就是 `pointInCircle(釋放點, layout.wafer, 容差)`。

**2. 機台控制是可拖曳的實體。** `scene/Chamber.ts` 把命中區域與繪圖分開：

```ts
const layout = chamberLayout(geo, kind);   // 只算幾何，回傳可命中的區域
drawChamber(ctx, geo, layout, state, time); // 只畫圖，不含邏輯
```

Stage 用 `layout` 做捏合判定、把結果寫回自己的狀態，再組成 `state` 交回去畫。
三種控制的拖曳換算：

```ts
door      = clamp((p.x - closedX) / (openX - closedX), 0, 1);       // 水平
power     = clamp((lever.bottom - p.y) / (lever.bottom - top), 0, 1); // 垂直
valves[i] = clamp(抓取時的值 + (p.x - 抓取時的x) / 140, 0, 1);        // 相對水平
```

⚠️ 旋鈕用**相對位移**（記住抓取瞬間的值與座標），不是絕對座標 —— 否則一抓就跳值。

**3. 製程窗口。** 控制值落在綠帶內品質 = 1，超出後線性衰減，沉積速率乘上品質。
`windowFit()` 的上下衰減幅度分開設定，因為「不足」與「過量」的懲罰通常不對稱
（PVD 功率過高會過熱，比不足更糟）。

**分支的處理**：PVD 一次就鍍上金屬，CVD 要多一步。子步驟是線性的，所以在
`onSubEnter()` 直接跳過：

```ts
if (sub?.id === 'metal' && this.method === 'pvd') {
  this.nextSub();
  return;
}
```

子步驟列上那一格會顯示成「已完成」。若希望它顯示為「不適用」，
需要在 `UIManager.renderSubsteps()` 加一個 `skipped` 狀態。

**粒子** 在 `scene/Particles.ts`，用 `mode` 切換兩種運動：

| | ballistic（PVD） | diffusive（CVD） |
| --- | --- | --- |
| 來源 | 上方靶材被電子束氣化 | 上方噴淋頭通入的氣體 |
| 運動 | **筆直下落**，畫成短線段表現速度 | **邊飄邊亂走**，畫成雙原子分子 |
| 落地 | 白色收縮閃光＝凝結 | 同上，時間較長 |
| 結果 | 金屬層 | 氧化層（之後還要再鍍金屬） |

物件池管理，達到上限就回收重生，不會每幀配置新陣列。第五關的乾式蝕刻
可以直接重用 `ballistic` 模式（方向反過來即可）。

### 第三關 · 微影製程 ✅ 已完成

值得注意的三件事：

**1. 沿用 VirtualDesk 的 Pattern 圖層，但把晶圓搬到畫面中央。**
新增的 `desk.setWaferPlacement({cx, cy, r})` 會一併搬動 `isOnWafer()` 與筆畫的
座標轉換，所以覆蓋率計算、PNG / STL 匯出這一整套機制都能直接沿用，
不必再實作一份。關卡每幀呼叫它（場景尺寸隨視窗變動），離開時記得傳 `null` 還原。

**2. 視角依「這一步在看什麼」切換。**
塗佈與繪圖是**俯視正圓**（設計圖案本來就從正上方看，也讓座標換算是單純的圓），
曝光是**正視**（才看得到 UV 燈 → 光罩 → 晶圓的上下關係）。同一關切換視角是可以的。

**3. 圖層要自己上色，不要用 `source-in` 合成。**
光阻塗佈層一開始寫成「白色遮罩 + source-in 上色」，但合成是以整張 desk canvas
為 destination，會連下面的晶圓一起塗滿。正解是**畫的時候就直接用光阻的顏色**：

```ts
const g = c.createRadialGradient(x, y, 0, x, y, brush);
g.addColorStop(0, `rgba(${RESIST_RGB}, 1)`);
g.addColorStop(1, `rgba(${RESIST_RGB}, 0)`);
```

`destination-out` 則是安全的（曝光動畫就靠它把被鉻擋住的光挖掉），
因為它只會減少 alpha，不會把不相干的區域填滿。

**光罩拖曳**與第二關的旋鈕一樣用**相對位移**，不是絕對座標：

```ts
this.dragFrom = { hand: {...hand.pinchPoint}, offset: {...this.maskOffset} };
// 之後每幀
this.maskOffset = {
  x: this.dragFrom.offset.x + (hand.pinchPoint.x - this.dragFrom.hand.x),
  y: this.dragFrom.offset.y + (hand.pinchPoint.y - this.dragFrom.hand.y),
};
```

**交給第四關的資料**：曝光結束時 `writeExposedMask()` 取圖案中央一條水平帶，
壓成 `SECTION_CELLS` 長度的陣列寫進 `wafer.exposedMask`（有鉻 = 0、沒畫到 = 1），
並把玩家選的 `wafer.resistTone` 一起存好。

### 第四關 · 顯影 ✅ 已完成

`Stage4Develop` 只有 ~190 行，因為互動邏輯抽到了 `DipStageBase`：

```ts
const done = this.runDip(frame, groundY, round, { waferColor, filmColor });
if (done) { wafer.develop(); this.nextSub(); }
```

`DipRound` 描述「這一輪有哪些槽、哪一槽是對的、選錯要說什麼」，其餘（抓取、
拖曳、落點判定、下沉、攪拌、進度環、提起）全部由基底處理。第五關的濕蝕刻與
去光阻直接重用同一支。

**正確答案依前面的選擇而定**，這是刻意的：

```ts
private get answer(): string {
  return this.ctx.wafer.resistTone === 'positive' ? 'tmah' : 'xylene';
}
```

玩家必須回想自己在第三關選了正還是負光阻，兩關才真的串起來。

⚠️ **踩過的坑**：`onSubEnter()` 原本無條件 `resetDip()`，結果晶圓一泡下去、
子步驟從「選試劑」推進到「顯影反應」時，正在進行的浸泡被清掉了。
連續動作橫跨多個子步驟時，只在回到第 0 步才重設：

```ts
protected override onSubEnter(index: number): void {
  if (index === 0) this.resetDip();
}
```

### 第五關 · 蝕刻 ✅ 已完成

三個子步驟用到兩種場景，都是重用既有模組：

| 子步驟 | 重用了什麼 |
| --- | --- |
| 氧氣電漿清潔 | `scene/Chamber.ts`（kind `cvd`）+ `Particles`（diffusive） |
| 蝕刻選擇 | 自繪的兩張說明卡；乾式走 Chamber，濕式走 `DipStageBase` |
| 去光阻與清洗 | `DipStageBase` |

**乾式與濕式的差別做在結果上，不只是動畫。** `WaferState.etch(undercut)`：

```ts
// 濕式蝕刻是等向性的，會往光阻底下橫向咬
if (undercut > 0.5) {
  for (...) if (base[i]) { etchedMask[i±1] = max(..., 0.6); }
}
```

`CrossSection` 把 0.6 的格子畫成「變窄的柱子」，所以兩種蝕刻在截面圖上長得
完全不一樣 —— 這才是這一步真正要教的東西。

### 結業證書

`utils/Certificate.ts`。三個階段：`capturePhoto()` → `composeCertificate()` → `canvasToPdf()`。

**不要為了中文去引 PDF 函式庫。** 在 PDF 裡排文字就得嵌入中文字型（好幾 MB +
subset + CID 編碼）。這裡先把整張證書畫在 canvas 上（文字由瀏覽器渲染成點陣），
再把單一張 JPEG 包進最小的 PDF 骨架，完全不需要字型物件。

PDF 的骨架只有 Catalog → Pages → Page → 一個 DCTDecode 影像。xref 表要記錄每個
物件的**位元組位移**，所以整份文件用 `Uint8Array` 拼：

```ts
const push = (chunk: string | Uint8Array) => { parts.push(chunk); length += chunk.length; };
const startObject = () => offsets.push(length);   // 呼叫時的 length 就是這個物件的位移
```

⚠️ 字串要以 **latin1 逐字元**寫入（`charCodeAt(i) & 0xff`），
用 `TextEncoder` 的 UTF-8 會把中間的二進位 JPEG 段撐開，位移全部錯位。

## 7. 尚未解決的問題

> 本節於 2026-07-30 逐條對照程式碼驗證過，狀態如下。

### 刻意保留的取捨

| 現象 | 為什麼不修 |
| --- | --- |
| **第一關倒藥液時，瓶口可能短暫甩出杯口** | 判定用的是**瓶口**位置，而瓶身一傾倒瓶口就往左甩約 0.9×瓶高，有機會甩出判定區讓傾倒中斷。曾改成「用手的位置判定 + 傾倒時把瓶子吸附到杯口正上方」根除它，但那樣瓶子會自己滑走，手感不像在倒東西。依實測回饋選擇保留這個小瑕疵，換取「自己拿著瓶子對準」的手感。若之後要再挑戰，建議加**遲滯**（開始倒之後放寬判定區）而不是吸附。 |

### 已修正的重大 bug（保留紀錄，避免重蹈）

| bug | 症狀 | 根因 |
| --- | --- | --- |
| **STL 側牆繞序反向** | 模型看起來不是實心圓盤，切片軟體判定異常 | 外緣側牆寫成 `(a@0, a@z, b@z)`，叉積 `ẑ × θ̂ = −r̂` → 法線朝內。網格仍封閉（每邊用兩次）但**定向不一致**，帶號體積為負。用腳本檢查「重複的有向邊」與帶號體積才抓到 |
| **正負光阻示意圖顛倒** | 玩家把中間的凹槽誤讀成自己畫的圖案 | 示意圖把鉻層畫在兩側、開口留在中間。玩家畫的 pattern **就是那塊鉻**，必須畫在中間，示意圖才讀得出「我畫的那塊最後是凸還是凹」 |
| **顯影 100% 卡住** | 進度到 100% 卻永遠出不來 | `updateReaction()` 把「下沉」判斷寫在「提起」之前，晶圓一開始上升 `dipDepth` 又小於 1，下一幀被推回槽底 |

### 仍然存在

| 問題 | 驗證方式 | 影響 | 建議 |
| --- | --- | --- | --- |
| **`ChoiceOption` 不支援示意圖** | `core/types.ts` 的 `ChoiceOption` 只有 `sub` / `color` / `glyph` | 第三關的正負光阻、第五關的乾濕蝕刻都得自己在 canvas 上畫卡片繞過去 | 加 `preview?: (ctx, w, h) => void` 讓選項自己畫縮圖 |
| **`#hand-canvas` 蓋住整個視窗格** | `z-index: 60`、`pointer-events: none` | 不擋點擊，但之後若要放「需要被點到」的浮層，記得排在它之上 | — |
| **各關 `onFrame()` 的手勢互動流程沒有測試** | `stage-machine.mjs` 已有「onEnter + 8 幀空跑」的冒煙測試（不丟例外、不自己過關），但「捏著藥瓶拖進正確的槽 → 子步驟推進」這種真正的互動流程仍未測 | 互動流程的迴歸只能靠手動玩 | 冒煙測試用的 `makeFrameStubs()` + `makeCtx2D()`（`stage-machine.mjs`）已能跑完整 `onFrame`；接下來要餵「有座標的 `HandFrame` 序列」並讓假的 `desk.geometry` / hit-box 對得起來 |
| **分支路線的 devComplete 未跑真程式** | `stage-machine.mjs` 只跑得了預設路線（PVD/正光阻/乾式）；其餘 7 種組合仍由 `wafer-state.mjs` 的重寫矩陣涵蓋 | `method` / `tone` / `etchMethod` 是 private，沒有 gameplay 之外的注入點；改了分支的 `devComplete()` 而忘了同步 `wafer-state.mjs` 仍會漏 | 給關卡加一個測試用的狀態注入 seam，或讓 `stage-machine.mjs` 也能驅動子步驟做選擇 |

### 已解決（保留紀錄）

| 問題 | 解法 |
| --- | --- |
| ~~`exposedMask` 沒有人寫入~~ | 第三關 `writeExposedMask()`（`Stage3Litho.ts`）填入，第四關 `WaferState.develop()` 使用 |
| ~~截面圖只有一種圖案化方式~~ | `CrossSection` 已分別處理 `resistMask`（光阻）與 `etchedMask`（下層材料，含 undercut 的變窄柱子） |
| ~~手部骨架被 UI 蓋住~~ | 獨立的 `#hand-canvas`（z-index 60），詳見 README〈圖層規範〉 |
| ~~右側面板的按鈕手構不到~~ | 視窗內的 `#btn-stage-action`，Modal 按鈕也都標了 `data-pinch` |
| ~~`Stage1DrawPattern.ts` / `StagePlaceholder.ts` 是死碼~~ | 已刪除（刪除前 `grep -rn` 確認除檔案自身外無任何引用） |
| ~~子步驟沒有「略過」狀態~~ | `BaseStage.skipSub()` 把該 index 記進 `skippedSubs`；`UIManager.renderSubsteps()` 畫成灰色斜線的「–」。第二關 PVD 路線的「金屬鍍膜」改用它 |
| ~~關卡類別完全沒有自動測試~~ | `scripts/checks/stage-machine.mjs`：① 用窄的 `makeStubContext()` 跑完整條 StageManager 生命週期，驗預設路線的 `devComplete()` 鏈與 `buildResult()`；② 用 `makeFrameStubs()` + permissive 的 2D context 替身跑每一關的 `onEnter` + 8 幀 `onFrame`（冒煙測試）。取代了「零真實關卡覆蓋」的狀態 |

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

// ── 機台（scene/Chamber.ts）──
chamberLayout(geo, kind)              // 只算幾何，回傳可命中的區域
drawChamber(ctx, geo, layout, state, time)
pointInCircle(point, circle, pad?)    // 通用的圓形命中測試

// ── 粒子（scene/Particles.ts）──
const field = new DepositionField();
field.update(dt, cfg);                // cfg.mode: 'ballistic' | 'diffusive'
field.render(ctx, cfg, color);
```
