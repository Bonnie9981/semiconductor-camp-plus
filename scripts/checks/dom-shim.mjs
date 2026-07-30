/**
 * 最小的 canvas / DOM 替身
 * ---------------------------------------------------------------------------
 * `Exporter.buildSTL()` 與 `Certificate.canvasToPdf()` 會用到
 * `document.createElement('canvas')`、`getImageData()`、`toBlob()`。
 * 這裡提供剛好夠用的替身，讓檢查腳本能在 Node 裡跑**真正的**輸出程式碼，
 * 而不是測一份抄過來的副本。
 *
 * 只實作被真正呼叫到的方法，其餘一律拋錯 —— 如果原始碼哪天開始用到別的
 * canvas API，這裡會立刻炸掉提醒你，而不是安靜地回傳錯的東西。
 */

/** 用來假造圖案：sample(u, v) 回傳 0~255 的 alpha。 */
export function fakePattern(width, height, sample) {
  return { __fake: true, width, height, sample };
}

function fakeCanvas() {
  const canvas = {
    width: 0,
    height: 0,
    /** 目前畫布的 RGBA 位元組。 */
    _data: null,
    getContext(kind) {
      if (kind !== '2d') throw new Error(`dom-shim: 只支援 '2d'，收到 '${kind}'`);
      return {
        drawImage(src, _dx, _dy, dw, dh) {
          if (!src?.__fake) throw new Error('dom-shim: drawImage 只接受 fakePattern()');
          const w = Math.round(dw ?? canvas.width);
          const h = Math.round(dh ?? canvas.height);
          const data = new Uint8ClampedArray(w * h * 4);
          for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
              const a = src.sample((i + 0.5) / w, (j + 0.5) / h);
              data[(j * w + i) * 4 + 3] = a;
            }
          }
          canvas._data = { data, w, h };
        },
        getImageData(_x, _y, w, h) {
          if (!canvas._data) throw new Error('dom-shim: getImageData 前沒有 drawImage');
          if (canvas._data.w !== w || canvas._data.h !== h) {
            throw new Error(`dom-shim: getImageData 尺寸不符（畫了 ${canvas._data.w}×${canvas._data.h}，讀 ${w}×${h}）`);
          }
          return { data: canvas._data.data, width: w, height: h };
        },
      };
    },
    /** Certificate.canvasToPdf() 用它取 JPEG 位元組。 */
    toBlob(cb, type) {
      if (type !== 'image/jpeg') throw new Error(`dom-shim: toBlob 只支援 jpeg，收到 ${type}`);
      cb(new Blob([MINIMAL_JPEG], { type }));
    },
  };
  return canvas;
}

/** 一張 1×1 的真 JPEG，拿來當 toBlob 的輸出。 */
export const MINIMAL_JPEG = Uint8Array.from(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
      'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
      'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  ),
);

/** 產生一張指定尺寸的假 canvas，直接餵給 canvasToPdf() 這種吃 canvas 的函式。 */
export function fakeCanvasOfSize(width, height) {
  const c = fakeCanvas();
  c.width = width;
  c.height = height;
  return c;
}

/** 安裝替身。呼叫真正的輸出程式碼之前先跑這個。 */
export function installDomShim() {
  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') throw new Error(`dom-shim: 只支援 'canvas'，收到 '${tag}'`);
      return fakeCanvas();
    },
  };
}
