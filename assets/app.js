/* ===========================================================
   長信茶業 內部管理與績效系統 — Demo
   傳統 script（非 ES module），file:// 直接開也能運作。
   =========================================================== */
(function () {
  'use strict';

  var D = window.DEMO;
  var STORE_KEY = 'teaops-demo-v1';

  /* ---------- 小工具 ------------------------------------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function nt(n) { return Math.round(n).toLocaleString('en-US'); }

  /** 以「萬」為單位，台灣財務報表習慣 */
  function wan(n) {
    var v = n / 10000;
    if (Math.abs(v) >= 1000) return (v / 10000).toFixed(2) + '億';
    if (Math.abs(v) >= 100) return Math.round(v) + '萬';
    return v.toFixed(1) + '萬';
  }

  function pct(n, digits) { return (n >= 0 ? '+' : '') + n.toFixed(digits === undefined ? 1 : digits) + '%'; }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.hidden = true; }, 2200);
  }

  /** CSV 下載。加上 BOM，Excel 開中文才不會變亂碼。 */
  function downloadCSV(filename, rows) {
    var csv = rows.map(function (r) {
      return r.map(function (cell) {
        var s = String(cell === null || cell === undefined ? '' : cell);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('已匯出 ' + filename);
  }

  /* ---------- 狀態（localStorage 持久化） ----------------- */

  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

  function defaultState() {
    return {
      employees: deepCopy(D.EMPLOYEES),
      orders: deepCopy(D.ORDERS),
      inventory: deepCopy(D.INVENTORY),
    };
  }

  var state = defaultState();

  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved && saved.employees && saved.orders && saved.inventory) state = saved;
    } catch (e) { /* 隱私模式或封鎖 storage：沿用預設資料即可 */ }
  }

  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { /* 寫不進去不影響瀏覽 */ }
  }

  function resetState() {
    state = defaultState();
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    selectedEmp = null;
    renderAll();
    toast('已還原為原始示範資料');
  }

  /* ---------- 績效計算 ------------------------------------ */

  function templateOf(emp) { return D.TEMPLATES[emp.template]; }

  function totalScore(emp) {
    return templateOf(emp).items.reduce(function (sum, it) {
      return sum + (emp.scores[it.key] || 0) * it.weight;
    }, 0) / 100;
  }

  function gradeOf(total) {
    if (total >= 90) return 'A';
    if (total >= 80) return 'B';
    if (total >= 70) return 'C';
    return 'D';
  }

  /** 量表填色：常態走主色，落後才轉警示色（顏色之外一律附數字） */
  function scoreColor(score) {
    if (score < 70) return 'var(--critical)';
    if (score < 85) return 'var(--warning)';
    return 'var(--series-1)';
  }

  /* ---------- 庫存狀態 ------------------------------------ */

  var STOCK_LEVELS = [
    { max: 0.6, key: 'critical', label: '急需補貨' },
    { max: 1.0, key: 'serious',  label: '低於安全量' },
    { max: 1.3, key: 'warning',  label: '接近下限' },
    { max: Infinity, key: 'good', label: '庫存充足' },
  ];

  function stockLevel(row) {
    var ratio = row.safety > 0 ? row.stock / row.safety : 2;
    for (var i = 0; i < STOCK_LEVELS.length; i++) {
      if (ratio < STOCK_LEVELS[i].max) return STOCK_LEVELS[i];
    }
    return STOCK_LEVELS[STOCK_LEVELS.length - 1];
  }

  function chip(levelKey, label) {
    return el('span', { class: 'chip chip-' + levelKey }, [
      el('span', { class: 'chip-dot' }), label,
    ]);
  }

  var ORDER_STATUS = {
    '已出貨': 'good',
    '備貨中': 'warning',
    '待付款': 'serious',
    '已取消': 'neutral',
  };

  /* =========================================================
     圖表
     ========================================================= */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  /** 右端圓角的水平長條：底端（左）維持直角，資料端（右）4px 圓角 */
  function barPath(x, y, w, h, r) {
    if (w <= r) return 'M' + x + ',' + y + 'h' + Math.max(w, 0.5) + 'v' + h + 'h' + -Math.max(w, 0.5) + 'z';
    var x2 = x + w;
    return 'M' + x + ',' + y +
      'H' + (x2 - r) + 'A' + r + ',' + r + ' 0 0 1 ' + x2 + ',' + (y + r) +
      'V' + (y + h - r) + 'A' + r + ',' + r + ' 0 0 1 ' + (x2 - r) + ',' + (y + h) +
      'H' + x + 'Z';
  }

  function niceCeil(v) {
    if (v <= 0) return 1;
    var mag = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) {
      if (steps[i] * mag >= v) return steps[i] * mag;
    }
    return 10 * mag;
  }

  /* ---- 折線圖：月營收趨勢（單一系列 → 不需圖例） -------- */
  function renderRevenueChart(host) {
    clear(host);
    var data = D.MONTHLY_REVENUE;
    var W = 740, H = 268, padL = 58, padR = 54, padT = 16, padB = 36;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var yMax = niceCeil(Math.max.apply(null, data.map(function (d) { return d.value; })));
    var ticks = 4;

    var svg = svgEl('svg', {
      class: 'chart', viewBox: '0 0 ' + W + ' ' + H, tabindex: '0',
      role: 'img', 'aria-label': '近 12 個月營收趨勢折線圖，可用左右方向鍵逐月查看',
    });

    var x = function (i) { return padL + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW); };
    var y = function (v) { return padT + plotH - (v / yMax) * plotH; };

    /* 格線 + y 軸刻度 */
    for (var t = 0; t <= ticks; t++) {
      var val = (yMax / ticks) * t;
      var yy = y(val);
      svg.appendChild(svgEl('line', { class: t === 0 ? 'axisline' : 'gridline', x1: padL, x2: padL + plotW, y1: yy, y2: yy }));
      var lbl = svgEl('text', { class: 'axis-label', x: padL - 10, y: yy + 4, 'text-anchor': 'end' });
      lbl.textContent = t === 0 ? '0' : wan(val);
      svg.appendChild(lbl);
    }

    /* 面積：系列色 10% 淡化，不是飽和色塊 */
    var linePts = data.map(function (d, i) { return x(i) + ',' + y(d.value); });
    var areaD = 'M' + x(0) + ',' + y(0) + 'L' + linePts.join('L') + 'L' + x(data.length - 1) + ',' + y(0) + 'Z';
    svg.appendChild(svgEl('path', { d: areaD, fill: 'var(--series-1-wash)' }));
    svg.appendChild(svgEl('path', {
      d: 'M' + linePts.join('L'), fill: 'none', stroke: 'var(--series-1)',
      'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));

    /* x 軸月份 */
    data.forEach(function (d, i) {
      var lb = svgEl('text', { class: 'axis-label', x: x(i), y: padT + plotH + 20, 'text-anchor': 'middle' });
      lb.textContent = d.label;
      svg.appendChild(lb);
    });

    /* 端點標記：2px 表面色外環，避免與線條糊在一起 */
    var last = data.length - 1;
    svg.appendChild(svgEl('circle', {
      cx: x(last), cy: y(data[last].value), r: 4.5,
      fill: 'var(--series-1)', stroke: 'var(--surface-1)', 'stroke-width': '2',
    }));
    var endLabel = svgEl('text', { class: 'value-label', x: x(last) + 10, y: y(data[last].value) + 4 });
    endLabel.textContent = wan(data[last].value);
    svg.appendChild(endLabel);

    /* 游標層 */
    var cross = svgEl('line', { class: 'gridline', x1: 0, x2: 0, y1: padT, y2: padT + plotH, stroke: 'var(--axis)', opacity: '0' });
    svg.appendChild(cross);
    var hoverDot = svgEl('circle', { r: 4.5, fill: 'var(--series-1)', stroke: 'var(--surface-1)', 'stroke-width': '2', opacity: '0' });
    svg.appendChild(hoverDot);

    var tip = el('div', { class: 'tooltip', hidden: 'hidden' });
    host.appendChild(tip);

    function showAt(i) {
      var d = data[i];
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', '1');
      hoverDot.setAttribute('cx', x(i)); hoverDot.setAttribute('cy', y(d.value)); hoverDot.setAttribute('opacity', '1');
      tip.hidden = false;
      clear(tip);
      tip.appendChild(el('div', { class: 'tt-label', text: d.month + (d.note ? ' · ' + d.note : '') }));
      tip.appendChild(el('div', { class: 'tt-value', text: 'NT$ ' + nt(d.value) }));
      tip.style.left = (x(i) / W * 100) + '%';
      tip.style.top = (y(d.value) / H * 100) + '%';
    }
    function hide() {
      cross.setAttribute('opacity', '0');
      hoverDot.setAttribute('opacity', '0');
      tip.hidden = true;
    }

    /* 命中區比標記大，滑鼠好對準 */
    data.forEach(function (d, i) {
      var band = plotW / (data.length - 1);
      var r = svgEl('rect', {
        x: x(i) - band / 2, y: padT, width: band, height: plotH, fill: 'transparent',
      });
      r.addEventListener('mouseenter', function () { showAt(i); });
      svg.appendChild(r);
    });
    svg.addEventListener('mouseleave', hide);

    var focusIdx = data.length - 1;
    svg.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowRight') { focusIdx = Math.min(data.length - 1, focusIdx + 1); showAt(focusIdx); ev.preventDefault(); }
      else if (ev.key === 'ArrowLeft') { focusIdx = Math.max(0, focusIdx - 1); showAt(focusIdx); ev.preventDefault(); }
      else if (ev.key === 'Escape') hide();
    });
    svg.addEventListener('blur', hide);

    host.insertBefore(svg, tip);
  }

  /* ---- 長條圖：本月通路營收（單一系列 → 全部同色） ------ */
  function renderChannelChart(host) {
    clear(host);
    var data = D.CHANNELS;
    var total = data.reduce(function (s, d) { return s + d.value; }, 0);
    var W = 740, padL = 70, padR = 96, padT = 6, bandH = 46, barH = 22;
    var H = padT * 2 + bandH * data.length;
    var plotW = W - padL - padR;
    var xMax = niceCeil(Math.max.apply(null, data.map(function (d) { return d.value; })));

    var svg = svgEl('svg', {
      class: 'chart', viewBox: '0 0 ' + W + ' ' + H,
      role: 'img', 'aria-label': '本月各通路營收長條圖',
    });

    var tip = el('div', { class: 'tooltip', hidden: 'hidden' });

    data.forEach(function (d, i) {
      var bandTop = padT + i * bandH;
      var y = bandTop + (bandH - barH) / 2;
      var w = (d.value / xMax) * plotW;

      var name = svgEl('text', { class: 'axis-label', x: padL - 12, y: y + barH / 2 + 4, 'text-anchor': 'end' });
      name.textContent = d.name;
      svg.appendChild(name);

      svg.appendChild(svgEl('path', { d: barPath(padL, y, w, barH, 4), fill: 'var(--series-1)' }));

      /* 數值直接標在長條末端外側，不塞在裡面以免被裁切 */
      var val = svgEl('text', { class: 'value-label', x: padL + w + 9, y: y + barH / 2 + 4 });
      val.textContent = wan(d.value) + '（' + (d.value / total * 100).toFixed(1) + '%）';
      svg.appendChild(val);

      var hit = svgEl('rect', { x: padL, y: bandTop, width: plotW + padR - 10, height: bandH, fill: 'transparent' });
      hit.addEventListener('mouseenter', function () {
        tip.hidden = false;
        clear(tip);
        tip.appendChild(el('div', { class: 'tt-label', text: d.name + ' · 占比 ' + (d.value / total * 100).toFixed(1) + '%' }));
        tip.appendChild(el('div', { class: 'tt-value', text: 'NT$ ' + nt(d.value) }));
        tip.style.left = ((padL + w) / W * 100) + '%';
        tip.style.top = (y / H * 100) + '%';
      });
      svg.appendChild(hit);
    });

    /* 基準線 */
    svg.appendChild(svgEl('line', { class: 'axisline', x1: padL, x2: padL, y1: padT, y2: H - padT }));

    svg.addEventListener('mouseleave', function () { tip.hidden = true; });
    host.appendChild(svg);
    host.appendChild(tip);
  }

  /** 圖表的表格替代檢視（淺色模式部分色階低於 3:1，一律提供） */
  function buildTableToggle(btn, host, buildRows) {
    var wrap = el('div', { class: 'table-scroll', hidden: 'hidden', style: 'margin-top:12px' });
    host.parentNode.appendChild(wrap);
    btn.addEventListener('click', function () {
      if (wrap.hidden) {
        clear(wrap);
        wrap.appendChild(buildRows());
        wrap.hidden = false;
        btn.textContent = '隱藏表格';
        btn.setAttribute('aria-expanded', 'true');
      } else {
        wrap.hidden = true;
        btn.textContent = '表格檢視';
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function simpleTable(headers, rows, caption) {
    var table = el('table');
    if (caption) table.appendChild(el('caption', { text: caption }));
    var thead = el('thead');
    thead.appendChild(el('tr', null, headers.map(function (h, i) {
      return el('th', { class: i === 0 ? '' : 'num', text: h });
    })));
    table.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (r) {
      tbody.appendChild(el('tr', null, r.map(function (c, i) {
        return el('td', { class: i === 0 ? '' : 'num', text: c });
      })));
    });
    table.appendChild(tbody);
    return table;
  }

  /* =========================================================
     分頁一：營運總覽
     ========================================================= */

  function renderOverview() {
    var rev = D.MONTHLY_REVENUE;
    var thisMonth = rev[rev.length - 1].value;
    var yoy = (thisMonth - D.LAST_YEAR_SAME_MONTH) / D.LAST_YEAR_SAME_MONTH * 100;

    $('#hero-figure').textContent = wan(thisMonth);
    $('#hero-sub').textContent = 'NT$ ' + nt(thisMonth) + ' · 統計至 ' + D.META.asOf;
    var deltaNode = $('#hero-delta');
    deltaNode.className = 'tile-delta ' + (yoy >= 0 ? 'delta-up' : 'delta-down');
    deltaNode.textContent = (yoy >= 0 ? '▲ ' : '▼ ') + pct(yoy) + '　較去年同期（' + wan(D.LAST_YEAR_SAME_MONTH) + '）';

    /* 統計磚全部由當前資料即時算出 — 改庫存或訂單，數字會跟著變 */
    var avg = state.employees.reduce(function (s, e) { return s + totalScore(e); }, 0) / state.employees.length;
    var avgDelta = avg - D.PREV_PERIOD_AVG;
    var lowStock = state.inventory.filter(function (r) { return r.stock < r.safety; });
    var openOrders = state.orders.filter(function (o) { return o.status === '備貨中' || o.status === '待付款'; });
    var packing = openOrders.filter(function (o) { return o.status === '備貨中'; }).length;
    var unpaid = openOrders.filter(function (o) { return o.status === '待付款'; }).length;
    var stockValue = state.inventory.reduce(function (s, r) { return s + r.stock * r.unitPrice; }, 0);

    var tiles = [
      {
        label: '全體平均績效', value: avg.toFixed(1),
        delta: (avgDelta >= 0 ? '▲ ' : '▼ ') + avgDelta.toFixed(1) + '　較上期（' + D.PREV_PERIOD_AVG.toFixed(1) + '）',
        cls: avgDelta >= 0 ? 'delta-up' : 'delta-down',
      },
      {
        label: '低於安全庫存', value: lowStock.length + ' 項',
        delta: lowStock.length ? '最急：' + lowStock[0].name : '全部品項皆充足',
        cls: lowStock.length ? 'delta-down' : 'delta-up',
      },
      {
        label: '未結案訂單', value: openOrders.length + ' 筆',
        delta: '備貨中 ' + packing + ' · 待付款 ' + unpaid, cls: 'delta-flat',
      },
      {
        label: '庫存總值', value: wan(stockValue),
        delta: '共 ' + state.inventory.length + ' 個品項', cls: 'delta-flat',
      },
    ];

    var host = $('#kpi-tiles');
    clear(host);
    tiles.forEach(function (t) {
      host.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'tile-label', text: t.label }),
        el('div', { class: 'tile-value', text: t.value }),
        el('div', { class: 'tile-delta ' + t.cls, text: t.delta }),
      ]));
    });

    renderRevenueChart($('#chart-revenue'));
    renderChannelChart($('#chart-channel'));
  }

  /* =========================================================
     分頁二：員工績效
     ========================================================= */

  var selectedEmp = null;
  var empSort = { key: 'total', dir: 'desc' };

  function visibleEmployees() {
    var q = $('#emp-search').value.trim().toLowerCase();
    var dept = $('#emp-dept').value;
    var list = state.employees.filter(function (e) {
      if (dept && e.dept !== dept) return false;
      if (!q) return true;
      return (e.name + e.dept + e.role + e.id).toLowerCase().indexOf(q) >= 0;
    });
    var dir = empSort.dir === 'asc' ? 1 : -1;
    list.sort(function (a, b) {
      var av, bv;
      if (empSort.key === 'total') { av = totalScore(a); bv = totalScore(b); }
      else { av = a[empSort.key]; bv = b[empSort.key]; }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return list;
  }

  function renderEmployeeTable() {
    var list = visibleEmployees();
    var tbody = $('#emp-tbody');
    clear(tbody);

    if (!list.length) {
      tbody.appendChild(el('tr', null, [
        el('td', { colspan: '6', class: 'empty-state', text: '找不到符合條件的員工' }),
      ]));
    }

    list.forEach(function (e) {
      var total = totalScore(e);
      var g = gradeOf(total);
      var tr = el('tr', {
        class: 'clickable' + (selectedEmp === e.id ? ' is-active' : ''),
        tabindex: '0', role: 'button',
        'aria-label': e.name + '，總分 ' + total.toFixed(1) + '，等第 ' + g,
      }, [
        el('td', null, [
          el('div', { text: e.name }),
          el('div', { style: 'color:var(--text-muted);font-size:12px', text: e.id + ' · ' + e.role }),
        ]),
        el('td', { text: e.dept }),
        el('td', null, [el('span', { class: 'chip chip-neutral' }, [el('span', { class: 'chip-dot' }), templateOf(e).label])]),
        el('td', { class: 'num', text: total.toFixed(1) }),
        el('td', null, [el('span', { class: 'grade grade-' + g, text: g })]),
        el('td', { style: 'color:var(--text-muted);font-size:12.5px', text: e.hireDate }),
      ]);
      function open() { selectedEmp = e.id; renderEmployeeTable(); renderEmployeeDetail(); }
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
      });
      tbody.appendChild(tr);
    });

    $('#emp-count').textContent = '共 ' + list.length + ' 位';

    /* 等第分布摘要 */
    var dist = { A: 0, B: 0, C: 0, D: 0 };
    state.employees.forEach(function (e) { dist[gradeOf(totalScore(e))]++; });
    $('#emp-dist').textContent = 'A ' + dist.A + ' · B ' + dist.B + ' · C ' + dist.C + ' · D ' + dist.D;
  }

  /* 量表刻度到 130 分，並在 100 分處畫一條目標線，
     否則「剛好達標」看起來只填了 77%，會誤導。 */
  var METER_MAX = 130;

  function meterWidth(score) { return clamp(score / METER_MAX * 100, 2, 100); }

  function meterRow(item, score, raw) {
    return el('div', { class: 'meter-row' }, [
      el('div', { class: 'meter-top' }, [
        el('span', { class: 'meter-name', text: item.name }),
        el('span', { class: 'meter-val', text: score.toFixed(0) }),
      ]),
      el('div', { class: 'meter-track' }, [
        el('div', { class: 'meter-fill', style: 'width:' + meterWidth(score) + '%;background:' + scoreColor(score) }),
        el('div', { class: 'meter-target', title: '目標 100 分' }),
      ]),
      el('div', { class: 'meter-weight', text: '權重 ' + item.weight + '%　' + item.rawLabel + '：' + (raw || '—') }),
    ]);
  }

  function renderEmployeeDetail() {
    var host = $('#emp-detail');
    clear(host);

    var emp = state.employees.filter(function (e) { return e.id === selectedEmp; })[0];
    if (!emp) {
      host.appendChild(el('div', { class: 'empty-state', text: '點選左側任一位員工，檢視評核細項並試著修改分數與評語。' }));
      return;
    }

    var tpl = templateOf(emp);
    var total = totalScore(emp);
    var g = gradeOf(total);

    host.appendChild(el('div', { class: 'detail-head' }, [
      el('div', { class: 'detail-name' }, [emp.name, ' ', el('span', { class: 'grade grade-' + g, text: g })]),
      el('div', { class: 'detail-meta', text: emp.dept + ' · ' + emp.role + ' · 到職 ' + emp.hireDate }),
      el('div', { class: 'detail-meta', text: tpl.label + '評核模板（' + tpl.note + '）' }),
    ]));

    host.appendChild(el('div', { class: 'tile-label', text: '加權總分' }));
    host.appendChild(el('div', { class: 'tile-value', text: total.toFixed(1) }));

    var meters = {};
    tpl.items.forEach(function (it) {
      var row = meterRow(it, emp.scores[it.key] || 0, emp.raw[it.key]);
      meters[it.key] = { val: $('.meter-val', row), fill: $('.meter-fill', row) };
      host.appendChild(row);
    });

    /* 可調整的評分 */
    var form = el('div', { class: 'score-input' });
    form.appendChild(el('div', { style: 'font-weight:620;margin-top:6px', text: '調整評分（0–130）' }));
    tpl.items.forEach(function (it) {
      var out = el('span', { class: 'meter-val', text: String(emp.scores[it.key]) });
      var range = el('input', {
        type: 'range', min: '0', max: '130', step: '1', value: String(emp.scores[it.key]),
        'aria-label': it.name + ' 分數',
      });
      range.addEventListener('input', function () {
        var v = Number(range.value);
        emp.scores[it.key] = v;
        out.textContent = range.value;
        /* 上方量表同步，不整塊重繪，才不會把滑桿的焦點弄丟 */
        var m = meters[it.key];
        m.val.textContent = v.toFixed(0);
        m.fill.style.width = meterWidth(v) + '%';
        m.fill.style.background = scoreColor(v);
        $('#emp-live-total').textContent = totalScore(emp).toFixed(1);
      });
      form.appendChild(el('label', null, [
        el('span', null, [it.name + '（權重 ' + it.weight + '%）　', out]),
        range,
      ]));
    });

    var liveTotal = el('span', { id: 'emp-live-total', text: total.toFixed(1) });
    form.appendChild(el('div', { class: 'detail-meta' }, ['調整後總分：', liveTotal]));

    var comment = el('textarea', { class: 'field', 'aria-label': '主管評語' });
    comment.value = emp.comment;
    form.appendChild(el('label', null, ['主管評語', comment]));

    form.appendChild(el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:4px' }, [
      el('button', {
        class: 'btn btn-primary', type: 'button', text: '儲存評核',
        onclick: function () {
          emp.comment = comment.value;
          saveState();
          renderEmployeeTable();
          renderEmployeeDetail();
          renderOverview();
          toast('已儲存 ' + emp.name + ' 的評核');
        },
      }),
      el('button', {
        class: 'btn', type: 'button', text: '還原此人',
        onclick: function () {
          var orig = D.EMPLOYEES.filter(function (e) { return e.id === emp.id; })[0];
          var idx = state.employees.indexOf(emp);
          state.employees[idx] = deepCopy(orig);
          saveState();
          renderEmployeeTable();
          renderEmployeeDetail();
          renderOverview();
          toast('已還原 ' + orig.name + ' 的原始評核');
        },
      }),
    ]));

    host.appendChild(form);
  }

  function exportEmployees() {
    var rows = [['員工編號', '姓名', '部門', '職務', '評核模板', '加權總分', '等第', '主管評語']];
    visibleEmployees().forEach(function (e) {
      var t = totalScore(e);
      rows.push([e.id, e.name, e.dept, e.role, templateOf(e).label, t.toFixed(1), gradeOf(t), e.comment]);
    });
    downloadCSV('績效評核_' + D.META.asOf + '.csv', rows);
  }

  /* =========================================================
     分頁三：訂單
     ========================================================= */

  var orderSort = { key: 'date', dir: 'desc' };

  function visibleOrders() {
    var q = $('#ord-search').value.trim().toLowerCase();
    var st = $('#ord-status').value;
    var ch = $('#ord-channel').value;
    var list = state.orders.filter(function (o) {
      if (st && o.status !== st) return false;
      if (ch && o.channel !== ch) return false;
      if (!q) return true;
      return (o.id + o.customer + o.item + o.owner).toLowerCase().indexOf(q) >= 0;
    });
    var dir = orderSort.dir === 'asc' ? 1 : -1;
    list.sort(function (a, b) {
      var av = a[orderSort.key], bv = b[orderSort.key];
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return list;
  }

  function renderOrders() {
    var list = visibleOrders();
    var tbody = $('#ord-tbody');
    clear(tbody);

    if (!list.length) {
      tbody.appendChild(el('tr', null, [el('td', { colspan: '7', class: 'empty-state', text: '沒有符合條件的訂單' })]));
    }

    list.forEach(function (o) {
      tbody.appendChild(el('tr', null, [
        el('td', { text: o.id }),
        el('td', { text: o.date }),
        el('td', { text: o.customer }),
        el('td', { text: o.channel }),
        el('td', { text: o.item }),
        el('td', { class: 'num', text: nt(o.amount) }),
        el('td', null, [chip(ORDER_STATUS[o.status] || 'neutral', o.status)]),
      ]));
    });

    var sum = list.filter(function (o) { return o.status !== '已取消'; })
      .reduce(function (s, o) { return s + o.amount; }, 0);
    $('#ord-count').textContent = '共 ' + list.length + ' 筆 · 有效金額 NT$ ' + nt(sum);
  }

  function exportOrders() {
    var rows = [['訂單編號', '日期', '客戶', '通路', '品項', '金額', '狀態', '負責業務']];
    visibleOrders().forEach(function (o) {
      rows.push([o.id, o.date, o.customer, o.channel, o.item, o.amount, o.status, o.owner]);
    });
    downloadCSV('訂單明細_' + D.META.asOf + '.csv', rows);
  }

  function setupOrderForm() {
    var form = $('#ord-form');
    $('#ord-add-toggle').addEventListener('click', function () {
      form.hidden = !form.hidden;
      this.textContent = form.hidden ? '＋ 新增訂單' : '收起表單';
      if (!form.hidden) $('#ord-f-customer').focus();
    });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var customer = $('#ord-f-customer').value.trim();
      var item = $('#ord-f-item').value.trim();
      var amount = Number($('#ord-f-amount').value);
      if (!customer || !item || !(amount > 0)) {
        toast('請填寫客戶、品項，金額需大於 0');
        return;
      }
      var seq = state.orders.length + 143;
      state.orders.unshift({
        id: 'SO-261' + String(seq).padStart(5, '0'),
        date: D.META.asOf,
        customer: customer,
        channel: $('#ord-f-channel').value,
        item: item,
        amount: amount,
        status: $('#ord-f-status').value,
        owner: $('#ord-f-owner').value,
      });
      saveState();
      form.reset();
      renderOrders();
      renderOverview();
      toast('已新增訂單');
    });
  }

  /* =========================================================
     分頁四：茶品庫存
     ========================================================= */

  function visibleInventory() {
    var q = $('#inv-search').value.trim().toLowerCase();
    var onlyLow = $('#inv-low').checked;
    return state.inventory.filter(function (r) {
      if (onlyLow && r.stock >= r.safety) return false;
      if (!q) return true;
      return (r.sku + r.name + r.origin + r.grade + r.lot).toLowerCase().indexOf(q) >= 0;
    });
  }

  function renderInventory() {
    var list = visibleInventory();
    var tbody = $('#inv-tbody');
    clear(tbody);

    if (!list.length) {
      tbody.appendChild(el('tr', null, [el('td', { colspan: '8', class: 'empty-state', text: '沒有符合條件的品項' })]));
    }

    list.forEach(function (r) {
      var lv = stockLevel(r);
      var input = el('input', {
        type: 'number', class: 'field', min: '0', step: '1', value: String(r.stock),
        style: 'width:92px', 'aria-label': r.name + ' 庫存量（公斤）',
      });
      input.addEventListener('change', function () {
        var v = Number(input.value);
        if (!(v >= 0)) { input.value = String(r.stock); return; }
        r.stock = v;
        saveState();
        renderInventory();
        renderOverview();
        toast(r.name + ' 庫存更新為 ' + v + ' kg');
      });

      tbody.appendChild(el('tr', null, [
        el('td', null, [
          el('div', { text: r.name }),
          el('div', { style: 'color:var(--text-muted);font-size:12px', text: r.sku + ' · ' + r.lot }),
        ]),
        el('td', { text: r.origin }),
        el('td', { text: r.grade }),
        el('td', { class: 'num', text: nt(r.stock) }),
        el('td', { class: 'num', text: nt(r.safety) }),
        el('td', { class: 'num', text: nt(r.unitPrice) }),
        el('td', null, [chip(lv.key, lv.label)]),
        el('td', null, [input]),
      ]));
    });

    var value = list.reduce(function (s, r) { return s + r.stock * r.unitPrice; }, 0);
    $('#inv-count').textContent = '共 ' + list.length + ' 項 · 庫存值 NT$ ' + nt(value);
  }

  function exportInventory() {
    var rows = [['SKU', '品名', '產地', '等級', '批號', '庫存(kg)', '安全庫存(kg)', '單價(元/kg)', '庫存值', '狀態']];
    visibleInventory().forEach(function (r) {
      rows.push([r.sku, r.name, r.origin, r.grade, r.lot, r.stock, r.safety, r.unitPrice, r.stock * r.unitPrice, stockLevel(r).label]);
    });
    downloadCSV('茶品庫存_' + D.META.asOf + '.csv', rows);
  }

  /* =========================================================
     分頁切換 / 主題 / 啟動
     ========================================================= */

  function setupTabs() {
    var tabs = $$('.tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) {
          var on = t === tab;
          t.setAttribute('aria-selected', on ? 'true' : 'false');
          $('#' + t.getAttribute('aria-controls')).hidden = !on;
        });
        if (tab.getAttribute('aria-controls') === 'panel-overview') renderOverview();
      });
    });
  }

  function setupTheme() {
    var btn = $('#theme-toggle');
    var saved = null;
    try { saved = localStorage.getItem('teaops-theme'); } catch (e) {}
    if (saved) document.documentElement.setAttribute('data-theme', saved);

    function label() {
      var cur = document.documentElement.getAttribute('data-theme');
      btn.textContent = cur === 'dark' ? '☀ 淺色' : '☾ 深色';
    }
    label();

    btn.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      if (!cur) {
        cur = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      var next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('teaops-theme', next); } catch (e) {}
      label();
      /* 圖表用 CSS 變數上色，但端點外環需要重畫才會吃到新表面色 */
      renderOverview();
    });
  }

  function setupSorting(theadSel, sortObj, rerender) {
    $$(theadSel + ' th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-key');
        if (sortObj.key === key) sortObj.dir = sortObj.dir === 'asc' ? 'desc' : 'asc';
        else { sortObj.key = key; sortObj.dir = 'desc'; }
        $$(theadSel + ' th.sortable').forEach(function (o) { o.removeAttribute('data-dir'); });
        th.setAttribute('data-dir', sortObj.dir);
        rerender();
      });
    });
  }

  function renderAll() {
    renderOverview();
    renderEmployeeTable();
    renderEmployeeDetail();
    renderOrders();
    renderInventory();
  }

  function init() {
    loadState();

    /* 下拉選單選項由資料推導，不寫死 */
    var depts = state.employees.map(function (e) { return e.dept; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; });
    depts.forEach(function (d) { $('#emp-dept').appendChild(el('option', { value: d, text: d })); });

    var channels = D.CHANNELS.map(function (c) { return c.name; });
    channels.forEach(function (c) {
      $('#ord-channel').appendChild(el('option', { value: c, text: c }));
      $('#ord-f-channel').appendChild(el('option', { value: c, text: c }));
    });
    Object.keys(ORDER_STATUS).forEach(function (s) {
      $('#ord-status').appendChild(el('option', { value: s, text: s }));
      $('#ord-f-status').appendChild(el('option', { value: s, text: s }));
    });
    state.employees.forEach(function (e) {
      $('#ord-f-owner').appendChild(el('option', { value: e.name, text: e.name }));
    });

    setupTabs();
    setupTheme();
    setupOrderForm();

    $('#emp-search').addEventListener('input', renderEmployeeTable);
    $('#emp-dept').addEventListener('change', renderEmployeeTable);
    $('#emp-export').addEventListener('click', exportEmployees);
    setupSorting('#emp-thead', empSort, renderEmployeeTable);

    $('#ord-search').addEventListener('input', renderOrders);
    $('#ord-status').addEventListener('change', renderOrders);
    $('#ord-channel').addEventListener('change', renderOrders);
    $('#ord-export').addEventListener('click', exportOrders);
    setupSorting('#ord-thead', orderSort, renderOrders);

    $('#inv-search').addEventListener('input', renderInventory);
    $('#inv-low').addEventListener('change', renderInventory);
    $('#inv-export').addEventListener('click', exportInventory);

    $('#reset-demo').addEventListener('click', resetState);

    buildTableToggle($('#revenue-table-btn'), $('#chart-revenue'), function () {
      return simpleTable(['月份', '營收（元）'],
        D.MONTHLY_REVENUE.map(function (d) { return [d.month + (d.note ? '（' + d.note + '）' : ''), nt(d.value)]; }),
        '近 12 個月營收');
    });
    buildTableToggle($('#channel-table-btn'), $('#chart-channel'), function () {
      var total = D.CHANNELS.reduce(function (s, c) { return s + c.value; }, 0);
      return simpleTable(['通路', '營收（元）', '占比'],
        D.CHANNELS.map(function (c) { return [c.name, nt(c.value), (c.value / total * 100).toFixed(1) + '%']; }),
        '本月各通路營收');
    });

    $('#period-label').textContent = D.META.period;
    renderAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
