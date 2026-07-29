# 半導體製程沉浸式模擬 · Semiconductor Process Simulator

以 **Vite + TypeScript + MediaPipe Hands** 打造的 WebAR 手勢互動遊戲。
玩家用「捏合（Pinch）」手勢拿起虛擬器材 —— 藥瓶、調配杯、晶圓、鑷子 ——
在畫面下方的虛擬實驗檯上一步步走完五道半導體製程。

> **接手開發請先讀 [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md)。**
> 那份文件說明整套架構的設計概念、每個模組的職責，以及第 2~5 關要怎麼接。

---

## 遊戲流程

```
半導體製程沉浸式模擬
│
├─ 1. RCA 清洗 ─────┬─ 去微粒          SC-1：DI : NH₄OH : H₂O₂ = 5 : 1 : 1
│                   ├─ 去氧化層        氫氟酸水溶液溶解原生 SiO₂
│                   ├─ 去離子          SC-2：DI : HCl : H₂O₂ = 6 : 1 : 1
│                   └─ 乾燥            離心力甩乾 + 80°C 熱風
│
├─ 2. 薄膜沉積 ─────┬─ 製程選擇        物理氣相沉積（PVD）或化學氣相沉積（CVD）
│                   ├─ 沉積反應        粒子運動與鍍膜
│                   └─ 金屬鍍膜        CVD 路線才需要（PVD 會跳過）
│
├─ 3. 微影製程 ─────┬─ 光阻劑塗抹      用手把光阻均勻塗抹到晶圓上
│                   ├─ 圖案設計        繪製要刻出的晶片圖案
│                   ├─ 正負光阻選擇    決定曝光區要移除還是保留
│                   └─ 曝光與烘烤      對準光罩後曝光
│
├─ 4. 顯影 ─────────┬─ 顯影液選擇      選出能溶解曝光區光阻的試劑
│                   └─ 顯影反應        浸泡並顯現圖案
│
└─ 5. 蝕刻 ─────────┬─ 氧氣電漿清潔    確保目標材料完全裸露
                    ├─ 蝕刻選擇        乾式（鉛直）或濕式（側向）
                    └─ 去光阻與清洗    丙酮／NMP 剝除後以去離子水清洗
```

**目前的實作範圍**

| 關卡 | 狀態 |
| --- | --- |
| 1. RCA 清洗 | ✅ 四個子步驟全部完成（配液互動、浸泡、旋轉乾燥） |
| 2. 薄膜沉積 | 🚧 Stub —— metadata 與子步驟已定義，製程邏輯待實作 |
| 3. 微影製程 | 🚧 Stub（繪圖互動的原型保留在 `Stage1DrawPattern.ts`） |
| 4. 顯影 | 🚧 Stub |
| 5. 蝕刻 | 🚧 Stub |

Stub 關卡的 UI 框架、子步驟列、關卡切換與手勢管線都是活的，可以完整走一遍流程。

---

## 快速開始

```bash
cd semiconductorAR
npm install     # postinstall 會自動把 MediaPipe 資產複製到 public/mediapipe/（約 26MB）
npm run dev     # → http://localhost:5173
```

開啟後允許瀏覽器的攝影機權限即可開始。**沒有攝影機也玩得下去** —— 左側互動面板的
按鈕都是真正的 HTML，用滑鼠一樣能操作（見〈沒有攝影機也能測〉）。

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
semiconductorAR/
├── index.html                  # 版面骨架（Header / Sidebar / Viewport / Panel / Footer / Modal）
├── vite.config.ts
├── docs/
│   └── IMPLEMENTATION.md       # ★ 實作概念與接手指南
├── scripts/
│   └── copy-mediapipe.mjs      # postinstall：複製 MediaPipe wasm/模型到 public/
├── src/
│   ├── main.ts                 # 程式入口、關卡註冊、UI 事件綁定、rAF 主迴圈
│   ├── style.css               # 設計 token（oklch 深色 Dashboard + IBM Plex）＋ 響應式斷點
│   ├── core/
│   │   ├── CameraManager.ts    # WebCam、前後鏡頭切換、MediaPipe Hands 整合
│   │   ├── GestureDetector.ts  # 鏡像座標映射、Pinch 判斷、骨架繪製
│   │   ├── StageManager.ts     # 關卡狀態機（locked → active → done）
│   │   ├── WaferState.ts       # 晶圓的層堆疊與污染狀態（整條製程共用）
│   │   └── types.ts            # 全專案共用型別（含子步驟與互動面板的定義）
│   ├── data/
│   │   └── solutions.ts        # 藥液資料表（名稱／化學式／顏色）與混色計算
│   ├── scene/                  # 純繪圖模組：吃狀態、畫一格畫面，不含遊戲邏輯
│   │   ├── Beaker.ts           # 燒杯／調配杯、平放晶圓的共用畫法
│   │   ├── Bottle.ts           # 藥瓶與傾倒液柱
│   │   ├── Drain.ts            # 廢液桶
│   │   └── SpinDryer.ts        # 旋轉乾燥機
│   ├── stages/
│   │   ├── BaseStage.ts        # 關卡抽象基底（含子步驟機制）
│   │   ├── Stage1RCA.ts        # 第一關：RCA 清洗（完整實作）
│   │   ├── Stage1DrawPattern.ts# 繪圖互動原型，將併入第三關的「圖案設計」
│   │   └── StagePlaceholder.ts # 第 2~5 關的 Stub 樣板
│   ├── ui/
│   │   ├── UIManager.ts        # 所有 HTML UI 的唯一操作入口
│   │   ├── VirtualDesk.ts      # 下方虛擬桌面：Chuck、晶圓、Pattern 圖層
│   │   └── CrossSection.ts     # 右下角晶圓截面圖 HUD
│   └── utils/
│       └── Exporter.ts         # PNG 下載 + STL 擠出
└── public/
    ├── assets/                 # 你自己的素材
    └── mediapipe/              # 由 postinstall 產生（已 gitignore）
```

資料流是單向的：

```
MediaPipe → CameraManager.latest → GestureDetector（鏡像/Pinch/平滑）
          → BaseStage.onFrame() ─┬─▶ scene/*（畫場景）
                                 ├─▶ VirtualDesk（畫桌面）
                                 ├─▶ WaferState（改晶圓狀態）→ CrossSection（畫截面）
                                 └─▶ UIManager.setPanel()（描述互動面板）
```

---

## 圖層規範（為什麼按鈕一定點得到）

「按鈕點不到」幾乎都是因為透明的 canvas 蓋在 UI 上面。本專案用兩層固定定位徹底切開：

| 元素 | z-index | pointer-events | 職責 |
| --- | --- | --- | --- |
| `#stage-view` | 1 | `none` | 鏡頭視窗容器，由 JS 對齊到 `#viewport-slot` |
| ├ `#video-element` | 1 | — | WebCam 影像（鏡像時只翻轉「它」） |
| ├ `#ar-canvas` | 2 | `none` | 手勢骨架、吸附在手上的道具 |
| └ `#desk-canvas` | 3 | `none` | 虛擬桌面與關卡自繪的場景（燒杯、藥瓶、機台） |
| `#ui-layer` | 10 | `auto` | 所有 HTML：Header / Sidebar / Panel / HUD / Modal |

`#ui-layer` 是一個 CSS Grid Dashboard，中間那格 `#viewport-slot` 只是**鏤空的視覺外框**
（`pointer-events: none`），`main.ts` 的 `syncStageView()` 用 `ResizeObserver` 把 `#stage-view`
精準疊上去。因此：

- 三層 canvas 永遠在 UI 底下，**不可能攔截任何點擊**；
- 位於視窗上的 HUD（鏡頭設定、手勢參考、互動面板…）是真正的 HTML，照樣 100% 可點；
- canvas 尺寸永遠等於 slot 尺寸，座標不需要任何額外換算。

---

## 鏡頭視窗內的版面配置

鏡頭視窗被切成三個互不重疊的區域，這是為了讓場景動畫永遠不被 UI 蓋住：

```
┌──────────────────────────────────────────────────────┐
│ LIVE  攝影機  鏡像            ┌──────────────┐        │  vp-top
│ ① 去微粒 ─ ② 去氧化層 ─ …    │ 手勢參考      │        │  #substep-strip  (top: 56)
│         ┌ AR 提示橫幅 ┐       └──────────────┘        │  #ar-hint        (top: 94)
│ ┌─────────────┐                                       │
│ │             │        ▮ ▮ ▮ ▮ ▮ ▮   ← 藥瓶層板        │
│ │ 互動面板     │                                       │  #stage-panel    (top: 146)
│ │ (選擇/配比/  │         ╭───╮          ╭─╮            │
│ │  動作按鈕)   │   ◯     │杯 │          │桶│            │  ← 場景（canvas）
│ └─────────────┘  晶圓    ╰───╯          ╰─╯            │
│ ┌───────────┐                                         │
│ │ 晶圓截面   │                                         │  vp-bottom
│ └───────────┘                                         │
└──────────────────────────────────────────────────────┘
```

**場景會自動避開互動面板。** 關卡不是用寫死的百分比擺器材，而是跟 `UIManager.panelInset()`
問「面板實際佔了多少寬度」，再從那裡往右佈局：

```ts
const inset = frame.ui.panelInset();          // 面板右緣（CSS px），收起時為 0
const left  = Math.min(inset + 26, width * 0.52);
const right = width - 14;
```

所以要調整版面只需要改 CSS 變數 `--panel-scene-w`，canvas 上的佈局會自動跟著讓位，
不需要在 TypeScript 裡再維護一份斷點。

### 響應式

| 目標尺寸 | 對應處理 |
| --- | --- |
| 1920×1080 外接螢幕 | 預設值 |
| 1512×982 MacBook Pro 14" | `max-height: 860px` → 壓低 Header/Footer，上方三條帶狀元素整體上移 |
| 1440×900 MacBook Air 13" | 同上，另觸發 `max-width: 1420px` → 側欄與面板縮窄 |
| 1366×768 Windows 筆電 | `max-height: 740px` → 再壓一次，字級與間距同步縮小 |
| < 1180px 寬 | 側欄壓到 196/236px，子步驟列縮小字級 |

canvas 上的器材尺寸則全部由 `clamp(依比例值, 下限, 上限)` 決定，
例如燒杯高度是 `clamp(min(height × 0.26, sceneW × 0.42), 96, 172)` ——
高度與寬度都不足時取小者，但永遠不小於可辨識的下限。

---

## 鏡像（照鏡子感）是怎麼做的

⚠️ **只翻 `<video>`，不要翻 AR canvas。**

若 video 與 AR canvas 都套 `transform: scaleX(-1)`、同時座標又做 `(1-x)*W` 映射，
這兩件事會互相抵消：座標翻到 800，canvas 再翻一次就變回 200，道具會往反方向跑；
而且 canvas 上的圖示與文字也會整個左右顛倒。

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

前三個子步驟不是選選項，而是真的動手配液：

```
捏起藥瓶 ─▶ 移到調配杯上方 ─▶ 瓶身自動傾倒、液柱流下
     │                              │  每 0.8 秒進 1 份（杯口有進度環）
     │                              ▼
     └── 放開＝放回層板        杯子的液面高度與混合顏色即時改變
                                    │
                        ┌───────────┴───────────┐
                   送去浸泡                  倒掉
                        │                       │
              配方對 ─▶ 浸泡動畫        捏起調配杯 ─▶ 移到廢液桶 ─▶ 放開
              配方錯 ─▶ 鎖住只能倒掉              （或按面板的「倒掉」）
```

- **Pinch 門檻**：`|landmark[4] - landmark[8]| < 0.05` 判定捏合，
  大於 `0.05 × 1.5` 才放開（遲滯區間，避免在門檻附近瘋狂閃爍）。可在「設定」中即時調整。
- **判定時機**：成分與份數在按下「送去浸泡」時才一起檢查。左側面板隨時顯示杯內清單，
  玩家可以自己核對。配錯 → 進入 `wrong` 狀態，唯一的出口是把整杯倒掉重來
  （真實製程配錯藥液也不可能微調，只能整槽報廢）。
- **份數要完全相符**：5:1:1 就是 5:1:1，10:2:2 不算對。
- **第四步（乾燥）** 改用手勢：捏合夾起晶圓 → 拖進滾筒的虛線圈 → 放開 → 按 START。
  沒有鏡頭時，左側面板會提供等效的按鈕。

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

  預設 `resolution: 120` → 57,600 面、約 2.8MB。

---

## 沒有攝影機也能測（開發用）

兩種方式：

**1. 用滑鼠玩。** 左側互動面板是真正的 HTML，所有按鈕都能點。
需要手勢的動作（夾晶圓、倒廢液）都另外提供了等效按鈕。

**2. Console。** `npm run dev` 模式下，主要模組會掛在 `window.__camp`：

```js
__camp.stages.completeCurrent({});      // 直接過關
__camp.stages.goTo(2);                  // 跳關（locked 的關卡會被擋下）
__camp.gesture.setPinchThreshold(0.08); // 放寬捏合判定

// 直接改晶圓狀態，驗證截面圖
__camp.wafer.contamination.particles = 0;
__camp.wafer.addLayer({ kind: 'oxide', label: 'SiO₂', thickness: 0.6,
                        color: '#8fa8b8', patterned: false });
```

`import.meta.env.DEV` 保護，production build 不會包含這段。

---

## 疑難排解

| 症狀 | 原因與解法 |
| --- | --- |
| 畫面全黑、右下顯示「鏡頭無法使用」 | 未授權攝影機，或不是 `https` / `localhost`。 |
| 骨架與真人的手位置對不上 | 檢查 `gesture.setVideoSize()` 是否拿到 `video.videoWidth`（metadata 載入後才有值）。 |
| 手往右移，畫面上的道具往左跑 | 鏡像被翻了兩次。確認 **只有 `#video-element`** 套了 `scaleX(-1)`。 |
| 很難捏合成功 | 「設定 → Pinch 靈敏度」調大，或在 `main.ts` 改 `new GestureDetector({ pinchOn: 0.07 })`。 |
| 藥瓶抓不起來 | 抓取半徑是 `max(44, 瓶寬 × 1.15)`，見 `Stage1RCA.grabRadius()`。 |
| 倒得太快／太慢 | `Stage1RCA.ts` 頂端的 `POUR_INTERVAL`（預設 0.8 秒 = 1 份）。 |
| 互動面板蓋住場景 | 場景左界來自 `UIManager.panelInset()`。若自訂了面板寬度，改 CSS 的 `--panel-scene-w` 即可。 |
| 低階筆電掉幀 | `CameraManager.createHands()` 把 `modelComplexity` 從 `1` 改成 `0`（lite 模型）。 |
| `Hands is not a constructor` | `public/mediapipe/` 不存在。重跑 `npm install` 或 `node scripts/copy-mediapipe.mjs`。 |
| 想改用 CDN 而不是自架資產 | 把 `CameraManager.ts` 的 `MP_BASE` 改成 `https://cdn.jsdelivr.net/npm/@mediapipe`，並確認版本與 `package.json` 一致。 |
