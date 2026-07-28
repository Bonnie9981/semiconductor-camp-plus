/**
 * gripper.js
 * ------------------------------------------------------------
 * 需求 5 的核心：讓「燒杯、晶圓夾」等物件能偵測並 attach 在手上，
 * 並能放到桌面（camera.js 定義的下 1/4 桌面區）上，給玩家實體感。
 *
 * 設計成一個小型「持有狀態機」，任何關卡模組都可以：
 *   1. Gripper.registerAttachable(id, { label, icon, homeX, homeY })
 *      → 在畫面上放一個可拿取的物件（例如燒杯）
 *   2. 玩家用手（目前是滑鼠 fallback）靠近並「捏合」該物件時自動 attach
 *   3. 放開（pinch end）時：
 *        - 若放開位置落在桌面區 → 物件被放到桌上該位置，
 *          emit 'object:placed'，物件保留在該座標直到再被拿起
 *        - 若放開位置不在桌面區 → 物件彈回 home 位置
 *
 * 這個模組完全不管「這是不是正確的關卡動作」——例如「有沒有把燒杯放到
 * 正確的清洗槽」這種判斷屬於個別關卡模組的責任，關卡模組只要監聽
 * 'object:placed' 事件、比對 payload.id / tableX / tableY 即可。
 *
 * 視覺呈現：每個 attachable 對應一個絕對定位的 DOM 節點，掛在
 * #attachable-layer 底下，位置由 requestAnimationFrame 迴圈依照
 * camera 座標 → 畫面像素座標換算後更新。
 */
(function (global) {
  'use strict';

  const ATTACH_RADIUS = 60; // canvas 座標系下，手要多靠近物件才能抓取

  function createGripper({ camera, eventBus, layerEl }) {
    const items = new Map(); // id -> { def, x, y, held, el }
    let heldId = null;
    let rafId = null;

    function canvasToLayerPx(x, y) {
      const { width, height } = camera.getCanvasSize();
      const rect = layerEl.getBoundingClientRect();
      return { left: (x / width) * rect.width, top: (y / height) * rect.height };
    }

    function render() {
      for (const [id, item] of items) {
        const { left, top } = canvasToLayerPx(item.x, item.y);
        item.el.style.left = `${left}px`;
        item.el.style.top = `${top}px`;
        item.el.classList.toggle('is-held', item.held);
      }
      rafId = requestAnimationFrame(render);
    }

    function distance(ax, ay, bx, by) {
      return Math.hypot(ax - bx, ay - by);
    }

    function onHandMove({ x, y }) {
      if (heldId) {
        const item = items.get(heldId);
        item.x = x; item.y = y;
      }
    }

    function onPinchStart({ x, y }) {
      if (heldId) return; // 已經拿著東西，不能再拿第二個（符合物理直覺）
      let closest = null, closestDist = Infinity;
      for (const [id, item] of items) {
        if (item.held) continue;
        const d = distance(x, y, item.x, item.y);
        if (d < ATTACH_RADIUS && d < closestDist) { closest = id; closestDist = d; }
      }
      if (closest) {
        heldId = closest;
        items.get(closest).held = true;
        eventBus.emit('object:attached', { id: closest });
      }
    }

    function onPinchEnd({ x, y }) {
      if (!heldId) return;
      const id = heldId;
      const item = items.get(id);
      item.held = false;
      heldId = null;

      if (camera.isPointInTableZone(x, y)) {
        item.x = x; item.y = y;
        eventBus.emit('object:placed', { id, tableX: x, tableY: y });
      } else {
        // 沒放在桌上 → 彈回原位
        item.x = item.def.homeX; item.y = item.def.homeY;
        eventBus.emit('object:returned', { id });
      }
    }

    eventBus.on('hand:move', onHandMove);
    eventBus.on('hand:pinchstart', onPinchStart);
    eventBus.on('hand:pinchend', onPinchEnd);

    return {
      /** 註冊一個可 attach 的物件。
       *  def: { label, icon(圖片路徑或emoji), homeX, homeY(canvas座標，初始擺放位置) } */
      registerAttachable(id, def) {
        const el = document.createElement('div');
        el.className = 'attachable-item';
        el.style.position = 'absolute';
        el.style.pointerEvents = 'none';
        el.style.transform = 'translate(-50%, -50%)';
        el.style.fontSize = '2rem';
        el.textContent = def.icon || '🧪';
        el.title = def.label || id;
        layerEl.appendChild(el);
        items.set(id, { def, x: def.homeX, y: def.homeY, held: false, el });
      },

      unregisterAttachable(id) {
        const item = items.get(id);
        if (item) { item.el.remove(); items.delete(id); }
      },

      /** 讀取目前狀態，供關卡模組判斷過關條件用（唯讀） */
      getItemState(id) {
        const item = items.get(id);
        return item ? { x: item.x, y: item.y, held: item.held } : null;
      },

      resetItem(id) {
        const item = items.get(id);
        if (!item) return;
        item.x = item.def.homeX; item.y = item.def.homeY; item.held = false;
      },

      start() { if (!rafId) render(); },
      stop() { if (rafId) cancelAnimationFrame(rafId); rafId = null; },

      destroy() {
        this.stop();
        eventBus.off('hand:move', onHandMove);
        eventBus.off('hand:pinchstart', onPinchStart);
        eventBus.off('hand:pinchend', onPinchEnd);
        for (const id of [...items.keys()]) this.unregisterAttachable(id);
      },
    };
  }

  global.createGripper = createGripper;
})(window);
