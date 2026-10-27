/* ===========================================================
   種子資料（公司情境參考長信名茶官網公開資訊；人員、訂單、金額、績效皆為虛構）
   =========================================================== */

const META = {
  companyLabel: '長信名茶',
  systemName: '內部管理與績效系統',
  period: '2026 年 10 月',
  asOf: '2026-10-27',
};

/* ---- 績效評核模板 ----------------------------------------
   不同職類用不同權重：業務職看業績，職能職看產出與品質。
   權重總和須為 100。
----------------------------------------------------------- */
const TEMPLATES = {
  sales: {
    label: '業務型',
    note: '適用批發業務、門市、電商、企業客製等有營收責任的職務',
    items: [
      { key: 'quota',        name: '業績達成率', weight: 40, rawLabel: '實際 / 目標' },
      { key: 'margin',       name: '毛利貢獻',   weight: 25, rawLabel: '毛利率（目標 32%）' },
      { key: 'newCustomer',  name: '新客開發',   weight: 15, rawLabel: '新客數 / 目標' },
      { key: 'satisfaction', name: '客戶滿意',   weight: 10, rawLabel: '客訴件數' },
      { key: 'discipline',   name: '出勤紀律',   weight: 10, rawLabel: '出勤率' },
    ],
  },
  ops: {
    label: '職能型',
    note: '適用茶廠製茶、品管、行政、行銷等無直接營收責任的職務',
    items: [
      { key: 'output',       name: '工作產出',   weight: 40, rawLabel: '當期完成量' },
      { key: 'quality',      name: '品質穩定',   weight: 25, rawLabel: '瑕疵 / 錯誤率' },
      { key: 'improvement',  name: '流程改善',   weight: 15, rawLabel: '提案採用數' },
      { key: 'teamwork',     name: '跨部門協作', weight: 10, rawLabel: '協作評價' },
      { key: 'discipline',   name: '出勤紀律',   weight: 10, rawLabel: '出勤率' },
    ],
  },
};

/* ---- 權限等級 --------------------------------------------
   rank 用於比較高低；可見範圍與可編輯範圍在 app.js 裡判定。
----------------------------------------------------------- */
const ACCESS_LEVELS = {
  staff:   { label: '一般員工',   rank: 1, note: '只看得到自己的評核與自己負責的訂單' },
  manager: { label: '部門主管',   rank: 2, note: '可評核所屬部門同仁，看得到營收圖表' },
  admin:   { label: '系統管理員', rank: 3, note: '全部資料可見可編輯' },
};

/* ---- 員工 ------------------------------------------------ */
const EMPLOYEES = [
  {
    id: 'E01', name: '陳佳蓉', dept: '業務部', role: '業務部主管',
    hireDate: '2017-03-06', template: 'sales',
    access: 'manager', managesDept: '業務部',
    scores: { quota: 118, margin: 109, newCustomer: 125, satisfaction: 100, discipline: 100 },
    raw: {
      quota: '1,062,000 / 900,000', margin: '34.9%', newCustomer: '5 / 4',
      satisfaction: '0 件', discipline: '100%',
    },
    comment: '商用茶批發客維繫穩定，本期成功把日月潭紅玉商用茶導入兩家連鎖手搖飲。議價偏守，毛利率維持得不錯。',
    version: 1, updatedBy: '系統匯入', updatedAt: '2026-10-20 09:14',
  },
  {
    id: 'E02', name: '林志偉', dept: '業務部', role: '業務專員',
    hireDate: '2022-09-12', template: 'sales', access: 'staff',
    scores: { quota: 78, margin: 70, newCustomer: 75, satisfaction: 76, discipline: 96 },
    raw: {
      quota: '546,000 / 700,000', margin: '22.4%', newCustomer: '3 / 4',
      satisfaction: '3 件', discipline: '96%',
    },
    comment: '衝量意願高但讓價過快，毛利率低於目標 9.6 個百分點，是全公司最低。建議下期先鎖報價級距，再談新客。',
    version: 1, updatedBy: '系統匯入', updatedAt: '2026-10-20 09:14',
  },
  {
    id: 'E03', name: '黃淑芬', dept: '門市', role: '建國門市主任',
    hireDate: '2015-06-01', template: 'sales',
    access: 'manager', managesDept: '門市',
    scores: { quota: 104, margin: 115, newCustomer: 90, satisfaction: 92, discipline: 100 },
    raw: {
      quota: '624,000 / 600,000', margin: '36.8%', newCustomer: '9 / 10',
      satisfaction: '1 件', discipline: '100%',
    },
    comment: '門市客單價提升明顯，試茶後帶台灣紅茶禮盒的搭售成效好。中秋檔期人力排班順暢，現場零客訴升級。',
    version: 1, updatedBy: '系統匯入', updatedAt: '2026-10-20 09:14',
  },
  {
    id: 'E04', name: '吳建宏', dept: '電商', role: '電商營運專員',
    hireDate: '2023-02-20', template: 'sales', access: 'staff',
    scores: { quota: 88, margin: 78, newCustomer: 120, satisfaction: 70, discipline: 92 },
    raw: {
      quota: '484,000 / 550,000', margin: '25.0%', newCustomer: '36 / 30',
      satisfaction: '3 件', discipline: '92%',
    },
    comment: '官網新客獲取是全公司最強，但出貨延遲造成 3 件客訴，連帶拉低滿意度分數。倉儲對單仍靠人工，是可優先自動化的環節。',
    version: 1, updatedBy: '系統匯入', updatedAt: '2026-10-20 09:14',
  },
  {
    id: 'E05', name: '張雅婷', dept: '業務部', role: '企業客製業務',
    hireDate: '2019-11-04', template: 'sales', access: 'staff',
    scores: { quota: 48, margin: 92, newCustomer: 50, satisfaction: 100, discipline: 98 },
    raw: {
      quota: '192,000 / 400,000', margin: '31.0%', newCustomer: '1 / 2',
      satisfaction: '0 件', discipline: '98%',
    },
    comment: '既有企業客戶回購穩定、零客訴，但業績僅達標 48%，新客開發幾乎停滯。兩家科技業客戶的年節禮贈預算延後核定是客觀因素，建議先送客製禮盒樣品卡位，並重設下期目標。',
    version: 1, updatedBy: '系統匯入', updatedAt: '2026-10-20 09:14',
  },
  {
    id: 'E06', name: '李俊傑', dept: '南投茶廠', role: '製茶師',
    hireDate: '2013-04-15', template: 'ops', access: 'staff',
    scores: { output: 86, quality: 92, improvement: 75, teamwork: 85, discipline: 100 },
    raw: {
      output: '1,820 kg / 2,100 kg', quality: '農殘送驗全合格 · 瑕疵率 1.1%', improvement: '1 案採用',
      teamwork: '4.2 / 5', discipline: '100%',
    },
    comment: '焙火手感穩定、送驗批次全數合格、全勤零遲到。本期產出未達標主因是五月春茶量能被外包稀釋。提出的萎凋槽濕度紀錄表已導入，但仍靠紙本，值得數位化。',
    version: 1, updatedBy: '系統匯入', updatedAt: '2026-10-20 09:14',
  },
  {
    id: 'E07', name: '王美玲', dept: '行政', role: '會計兼行政',
    hireDate: '2016-08-22', template: 'ops',
    access: 'admin',
    scores: { output: 90, quality: 95, improvement: 60, teamwork: 100, discipline: 98 },
    raw: {
      output: '月結準時 3 / 3 期', quality: '傳票錯誤 2 筆', improvement: '0 案採用',
      teamwork: '4.6 / 5', discipline: '98%',
    },
    comment: '月結從未延遲、跨部門配合度全公司最高。流程改善面較被動，整期零提案；可指派一項自動化主題（例如請款單數位化）當作下期目標。',
    version: 1, updatedBy: '系統匯入', updatedAt: '2026-10-20 09:14',
  },
  {
    id: 'E08', name: '蔡承翰', dept: '電商', role: '行銷企劃',
    hireDate: '2024-07-08', template: 'ops', access: 'staff',
    scores: { output: 72, quality: 62, improvement: 95, teamwork: 85, discipline: 86 },
    raw: {
      output: '10 篇 / 14 篇', quality: '素材退回 5 次', improvement: '3 案採用',
      teamwork: '4.2 / 5', discipline: '86%',
    },
    comment: '中秋「台灣紅茶禮盒」上市的內容企劃帶動電商新客成長，點子最多、提案採用數最高。但素材退回 5 次、產出只達 71%，交期與規格穩定度是這期最該補的洞。',
    version: 1, updatedBy: '系統匯入', updatedAt: '2026-10-20 09:14',
  },
];

/* ---- 評核流程狀態機 --------------------------------------
   自評 → 主管評核 → 複核 → 定版；定版後員工可提申訴，退回主管重評。
   每一次轉移都寫進 history，構成稽核軌跡與歷史版本。
----------------------------------------------------------- */
const WORKFLOW = {
  order: ['self', 'manager', 'review', 'final'],
  states: {
    self:    { label: '待自評',     hint: '等待本人填寫自評分數與自述',   chip: 'neutral'  },
    manager: { label: '主管評核中', hint: '等待直屬主管評分',             chip: 'warning'  },
    review:  { label: '複核中',     hint: '等待管理員複核',               chip: 'serious'  },
    final:   { label: '已定版',     hint: '本期評核已鎖定',               chip: 'good'     },
    appeal:  { label: '申訴中',     hint: '員工已提申訴，待主管重新評核', chip: 'critical' },
  },
  /* 每個動作：誰能做、從哪個狀態到哪個狀態 */
  actions: {
    submitSelf:   { label: '送出自評',   from: 'self',    to: 'manager', by: 'owner',   tone: 'primary' },
    /* 員工遲遲不自評會把整個週期卡死，所以管理員要有推進的手段 */
    skipSelf:     { label: '代為跳過自評', from: 'self',  to: 'manager', by: 'admin',   tone: 'plain'   },
    submitReview: { label: '送出評核',   from: 'manager', to: 'review',  by: 'manager', tone: 'primary' },
    finalize:     { label: '定版',       from: 'review',  to: 'final',   by: 'admin',   tone: 'primary' },
    sendBack:     { label: '退回主管',   from: 'review',  to: 'manager', by: 'admin',   tone: 'plain'   },
    appeal:       { label: '提出申訴',   from: 'final',   to: 'appeal',  by: 'owner',   tone: 'plain'   },
    reopen:       { label: '受理並重評', from: 'appeal',  to: 'manager', by: 'manager', tone: 'primary' },
  },
};

/* ---- 本期評核週期 ---------------------------------------- */
const CYCLE = { period: '2026-Q4', opened: '2026-10-01', due: '2026-11-15' };

/* ---- 各員工的本期流程狀態 -------------------------------- */
const CYCLE_STATE = {
  E01: {
    status: 'final',
    selfScores: { quota: 115, margin: 105, newCustomer: 120, satisfaction: 100, discipline: 100 },
    selfComment: '本期把日月潭紅玉商用茶導入兩家連鎖手搖飲，批發線營收成長明顯。議價上盡量守住毛利，沒有為了衝量讓價。',
    reviewNote: '自評與主管評核落差小、數據佐證充分，維持 A 等，核定為本期標竿。',
    appealReason: '',
  },
  E02: {
    status: 'manager',
    selfScores: { quota: 85, margin: 80, newCustomer: 85, satisfaction: 85, discipline: 100 },
    selfComment: '本期成交筆數有成長，但我承認報價給得太鬆。希望公司能給一份標準報價級距表，我才知道底線在哪。',
    reviewNote: '',
    appealReason: '',
  },
  E03: {
    status: 'review',
    selfScores: { quota: 100, margin: 110, newCustomer: 95, satisfaction: 90, discipline: 100 },
    selfComment: '中秋檔期主推台灣紅茶禮盒，試茶後搭售成效好，客單價提升。排班提前兩週規劃，現場沒有開天窗。',
    reviewNote: '',
    appealReason: '',
  },
  E04: {
    status: 'self',
    selfScores: null, selfComment: '', reviewNote: '', appealReason: '',
  },
  E05: {
    status: 'appeal',
    selfScores: { quota: 70, margin: 95, newCustomer: 60, satisfaction: 100, discipline: 100 },
    selfComment: '既有企業客戶回購全數守住、零客訴。新客開發確實沒達標，但主因是兩家科技業客戶的年節禮贈預算延到明年一月才核定。',
    reviewNote: '業績未達標屬實，惟客戶預算延後有書面佐證，退回主管重新評估權重。',
    appealReason: '業績目標是以客戶年度預算如期核定為前提訂的，預算延後屬客戶端因素。請求將業績權重由 40% 暫調為 25%，或重設本期目標。',
  },
  E06: {
    status: 'manager',
    selfScores: { output: 95, quality: 100, improvement: 85, teamwork: 90, discipline: 100 },
    selfComment: '冬茶首批焙火品質有把關，農殘送驗全數合格，瑕疵率壓在 1.1%。五月春茶外包的部分不在我控制範圍，希望產出目標能把外包量扣掉再算。',
    reviewNote: '',
    appealReason: '',
  },
  E07: {
    status: 'final',
    selfScores: { output: 95, quality: 100, improvement: 70, teamwork: 100, discipline: 98 },
    selfComment: '三期月結都準時。流程改善確實沒有主動提案，主要是日常帳務就佔滿工時。',
    reviewNote: '月結零延遲，核定 B 等。下期指派「請款單數位化」為指定改善項目，納入流程改善評分。',
    appealReason: '',
  },
  E08: {
    status: 'self',
    selfScores: null, selfComment: '', reviewNote: '', appealReason: '',
  },
};

/* ---- 稽核軌跡種子：[時間, 操作者, 動作, 原狀態, 新狀態, 說明] ---- */
const AUDIT_SEED = {
  E01: [
    ['2026-10-01 09:00', '王美玲', 'openCycle',    null,      'self',    '開啟 2026-Q4 評核週期'],
    ['2026-10-06 14:22', '陳佳蓉', 'submitSelf',   'self',    'manager', '送出自評'],
    ['2026-10-12 10:05', '王美玲', 'submitReview', 'manager', 'review',  '本人為主管，依規定由管理員代評'],
    ['2026-10-15 16:40', '王美玲', 'finalize',     'review',  'final',   '定版，核定 A 等'],
  ],
  E02: [
    ['2026-10-01 09:00', '王美玲', 'openCycle',  null,   'self',    '開啟 2026-Q4 評核週期'],
    ['2026-10-08 11:30', '林志偉', 'submitSelf', 'self', 'manager', '送出自評'],
  ],
  E03: [
    ['2026-10-01 09:00', '王美玲', 'openCycle',    null,      'self',    '開啟 2026-Q4 評核週期'],
    ['2026-10-05 09:48', '黃淑芬', 'submitSelf',   'self',    'manager', '送出自評'],
    ['2026-10-14 15:12', '王美玲', 'submitReview', 'manager', 'review',  '本人為主管，依規定由管理員代評'],
  ],
  E04: [
    ['2026-10-01 09:00', '王美玲', 'openCycle', null, 'self', '開啟 2026-Q4 評核週期'],
  ],
  E05: [
    ['2026-10-01 09:00', '王美玲', 'openCycle',    null,      'self',    '開啟 2026-Q4 評核週期'],
    ['2026-10-07 13:05', '張雅婷', 'submitSelf',   'self',    'manager', '送出自評'],
    ['2026-10-13 09:20', '陳佳蓉', 'submitReview', 'manager', 'review',  '主管評核完成'],
    ['2026-10-16 11:00', '王美玲', 'finalize',     'review',  'final',   '定版，核定 D 等'],
    ['2026-10-21 17:35', '張雅婷', 'appeal',       'final',   'appeal',  '提出申訴：客戶預算延後屬外部因素'],
  ],
  E06: [
    ['2026-10-01 09:00', '王美玲', 'openCycle',  null,   'self',    '開啟 2026-Q4 評核週期'],
    ['2026-10-09 08:15', '李俊傑', 'submitSelf', 'self', 'manager', '送出自評'],
  ],
  E07: [
    ['2026-10-01 09:00', '王美玲', 'openCycle',    null,      'self',    '開啟 2026-Q4 評核週期'],
    ['2026-10-04 16:50', '王美玲', 'submitSelf',   'self',    'manager', '送出自評'],
    ['2026-10-11 10:30', '王美玲', 'submitReview', 'manager', 'review',  '主管評核完成'],
    ['2026-10-15 16:45', '王美玲', 'finalize',     'review',  'final',   '定版，核定 B 等'],
  ],
  E08: [
    ['2026-10-01 09:00', '王美玲', 'openCycle', null, 'self', '開啟 2026-Q4 評核週期'],
  ],
};

/* ---- 月營收（近 12 個月，單位：元） ---------------------- */
const MONTHLY_REVENUE = [
  { month: '2025-11', label: '11月', value: 4120000, note: '冬茶上市' },
  { month: '2025-12', label: '12月', value: 4860000, note: '年節備貨' },
  { month: '2026-01', label: '1月',  value: 5240000, note: '春節檔期' },
  { month: '2026-02', label: '2月',  value: 2680000, note: '節後淡季' },
  { month: '2026-03', label: '3月',  value: 2940000, note: '' },
  { month: '2026-04', label: '4月',  value: 4380000, note: '春茶上市 · 極春錦雲禮盒' },
  { month: '2026-05', label: '5月',  value: 4710000, note: '春茶旺季' },
  { month: '2026-06', label: '6月',  value: 3260000, note: '' },
  { month: '2026-07', label: '7月',  value: 2880000, note: '夏季淡季' },
  { month: '2026-08', label: '8月',  value: 3540000, note: '中秋備貨' },
  { month: '2026-09', label: '9月',  value: 5080000, note: '中秋 · 台灣紅茶禮盒上市' },
  { month: '2026-10', label: '10月', value: 2908000, note: '本月（截至 10/27）' },
];

/* 去年同期（2025-10），用於年增率比較 */
const LAST_YEAR_SAME_MONTH = 2560000;

/* 上一評核期的全體平均總分，用於績效 delta */
const PREV_PERIOD_AVG = 86.4;

/* ---- 本月通路營收 ----------------------------------------
   與員工個人業績對帳：批發 = 陳佳蓉 + 林志偉，門市 = 黃淑芬，
   電商 = 吳建宏，企業客製 = 張雅婷。合計等於本月營收 2,908,000。
   通路對應官網的商用茶／高山茶批發、建國門市、官網零售、商品規劃（客製）。
----------------------------------------------------------- */
const CHANNELS = [
  { name: '批發', value: 1608000 },
  { name: '門市', value: 624000 },
  { name: '電商', value: 484000 },
  { name: '企業客製', value: 192000 },
];

/* ---- 訂單 ------------------------------------------------ */
const ORDERS = [
  { id: 'SO-26100142', date: '2026-10-26', customer: '春日茶飲連鎖', channel: '批發', item: '紅玉商用茶 (30kg)', amount: 186000, status: '備貨中', owner: '陳佳蓉' },
  { id: 'SO-26100141', date: '2026-10-25', customer: '個人客戶 · 林',   channel: '電商', item: '台灣紅茶禮盒 ×4', amount: 8800,   status: '已出貨', owner: '吳建宏' },
  { id: 'SO-26100140', date: '2026-10-25', customer: '禾田食品行',     channel: '批發', item: '凍頂烏龍茶 (50kg)', amount: 142500, status: '已出貨', owner: '林志偉' },
  { id: 'SO-26100139', date: '2026-10-24', customer: '永衡精密 · 年節禮贈', channel: '企業客製', item: '客製錦雲禮盒 ×160', amount: 416000, status: '待付款', owner: '張雅婷' },
  { id: 'SO-26100138', date: '2026-10-23', customer: '建國門市 · 現場',  channel: '門市', item: '頂級東方美人 (2kg)', amount: 19600, status: '已出貨', owner: '黃淑芬' },
  { id: 'SO-26100137', date: '2026-10-22', customer: '青禾茶館',       channel: '批發', item: '杉林溪番仔田茶 (25kg)', amount: 162500, status: '已出貨', owner: '陳佳蓉' },
  { id: 'SO-26100136', date: '2026-10-21', customer: '個人客戶 · 王',   channel: '電商', item: '蜜香紅烏龍 ×6', amount: 2880,   status: '已出貨', owner: '吳建宏' },
  { id: 'SO-26100135', date: '2026-10-20', customer: '沐光旅店',       channel: '批發', item: '冬片包種茶 (40kg)', amount: 108000, status: '已出貨', owner: '林志偉' },
  { id: 'SO-26100134', date: '2026-10-19', customer: '建國門市 · 現場',  channel: '門市', item: '汝窯梨山茶禮盒 ×12', amount: 27000, status: '已出貨', owner: '黃淑芬' },
  { id: 'SO-26100133', date: '2026-10-18', customer: '個人客戶 · 張',   channel: '電商', item: '阿里山烏龍茶 ×3', amount: 1080, status: '已取消', owner: '吳建宏' },
  { id: 'SO-26100132', date: '2026-10-17', customer: '翠峰茶行',       channel: '批發', item: '石棹春茶 (60kg)', amount: 138000, status: '已出貨', owner: '陳佳蓉' },
  { id: 'SO-26100131', date: '2026-10-16', customer: '安穩生技 · 員工禮贈', channel: '企業客製', item: '原葉三角立體茶包 ×340', amount: 95200, status: '已出貨', owner: '張雅婷' },
  { id: 'SO-26100130', date: '2026-10-15', customer: '個人客戶 · 李',   channel: '電商', item: '南投武界烏龍冬片 ×5', amount: 3400,  status: '已出貨', owner: '吳建宏' },
  { id: 'SO-26100129', date: '2026-10-14', customer: '禾田食品行',     channel: '批發', item: '凍頂烏龍茶 (30kg)', amount: 85500, status: '已出貨', owner: '林志偉' },
  { id: 'SO-26100128', date: '2026-10-13', customer: '建國門市 · 現場',  channel: '門市', item: '金福大禹嶺烏龍茶 ×4', amount: 10000, status: '已出貨', owner: '黃淑芬' },
  { id: 'SO-26100127', date: '2026-10-12', customer: '橙心手搖飲',     channel: '批發', item: '紅玉商用茶 (35kg)', amount: 129500, status: '備貨中', owner: '陳佳蓉' },
  { id: 'SO-26100126', date: '2026-10-09', customer: '個人客戶 · 周',   channel: '電商', item: '雲南宮廷普洱一泡餅 ×4', amount: 5520, status: '已出貨', owner: '吳建宏' },
  { id: 'SO-26100125', date: '2026-10-08', customer: '沐光旅店',       channel: '批發', item: '冬片包種茶 (25kg)', amount: 67500, status: '待付款', owner: '林志偉' },
];

/* ---- 茶品庫存（品項與商品圖對照長信名茶官網茶葉專區；數量、價格為虛構）
   img 為官網 CDN 圖片路徑，離線開啟時載不到會自動隱藏 ---- */
const IMG_BASE = 'https://cdn.store-assets.com/s/772214/';
const INVENTORY = [
  { sku: 'TEA-001', img: 'i/35230008.png', name: '阿里山烏龍茶',     origin: '嘉義 · 阿里山', grade: '特級', lot: 'L2604-07', stock: 186, safety: 120, unitPrice: 5200,  lastIn: '2026-05-12' },
  { sku: 'TEA-002', img: 'i/73862923.png', name: '杉林溪番仔田茶',   origin: '南投 · 竹山',   grade: '特級', lot: 'L2604-11', stock: 94,  safety: 100, unitPrice: 6500,  lastIn: '2026-05-18' },
  { sku: 'TEA-003', img: 'i/37883167.png', name: '梨山烏龍茶',       origin: '台中 · 梨山',   grade: '極品', lot: 'L2512-02', stock: 31,  safety: 60,  unitPrice: 9800,  lastIn: '2025-12-20' },
  { sku: 'TEA-004', img: 'i/35236052.png', name: '凍頂烏龍茶',       origin: '南投 · 鹿谷',   grade: '一級', lot: 'L2605-03', stock: 420, safety: 200, unitPrice: 2850,  lastIn: '2026-05-26' },
  { sku: 'TEA-005', img: 'i/70122066.png', name: '石棹春茶',         origin: '嘉義 · 石棹',   grade: '一級', lot: 'L2604-15', stock: 512, safety: 250, unitPrice: 2300,  lastIn: '2026-05-08' },
  { sku: 'TEA-006', img: 'i/72585905.png', name: '頂級東方美人',     origin: '新竹 · 北埔',   grade: '特級', lot: 'L2606-09', stock: 46,  safety: 40,  unitPrice: 9800,  lastIn: '2026-06-28' },
  { sku: 'TEA-007', img: 'i/85664046.png', name: '日月潭紅玉（台茶18號）', origin: '南投 · 魚池', grade: '特級', lot: 'L2608-04', stock: 158, safety: 110, unitPrice: 3700, lastIn: '2026-08-10' },
  { sku: 'TEA-008', img: 'i/100848345.png', name: '蜜香紅烏龍',       origin: '台東 · 鹿野',   grade: '一級', lot: 'L2607-05', stock: 72,  safety: 80,  unitPrice: 4100,  lastIn: '2026-07-22' },
  { sku: 'TEA-009', img: 'i/99066376.png', name: '冬片包種茶',       origin: '新北 · 坪林',   grade: '一級', lot: 'L2512-14', stock: 228, safety: 150, unitPrice: 2700,  lastIn: '2025-12-30' },
  { sku: 'TEA-010', img: 'i/35236359.png', name: '南投武界烏龍（冬片）', origin: '南投 · 仁愛', grade: '特級', lot: 'L2512-21', stock: 61, safety: 70, unitPrice: 4800, lastIn: '2025-12-29' },
  { sku: 'TEA-011', img: 'i/37290977.png', name: '大禹嶺烏龍茶',     origin: '台中 · 和平',   grade: '極品', lot: 'L2606-02', stock: 38,  safety: 30,  unitPrice: 16000, lastIn: '2026-06-17' },
  { sku: 'TEA-012', img: 'i/77447555.png', name: '華岡水源頭高冷茶', origin: '南投 · 仁愛',   grade: '極品', lot: 'L2605-08', stock: 22,  safety: 15,  unitPrice: 15000, lastIn: '2026-05-21' },
  { sku: 'TEA-013', img: 'i/86733593.png', name: '梨山芽尖紅茶',     origin: '台中 · 梨山',   grade: '特級', lot: 'L2607-11', stock: 64,  safety: 40,  unitPrice: 7800,  lastIn: '2026-07-15' },
  { sku: 'TEA-014', img: 'i/107921698.png', name: '雲南宮廷普洱',     origin: '雲南 · 勐海',   grade: '陳年', lot: 'L1603-01', stock: 24,  safety: 15,  unitPrice: 12000, lastIn: '2024-03-15' },
];

/* 以傳統 script 載入，掛到全域命名空間，讓 file:// 直接開也能跑 */
window.DEMO = {
  IMG_BASE, META, TEMPLATES, ACCESS_LEVELS, WORKFLOW, CYCLE, CYCLE_STATE, AUDIT_SEED, EMPLOYEES, MONTHLY_REVENUE, LAST_YEAR_SAME_MONTH,
  PREV_PERIOD_AVG, CHANNELS, ORDERS, INVENTORY,
};
