# 半導體製程互動遊戲 · Semiconductor Process Simulator

以 **Vite + TypeScript + MediaPipe Hands** 打造的 WebAR 手勢互動遊戲。
玩家用「捏合（Pinch）」手勢把虛擬道具吸附到手上，在畫面下方的虛擬桌面操作晶圓，
一步步走完六道半導體製程。

本版本的範疇：**完整的 UI 框架** ＋ **第一關「繪製光罩圖形」的完整實作**。
第 2~6 關為刻意留空的 Stub，等待依照下方〈擴充開發指南〉接手。

---

## 快速開始

```bash
cd semiconductor-camp
npm install     # postinstall 會自動把 MediaPipe 資產複製到 public/mediapipe/（約 26MB）
npm run dev     # → http://localhost:5173
```

開啟後允許瀏覽器的攝影機權限即可開始。

> **getUserMedia 只在 `https` 或 `localhost` 下可用。**
> 想用區網 IP 讓其他裝置連進來測試，請改用 `npx vite --https` 或在前面架一層 HTTPS 反向代理。

其他指令：

| 指令 | 說明 |
| --- | --- |
| `npm run dev` | 開發伺服器（含 HMR） |
| `npm run build` | 型別檢查 + 產出 `dist/` |
| `npm run preview` | 預覽 build 結果 |
| `npm run typecheck` | 只跑 `tsc --noEmit` |

---

## 專案結構

```
semiconductor-camp/
├── index.html                  # 版面骨架（Header / Sidebar / Viewport / Panel / Footer / Modal）
├── vite.config.ts
├── scripts/
│   └── copy-mediapipe.mjs      # postinstall：複製 MediaPipe wasm/模型到 public/
├── src/
│   ├── main.ts                 # 程式入口、關卡註冊、UI 事件綁定、rAF 主迴圈
│   ├── style.css               # 設計 token（oklch 深色 Dashboard + IBM Plex）
│   ├── core/
│   │   ├── CameraManager.ts    # WebCam、前後鏡頭切換、MediaPipe Hands 整合
│   │   ├── GestureDetector.ts  # 鏡像座標映射、Pinch 判斷、骨架繪製
│   │   ├── StageManager.ts     # 關卡狀態機（locked → active → done）
│   │   └── types.ts            # 全專案共用型別
│   ├── stages/
│   │   ├── BaseStage.ts        # 關卡抽象基底
│   │   ├── Stage1DrawPattern.ts# 第一關：Pinch 吸附畫筆 + 晶圓繪圖
│   │   └── StagePlaceholder.ts # 第 2~6 關的空樣板
│   ├── ui/
│   │   ├── UIManager.ts        # 所有 HTML UI 的唯一操作入口
│   │   └── VirtualDesk.ts      # 下方虛擬桌面：Chuck、晶圓、Pattern 圖層
│   └── utils/
│       └── Exporter.ts         # PNG 下載 + STL 擠出
└── public/
    ├── assets/                 # 你自己的素材
    └── mediapipe/              # 由 postinstall 產生（已 gitignore）
```

資料流是單向的：

```
MediaPipe → CameraManager.latest → GestureDetector（鏡像/Pinch/平滑）
          → BaseStage.onFrame() → VirtualDesk（畫圖）＋ UIManager（更新文案）
```

---

## 圖層規範（為什麼按鈕一定點得到）

「按鈕點不到」幾乎都是因為透明的 canvas 蓋在 UI 上面。本專案用兩層固定定位徹底切開：

| 元素 | z-index | pointer-events | 職責 |
| --- | --- | --- | --- |
| `#stage-view` | 1 | `none` | 鏡頭視窗容器，由 JS 對齊到 `#viewport-slot` |
| ├ `#video-element` | 1 | — | WebCam 影像（鏡像時只翻轉「它」） |
| ├ `#ar-canvas` | 2 | `none` | 手勢骨架、吸附在手上的畫筆 |
| └ `#desk-canvas` | 3 | `none` | 虛擬桌面：Chuck、晶圓、Pattern、筆尖游標 |
| `#ui-layer` | 10 | `auto` | 所有 HTML：Header / Sidebar / Panel / HUD / Modal |

`#ui-layer` 是一個 CSS Grid Dashboard，中間那格 `#viewport-slot` 只是**鏤空的視覺外框**
（`pointer-events: none`），`main.ts` 的 `syncStageView()` 用 `ResizeObserver` 把 `#stage-view`
精準疊上去。因此：

- 三層 canvas 永遠在 UI 底下，**不可能攔截任何點擊**；
- 位於視窗上的 HUD（鏡頭設定、手勢參考、畫筆顏色…）是真正的 HTML，照樣 100% 可點；
- canvas 尺寸永遠等於 slot 尺寸，座標不需要任何額外換算。

---

## 鏡像（照鏡子感）是怎麼做的

⚠️ **只翻 `<video>`，不要翻 AR canvas。**

原始規格寫「video 與 AR canvas 都套 `transform: scaleX(-1)`，同時座標做 `(1-x)*W` 映射」，
但這兩件事會互相抵消：座標翻到 800，canvas 再翻一次就變回 200，畫筆會往反方向跑；
而且 canvas 上的畫筆圖示、文字也會整個左右顛倒。

正確作法（本專案的實作）：

```css
/* 只有影像翻轉 */
#stage-view.is-mirrored #video-element { transform: scaleX(-1); }
```

```ts
// 座標翻轉交給 GestureDetector
if (this.mirror) px = cw - px;   // ＝ (1 - x) * CanvasWidth
```

另外 `GestureDetector.project()` 還處理了 `object-fit: cover`：影像被等比放大再裁切，
直接用 `x * width` 會讓骨架與真人的手對不上（畫面越不 16:9 偏差越大）：

```ts
const scale = Math.max(cw / videoW, ch / videoH);
const dw = videoW * scale, dh = videoH * scale;
px = (cw - dw) / 2 + x * dw;
py = (ch - dh) / 2 + y * dh;
if (mirror) px = cw - px;
```

`setMirror()` / `setCanvasSize()` 會自動 `reset()` 平滑狀態 —— 否則玩家在捏合中途切換鏡像時，
指標會「滑」過整個螢幕，在晶圓上拖出一條假線。

---

## 第一關的互動循環

```
MediaPipe landmarks
  └─▶ GestureDetector      鏡像映射 + Landmark 4/8 距離 + 遲滯 + 指數平滑
        └─▶ Stage1.onFrame()
              ├─ Attach     捏合 → 畫筆吸附到 pinchPoint
              ├─ 命中測試   pinchPoint 是否落在 VirtualDesk 的晶圓圓形內
              ├─ 作用       命中就在 Pattern 圖層畫線
              └─ 回饋       AR 層畫筆 + 桌面層游標 + 中央提示 + 右側手部狀態
```

- **Pinch 門檻**：`|landmark[4] - landmark[8]| < 0.05` 判定捏合，
  大於 `0.05 × 1.5` 才放開（遲滯區間，避免在門檻附近瘋狂閃爍）。可在「設定」中即時調整。
- **過關條件**：圖形覆蓋晶圓面積 ≥ 0.8%（`Stage1DrawPattern.MIN_COVERAGE`）。
- **Pattern 圖層**：所有筆畫畫在一張 720×720 的離螢幕 canvas 上，與螢幕解析度脫鉤 ——
  視窗縮放、匯出、左下角預覽框共用同一份資料，resize 不會弄丟圖形。
- 依規格，第一關**不做**正／負光阻切換，該機制留給後續關卡
  （`Exporter` 的 `invert` 選項已經預留好）。

---

## 匯出（Exporter）

- **PNG**：`desk.composeWaferImage(1024)` 合成「白底圓形晶圓 + 圖案」後存檔，所見即所得。
- **STL**：把 Pattern 當高度圖，在**極座標**網格上擠出成圓形晶圓。

  ```
  h(vertex) = base                 （沒畫到）
            = base + patternHeight （有畫到）
  ```

  輸出＝中心三角扇 + 各環之間的四邊形（頂面）+ 反向的底面 + 最外環一圈側牆。

  為什麼是極座標而不是 X/Y 方格？方格版本必須在「相鄰格高度不同」處補垂直牆，
  一旦兩個對角格同高、另兩個對角格不同高，四道牆會共用同一條垂直邊 →
  該邊被 4 個三角形使用，模型就不是 2-manifold（實測 `resolution=120` 會產生 488 條壞邊）。
  極座標版本所有面共用頂點、沒有內部垂直牆，邊界又是一圈封閉的圓，
  **任何解析度下都保證封閉且 2-manifold**（已用 V−E+F=2 驗證），順帶得到真正的圓形晶圓邊緣。

  預設 `resolution: 120` → 57,600 面、約 2.8MB。圖案邊緣是一格寬的斜坡而非垂直峭壁，
  這是「簡易擠出」的預期外觀，調高 `resolution` 會越來越接近垂直。

---

## 沒有攝影機也能測（開發用）

`npm run dev` 模式下，主要模組會掛在 `window.__camp`：

```js
// 在晶圓上畫一筆
const g = __camp.desk.geometry;
__camp.desk.beginStroke(g.waferCX - 60, g.waferCY);
__camp.desk.strokeTo(g.waferCX + 60, g.waferCY + 30);
__camp.desk.endStroke();

__camp.stages.completeCurrent({});     // 直接過關
__camp.stages.goTo(2);                 // 跳關（locked 的關卡會被擋下）
__camp.gesture.setPinchThreshold(0.08);// 放寬捏合判定
```

`import.meta.env.DEV` 保護，production build 不會包含這段。

---

# 擴充開發指南

## A. 新增第二關：`Stage2Coating.ts`

### 步驟 1 — 建立關卡類別

新增 `src/stages/Stage2Coating.ts`，繼承 `BaseStage`。
必要的 metadata（標題、提示、操作說明）是 `abstract`，TypeScript 會強迫你全部填完，
UI 因此不可能出現空白欄位：

```ts
import type { InstructionStep, StageContext, StageFrame, StageResult } from '../core/types';
import { BaseStage } from './BaseStage';

export class Stage2Coating extends BaseStage {
  readonly id = 'coating';                 // ← 結果會存進 stages.resultOf('coating')
  readonly title = '塗佈光阻';
  readonly shortTitle = '光阻塗佈';        // LIVE 標籤與底部流程列用
  readonly description = '抓取燒杯把光阻倒到晶圓上，再旋轉塗佈鋪平。';
  readonly hint = '捏合抓住燒杯，移到晶圓上方後把手腕往下轉就會開始倒。';
  readonly primaryLabel = '完成塗佈';
  readonly usesPenTools = false;           // 這關不需要「畫筆顏色 / 已繪製圖形」HUD

  readonly instructions: InstructionStep[] = [
    { glyph: '🤏', title: '抓起燒杯', desc: '把手移到桌上的燒杯附近再捏合。' },
    { glyph: '↗️', title: '移到晶圓上方', desc: '維持捏合，把燒杯帶到晶圓正上方。' },
    { glyph: '🔄', title: '傾斜手腕', desc: '手腕往下轉超過 50° 就會開始倒出光阻。' },
  ];

  override onEnter(ctx: StageContext): void {
    super.onEnter(ctx);
    ctx.desk.setWaferVisible(true);        // 這關要看得到晶圓
  }

  override onFrame(frame: StageFrame): void { /* 見 B 節 */ }

  override canComplete(): boolean { return this.poured >= 1; }

  override buildResult(): StageResult {
    return { thickness: this.poured, uniformity: this.uniformity };
  }

  override restart(): void { this.poured = 0; }
}
```

### 步驟 2 — 註冊到 `StageManager`

打開 `src/main.ts`，把對應位置的 `StagePlaceholder` 換掉即可，**其他檔案都不用動**：

```diff
+import { Stage2Coating } from './stages/Stage2Coating';

 stages
   .register(new Stage1DrawPattern())
-  .register(
-    new StagePlaceholder({
-      id: 'coating',
-      title: '塗佈光阻',
-      /* … */
-    }),
-  )
+  .register(new Stage2Coating())
   .register(/* 第三關 … */);
```

註冊順序＝關卡順序。`StageManager` 會自動處理：

- 第一關 `active`、其餘 `locked`；
- `completeCurrent()` 把目前關標成 `done` 並解鎖下一關；
- 左側步驟列、底部流程列、Header 進度條、右側面板全部由 `UIManager.syncStages()` 重畫。

你在關卡裡想「直接判定失敗」時呼叫 `this.ctx.stages.fail('光阻厚度不均，重來一次')`，
失敗 Modal 會自動跳出來。

---

## B. 把「Pinch 吸附畫筆」直接改成「Pinch 抓取燒杯 / 晶圓夾」

第一關的 Attach 邏輯其實只有四行，而且**與道具無關**。整個模式是：

```
1. Attach   哪個條件成立時，道具跟著手走？
2. 命中     道具目前在哪個作用區上？
3. 作用     命中時每幀做什麼？
4. 回饋     怎麼畫這個道具、怎麼更新 UI？
```

### 差異對照

| | 第一關（畫筆） | 第二關（燒杯） |
| --- | --- | --- |
| Attach 條件 | 只要捏合就吸附 | 捏合 **且** 手離燒杯夠近才拿得起來 |
| 錨點 | `hand.pinchPoint` | 同上（道具位置＝捏合點） |
| 命中區 | `desk.isOnWafer(p)` | 晶圓正上方（同一個 `isOnWafer`） |
| 額外輸入 | 無 | **手腕傾斜角**（決定倒不倒） |
| 作用 | `desk.strokeTo()` | 累加倒出的量 |

### 可以直接抄的實作

```ts
import { INDEX_TIP, THUMB_TIP } from '../core/GestureDetector';
import type { Point, StageFrame } from '../core/types';

const GRAB_RADIUS = 70;   // 手離道具多近才抓得起來（px）
const POUR_TILT = 0.9;    // 手腕傾斜超過約 50° 開始倒
const POUR_RATE = 0.45;   // 每秒倒出的量

private attached = false;
private beaker: Point = { x: 0, y: 0 };
private poured = 0;

override onFrame(frame: StageFrame): void {
  const { hand, ar, desk, ui, dt } = frame;

  if (!hand.present) {
    this.attached = false;
    ui.setArHint('🖐️ 張開手掌，讓系統看見你的手');
    ui.setHandState('✋', '（未偵測到手）', 'NO HAND', false);
    return;
  }

  const p = hand.pinchPoint;

  // ── 1. Attach ───────────────────────────────────────────────────
  // 與第一關唯一的差別：多一個「要碰到燒杯」的距離判斷。
  // 想做成「一捏就有」（像畫筆那樣），把 distance 判斷拿掉就好。
  if (hand.justPinched && distance(p, this.beaker) < GRAB_RADIUS) this.attached = true;
  if (!hand.pinching) this.attached = false;
  if (this.attached) this.beaker = { ...p };        // ← 道具跟著捏合點走

  // ── 2. 命中 + 3. 作用 ────────────────────────────────────────────
  const tilt = handTilt(hand);                       // 手腕傾斜角
  const overWafer = desk.isOnWafer(this.beaker.x, this.beaker.y);
  const pouring = this.attached && overWafer && Math.abs(tilt) > POUR_TILT;
  if (pouring) this.poured = Math.min(1, this.poured + dt * POUR_RATE);

  // ── 4. 回饋 ─────────────────────────────────────────────────────
  this.drawBeaker(ar, this.beaker, tilt, this.attached);
  if (pouring) this.drawPourStream(ar, this.beaker, desk.geometry);
  desk.drawCursor(p.x, p.y, this.attached);

  ui.setArHint(
    pouring       ? `🧪 正在倒光阻…（${Math.round(this.poured * 100)}%）`
    : this.attached ? '🧪 燒杯已附著在你的手上 — 移到晶圓上方後傾斜手腕'
    :                 '🤏 把手移到燒杯上再捏合，就能拿起來',
    this.attached,
  );
  ui.setHandState(
    this.attached ? '🧪' : '✋',
    this.attached ? '燒杯（已吸附）' : '（空手）',
    `PINCH ${hand.pinchDistance.toFixed(3)} / TILT ${tilt.toFixed(2)}`,
    this.attached,
  );
}

/** 用拇指尖 → 食指尖的向量當作手腕旋轉角。 */
function handTilt(hand: StageFrame['hand']): number {
  const a = hand.landmarks[THUMB_TIP];
  const b = hand.landmarks[INDEX_TIP];
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
```

### 畫道具：把 `drawPen()` 改個形狀就好

`Stage1DrawPattern.drawPen()` 的骨架可以整段複製，只換中間的路徑：

```ts
private drawBeaker(ctx: CanvasRenderingContext2D, at: Point, tilt: number, attached: boolean): void {
  ctx.save();
  ctx.globalAlpha = attached ? 1 : 0.5;
  ctx.translate(at.x, at.y);
  ctx.rotate(tilt);                 // ← 畫筆是固定的 0.42，燒杯改成跟著手腕轉
  // 杯身
  ctx.fillStyle = 'rgba(180, 225, 235, 0.35)';
  ctx.strokeStyle = '#cfe8ef';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(-27, -38, 54, 76);
  ctx.fill();
  ctx.stroke();
  // 液面
  ctx.fillStyle = '#0f6b5c';
  ctx.fillRect(-25, 38 - 46 * (1 - this.poured), 50, 46 * (1 - this.poured));
  ctx.restore();
}
```

### 「晶圓夾」也是同一套

夾子（tweezers）只是把「作用」從倒液體換成夾取／放置：

```ts
// Attach：同上，把 this.beaker 換成 this.tweezers
// 作用：捏合放開的瞬間，如果夾子在 Chuck 上方就完成放置
if (hand.justReleased && this.holdingWafer && this.overChuck(desk)) {
  this.placed = true;
  this.ctx.stages.completeCurrent(this.buildResult());
}
```

### 建議：需要第三個道具時再抽共用類別

兩關之內用複製貼上最快也最好讀。等到第三個「可抓取道具」出現時，
再把上面的 Attach 區塊抽成 `src/core/AttachableProp.ts`：

```ts
export class AttachableProp {
  constructor(public position: Point, private grabRadius = 70) {}
  attached = false;
  update(hand: HandFrame): void {
    if (hand.justPinched && Math.hypot(hand.pinchPoint.x - this.position.x,
                                       hand.pinchPoint.y - this.position.y) < this.grabRadius) {
      this.attached = true;
    }
    if (!hand.pinching) this.attached = false;
    if (this.attached) this.position = { ...hand.pinchPoint };
  }
}
```

之後每個關卡就只剩 `this.beaker.update(hand)` 一行。

---

## 疑難排解

| 症狀 | 原因與解法 |
| --- | --- |
| 畫面全黑、右下顯示「鏡頭無法使用」 | 未授權攝影機，或不是 `https` / `localhost`。 |
| 骨架與真人的手位置對不上 | 檢查 `gesture.setVideoSize()` 是否拿到 `video.videoWidth`（metadata 載入後才有值）。 |
| 手往右移，畫面上的筆往左跑 | 鏡像被翻了兩次。確認 **只有 `#video-element`** 套了 `scaleX(-1)`。 |
| 很難捏合成功 | 「設定 → Pinch 靈敏度」調大，或在 `main.ts` 改 `new GestureDetector({ pinchOn: 0.07 })`。 |
| 低階筆電掉幀 | `CameraManager.createHands()` 把 `modelComplexity` 從 `1` 改成 `0`（lite 模型）。 |
| `Hands is not a constructor` | `public/mediapipe/` 不存在。重跑 `npm install` 或 `node scripts/copy-mediapipe.mjs`。 |
| 想改用 CDN 而不是自架資產 | 把 `CameraManager.ts` 的 `MP_BASE` 改成 `https://cdn.jsdelivr.net/npm/@mediapipe`，並確認版本與 `package.json` 一致。 |
