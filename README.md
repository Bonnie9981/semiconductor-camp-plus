# 半導體製程沉浸式模擬 · Semiconductor Process Simulator

以 **Vite + TypeScript + MediaPipe Hands** 打造的 WebAR 手勢互動遊戲。
玩家用「捏合（Pinch）」手勢拿起虛擬器材 —— 藥瓶、調配杯、晶圓、鑷子 ——
在畫面下方的虛擬實驗檯上一步步走完五道半導體製程。

> **接手開發請先讀 [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md)。**
> 那份文件說明整套架構的設計概念、每個模組的職責，以及怎麼新增關卡。

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
├─ 3. 微影製程 ─────┬─ 光阻劑塗抹      中心滴一滴，靠旋轉塗佈鋪成均勻薄膜
│                   ├─ 圖案設計        繪製要刻出的晶片圖案
│                   ├─ 正負光阻選擇    決定曝光區要移除還是保留
│                   └─ 曝光與烘烤      對準光罩後曝光
│
├─ 4. 顯影 ─────────┬─ 顯影液選擇      TMAH 2.38%（MIF 標準顯影液，正負光阻通用）
│                   └─ 顯影反應        浸泡並顯現圖案
│
└─ 5. 蝕刻 ─────────┬─ 氧氣電漿清潔    確保目標材料完全裸露
                    ├─ 蝕刻選擇        乾式（鉛直）或濕式（側向）
                    └─ 去光阻與清洗    丙酮 → NMP → 去離子水，三步依序
```

**目前的實作範圍**

| 關卡 | 狀態 |
| --- | --- |
| 1. RCA 清洗 | ✅ 四個子步驟全部完成（配液互動、浸泡、旋轉乾燥） |
| 2. 薄膜沉積 | ✅ 完成，含 PVD／CVD 分支與粒子動畫 |
| 3. 微影製程 | ✅ 完成（滴光阻／旋轉塗佈／繪圖／正負光阻／對位曝光） |
| 4. 顯影 | ✅ 完成（選 TMAH、浸泡攪拌顯影） |
| 5. 蝕刻 | ✅ 完成（O₂ 電漿清潔、乾／濕蝕刻分支、去光阻） |

### 藥液正確答案的依據

第四、五關的「正解」都查過業界資料，不是憑印象：

| 步驟 | 正解 | 依據 |
| --- | --- | --- |
| 顯影 | **TMAH 2.38%** | 半導體標準顯影液，MIF（不含金屬離子）。**正光阻與負光阻都用它** —— 負光阻是靠鹼液溶掉「沒有交聯」的未曝光區。二甲苯只用於早期橡膠系負光阻，量產線已淘汰 |
| 濕式蝕刻 | **PAN 鋁蝕刻液**（H₃PO₄ : CH₃COOH : HNO₃ : H₂O ≈ 80:15:3:2） | 此時最上層是金屬鋁。硝酸先氧化鋁、磷酸溶掉氧化鋁、醋酸降低表面張力幫助潤濕。BOE 是給 SiO₂ 用的，對鋁無效 |
| 去光阻 | **丙酮 → NMP → 去離子水**（三步） | ① 先用丙酮溶掉大部分光阻（**不可用去離子水**，光阻不溶於水）② 丙酮揮發快會留殘渣，再用高沸點的 NMP 徹底剝除 ③ 最後以去離子水沖掉殘留溶劑。順序不能顛倒 |

五道製程全部走完後會進入**結業證書**畫面：自動拍一張照片，和你親手做出來的
晶圓圖案排成一張證書，可下載 **PDF 證書**、**晶圓 PNG** 與 **3D 模型 STL**。

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
│   │   ├── SpinDryer.ts        # 旋轉乾燥機
│   │   ├── Chamber.ts          # 沉積／電漿腔體與機台上的實體控制元件
│   │   ├── Particles.ts        # 粒子場（直線下落 / 擴散亂走）
│   │   ├── Aligner.ts          # 光罩對準曝光機（UV 燈 / 可拖曳光罩）
│   │   └── TankBench.ts        # 一排藥液槽（顯影／濕蝕刻／去光阻共用）
│   ├── stages/
│   │   ├── BaseStage.ts        # 關卡抽象基底（含子步驟機制）
│   │   ├── Stage1RCA.ts        # 第一關：RCA 清洗（完整實作）
│   │   ├── Stage2Deposition.ts # 第二關：薄膜沉積（完整實作）
│   │   ├── Stage3Litho.ts      # 第三關：微影製程（完整實作）
│   │   ├── Stage4Develop.ts    # 第四關：顯影（完整實作）
│   │   ├── Stage5Etch.ts       # 第五關：蝕刻（完整實作）
│   │   └── DipStageBase.ts     # 「把晶圓拖進正確藥液槽」的共用基底
│   ├── ui/
│   │   ├── UIManager.ts        # 所有 HTML UI 的唯一操作入口
│   │   ├── VirtualDesk.ts      # 下方虛擬桌面：Chuck、晶圓、Pattern 圖層
│   │   └── CrossSection.ts     # 右下角晶圓截面圖 HUD
│   └── utils/
│       ├── Exporter.ts         # PNG 下載 + STL 擠出
│       └── Certificate.ts      # 拍照、證書排版、最小 PDF 產生器
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
| ├ `#desk-canvas` | 2 | `none` | 虛擬桌面與關卡自繪的場景（燒杯、藥瓶、機台） |
| └ `#ar-canvas` | 3 | `none` | 吸附在手上的道具 |
| `#ui-layer` | 10 | `auto` | 所有 HTML：Header / Sidebar / Panel / HUD / Modal |
| `#hand-canvas` | 60 | `none` | 手勢骨架與捏合游標 —— **疊在所有東西之上** |

**手部骨架是獨立的一層，而且在最上面。** 只畫在 canvas（z-index 3）時，
手一移到左側互動面板（HTML, z-index 10）就會被蓋掉，玩家看不到自己指著哪顆按鈕。
`drawHandSkeleton()` 另外畫一圈**捏合游標**，明確標出所有命中判定實際使用的那個點。

**視窗內也有一顆「完成本關 / 下一步」按鈕**（`#btn-stage-action`）。
右側面板在鏡頭視野之外、手構不到，所以主要行動必須在視窗裡也有一份，
整場遊戲才能純用手玩完。Modal 上的按鈕同樣標了 `data-pinch`，捏合游標按得到。

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

## 第二關的互動循環

原則是**能用手直接碰的就不要做成按鈕**：

```
拖晶圓進機台 ─▶ 拖門把關腔門 ─▶ 自動抽真空 ─▶ 操作機台控制 ─▶ 按大按鈕啟動
  ＝選擇製程                                        │
                                    ┌───────────────┴───────────────┐
                              PVD：拉桿調電子束功率        CVD：轉兩顆氣閥旋鈕
                                    └───────────────┬───────────────┘
                                        維持在綠色製程窗口內，膜才長得快
```

| 操作 | 手勢 | 對應的製程意義 |
| --- | --- | --- |
| 把晶圓拖進 e-gun 或 PECVD | 捏起 → 移動 → 放開 | 選擇 PVD 或 CVD |
| 拖門把往左 | 捏住拖曳 | 腔室密閉，否則殘留空氣會讓薄膜氧化 |
| 上下拖拉桿 | 捏住拖曳 | 電子束功率。太低長得慢，太高靶材過熱 |
| 左右轉旋鈕 | 捏住拖曳 | SiH₄ 與 N₂O 流量比，決定 SiO₂ 的化學計量 |
| 按機台上的圓鈕 | 捏一下 | 啟動電子槍 / 點燃電漿 |

粒子運動直接表達兩種製程的差別（見 `scene/Particles.ts`）：

- **ballistic（PVD）** —— 真空中沒有東西撞它，一條一條**筆直落下**
- **diffusive（CVD）** —— 氣體分子互相碰撞，**邊飄邊亂走**，被電漿激發後才在表面反應

**分支**：PVD 一次就鍍上金屬；CVD 先長氧化層，還要再進 e-gun 鍍一層金屬。
子步驟是線性的，所以 PVD 路線在 `onSubEnter()` 直接跳過「金屬鍍膜」那一步。

---

## 第三關的互動循環

四個子步驟，每一步都是用手完成的：

| 子步驟 | 手勢 | 過關條件 |
| --- | --- | --- |
| 光阻劑塗抹 | 捏一下在中心滴一滴 | 滴完直接進旋轉塗佈（光阻靠離心力鋪開，不是用抹的） |
| 圖案設計 | 捏合畫線 | 圖案覆蓋 ≥ 1.5% |
| 正負光阻選擇 | 把手移到卡片上捏一下 | 兩張大卡片各附剖面示意圖 |
| 曝光與烘烤 | 捏住光罩拖曳對位 → 按大按鈕 | 兩組十字記號重合到 14 µm 內 |

**視角會切換**：前兩步是**俯視**（設計圖案就該從正上方看，晶圓直徑 328–486px），
第四步切到**正視**，才看得到 UV 燈 → 光罩 → 晶圓的上下關係。

**關鍵教學點：畫出來的圖案是鉻層，會擋住光。** 這是初學者最容易搞反的地方，
所以曝光動畫刻意用「先鋪滿一層光，再用圖案挖掉」來表達：

```ts
ctx.fillRect(...);                       // 光罩到晶圓之間鋪滿 UV
ctx.globalCompositeOperation = 'destination-out';
ctx.drawImage(pattern, ...);             // 有鉻的地方把光挖掉
```

曝光結束時把圖案換算成 `WaferState.exposedMask`（有鉻 = 0，沒畫到 = 1），
第四關的顯影再依 `resistTone` 決定哪一邊的光阻被溶掉。

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

  **繞序（winding）必須讓所有面的法線一致朝外。** 外緣側牆原本寫成
  `(a@0, a@z, b@z)`，叉積是 `ẑ × θ̂ = −r̂` —— 整圈側牆的法線朝內。網格雖然仍然
  封閉（每條邊都用兩次），但定向不一致、散度定理算出來的帶號體積是**負的**，
  切片軟體因此不把它當成實心體。改成 `(a@0, b@0, b@z)` 之後 `θ̂ × ẑ = +r̂` 才正確。

  **圖案的凸凹由光阻類型決定**（`invert` 選項）：
  正光阻 → 光阻留在畫到的地方 → 被保護 → **凸起**；
  負光阻 → 光阻留在沒畫到的地方 → 畫到的地方被蝕掉 → **凹陷**。

  預設 `resolution: 160`。

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


---

## 結業證書

五道製程全部完成後會自動進入證書畫面：

```
allComplete ─▶ capturePhoto(video)      從 <video> 擷取一張 4:3 照片（依鏡像翻轉）
            ─▶ composeCertificate()     照片 + 晶圓圖 + 製程紀錄排版成 1684×1190 canvas
            ─▶ canvasToPdf()            包成 A4 橫式 PDF
```

**為什麼不用 PDF 函式庫？** 證書上有大量中文，任何在 PDF 裡「排文字」的方案
都得嵌入中文字型（一個檔就好幾 MB，還要處理 subset 與 CID 編碼）。
這裡改成先把整張證書畫在 canvas 上（文字由瀏覽器渲染成點陣），
再把單一張 JPEG 包進最小的 PDF 骨架 —— 不需要任何字型物件，
輸出也保證跟畫面上看到的一模一樣。

PDF 只用到 Catalog → Pages → Page → 一個 DCTDecode 影像。xref 表需要每個物件的
位元組位移，所以整份文件是以 `Uint8Array` 拼出來的（字串以 latin1 逐字元寫入，
才不會破壞中間的二進位 JPEG 段）。

證書畫面同時提供三種下載：**PDF 證書**、**晶圓 PNG**、**3D 模型 STL**。
中途的關卡結算視窗**不提供任何下載** —— 那時候拿到的是半成品。


---

## 開發者模式

設定（⚙）→「開發者模式」。開啟後左側步驟列與底部流程列的**所有關卡都可以點**，
包含還沒解鎖的（會標成黃色虛線框）。`StageManager.goTo(index, force)` 的 `force`
會無視鎖定並順手把目標關卡解鎖。

跳關進來時晶圓可能缺少前置狀態（例如直接跳到第五關時還沒有光阻層），
第四、五關的 `onEnter()` 會自動補上，否則會卡在「沒有光阻可以剝除」而過不了關。

---

## 破壞性操作的確認

「再玩一次」與右上角的退出鈕都會先開一個**置中的確認框**（`#confirm-root`，
z-index 70）。刻意不用 `window.confirm` —— 原生對話框沒辦法用捏合手勢按。

另外，五道製程全部完成後**延遲 1.6 秒**才開證書畫面：玩家是用捏合按下「完成蝕刻」的，
手往往還停在原處，證書一瞬間跳出來的話，同一次捏合的殘留判定就可能直接打到
「再玩一次」。
