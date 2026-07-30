import type { ChoiceOption, MixRow } from '../core/types';

/**
 * 製程藥液資料表
 * ---------------------------------------------------------------------------
 * RCA 三個濕式步驟、顯影、濕蝕刻都從這張表取選項，因此「正確答案」與「干擾項」
 * 用的是同一份定義，玩家不會因為文案不一致而察覺哪個是對的。
 *
 * color 是這瓶藥液在燒杯裡的顏色，混合時會依份數做加權平均。
 */

export interface Solution {
  id: string;
  name: string;
  formula: string;
  color: string;
  /** 這瓶藥液的作用，答錯時顯示。 */
  role: string;
}

export const SOLUTIONS: Record<string, Solution> = {
  di: {
    id: 'di',
    name: '去離子水',
    formula: 'H₂O (DI)',
    color: '#7fc8e8',
    role: '稀釋用的超純水，幾乎所有清洗液的基底。',
  },
  nh4oh: {
    id: 'nh4oh',
    name: '氨水',
    formula: 'NH₄OH',
    color: '#a99ae0',
    role: '鹼性，使微粒與晶圓表面同帶負電而互相排斥。',
  },
  h2o2: {
    id: 'h2o2',
    name: '過氧化氫',
    formula: 'H₂O₂',
    color: '#efe184',
    role: '強氧化劑，把有機物氧化分解。',
  },
  hcl: {
    id: 'hcl',
    name: '鹽酸',
    formula: 'HCl',
    color: '#f0a96b',
    role: '與金屬離子形成可溶的錯合物，把離子帶走。',
  },
  hf: {
    id: 'hf',
    name: '氫氟酸',
    formula: 'HF',
    color: '#6fd9ad',
    role: '唯一能溶解二氧化矽的酸（生成可溶的 H₂SiF₆）。RCA 用它剝原生氧化層，也是最經典的濕蝕刻液。',
  },
  hno3: {
    id: 'hno3',
    name: '硝酸',
    formula: 'HNO₃',
    color: '#e08585',
    role: '強氧化性酸，濕蝕刻矽時與 HF 搭配使用。',
  },
  acetone: {
    id: 'acetone',
    name: '丙酮',
    formula: 'CH₃COCH₃',
    color: '#cfd6da',
    role:
      '光阻剝離溶劑。揮發極快，泡完直接乾掉，所以**後面不接水洗** —— ' +
      '沖水會把溶解的光阻重新沉積回表面留下水痕。要接的話接 IPA。',
  },
  nmp: {
    id: 'nmp',
    name: 'NMP',
    formula: 'C₅H₉NO',
    color: '#9fb4c0',
    role:
      '半導體業界標準的光阻剝離液。閃點遠高於丙酮、可加溫操作、殘留少，' +
      '但沸點 202°C 不會自己揮發，所以**後面必須用去離子水沖淨**（與水完全互溶）。',
  },
  koh: {
    id: 'koh',
    name: '氫氧化鉀',
    formula: 'KOH',
    color: '#c79ae0',
    role: '鹼性顯影液，溶解曝光後的正光阻。',
  },
  tmah: {
    id: 'tmah',
    name: '四甲基氫氧化銨',
    formula: 'TMAH 2.38%',
    color: '#8ad4c4',
    role: '半導體標準顯影液（MIF，不含金屬離子）。業界統一使用 2.38 wt% 水溶液，正、負光阻都用它。',
  },
  xylene: {
    id: 'xylene',
    name: '二甲苯',
    formula: 'C₈H₁₀',
    color: '#d8c489',
    role: '早期橡膠系負光阻的溶劑型顯影液。現代負光阻已改用鹼性 TMAH，量產線不再使用。',
  },
  boe: {
    id: 'boe',
    name: '緩衝氧化蝕刻液',
    formula: 'BOE (NH₄F+HF)',
    color: '#6fd9c8',
    role: '加了氟化銨緩衝劑的氫氟酸，蝕刻 SiO₂ 時速率穩定、不會啃壞光阻。對金屬鋁無效。',
  },
  pan: {
    id: 'pan',
    name: '鋁蝕刻液',
    formula: 'PAN 80:15:3:2',
    color: '#e2a0d0',
    role: '磷酸／醋酸／硝酸混合液。硝酸先把鋁氧化、磷酸溶掉氧化鋁、醋酸降低表面張力幫助潤濕。',
  },
};

/**
 * 配液安全規則：**沒有去離子水墊底時，不可以把兩種不同的藥液混在一起**。
 *
 * 濃酸、濃鹼與雙氧水彼此混合是劇烈放熱反應。有水墊在底下時，
 * 水的高熱容量能吸收熱量、對流也帶得走；沒有水的話，
 * 兩種濃藥液的界面局部瞬間到達沸點就會**突沸**，
 * 把高溫強腐蝕的液體整團噴出來。
 *
 * 注意「危險」的條件不是「水沒有第一個倒」，也不是「杯子裡有東西」：
 * 空杯、或同一瓶藥液多倒幾份，都沒有不同的東西可以反應。
 * 真正的危險是**在乾的狀態下讓兩種不同的藥液相遇**。
 *
 * 刻意做成純函式，scripts/checks 才能直接驗證。
 */
export function isUnsafePour(pouringId: string, currentIds: readonly string[]): boolean {
  // 加水永遠安全
  if (pouringId === 'di') return false;
  // 有水墊底，之後怎麼混都安全
  if (currentIds.includes('di')) return false;
  // 危險的是「**不同**的藥液在乾的狀態下相遇」。
  // 空杯、或杯子裡本來就只有同一瓶藥液（多倒了幾份），都沒有東西可以反應。
  return currentIds.some((id) => id !== pouringId);
}

export function solution(id: string): Solution {
  const s = SOLUTIONS[id];
  if (!s) throw new Error(`solutions.ts: 找不到藥液 '${id}'`);
  return s;
}

/** 把藥液轉成選擇題選項。 */
export function toChoice(id: string): ChoiceOption {
  const s = solution(id);
  return { id: s.id, label: s.name, sub: s.formula, color: s.color };
}

/** 把藥液轉成配比列。 */
export function toMixRow(id: string, parts = 0): MixRow {
  const s = solution(id);
  return { id: s.id, label: s.name, sub: s.formula, color: s.color, parts };
}

/**
 * 依份數加權混合顏色。份數越懸殊，混出來的顏色越接近主要成分——
 * 這正是燒杯動畫「濃度改變顏色」要的效果。
 */
export function blendColor(rows: readonly MixRow[]): string {
  const total = rows.reduce((sum, r) => sum + r.parts, 0);
  if (total === 0) return '#2b3940';

  let r = 0;
  let g = 0;
  let b = 0;
  for (const row of rows) {
    const [cr, cg, cb] = hexToRgb(row.color);
    const w = row.parts / total;
    r += cr * w;
    g += cg * w;
    b += cb * w;
  }
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}
