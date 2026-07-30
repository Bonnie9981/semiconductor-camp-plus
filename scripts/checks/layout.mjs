/**
 * 版面檢查
 * ---------------------------------------------------------------------------
 * 直接跑真正的 `chamberLayout()` 與 `alignerLayout()`，確認在常見筆電尺寸下
 * 機台上的元素不會互相重疊、也不會小到看不清或按不到。
 *
 * 這支曾經抓到兩個真實 bug：CVD 的兩顆氣閥旋鈕疊到大按鈕、
 * 腔門下方的狀態文字溢出機台外框。
 */
import { Report, SCREENS, SRC, clamp, viewport } from './lib.mjs';

const { chamberLayout } = await import(`${SRC}scene/Chamber.ts`);
const { alignerLayout, ALIGN_TOLERANCE } = await import(`${SRC}scene/Aligner.ts`);

const report = new Report('版面（真實 chamberLayout / alignerLayout）');

for (const screen of SCREENS) {
  const vp = viewport(screen);
  const { scene, groundY, height } = vp;

  // ── 沉積 / 蝕刻腔體（與 Stage2、Stage5 相同的算法） ──
  {
    const cw = scene.w * 0.98;
    const ch = clamp(Math.min(cw * 0.72, groundY - height * 0.19), 200, 430);
    const geo = { x: scene.left + (scene.w - cw) / 2, y: groundY - 16 - ch, w: cw, h: ch };
    const L = chamberLayout(geo, 'cvd');

    const errs = [];
    if (L.interior.h < 90) errs.push(`腔室太矮 ${L.interior.h.toFixed(0)}px`);
    if (L.wafer.r < 40) errs.push(`晶圓太小 r=${L.wafer.r.toFixed(0)}`);
    if (L.button.r < 22) errs.push(`啟動按鈕太小 r=${L.button.r.toFixed(0)}（手勢按不到）`);
    if (L.lever.bottom - L.lever.top < 60) {
      errs.push(`功率拉桿太短 ${(L.lever.bottom - L.lever.top).toFixed(0)}px`);
    }
    const [v0, v1] = L.valves;
    if (v1.cy - v0.cy < v0.r + v1.r + 16) {
      errs.push(`兩顆氣閥太近，間距 ${(v1.cy - v0.cy).toFixed(0)}px`);
    }
    if (v1.cy + v1.r > L.button.cy - L.button.r - 6) errs.push('氣閥疊到大按鈕');
    // 門把 + 下方狀態文字必須留在機台裡
    const doorTextBottom = L.doorHandle.cy + L.doorHandle.r + 6 + 14;
    if (doorTextBottom > geo.y + geo.h) {
      errs.push(`腔門狀態文字溢出機台 ${(doorTextBottom - geo.y - geo.h).toFixed(0)}px`);
    }
    if (geo.y < height * 0.16) errs.push(`機台頂端過高，會壓到上方的提示帶`);

    report.add(
      `${screen.name}  腔體`,
      errs,
      `${cw.toFixed(0)}×${ch.toFixed(0)} 晶圓r ${L.wafer.r.toFixed(0)} 鈕r ${L.button.r.toFixed(0)}`,
    );
  }

  // ── 光罩對準曝光機（與 Stage3 相同的算法） ──
  {
    const aw = scene.w * 0.98;
    const ah = clamp(Math.min(aw * 0.72, groundY - height * 0.19), 220, 440);
    const geo = { x: scene.left + (scene.w - aw) / 2, y: groundY - 16 - ah, w: aw, h: ah };
    const L = alignerLayout(geo);

    const errs = [];
    if (L.wafer.r < 55) errs.push(`晶圓太小 r=${L.wafer.r.toFixed(0)}`);
    if (L.button.r < 24) errs.push(`曝光按鈕太小 r=${L.button.r.toFixed(0)}`);
    const maskTop = L.maskHome.y - L.mask.h / 2;
    const maskBottom = L.maskHome.y + L.mask.h / 2;
    if (maskTop < L.lamp.y + L.lamp.h + 16) {
      errs.push(`光罩撞到 UV 燈管 ${(L.lamp.y + L.lamp.h + 16 - maskTop).toFixed(0)}px`);
    }
    if (maskBottom > L.wafer.cy - L.wafer.r * 0.3) errs.push('光罩壓到晶圓');
    if (maskTop - 21 < geo.y + 30) errs.push('光罩標籤壓到機台名牌');
    if (ALIGN_TOLERANCE < 6) errs.push(`對準容差 ${ALIGN_TOLERANCE} 太嚴苛，手勢對不準`);

    report.add(
      `${screen.name}  曝光機`,
      errs,
      `${aw.toFixed(0)}×${ah.toFixed(0)} 晶圓r ${L.wafer.r.toFixed(0)} 鈕r ${L.button.r.toFixed(0)}`,
    );
  }
}

export default () => report.print();
