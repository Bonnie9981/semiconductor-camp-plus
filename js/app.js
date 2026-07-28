/**
 * app.js
 * ------------------------------------------------------------
 * 唯一「知道整個遊戲流程長怎樣」的地方。其他模組互相不知道彼此存在，
 * 都是透過這裡組裝、透過 EventBus 溝通。
 *
 * ============================================================
 * 如何加入一支新關卡（例如「清洗 Cleaning」）：
 * ============================================================
 *   1. 建立 js/levels/clean.js（複製 waferBreak.js 當樣板）
 *   2. 在檔案裡呼叫：
 *        LevelManager.register('clean', {
 *          code: 'CLN', label: 'Wafer Cleaning',
 *          instructions: '...',
 *          mount(container, ctx) { ... },
 *          unmount(container, ctx) { ... },
 *        });
 *   3. 在 index.html 的 <script> 區塊加一行
 *        <script src="js/levels/clean.js"></script>
 *      （放在 app.js 之前即可，順序不影響邏輯）
 *   4. 在下面的 LEVEL_ORDER 陣列中，把 'clean' 加到你想要的順序位置
 *
 *   完成。不需要改 gameState.js / levelManager.js / index.html 版面，
 *   sidebar 的站點清單、進度條、鎖定狀態都會自動依 LEVEL_ORDER 產生。
 *
 * ============================================================
 * 目前註冊的關卡（依需求 1，除了 'litho-paint' 之外全部是佔位關卡，
 * 只示範「怎麼掛進流程」，實際製程互動邏輯留給你自行實作）：
 * ============================================================
 */
(function () {
  'use strict';

  const LEVEL_ORDER = ['clean', 'litho-paint', 'etch', 'deposit', 'oxidize', 'implant', 'dicing'];

  // ---- 佔位關卡（除 litho-paint、dicing 外）----
  // 每一關都用同一份「示範完成」按鈕當作暫時的過關條件，
  // 之後把 mount() 裡的內容換成真正的製程互動即可，介面不用動。
  function registerPlaceholderLevel(id, code, label, instructions) {
    let btnRef = null;
    let clickHandler = null;
    LevelManager.register(id, {
      code, label, instructions,
      mount(container, ctx) {
        btnRef = UI.createButton({
          label: `（佔位關卡）完成 ${label}`,
          onClick: () => ctx.completeLevel({ placeholder: true }),
        });
        btnRef.style.cssText = 'position:absolute;left:16px;top:16px;';
        container.appendChild(btnRef);
      },
      unmount() {
        btnRef?.remove();
        btnRef = null;
      },
    });
  }

  registerPlaceholderLevel('clean', 'CLN', 'Wafer Cleaning',
    '清洗晶圓表面的雜質與微粒（待實作：偵測晶圓在清洗槽中的擦洗動作）。');
  registerPlaceholderLevel('etch', 'ETCH', 'Etching',
    '用化學或電漿蝕刻移除未受光罩保護的區域（待實作：偵測手把控制桿反覆下拉的動作）。');
  registerPlaceholderLevel('deposit', 'DEP', 'Deposition',
    '在晶圓表面鍍上一層薄膜（待實作：偵測手把控制桿反覆上推的動作）。');
  registerPlaceholderLevel('oxidize', 'OXD', 'Oxidation',
    '在高溫氧氣環境中生成氧化層（待實作：偵測手部在爐口位置的持續停留）。');
  registerPlaceholderLevel('implant', 'ION', 'Ion Implantation',
    '將摻雜離子植入晶圓以改變導電性（待實作：偵測手部對佈植機按鈕的多次點擊）。');

  // ---- 需求 6-1：litho-paint 關卡 —— 玩家用手繪製 pattern，並選擇光阻極性 ----
  LevelManager.register('litho-paint', {
    code: 'LITH',
    label: 'Photolithography (Draw Pattern)',
    instructions:
      '選擇你要使用的光阻極性（正光阻 / 負光阻），然後直接在鏡頭畫面上畫出你的光罩圖案。' +
      '完成後按下「Expose」結束本站，你畫的圖案會保留到遊戲結束的下載檔案中。',

    mount(container, ctx) {
      const { painter, completeLevel } = ctx;
      painter.clear();
      painter.setEnabled(true);

      const panel = document.createElement('div');
      panel.style.cssText = 'position:absolute;left:16px;top:16px;display:flex;flex-direction:column;gap:8px;';
      panel.innerHTML = `
        <div style="display:flex;gap:8px;">
          <label style="color:#fff;font-size:var(--fs-sm);display:flex;align-items:center;gap:4px;">
            <input type="radio" name="resist" value="positive" checked> 正光阻
          </label>
          <label style="color:#fff;font-size:var(--fs-sm);display:flex;align-items:center;gap:4px;">
            <input type="radio" name="resist" value="negative"> 負光阻
          </label>
        </div>
        <button class="win-btn" id="btn-clear-pattern">Clear</button>
        <button class="win-btn" id="btn-expose">Expose (Finish Drawing)</button>
      `;
      container.appendChild(panel);

      panel.querySelectorAll('input[name="resist"]').forEach((el) => {
        el.addEventListener('change', (e) => GameState.setResistPolarity(e.target.value));
      });
      panel.querySelector('#btn-clear-pattern').addEventListener('click', () => painter.clear());
      panel.querySelector('#btn-expose').addEventListener('click', () => {
        if (painter.isEmpty()) {
          alert('請先畫出至少一筆圖案再曝光。');
          return;
        }
        const positiveDataURL = painter.getPatternDataURL(false);
        const negativeDataURL = painter.getPatternDataURL(true);
        GameState.setPattern(positiveDataURL, false);
        // 兩種版本都先存起來，exportManager 依 resistPolarity 挑選要輸出哪一個。
        const p = GameState.getPattern();
        if (p) p.negativeDataURL = negativeDataURL;
        painter.setEnabled(false);
        completeLevel({ hasPattern: true });
      });

      this._panel = panel;
    },
    unmount(container, ctx) {
      ctx.painter.setEnabled(false);
      this._panel?.remove();
      this._panel = null;
    },
  });

  // ---- 啟動 ----
  window.addEventListener('DOMContentLoaded', () => {
    const stageOuter = document.getElementById('stage-outer');
    const stageViewport = document.getElementById('stage-viewport');
    const videoEl = document.getElementById('camera-video');
    const canvasEl = document.getElementById('camera-canvas');
    const painterCanvasEl = document.getElementById('painter-canvas');
    const attachLayerEl = document.getElementById('attachable-layer');
    const cameraFrameEl = document.getElementById('camera-frame');

    // ---- 需求 2：等比例縮放固定 16:9 舞台以符合任意筆電視窗尺寸 ----
    function fitStageToViewport() {
      const designW = 1600, designH = 900;
      const scale = Math.min(window.innerWidth / designW, window.innerHeight / designH);
      stageViewport.style.transform = `scale(${scale})`;
    }
    fitStageToViewport();
    window.addEventListener('resize', fitStageToViewport);

    // ---- 模組組裝 ----
    const camera = createCamera({ videoEl, canvasEl });
    const painter = createPainter({ canvasEl: painterCanvasEl });
    const gripper = createGripper({ camera, eventBus: EventBus, layerEl: attachLayerEl });
    const screens = createScreens({ rootEl: document.getElementById('end-screen-root') });

    camera.start();
    gripper.start();

    LevelManager.setSharedContext({ eventBus: EventBus, gameState: GameState, camera, gripper, painter });

    // levelManager 需要知道每個關卡在序列中的 index，用來組出 completeLevel/failLevel
    LEVEL_ORDER.forEach((id, i) => {
      const def = LevelManager.get(id);
      if (def) def.__index = i;
      else console.error(`[app.js] level "${id}" was listed in LEVEL_ORDER but never registered.`);
    });

    GameState.init(LEVEL_ORDER);

    // ---- Sidebar / 進度條 渲染（唯讀畫面，狀態一律來自 GameState）----
    const stationListEl = document.getElementById('station-list');
    const overallFill = document.getElementById('overall-progress-fill');
    const overallLabel = document.getElementById('overall-progress-label');
    const stepFill = document.getElementById('step-progress-fill');
    const stepLabel = document.getElementById('step-progress-label');
    const stationTitleEl = document.getElementById('station-title');
    const stationInstructionsEl = document.getElementById('station-instructions');
    const finishBtn = document.getElementById('btn-open-end-screen');

    function renderStationList(snapshot) {
      stationListEl.innerHTML = '';
      snapshot.order.forEach((id, i) => {
        const def = LevelManager.get(id);
        const status = snapshot.statuses[i];
        const locked = !GameState.canSelect(i);
        const row = UI.createStationRow({
          code: def?.code || '??',
          label: def?.label || id,
          status,
          progressPct: snapshot.progress[i],
          locked,
          onSelect: () => { if (!locked) GameState.selectLevel(i); },
        });
        stationListEl.appendChild(row);
      });
    }

    function renderProgress(snapshot) {
      const doneCount = snapshot.statuses.filter((s) => s === 'done').length;
      const overallPct = (doneCount / snapshot.statuses.length) * 100;
      UI.updateProgressBar(overallFill, overallLabel, overallPct);
      UI.updateProgressBar(stepFill, stepLabel, snapshot.progress[snapshot.currentIndex] || 0);
      finishBtn.disabled = !snapshot.isComplete;
    }

    function renderActiveLevel(snapshot) {
      const id = snapshot.order[snapshot.currentIndex];
      const def = LevelManager.get(id);
      stationTitleEl.textContent = def ? `${def.code} — ${def.label}` : '—';
      stationInstructionsEl.textContent = def?.instructions || '';
      LevelManager.mountLevel(id, cameraFrameEl);
    }

    let lastMountedIndex = -1;
    EventBus.on('state:changed', (snapshot) => {
      renderStationList(snapshot);
      renderProgress(snapshot);
      if (snapshot.currentIndex !== lastMountedIndex) {
        lastMountedIndex = snapshot.currentIndex;
        renderActiveLevel(snapshot);
      }
    });

    // 手動觸發第一次渲染
    EventBus.emit('state:changed', GameState.getSnapshot());

    // ---- 需求 6：結局畫面觸發 ----
    EventBus.on('game:completed', () => screens.showSuccess());
    EventBus.on('game:failed', ({ reason }) => screens.showFailure(reason));
    EventBus.on('game:retryRequested', () => {
      screens.clear();
      GameState.resetCurrentLevel();
      EventBus.emit('state:changed', GameState.getSnapshot());
    });
    EventBus.on('game:restartRequested', () => {
      screens.clear();
      GameState.init(LEVEL_ORDER);
    });

    // ---- 其餘按鈕 ----
    document.getElementById('btn-reset-step').addEventListener('click', () => GameState.resetCurrentLevel());
    document.getElementById('btn-open-end-screen').addEventListener('click', () => {
      if (GameState.getSnapshot().isComplete) screens.showSuccess();
    });
    document.getElementById('btn-exit').addEventListener('click', () => {
      if (confirm('離開訓練模擬器？目前晶圓的進度將會遺失。')) window.location.reload();
    });
    document.getElementById('btn-glossary').addEventListener('click', () => {
      const body = LEVEL_ORDER.map((id) => {
        const d = LevelManager.get(id);
        return `${d?.code || id} — ${d?.label || id}: ${d?.instructions || ''}`;
      }).join('\n\n');
      alert(body);
    });
  });
})();
