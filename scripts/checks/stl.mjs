/**
 * STL 幾何檢查
 * ---------------------------------------------------------------------------
 * 直接跑真正的 `Exporter.buildSTL()`（搭配最小 canvas 替身），解析輸出的
 * binary STL，驗證三件事：
 *
 *   封閉      每條無向邊剛好被用兩次
 *   定向一致  每條**有向**邊只出現一次
 *   體積為正  帶號體積（散度定理）> 基材體積
 *
 * 第三點是實際抓到 bug 的那一項：外緣側牆的繞序寫反時，網格仍然「封閉」，
 * 但定向不一致、帶號體積為負，切片軟體就不把它當成實心體。
 */
import { Report, SRC } from './lib.mjs';
import { fakePattern, installDomShim } from './dom-shim.mjs';

installDomShim();
const { Exporter } = await import(`${SRC}utils/Exporter.ts`);

const report = new Report('STL 幾何（真實 Exporter.buildSTL）');

const R = 100;
const BASE = 1.5;

/** 中央一個圓 + 一條橫槓，模擬玩家畫的圖案。 */
const pattern = fakePattern(512, 512, (u, v) => {
  const x = (u - 0.5) * 2 * R;
  const y = (0.5 - v) * 2 * R;
  const inked = Math.hypot(x, y) < 40 || (Math.abs(y) < 12 && Math.abs(x) < 70);
  return inked ? 255 : 0;
});

function parseBinarySTL(buffer) {
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  const tris = [];
  for (let t = 0; t < count; t++) {
    const o = 84 + t * 50 + 12; // 跳過 12 bytes 的法線
    const p = [];
    for (let k = 0; k < 3; k++) {
      p.push([
        view.getFloat32(o + k * 12, true),
        view.getFloat32(o + k * 12 + 4, true),
        view.getFloat32(o + k * 12 + 8, true),
      ]);
    }
    tris.push(p);
  }
  return tris;
}

function analyse(tris) {
  const key = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}`;
  const directed = new Map();
  const undirected = new Map();
  let volume = 0;

  for (const [a, b, c] of tris) {
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const kp = key(p);
      const kq = key(q);
      const d = `${kp}|${kq}`;
      directed.set(d, (directed.get(d) ?? 0) + 1);
      const u = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
      undirected.set(u, (undirected.get(u) ?? 0) + 1);
    }
    volume +=
      (a[0] * (b[1] * c[2] - c[1] * b[2]) -
        a[1] * (b[0] * c[2] - c[0] * b[2]) +
        a[2] * (b[0] * c[1] - c[0] * b[1])) /
      6;
  }

  return {
    triangles: tris.length,
    openEdges: [...undirected.values()].filter((n) => n !== 2).length,
    flippedEdges: [...directed.values()].filter((n) => n !== 1).length,
    volume,
  };
}

for (const [label, invert] of [
  ['正光阻（圖案凸起）', false],
  ['負光阻（圖案凹陷）', true],
]) {
  const blob = Exporter.buildSTL(pattern, {
    waferRadiusMm: R,
    baseThicknessMm: BASE,
    patternHeightMm: 1.2,
    invert,
  });
  const stats = analyse(parseBinarySTL(await blob.arrayBuffer()));
  const baseVolume = Math.PI * R * R * BASE;

  const errs = [];
  if (stats.openEdges > 0) errs.push(`${stats.openEdges} 條邊沒有剛好用兩次 → 有破洞或非流形`);
  if (stats.flippedEdges > 0) {
    errs.push(`${stats.flippedEdges} 條有向邊重複 → 有面的繞序方向相反，定向不一致`);
  }
  if (stats.volume <= 0) errs.push(`帶號體積 ${stats.volume.toFixed(0)} mm³ ≤ 0 → 整體法線朝內`);
  if (stats.volume <= baseVolume) {
    errs.push(
      `體積 ${stats.volume.toFixed(0)} mm³ 小於基材 ${baseVolume.toFixed(0)} mm³ → 幾何有誤`,
    );
  }

  report.add(label, errs, `${stats.triangles} 面、體積 ${stats.volume.toFixed(0)} mm³`);
}

export default () => report.print();
