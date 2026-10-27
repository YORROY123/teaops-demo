/* ===========================================================
   種子資料（全部為虛構示範資料，與任何真實公司、人員無關）
   =========================================================== */

const META = {
  companyLabel: '長信茶業',
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
    note: '適用業務、門市、電商等有營收責任的職務',
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
    note: '適用製茶、品管、行政等無直接營收責任的職務',
    items: [
      { key: 'output',       name: '工作產出',   weight: 40, rawLabel: '當期完成量' },
      { key: 'quality',      name: '品質穩定',   weight: 25, rawLabel: '瑕疵 / 錯誤率' },
      { key: 'improvement',  name: '流程改善',   weight: 15, rawLabel: '提案採用數' },
      { key: 'teamwork',     name: '跨部門協作', weight: 10, rawLabel: '協作評價' },
      { key: 'discipline',   name: '出勤紀律',   weight: 10, rawLabel: '出勤率' },
    ],
  },
};

/* ---- 員工 ------------------------------------------------ */
const EMPLOYEES = [
  {
    id: 'E01', name: '陳佳蓉', dept: '業務部', role: '資深業務專員',
    hireDate: '2017-03-06', template: 'sales',
    scores: { quota: 118, margin: 109, newCustomer: 125, satisfaction: 100, discipline: 100 },
    raw: {
      quota: '1,062,000 / 900,000', margin: '34.9%', newCustomer: '5 / 4',
      satisfaction: '0 件', discipline: '100%',
    },
    comment: '大宗批發客維繫穩定，本期成功把梅山烏龍導入兩家連鎖茶飲通路。議價偏守，毛利率維持得不錯。',
  },
  {
    id: 'E02', name: '林志偉', dept: '業務部', role: '業務專員',
    hireDate: '2022-09-12', template: 'sales',
    scores: { quota: 78, margin: 70, newCustomer: 75, satisfaction: 76, discipline: 96 },
    raw: {
      quota: '546,000 / 700,000', margin: '22.4%', newCustomer: '3 / 4',
      satisfaction: '3 件', discipline: '96%',
    },
    comment: '衝量意願高但讓價過快，毛利率低於目標 9.6 個百分點，是全公司最低。建議下期先鎖報價級距，再談新客。',
  },
  {
    id: 'E03', name: '黃淑芬', dept: '門市', role: '門市主任',
    hireDate: '2015-06-01', template: 'sales',
    scores: { quota: 104, margin: 115, newCustomer: 90, satisfaction: 92, discipline: 100 },
    raw: {
      quota: '624,000 / 600,000', margin: '36.8%', newCustomer: '9 / 10',
      satisfaction: '1 件', discipline: '100%',
    },
    comment: '門市客單價提升明顯，禮盒搭售成效好。中秋檔期人力排班順暢，現場零客訴升級。',
  },
  {
    id: 'E04', name: '吳建宏', dept: '電商', role: '電商營運專員',
    hireDate: '2023-02-20', template: 'sales',
    scores: { quota: 88, margin: 78, newCustomer: 120, satisfaction: 70, discipline: 92 },
    raw: {
      quota: '484,000 / 550,000', margin: '25.0%', newCustomer: '36 / 30',
      satisfaction: '3 件', discipline: '92%',
    },
    comment: '新客獲取是全公司最強，但出貨延遲造成 3 件客訴，連帶拉低滿意度分數。倉儲對單仍靠人工，是可優先自動化的環節。',
  },
  {
    id: 'E05', name: '張雅婷', dept: '業務部', role: '外銷業務',
    hireDate: '2019-11-04', template: 'sales',
    scores: { quota: 48, margin: 92, newCustomer: 50, satisfaction: 100, discipline: 98 },
    raw: {
      quota: '192,000 / 400,000', margin: '31.0%', newCustomer: '1 / 2',
      satisfaction: '0 件', discipline: '98%',
    },
    comment: '既有日本客戶續單穩定、零客訴，但業績僅達標 48%，新市場開發幾乎停滯。海外展延期是客觀因素，建議改走線上樣品寄送並重設下期目標。',
  },
  {
    id: 'E06', name: '李俊傑', dept: '製茶廠', role: '製茶師',
    hireDate: '2013-04-15', template: 'ops',
    scores: { output: 86, quality: 92, improvement: 75, teamwork: 85, discipline: 100 },
    raw: {
      output: '1,820 kg / 2,100 kg', quality: '瑕疵率 1.1%', improvement: '1 案採用',
      teamwork: '4.2 / 5', discipline: '100%',
    },
    comment: '烘焙手感穩定、全勤零遲到。本期產出未達標主因是五月春茶量能被外包稀釋。提出的萎凋槽濕度紀錄表已導入，但仍靠紙本，值得數位化。',
  },
  {
    id: 'E07', name: '王美玲', dept: '行政', role: '會計兼行政',
    hireDate: '2016-08-22', template: 'ops',
    scores: { output: 90, quality: 95, improvement: 60, teamwork: 100, discipline: 98 },
    raw: {
      output: '月結準時 3 / 3 期', quality: '傳票錯誤 2 筆', improvement: '0 案採用',
      teamwork: '4.6 / 5', discipline: '98%',
    },
    comment: '月結從未延遲、跨部門配合度全公司最高。流程改善面較被動，整期零提案；可指派一項自動化主題（例如請款單數位化）當作下期目標。',
  },
  {
    id: 'E08', name: '蔡承翰', dept: '電商', role: '行銷企劃',
    hireDate: '2024-07-08', template: 'ops',
    scores: { output: 72, quality: 62, improvement: 95, teamwork: 85, discipline: 86 },
    raw: {
      output: '10 篇 / 14 篇', quality: '素材退回 5 次', improvement: '3 案採用',
      teamwork: '4.2 / 5', discipline: '86%',
    },
    comment: '中秋檔期的內容企劃帶動電商新客成長，點子最多、提案採用數最高。但素材退回 5 次、產出只達 71%，交期與規格穩定度是這期最該補的洞。',
  },
];

/* ---- 月營收（近 12 個月，單位：元） ---------------------- */
const MONTHLY_REVENUE = [
  { month: '2025-11', label: '11月', value: 4120000, note: '冬茶上市' },
  { month: '2025-12', label: '12月', value: 4860000, note: '年節備貨' },
  { month: '2026-01', label: '1月',  value: 5240000, note: '春節檔期' },
  { month: '2026-02', label: '2月',  value: 2680000, note: '節後淡季' },
  { month: '2026-03', label: '3月',  value: 2940000, note: '' },
  { month: '2026-04', label: '4月',  value: 4380000, note: '春茶上市' },
  { month: '2026-05', label: '5月',  value: 4710000, note: '春茶旺季' },
  { month: '2026-06', label: '6月',  value: 3260000, note: '' },
  { month: '2026-07', label: '7月',  value: 2880000, note: '夏季淡季' },
  { month: '2026-08', label: '8月',  value: 3540000, note: '中秋備貨' },
  { month: '2026-09', label: '9月',  value: 5080000, note: '中秋禮盒' },
  { month: '2026-10', label: '10月', value: 2908000, note: '本月（截至 10/27）' },
];

/* 去年同期（2025-10），用於年增率比較 */
const LAST_YEAR_SAME_MONTH = 2560000;

/* 上一評核期的全體平均總分，用於績效 delta */
const PREV_PERIOD_AVG = 86.4;

/* ---- 本月通路營收 ----------------------------------------
   與員工個人業績對帳：批發 = 陳佳蓉 + 林志偉，門市 = 黃淑芬，
   電商 = 吳建宏，外銷 = 張雅婷。合計等於本月營收 2,908,000。
----------------------------------------------------------- */
const CHANNELS = [
  { name: '批發', value: 1608000 },
  { name: '門市', value: 624000 },
  { name: '電商', value: 484000 },
  { name: '外銷', value: 192000 },
];

/* ---- 訂單 ------------------------------------------------ */
const ORDERS = [
  { id: 'SO-26100142', date: '2026-10-26', customer: '春日茶飲連鎖', channel: '批發', item: '梅山烏龍 (30kg)', amount: 186000, status: '備貨中', owner: '陳佳蓉' },
  { id: 'SO-26100141', date: '2026-10-25', customer: '個人客戶 · 林',   channel: '電商', item: '紅玉紅茶禮盒 ×4', amount: 7200,   status: '已出貨', owner: '吳建宏' },
  { id: 'SO-26100140', date: '2026-10-25', customer: '禾田食品行',     channel: '批發', item: '四季春 (50kg)',  amount: 142500, status: '已出貨', owner: '林志偉' },
  { id: 'SO-26100139', date: '2026-10-24', customer: '日商 Yamane 商事', channel: '外銷', item: '高山烏龍 (80kg)', amount: 416000, status: '待付款', owner: '張雅婷' },
  { id: 'SO-26100138', date: '2026-10-23', customer: '建國門市 · 現場',  channel: '門市', item: '東方美人 (2kg)',  amount: 19600,  status: '已出貨', owner: '黃淑芬' },
  { id: 'SO-26100137', date: '2026-10-22', customer: '青禾茶館',       channel: '批發', item: '杉林溪烏龍 (25kg)', amount: 162500, status: '已出貨', owner: '陳佳蓉' },
  { id: 'SO-26100136', date: '2026-10-21', customer: '個人客戶 · 王',   channel: '電商', item: '蜜香紅茶 150g ×6', amount: 4320,   status: '已出貨', owner: '吳建宏' },
  { id: 'SO-26100135', date: '2026-10-20', customer: '沐光旅店',       channel: '批發', item: '包種茶 (40kg)',  amount: 108000, status: '已出貨', owner: '林志偉' },
  { id: 'SO-26100134', date: '2026-10-19', customer: '建國門市 · 現場',  channel: '門市', item: '中秋禮盒 ×12',   amount: 28800,  status: '已出貨', owner: '黃淑芬' },
  { id: 'SO-26100133', date: '2026-10-18', customer: '個人客戶 · 張',   channel: '電商', item: '阿里山烏龍 75g ×3', amount: 3450, status: '已取消', owner: '吳建宏' },
  { id: 'SO-26100132', date: '2026-10-17', customer: '翠峰茶行',       channel: '批發', item: '金萱 (60kg)',    amount: 138000, status: '已出貨', owner: '陳佳蓉' },
  { id: 'SO-26100131', date: '2026-10-16', customer: '日商 Yamane 商事', channel: '外銷', item: '鐵觀音 (20kg)',  amount: 96000,  status: '已出貨', owner: '張雅婷' },
  { id: 'SO-26100130', date: '2026-10-15', customer: '個人客戶 · 李',   channel: '電商', item: '冬片烏龍 100g ×5', amount: 6500,  status: '已出貨', owner: '吳建宏' },
  { id: 'SO-26100129', date: '2026-10-14', customer: '禾田食品行',     channel: '批發', item: '四季春 (30kg)',  amount: 85500,  status: '已出貨', owner: '林志偉' },
  { id: 'SO-26100128', date: '2026-10-13', customer: '建國門市 · 現場',  channel: '門市', item: '碧螺春 (1.5kg)', amount: 11250,  status: '已出貨', owner: '黃淑芬' },
  { id: 'SO-26100127', date: '2026-10-12', customer: '安穩生技',       channel: '批發', item: '紅玉紅茶 (35kg)', amount: 129500, status: '備貨中', owner: '陳佳蓉' },
  { id: 'SO-26100126', date: '2026-10-09', customer: '個人客戶 · 周',   channel: '電商', item: '普洱熟磚 ×2',    amount: 5600,   status: '已出貨', owner: '吳建宏' },
  { id: 'SO-26100125', date: '2026-10-08', customer: '沐光旅店',       channel: '批發', item: '包種茶 (25kg)',  amount: 67500,  status: '待付款', owner: '林志偉' },
];

/* ---- 茶品庫存 -------------------------------------------- */
const INVENTORY = [
  { sku: 'TEA-001', name: '阿里山高山烏龍', origin: '嘉義 · 阿里山', grade: '特級', lot: 'L2604-07', stock: 186, safety: 120, unitPrice: 5200, lastIn: '2026-05-12' },
  { sku: 'TEA-002', name: '杉林溪烏龍',     origin: '南投 · 竹山',   grade: '特級', lot: 'L2604-11', stock: 94,  safety: 100, unitPrice: 6500, lastIn: '2026-05-18' },
  { sku: 'TEA-003', name: '梨山冬片烏龍',   origin: '台中 · 梨山',   grade: '極品', lot: 'L2512-02', stock: 31,  safety: 60,  unitPrice: 9800, lastIn: '2025-12-20' },
  { sku: 'TEA-004', name: '金萱（台茶12號）', origin: '南投 · 名間', grade: '一級', lot: 'L2605-03', stock: 420, safety: 200, unitPrice: 2300, lastIn: '2026-05-26' },
  { sku: 'TEA-005', name: '四季春',         origin: '南投 · 名間',   grade: '一級', lot: 'L2606-01', stock: 512, safety: 250, unitPrice: 1900, lastIn: '2026-06-03' },
  { sku: 'TEA-006', name: '東方美人茶',     origin: '新竹 · 北埔',   grade: '特級', lot: 'L2606-09', stock: 46,  safety: 40,  unitPrice: 9800, lastIn: '2026-06-28' },
  { sku: 'TEA-007', name: '紅玉紅茶（台茶18號）', origin: '南投 · 魚池', grade: '特級', lot: 'L2608-04', stock: 158, safety: 110, unitPrice: 3700, lastIn: '2026-08-10' },
  { sku: 'TEA-008', name: '蜜香紅茶',       origin: '花蓮 · 瑞穗',   grade: '一級', lot: 'L2607-05', stock: 72,  safety: 80,  unitPrice: 4100, lastIn: '2026-07-22' },
  { sku: 'TEA-009', name: '文山包種茶',     origin: '新北 · 坪林',   grade: '一級', lot: 'L2605-14', stock: 228, safety: 150, unitPrice: 2700, lastIn: '2026-05-30' },
  { sku: 'TEA-010', name: '木柵鐵觀音',     origin: '台北 · 木柵',   grade: '特級', lot: 'L2604-21', stock: 61,  safety: 70,  unitPrice: 4800, lastIn: '2026-04-29' },
  { sku: 'TEA-011', name: '梅山烏龍',       origin: '嘉義 · 梅山',   grade: '一級', lot: 'L2609-02', stock: 340, safety: 180, unitPrice: 3100, lastIn: '2026-09-07' },
  { sku: 'TEA-012', name: '普洱熟磚（10年）', origin: '雲南 · 勐海',  grade: '陳年', lot: 'L1603-01', stock: 24,  safety: 15,  unitPrice: 12000, lastIn: '2024-03-15' },
];

/* 以傳統 script 載入，掛到全域命名空間，讓 file:// 直接開也能跑 */
window.DEMO = {
  META, TEMPLATES, EMPLOYEES, MONTHLY_REVENUE, LAST_YEAR_SAME_MONTH,
  PREV_PERIOD_AVG, CHANNELS, ORDERS, INVENTORY,
};
