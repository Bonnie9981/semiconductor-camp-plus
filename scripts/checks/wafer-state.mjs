/**
 * 晶圓狀態機檢查
 * ---------------------------------------------------------------------------
 * 測的是真正的 `WaferState.develop()` / `etch()`，以及「五關全部強制完成」
 * 之後晶圓應該長什麼樣（開發者模式的 devComplete 鏈）。
 *
 * 預設路線（PVD/正光阻/乾式）的 devComplete() 鏈已由 stage-machine.mjs 跑
 * 真正的 Stage 類別涵蓋。這裡保留的重寫版負責另外 7 種分支組合
 * （method / tone / etchMethod 是 private，沒有 gameplay 之外的注入點）——
 * 改到分支相關的 devComplete() 時，這支檢查也要一起改。
 */
import { Report, SRC } from './lib.mjs';

const { WaferState, SECTION_CELLS } = await import(`${SRC}core/WaferState.ts`);
const { isUnsafePour } = await import(`${SRC}data/solutions.ts`);
const { formatElapsed } = await import(`${SRC}utils/format.ts`);

const report = new Report('晶圓狀態機（真實 WaferState）');

// ── ⓿ 配液安全規則：沒有水墊底時不可以混合兩種藥液 ──
{
  const cases = [
    // [要倒的, 杯子裡已有的, 應該是否危險, 說明]
    ['di', [], false, '空杯倒水'],
    ['hf', [], false, '空杯倒單一藥液 —— 沒有東西可以反應'],
    ['h2o2', [], false, '空杯倒雙氧水 —— 同上'],
    ['hf', ['hf'], false, '同一瓶多倒一份 —— 沒有不同的東西可以反應'],
    ['h2o2', ['h2o2'], false, '同上（雙氧水）'],
    ['nh4oh', ['nh4oh'], false, '同上（氨水）'],
    ['di', ['h2o2'], false, '往藥液裡補水 —— 這是正確的補救方向'],
    ['h2o2', ['di'], false, '水已墊底'],
    ['hcl', ['di', 'nh4oh'], false, '水已墊底，後續順序不限'],
    ['h2o2', ['nh4oh'], true, '乾的狀態下讓雙氧水碰到鹼 —— 突沸'],
    ['nh4oh', ['h2o2'], true, '反過來也一樣 —— 突沸'],
    ['hcl', ['hf'], true, '兩種不同的酸乾混 —— 突沸'],
    ['h2o2', ['hf'], true, '同一瓶倒完之後，再倒不同的藥液 —— 突沸'],
    ['h2o2', ['di', 'nh4oh', 'hcl'], false, '只要有水，混幾種都安全'],
  ];
  for (const [pouring, current, expectUnsafe, label] of cases) {
    const got = isUnsafePour(pouring, current);
    report.add(
      `isUnsafePour('${pouring}', [${current.join(',')}])`,
      got === expectUnsafe ? [] : [`預期 ${expectUnsafe}，得到 ${got}`],
      label,
    );
  }
}

// ── ⓵ 計時器的格式化 ──
{
  const cases = [
    [0, '00:00'],
    [999, '00:00'],
    [1000, '00:01'],
    [59_000, '00:59'],
    [60_000, '01:00'],
    [12 * 60_000 + 34_000, '12:34'],
    [59 * 60_000 + 59_000, '59:59'],
    [3_600_000, '1:00:00'],
    [3_600_000 + 5 * 60_000 + 7_000, '1:05:07'],
    [-500, '00:00'],
  ];
  for (const [ms, expect] of cases) {
    const got = formatElapsed(ms);
    report.add(`formatElapsed(${ms})`, got === expect ? [] : [`預期 ${expect}，得到 ${got}`], got);
  }
}

// ── ① develop()：正負光阻的結果必須互補 ──
{
  const stripes = (i) => (Math.floor(i / 3) % 2 === 0 ? 1 : 0);
  const masks = {};
  for (const tone of ['positive', 'negative']) {
    const w = new WaferState();
    w.addLayer({ kind: 'resist', label: '光阻層', thickness: 0.45, color: '#2f7d5b', patterned: false });
    for (let i = 0; i < SECTION_CELLS; i++) w.exposedMask[i] = stripes(i);
    w.resistTone = tone;
    w.develop();
    masks[tone] = [...w.resistMask];

    const errs = [];
    const kept = w.resistMask.filter((v) => v > 0.5).length;
    if (kept === 0) errs.push('顯影後光阻全被洗掉，沒有圖案');
    if (kept === SECTION_CELLS) errs.push('顯影後光阻完全沒被洗掉');
    if (!w.layers.find((l) => l.kind === 'resist')?.patterned) {
      errs.push('光阻層沒有被標記為 patterned，截面圖不會切出缺口');
    }
    report.add(`develop() ${tone}`, errs, `留下 ${kept}/${SECTION_CELLS} 格光阻`);
  }

  const complementary = masks.positive.every((v, i) => v > 0.5 !== masks.negative[i] > 0.5);
  report.add(
    'develop() 正負光阻互補',
    complementary ? [] : ['同一張光罩下，正負光阻的顯影結果必須完全相反'],
  );
}

// ── ② etch()：乾式側壁筆直、濕式有側向咬蝕 ──
{
  for (const [label, uc] of [
    ['etch(0) 乾式', 0],
    ['etch(1) 濕式', 1],
  ]) {
    const w = new WaferState();
    w.addLayer({ kind: 'metal', label: '金屬層 Al', thickness: 0.5, color: '#c9ced6', patterned: false });
    w.addLayer({ kind: 'resist', label: '光阻層', thickness: 0.45, color: '#2f7d5b', patterned: false });
    for (let i = 0; i < SECTION_CELLS; i++) w.exposedMask[i] = Math.floor(i / 3) % 2 === 0 ? 1 : 0;
    w.develop();
    w.etch(uc);

    const errs = [];
    const through = w.etchedMask.filter((v) => v > 0.9).length;
    const partial = w.etchedMask.filter((v) => v > 0.4 && v <= 0.9).length;
    if (through === 0) errs.push('完全沒蝕穿任何一格');
    if (through === SECTION_CELLS) errs.push('整片都被蝕穿，圖案消失');
    if (uc === 0 && partial > 0) errs.push(`乾式蝕刻不該有側向咬蝕，卻有 ${partial} 格`);
    if (uc === 1 && partial === 0) errs.push('濕式蝕刻應該要有側向咬蝕（undercut），卻完全沒有');
    if (!w.topLayer.patterned) errs.push('最上層沒有被標記為 patterned');
    report.add(label, errs, `蝕穿 ${through}、側向 ${partial}`);
  }
}

// ── ③ devComplete 鏈：五關全部強制完成後的最終狀態 ──
{
  /** 重現各關 devComplete() 對晶圓做的事，順序與遊戲一致。 */
  const runChain = (tone, method, etchMethod) => {
    const w = new WaferState();
    // 1 RCA
    Object.assign(w.contamination, { particles: 0, oxide: 0, ions: 0, water: 0 });
    // 2 薄膜沉積
    if (method === 'cvd') {
      w.addLayer({ kind: 'oxide', label: '二氧化矽 SiO₂', thickness: 0.7, color: '#93b3c6', patterned: false });
    }
    w.addLayer({ kind: 'metal', label: '金屬層 Al', thickness: 0.5, color: '#c9ced6', patterned: false });
    // 3 微影
    w.addLayer({ kind: 'resist', label: '光阻層', thickness: 0.45, color: '#2f7d5b', patterned: false });
    for (let i = 0; i < SECTION_CELLS; i++) w.exposedMask[i] = Math.floor(i / 3) % 2 === 0 ? 1 : 0;
    w.resistTone = tone;
    // 4 顯影
    w.develop();
    // 5 蝕刻
    w.etch(etchMethod === 'wet' ? 1 : 0);
    w.removeLayer('resist');
    return w;
  };

  for (const tone of ['positive', 'negative']) {
    for (const method of ['pvd', 'cvd']) {
      for (const etchMethod of ['dry', 'wet']) {
        const w = runChain(tone, method, etchMethod);
        const errs = [];
        if (!w.isClean) errs.push('晶圓沒洗乾淨');
        if (!w.hasLayer('metal')) errs.push('沒有金屬層 → 證書與 STL 會拿到空白晶圓');
        if (method === 'cvd' && !w.hasLayer('oxide')) errs.push('CVD 路線缺氧化層');
        if (w.hasLayer('resist')) errs.push('光阻沒剝掉 → 第五關的 canComplete() 過不了');
        const through = w.etchedMask.filter((v) => v > 0.9).length;
        if (through === 0 || through === SECTION_CELLS) errs.push('蝕刻結果沒有圖案');
        report.add(
          `devComplete 鏈 ${tone}/${method}/${etchMethod}`,
          errs,
          `層 ${w.layers.map((l) => l.kind).join('+')}`,
        );
      }
    }
  }
}



// ── ④ 蝕刻關的藥液規則 ──
// 這兩條規則是使用者親自訂的製程知識，很容易在後續重構時被改壞，所以鎖在檢查裡。
{
  const { wetEtchRound, stripRound } = await import(`${SRC}stages/Stage5Etch.ts`);

  const ids = (r) => r.tanks.map((t) => t.id);
  const expect = (label, cond, detail) => report.add(label, cond ? [] : [detail], detail);

  // 濕式蝕刻：氫氟酸與 PAN 都可以，硝酸單獨與去離子水不行
  const wet = wetEtchRound();
  expect('濕蝕刻 可用氫氟酸', wet.answers.includes('hf'), `answers=${wet.answers.join('/')}`);
  expect('濕蝕刻 可用 PAN', wet.answers.includes('pan'), `answers=${wet.answers.join('/')}`);
  expect('濕蝕刻 拒絕單獨硝酸', !wet.answers.includes('hno3'), 'hno3 會讓鋁鈍化');
  expect('濕蝕刻 拒絕去離子水', !wet.answers.includes('di'), 'di 不蝕刻任何東西');
  for (const id of wet.answers) {
    expect(`濕蝕刻 ${id} 有出現在檯面上`, ids(wet).includes(id), ids(wet).join(', '));
  }

  // 去光阻：丙酮與 NMP 二選一，兩者都要在檯面上，且都要有解釋
  const s0 = stripRound(0);
  expect('去光阻 丙酮可選', s0.answers.includes('acetone'), `answers=${s0.answers.join('/')}`);
  expect('去光阻 NMP 可選', s0.answers.includes('nmp'), `answers=${s0.answers.join('/')}`);
  expect('去光阻 拒絕先用水', !s0.answers.includes('di'), '光阻不溶於水');
  expect('去光阻 拒絕顯影液', !s0.answers.includes('tmah'), 'TMAH 剝不掉整層');
  for (const id of ['acetone', 'nmp', 'di', 'tmah']) {
    expect(`去光阻 檯面有 ${id}`, ids(s0).includes(id), ids(s0).join(', '));
  }

  // 第二輪：丙酮與 NMP 兩條路線都要走到這裡，而且只能用去離子水
  const s1 = stripRound(1);
  expect('沖洗 只收去離子水',
    s1.answers.length === 1 && s1.answers[0] === 'di',
    `answers=${s1.answers.join('/')}`);
  expect('沖洗 拒絕再泡溶劑',
    !s1.answers.includes('acetone') && !s1.answers.includes('nmp'),
    '溶劑已經泡過了');

  // 錯誤提示必須每個「非答案」的槽都講得出理由（不能只丟一句預設值）
  for (const [name, round] of [['濕蝕刻', wet], ['去光阻', s0], ['沖洗', s1]]) {
    const wrong = ids(round).filter((id) => !round.answers.includes(id));
    const vague = wrong.filter((id) => {
      const h = round.wrongHint(id);
      return !h || h.length < 12;
    });
    report.add(`${name} 每個錯誤選項都有說明`, vague.length ? [`太短或空白：${vague.join(', ')}`] : [],
      `${wrong.length} 個錯誤選項`);
  }
}

export default () => report.print();
