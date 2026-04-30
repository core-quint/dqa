// ============================================================
// DQA Constants
// ============================================================

export const BASE_VAX = ['BCG', 'Penta1', 'Penta3', 'OPV1', 'OPV3', 'MR1', 'MR2'];

export const ADD_VAX = [
  'RVV1', 'RVV2', 'RVV3',
  'IPV1', 'IPV2', 'IPV3',
  'PCV1', 'PCV2', 'PCV Booster',
  'HepB0', 'DPT 1st Booster',
];

export const PAIR_DEFAULTS = ['Penta1→Penta3', 'MR1→MR2', 'BCG→MR1', 'Penta3→MR1'];

// UWIN-specific dropout defaults: Penta1→Penta3, MR1→MR2, Penta3→MR1
export const UWIN_PAIR_DEFAULTS = ['Penta1→Penta3', 'MR1→MR2', 'Penta3→MR1'];

export const OUT_INC_ALL = ['INC_LOW', 'INC_MOD', 'INC_EXT'];
export const OUT_DROP_ALL = ['DROP_LOW', 'DROP_MOD', 'DROP_EXT'];
export const DROP_RANGE_ALL = ['R5_10', 'R11_20', 'R20P'];

export const CO_SPECS: Record<string, string[]> = {
  co1: ['OPV1', 'Penta1', 'RVV1', 'PCV1', 'IPV1'],
  co2: ['OPV2', 'Penta2', 'RVV2'],
  co3: ['OPV3', 'Penta3', 'RVV3', 'PCV2', 'IPV2'],
  co4: ['MR1', 'PCV Booster', 'IPV3'],
  co5: ['MR2', 'DPT 1st Booster'],
};

export const CO_LABELS: Record<string, string> = {
  co1: '6 weeks — OPV1, Penta1, RVV1, PCV1, IPV1',
  co2: '10 weeks — OPV2, Penta2, RVV2',
  co3: '14 weeks — OPV3, Penta3, RVV3, PCV2, IPV2',
  co4: '9 months — MR1, PCV Booster, IPV3',
  co5: '2 years — MR2, DPT 1st Booster',
};

export const GROUP_COLORS: Record<string, string> = {
  availability: '#0ea5e9',
  completeness: '#6366f1',
  accuracy: '#f97316',
  consistency: '#22c55e',
};

export const INCONS_LIGHT = '#86efac';

export const UWIN_DEFAULT_FILTERS = {
  blocks: [] as string[],
  months: [] as string[],
  ownership: [] as string[],
  ru: [] as string[],
  outliersVax: [...BASE_VAX],
  addVax: [] as string[],
  outliersInc: ['INC_EXT'],
  outliersDrop: ['DROP_EXT'],
  dropRanges: ['R20P'],
  dropPairs: [...UWIN_PAIR_DEFAULTS],
  dropFrom: [] as string[],
  dropTo: [] as string[],
  inconsFrom: [] as string[],
  inconsTo: [] as string[],
  activeGroup: '' as string,
};

export const DEFAULT_FILTERS = {
  blocks: [] as string[],
  months: [] as string[],
  ownership: [] as string[],
  ru: [] as string[],
  outliersVax: [...BASE_VAX],
  addVax: [] as string[],
  outliersInc: ['INC_EXT'],
  outliersDrop: ['DROP_EXT'],
  dropRanges: ['R20P'],
  dropPairs: [...PAIR_DEFAULTS],
  dropFrom: [] as string[],
  dropTo: [] as string[],
  inconsFrom: [] as string[],
  inconsTo: [] as string[],
  activeGroup: '' as string,
};
