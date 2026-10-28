/* ===========================================================
   長信名茶 內部管理與績效系統 — Demo
   傳統 script（非 ES module），file:// 直接開也能運作。

   三個重點：
   1. 權限分級   身分存在 sessionStorage，所以同一瀏覽器的不同分頁可以是不同人
   2. 評核流程   自評 → 主管評核 → 複核 → 定版（+ 申訴退回），每步留稽核軌跡
   3. 多人同時用 共用資料存 localStorage 當「伺服器」，存檔時比對版本號，
                 跨分頁用 BroadcastChannel 即時同步並顯示線上名單
   4. 資料表     每筆訂單／茶品有單筆表單頁：關聯資料、欄位級版本紀錄、留言；
                 另有簽核流程、樞紐報表、全文檢索、CSV 匯入、出貨單列印
   =========================================================== */
(function () {
  'use strict';

  var D = window.DEMO;
  var STORE_KEY = 'teaops-demo-v4';
  var SESSION_KEY = 'teaops-session-v3';
  var THEME_KEY = 'teaops-theme';
  var AUTH_KEY = 'teaops-auth-v1';          // 失敗次數與登入稽核（跨分頁共用）
  var REMEMBER_KEY = 'teaops-remember-user';
  var TAB_ID = Math.random().toString(36).slice(2, 9);

  /* =========================================================
     小工具
     ========================================================= */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function nt(n) { return Math.round(n).toLocaleString('en-US'); }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  /** 以「萬」為單位，台灣財務報表習慣 */
  function wan(n) {
    var v = n / 10000;
    if (Math.abs(v) >= 1000) return (v / 10000).toFixed(2) + '億';
    if (Math.abs(v) >= 100) return Math.round(v) + '萬';
    return v.toFixed(1) + '萬';
  }

  function pct(n, digits) { return (n >= 0 ? '+' : '') + n.toFixed(digits === undefined ? 1 : digits) + '%'; }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function nowStamp() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /** CSV 下載。加 BOM，Excel 開中文才不會變亂碼。 */
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

  /* =========================================================
     共用資料（localStorage 當「伺服器」）
     ========================================================= */

  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

  function defaultState() {
    var employees = D.EMPLOYEES.map(function (base) {
      var cyc = D.CYCLE_STATE[base.id] || {};
      var seed = D.AUDIT_SEED[base.id] || [];
      var emp = deepCopy(base);
      emp.status = cyc.status || 'self';
      emp.selfScores = cyc.selfScores ? deepCopy(cyc.selfScores) : null;
      emp.selfComment = cyc.selfComment || '';
      emp.reviewNote = cyc.reviewNote || '';
      emp.appealReason = cyc.appealReason || '';
      emp.history = seed.map(function (h) {
        return { ts: h[0], actor: h[1], action: h[2], from: h[3], to: h[4], note: h[5] };
      });
      var lastSeed = seed[seed.length - 1];
      emp.version = 1;
      emp.updatedBy = lastSeed ? lastSeed[1] : '系統匯入';
      emp.updatedAt = lastSeed ? lastSeed[0] : '2026-10-01 09:00';
      return emp;
    });
    return {
      employees: employees, orders: deepCopy(D.ORDERS.concat(D.ORDER_ARCHIVE)), inventory: deepCopy(D.INVENTORY),
      approvals: deepCopy(D.APPROVALS), recordLog: deepCopy(D.RECORD_LOG), comments: deepCopy(D.COMMENTS),
    };
  }

  var state = defaultState();

  function readShared() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var saved = JSON.parse(raw);
      if (saved && saved.employees && saved.orders && saved.inventory && saved.approvals && saved.recordLog && saved.comments) return saved;
    } catch (e) { /* 無痕模式或封鎖 storage */ }
    return null;
  }

  function loadState() {
    var shared = readShared();
    if (shared) state = shared;
  }

  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { /* 寫不進去不影響瀏覽，只是重整後會回到預設 */ }
    if (currentUser()) renderNotifBadge();   // 任何資料異動都可能改變待辦數
  }

  function resetState() {
    state = defaultState();
    saveState();
    var auth = readAuth();
    auth.accounts = {};
    auth.fails = {};
    writeAuth(auth);
    var sess = getSession();
    if (sess) { sess.pwv = 0; setSession(sess); }
    conflict = null;
    detailDraft = null;
    selectedEmp = null;
    selectedAp = null;
    ordSelected = {};
    closeDrawer();
    broadcast({ type: 'data', by: currentUser() ? currentUser().name : '系統', note: '還原示範資料', target: '全部資料' });
    renderAll();
    toast('已還原為原始示範資料');
  }

  /* =========================================================
     身分（sessionStorage：每個分頁可以是不同人）
     ========================================================= */

  var memorySession = null;   // sessionStorage 被封鎖時的退路

  function getSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { return memorySession; }
    return memorySession;
  }

  function setSession(s) {
    memorySession = s;
    try {
      if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (e) { /* 只存在記憶體，重整會要求重新選身分 */ }
  }

  /* =========================================================
     登入驗證
     1. 密碼以 PBKDF2-SHA256 + 鹽值比對，常數時間比較
     2. 錯誤訊息不區分「帳號不存在」與「密碼錯誤」，避免帳號被列舉
     3. 同一帳號連錯 5 次鎖定 5 分鐘
     4. 主管以上強制兩步驟驗證，驗證碼 5 分鐘失效、最多試 3 次
     5. 閒置 15 分鐘自動登出（前 1 分鐘警告），登入滿 8 小時強制重新登入
     6. 所有事件寫入稽核紀錄
     ========================================================= */

  var AUTH = {
    maxFails: 5, lockMs: 5 * 60e3,
    otpMs: 5 * 60e3, otpTries: 3, resendMs: 30e3,
    idleMs: 15 * 60e3, warnMs: 60e3, absoluteMs: 8 * 3600e3,
  };
  /* 帳號不存在時也跑一次雜湊，讓回應時間一致 */
  var DUMMY_SALT = '00000000000000000000000000000000';
  var AUTH_EVENTS = {
    success:   { label: '登入成功',   chip: 'good' },
    fail:      { label: '登入失敗',   chip: 'serious' },
    locked:    { label: '帳號鎖定',   chip: 'critical' },
    'mfa-sent':{ label: '傳送驗證碼', chip: 'neutral' },
    'mfa-fail':{ label: '驗證碼錯誤', chip: 'warning' },
    logout:    { label: '登出',       chip: 'neutral' },
    timeout:   { label: '逾時登出',   chip: 'warning' },
    unlock:    { label: '解除鎖定',   chip: 'good' },
    forced:    { label: '強制登出',   chip: 'warning' },
    disabled:  { label: '停用帳號登入', chip: 'critical' },
    'pw-change':    { label: '變更密碼', chip: 'good' },
    'pw-reset':     { label: '重設密碼', chip: 'warning' },
    'acct-disable': { label: '停用帳號', chip: 'serious' },
    'acct-enable':  { label: '啟用帳號', chip: 'good' },
  };
  var pendingMfa = null;

  function stampSec() {
    var d = new Date();
    return nowStamp() + ':' + pad2(d.getSeconds());
  }

  function readAuth() {
    try {
      var a = JSON.parse(localStorage.getItem(AUTH_KEY));
      if (a && a.fails && a.log) { a.accounts = a.accounts || {}; return a; }
    } catch (e) {}
    return { fails: {}, log: [], accounts: {} };
  }
  function writeAuth(a) {
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch (e) {}
  }

  function authLog(event, username, empId, detail) {
    var a = readAuth();
    a.log.unshift({ at: stampSec(), event: event, username: username, empId: empId || null, detail: detail || '' });
    a.log = a.log.slice(0, 200);
    writeAuth(a);
    broadcast({ type: 'auth' });
  }

  function lockedUntil(username) {
    var f = readAuth().fails[username];
    return f && f.until > Date.now() ? f.until : 0;
  }
  function lockMsg(until) {
    var min = Math.ceil((until - Date.now()) / 60e3);
    return '此帳號因多次登入失敗已暫時鎖定，請 ' + min + ' 分鐘後再試，或聯繫系統管理員解除。';
  }

  function hexToBytes(h) {
    var a = new Uint8Array(h.length / 2);
    for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16);
    return a;
  }
  function bytesToHex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function pbkdf2(password, saltHex) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
      .then(function (key) {
        return crypto.subtle.deriveBits(
          { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations: D.AUTH_ITERATIONS }, key, 256);
      })
      .then(bytesToHex);
  }
  /** 常數時間比較，不因第一個不同的字元就提早返回 */
  function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    var r = 0;
    for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  }
  /** 帳號 = 種子資料 + 管理員異動（停用、重設密碼、使用者自行改密碼） */
  function getAccount(empId) {
    if (!D.ACCOUNTS[empId]) return null;
    return Object.assign({}, D.ACCOUNTS[empId], readAuth().accounts[empId] || {});
  }
  function updateAccount(empId, patch) {
    var a = readAuth();
    a.accounts[empId] = Object.assign(a.accounts[empId] || {}, patch);
    writeAuth(a);
  }
  function findAccount(username) {
    var ids = Object.keys(D.ACCOUNTS);
    for (var i = 0; i < ids.length; i++) {
      var acct = getAccount(ids[i]);
      if (acct.username === username) return { empId: ids[i], acct: acct };
    }
    return null;
  }
  function lastLoginOf(empId) {
    var at = null;
    readAuth().log.some(function (r) {
      if (r.event === 'success' && r.empId === empId) { at = r.at; return true; }
      return false;
    });
    return at;
  }
  function randomHex(bytes) { return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes))); }

  function showAuthError(id, msg) {
    var n = $(id);
    n.textContent = msg || '';
    n.hidden = !msg;
  }
  function showNotice(msg) {
    var n = $('#auth-notice');
    n.textContent = msg || '';
    n.hidden = !msg;
  }
  function setBusy(busy) {
    var b = $('#lg-submit');
    b.disabled = busy;
    b.classList.toggle('is-busy', busy);
    b.querySelector('.btn-label').textContent = busy ? '驗證中…' : '登入';
  }

  function onPasswordSubmit(ev) {
    ev.preventDefault();
    var username = $('#lg-user').value.trim().toLowerCase();
    var password = $('#lg-pass').value;
    showNotice('');
    if (!username || !password) { showAuthError('#lg-error', '請輸入帳號與密碼'); return; }
    if (!(window.crypto && crypto.subtle)) {
      showAuthError('#lg-error', '這個瀏覽器環境不支援安全雜湊（需 HTTPS），請改用線上版開啟。');
      return;
    }
    var until = lockedUntil(username);
    if (until) {
      authLog('locked', username, null, '鎖定期間嘗試登入');
      showAuthError('#lg-error', lockMsg(until));
      return;
    }
    showAuthError('#lg-error', '');
    setBusy(true);
    var hit = findAccount(username);
    pbkdf2(password, hit ? hit.acct.salt : DUMMY_SALT).then(function (hash) {
      setBusy(false);
      if (!hit || !safeEqual(hash, hit.acct.hash)) { registerFail(username, hit); return; }
      if (hit.acct.disabled) {
        authLog('disabled', username, hit.empId, '已停用的帳號嘗試登入');
        showAuthError('#lg-error', '此帳號已停用，請聯繫系統管理員。');
        return;
      }

      var a = readAuth();
      delete a.fails[username];
      writeAuth(a);
      try {
        if ($('#lg-remember').checked) localStorage.setItem(REMEMBER_KEY, username);
        else localStorage.removeItem(REMEMBER_KEY);
      } catch (e) {}

      if (hit.acct.mfa) startMfa(hit.empId, username);
      else completeLogin(hit.empId, username, false);
    }, function () {
      setBusy(false);
      showAuthError('#lg-error', '驗證服務暫時無法使用，請稍後再試。');
    });
  }

  function registerFail(username, hit) {
    var a = readAuth();
    var f = a.fails[username] || { count: 0, until: 0 };
    f.count += 1;
    var msg = '帳號或密碼錯誤';
    var locked = false;
    if (f.count >= AUTH.maxFails) {
      f.until = Date.now() + AUTH.lockMs;
      f.count = 0;
      locked = true;
      msg = lockMsg(f.until);
    } else if (AUTH.maxFails - f.count <= 2) {
      msg += '。再錯 ' + (AUTH.maxFails - f.count) + ' 次，帳號將暫時鎖定。';
    }
    a.fails[username] = f;
    writeAuth(a);
    authLog(locked ? 'locked' : 'fail', username, hit ? hit.empId : null,
      (hit ? '密碼錯誤' : '帳號不存在') + (locked ? '，連續失敗 ' + AUTH.maxFails + ' 次' : ''));
    showAuthError('#lg-error', msg);
    $('#lg-pass').value = '';
    $('#lg-pass').focus();
  }

  /* ---- 兩步驟驗證：Demo 沒有簡訊閘道，驗證碼顯示在「模擬手機」區塊 ---- */
  function newOtp() {
    var n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
    return ('00000' + n).slice(-6);
  }
  function maskedPhone(empId) {
    return '09●● ●●● ' + (300 + Number(empId.slice(1)) * 37);
  }

  function startMfa(empId, username) {
    pendingMfa = { empId: empId, username: username, code: newOtp(), exp: Date.now() + AUTH.otpMs, tries: 0, sentAt: Date.now() };
    authLog('mfa-sent', username, empId, '簡訊驗證碼至 ' + maskedPhone(empId));
    $('#step-password').hidden = true;
    $('#step-mfa').hidden = false;
    $('#mfa-sub').textContent = '驗證碼已傳送至 ' + maskedPhone(empId) + '，請在 5 分鐘內輸入。';
    $('#mfa-code').value = '';
    showAuthError('#mfa-error', '');
    renderSms();
    tickMfa();
    $('#mfa-code').focus();
  }

  function renderSms() {
    var body = $('#sms-body');
    clear(body);
    if (!pendingMfa) return;
    body.appendChild(document.createTextNode('【長信名茶】您的登入驗證碼為 '));
    body.appendChild(el('strong', { text: pendingMfa.code }));
    body.appendChild(document.createTextNode('，5 分鐘內有效。請勿將驗證碼提供給任何人。'));
  }

  function tickMfa() {
    if (!pendingMfa || $('#step-mfa').hidden) return;
    var left = pendingMfa.exp - Date.now();
    $('#mfa-exp').textContent = left > 0
      ? '剩餘 ' + Math.floor(left / 60e3) + ':' + pad2(Math.floor(left % 60e3 / 1000))
      : '驗證碼已失效';
    var wait = AUTH.resendMs - (Date.now() - pendingMfa.sentAt);
    var rb = $('#mfa-resend');
    rb.disabled = wait > 0;
    rb.textContent = wait > 0 ? '重新傳送（' + Math.ceil(wait / 1000) + '）' : '重新傳送';
  }

  function onMfaSubmit(ev) {
    ev.preventDefault();
    if (!pendingMfa) return;
    var code = $('#mfa-code').value.trim();
    if (!/^\d{6}$/.test(code)) { showAuthError('#mfa-error', '請輸入 6 位數字'); return; }
    if (Date.now() > pendingMfa.exp) { showAuthError('#mfa-error', '驗證碼已失效，請重新傳送'); return; }
    if (!safeEqual(code, pendingMfa.code)) {
      pendingMfa.tries += 1;
      authLog('mfa-fail', pendingMfa.username, pendingMfa.empId, '第 ' + pendingMfa.tries + ' 次');
      var left = AUTH.otpTries - pendingMfa.tries;
      if (left <= 0) {
        backToPassword('驗證失敗次數過多，請重新登入。');
        return;
      }
      showAuthError('#mfa-error', '驗證碼錯誤，還可再試 ' + left + ' 次');
      $('#mfa-code').select();
      return;
    }
    completeLogin(pendingMfa.empId, pendingMfa.username, true);
  }

  function backToPassword(notice) {
    pendingMfa = null;
    $('#step-mfa').hidden = true;
    $('#step-password').hidden = false;
    $('#lg-pass').value = '';
    showAuthError('#lg-error', '');
    showNotice(notice || '');
    $('#lg-user').focus();
  }

  function completeLogin(empId, username, viaMfa) {
    pendingMfa = null;
    if (getAccount(empId).mustChange) {
      openPwModal({
        forced: true, empId: empId, username: username,
        done: function () { finishLogin(empId, username, viaMfa); },
      });
      return;
    }
    finishLogin(empId, username, viaMfa);
  }

  function finishLogin(empId, username, viaMfa) {
    var last = lastLoginOf(empId);
    authLog('success', username, empId, viaMfa ? '密碼 + 兩步驟驗證' : '密碼');
    login(empId, { mfa: viaMfa, lastLogin: last, pwv: getAccount(empId).pwChangedAt || 0 });
  }

  /* ---- 密碼政策與變更（首次登入強制、使用者自行變更共用同一個表單） ---- */
  var PW_RULES = [
    { label: '至少 10 個字元',          test: function (p) { return p.length >= 10; } },
    { label: '包含大寫英文字母',        test: function (p) { return /[A-Z]/.test(p); } },
    { label: '包含小寫英文字母',        test: function (p) { return /[a-z]/.test(p); } },
    { label: '包含數字',                test: function (p) { return /[0-9]/.test(p); } },
    { label: '包含符號（例如 ! # @ -）', test: function (p) { return /[^A-Za-z0-9]/.test(p); } },
    { label: '不可包含帳號名稱',        test: function (p, ctx) {
        var low = p.toLowerCase();
        return ctx.username.split('.').every(function (part) { return low.indexOf(part) < 0; });
      } },
  ];
  var pwCtx = null;

  function renderPwRules() {
    var p = $('#pw-new').value;
    var host = $('#pw-rules');
    clear(host);
    var passed = 0;
    PW_RULES.forEach(function (r) {
      var ok = !!p && r.test(p, pwCtx);
      if (ok) passed += 1;
      host.appendChild(el('li', { class: ok ? 'ok' : '' }, [ok ? '✓ ' : '○ ', r.label]));
    });
    var bar = $('#pw-meter-bar');
    bar.style.width = (passed / PW_RULES.length * 100) + '%';
    bar.className = passed === PW_RULES.length ? 'strong' : passed >= 4 ? 'mid' : 'weak';
  }

  function openPwModal(ctx) {
    pwCtx = ctx;
    $('#pw-title').textContent = ctx.forced ? '請設定新密碼' : '變更密碼';
    $('#pw-desc').textContent = ctx.forced
      ? '管理員已為你重設密碼。為了安全，請先設定只有你知道的新密碼才能繼續使用系統。'
      : '變更後，其他已登入的分頁會被要求重新登入。';
    $('#pw-current-wrap').hidden = !!ctx.forced;
    $('#pw-cancel').textContent = ctx.forced ? '取消登入' : '取消';
    $('#pw-username').value = ctx.username;
    ['#pw-current', '#pw-new', '#pw-confirm'].forEach(function (id) { $(id).value = ''; });
    showAuthError('#pw-error', '');
    renderPwRules();
    $('#pw-modal').hidden = false;
    (ctx.forced ? $('#pw-new') : $('#pw-current')).focus();
  }

  function closePwModal() {
    $('#pw-modal').hidden = true;
    pwCtx = null;
  }

  function onPwSubmit(ev) {
    ev.preventDefault();
    var ctx = pwCtx;
    if (!ctx) return;
    var acct = getAccount(ctx.empId);
    var nw = $('#pw-new').value;
    var failed = PW_RULES.filter(function (r) { return !r.test(nw, ctx); });
    if (failed.length) { showAuthError('#pw-error', '新密碼不符合規則：' + failed[0].label); return; }
    if (nw !== $('#pw-confirm').value) { showAuthError('#pw-error', '兩次輸入的新密碼不一致'); return; }

    var btn = $('#pw-submit');
    btn.disabled = true;
    var checkCurrent = ctx.forced
      ? Promise.resolve(true)
      : pbkdf2($('#pw-current').value, acct.salt).then(function (h) { return safeEqual(h, acct.hash); });

    checkCurrent.then(function (ok) {
      if (!ok) { showAuthError('#pw-error', '目前密碼不正確'); return null; }
      return pbkdf2(nw, acct.salt).then(function (same) {
        if (safeEqual(same, acct.hash)) { showAuthError('#pw-error', '新密碼不可與目前密碼相同'); return null; }
        var salt = randomHex(16);
        return pbkdf2(nw, salt).then(function (hash) { return { salt: salt, hash: hash }; });
      });
    }).then(function (r) {
      btn.disabled = false;
      if (!r) return;
      var at = Date.now();
      updateAccount(ctx.empId, { salt: r.salt, hash: r.hash, mustChange: false, pwChangedAt: at });
      authLog('pw-change', ctx.username, ctx.empId, ctx.forced ? '重設後首次登入設定新密碼' : '使用者自行變更');
      var sess = getSession();
      if (sess && sess.empId === ctx.empId) { sess.pwv = at; setSession(sess); }
      var done = ctx.done;
      closePwModal();
      toast('密碼已更新');
      if (done) done();
    }, function () {
      btn.disabled = false;
      showAuthError('#pw-error', '更新失敗，請稍後再試');
    });
  }

  function showInfo(title, nodes) {
    $('#info-title').textContent = title;
    var body = $('#info-body');
    clear(body);
    nodes.forEach(function (n) { body.appendChild(n); });
    $('#info-modal').hidden = false;
    $('#info-ok').focus();
  }

  /* ---- 工作階段逾時 ---- */
  function touchSession() {
    var s = getSession();
    if (!s || !$('#idle-modal').hidden) return;    // 警告視窗開著時，只有按「繼續使用」才算數
    if (Date.now() - (s.lastActive || 0) < 5000) return;
    s.lastActive = Date.now();
    setSession(s);
  }

  function checkSession() {
    var s = getSession();
    var modal = $('#idle-modal');
    if (!s) { modal.hidden = true; return; }
    var acct = getAccount(s.empId);
    if (acct && acct.disabled) { logout('forced', '此帳號已被系統管理員停用。'); return; }
    if (acct && (acct.pwChangedAt || 0) !== (s.pwv || 0)) { logout('forced', '密碼已變更，請重新登入。'); return; }
    var now = Date.now();
    if (now - s.loginAt > AUTH.absoluteMs) { logout('timeout', '登入已超過 8 小時，請重新登入。'); return; }
    var idleLeft = AUTH.idleMs - (now - s.lastActive);
    if (idleLeft <= 0) { logout('timeout', '閒置超過 15 分鐘，已自動登出。'); return; }
    if (idleLeft <= AUTH.warnMs) {
      $('#idle-count').textContent = Math.ceil(idleLeft / 1000);
      if (modal.hidden) { modal.hidden = false; $('#idle-stay').focus(); }
    } else {
      modal.hidden = true;
    }
  }

  function auditRows() {
    var q = $('#audit-search').value.trim().toLowerCase();
    var evt = $('#audit-event').value;
    return readAuth().log.filter(function (r) {
      if (evt && r.event !== evt) return false;
      if (!q) return true;
      var emp = r.empId ? byId(state.employees, r.empId) : null;
      return (r.username + (emp ? emp.name : '') + r.detail).toLowerCase().indexOf(q) >= 0;
    });
  }

  function renderAuthAudit() {
    if (!currentUser() || !isAdmin()) return;
    var tbody = $('#auth-tbody');
    clear(tbody);
    var all = auditRows();
    var log = all.slice(0, 100);
    $('#audit-count').textContent = '共 ' + all.length + ' 筆' + (all.length > log.length ? '，顯示最新 100 筆' : '');
    if (!log.length) {
      tbody.appendChild(el('tr', null, [el('td', { colspan: '4', class: 'empty-state', text: '沒有符合條件的紀錄' })]));
    }
    log.forEach(function (r) {
      var ev = AUTH_EVENTS[r.event] || { label: r.event, chip: 'neutral' };
      var emp = r.empId ? byId(state.employees, r.empId) : null;
      tbody.appendChild(el('tr', null, [
        el('td', { class: 'nowrap', text: r.at }),
        el('td', null, [el('div', { text: r.username }), emp ? el('div', { class: 'cell-sub', text: emp.name }) : null]),
        el('td', null, [chip(ev.chip, ev.label)]),
        el('td', { class: 'cell-sub', text: r.detail }),
      ]));
    });
  }

  function exportAudit() {
    var rows = [['時間', '帳號', '姓名', '事件', '說明']];
    auditRows().forEach(function (r) {
      var emp = r.empId ? byId(state.employees, r.empId) : null;
      rows.push([r.at, r.username, emp ? emp.name : '', (AUTH_EVENTS[r.event] || {}).label || r.event, r.detail]);
    });
    downloadCSV('稽核紀錄_' + D.META.asOf + '.csv', rows);
  }

  /* ---- 帳號與權限（管理員） ---- */
  function isAdmin() { return accessOf(currentUser()) === 'admin'; }

  function stampOf(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function tempPassword() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    var r = crypto.getRandomValues(new Uint8Array(10));
    var out = '';
    for (var i = 0; i < r.length; i++) out += chars[r[i] % chars.length];
    return 'Tmp#' + out;
  }

  function resetPassword(empId) {
    var target = getAccount(empId);
    var pw = tempPassword();
    var salt = randomHex(16);
    pbkdf2(pw, salt).then(function (hash) {
      updateAccount(empId, { salt: salt, hash: hash, mustChange: true, pwChangedAt: Date.now() });
      var a = readAuth();
      delete a.fails[target.username];
      writeAuth(a);
      authLog('pw-reset', getSessionUsername(), currentUser().id, '重設 ' + target.username + ' 的密碼，下次登入須變更');
      renderAccounts();
      var code = el('code', { class: 'temp-pw', text: pw });
      showInfo('已重設 ' + target.username + ' 的密碼', [
        el('p', { text: '臨時密碼只會顯示這一次，請透過安全管道交給本人。對方登入後會被要求立刻設定新密碼，目前已登入的工作階段也會被登出。' }),
        el('div', { class: 'temp-pw-row' }, [code, el('button', {
          class: 'btn btn-sm', type: 'button',
          onclick: function () {
            var btn = this;
            if (navigator.clipboard) navigator.clipboard.writeText(pw).then(function () { btn.textContent = '已複製'; }, function () {});
          },
        }, ['複製'])]),
      ]);
    });
  }

  function setDisabled(empId, disabled) {
    var target = getAccount(empId);
    updateAccount(empId, { disabled: disabled });
    authLog(disabled ? 'acct-disable' : 'acct-enable', getSessionUsername(), currentUser().id,
      (disabled ? '停用 ' : '啟用 ') + target.username + (disabled ? '，已登入的工作階段會被登出' : ''));
    renderAccounts();
    toast((disabled ? '已停用 ' : '已啟用 ') + target.username);
  }

  function unlockOne(empId) {
    var target = getAccount(empId);
    var a = readAuth();
    delete a.fails[target.username];
    writeAuth(a);
    authLog('unlock', getSessionUsername(), currentUser().id, '解除 ' + target.username + ' 的鎖定');
    renderAccounts();
    toast('已解除 ' + target.username + ' 的鎖定');
  }

  /** 兩段式確認：第一次按只變色提示，5 秒內再按一次才執行 */
  function armedButton(label, armedLabel, danger, action) {
    var btn = el('button', { class: 'btn btn-sm', type: 'button', text: label });
    btn.addEventListener('click', function () {
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.textContent = armedLabel;
        if (danger) btn.classList.add('btn-danger');
        setTimeout(function () {
          btn.dataset.armed = '';
          btn.textContent = label;
          btn.classList.remove('btn-danger');
        }, 5000);
        return;
      }
      action();
    });
    return btn;
  }

  function renderAccounts() {
    if (!currentUser() || !isAdmin()) return;
    var me = currentUser();
    var auth = readAuth();
    var rows = state.employees.map(function (e) {
      var acct = getAccount(e.id);
      return { e: e, acct: acct, locked: lockedUntil(acct.username) };
    });
    var cutoff = stampOf(Date.now() - 24 * 3600e3);
    var fails24 = auth.log.filter(function (r) { return (r.event === 'fail' || r.event === 'locked') && r.at >= cutoff; }).length;
    var active = rows.filter(function (r) { return !r.acct.disabled; }).length;
    var mfaOn = rows.filter(function (r) { return r.acct.mfa; }).length;
    var lockedN = rows.filter(function (r) { return r.locked; }).length;

    var tiles = $('#acct-tiles');
    clear(tiles);
    [
      { label: '帳號總數', value: rows.length + ' 個', delta: '啟用中 ' + active + ' · 停用 ' + (rows.length - active), cls: 'delta-flat' },
      { label: '兩步驟驗證', value: mfaOn + ' / ' + rows.length, delta: '主管以上強制啟用', cls: 'delta-flat' },
      { label: '鎖定中', value: lockedN + ' 個', delta: lockedN ? '可在下方解除' : '沒有被鎖定的帳號', cls: lockedN ? 'delta-down' : 'delta-up' },
      { label: '24 小時內登入失敗', value: fails24 + ' 次', delta: fails24 >= 5 ? '偏高，建議查看稽核紀錄' : '正常範圍', cls: fails24 >= 5 ? 'delta-down' : 'delta-flat' },
    ].forEach(function (t) {
      tiles.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'tile-label', text: t.label }),
        el('div', { class: 'tile-value', text: t.value }),
        el('div', { class: 'tile-delta ' + t.cls, text: t.delta }),
      ]));
    });

    var tbody = $('#acct-tbody');
    clear(tbody);
    rows.forEach(function (r) {
      var e = r.e, acct = r.acct, self = e.id === me.id;
      var status = acct.disabled ? chip('critical', '已停用')
        : r.locked ? chip('serious', '鎖定中')
        : acct.mustChange ? chip('warning', '待設定新密碼')
        : chip('good', '啟用中');
      var actions = el('div', { class: 'row-actions' }, [
        armedButton('重設密碼', '確定重設？', false, function () { resetPassword(e.id); }),
        self ? null : acct.disabled
          ? el('button', { class: 'btn btn-sm', type: 'button', text: '啟用', onclick: function () { setDisabled(e.id, false); } })
          : armedButton('停用', '確定停用？', true, function () { setDisabled(e.id, true); }),
        r.locked ? el('button', { class: 'btn btn-sm', type: 'button', text: '解除鎖定', onclick: function () { unlockOne(e.id); } }) : null,
      ]);
      tbody.appendChild(el('tr', acct.disabled ? { class: 'row-muted' } : null, [
        el('td', null, [el('div', { text: e.name + (self ? '（你）' : '') }), el('div', { class: 'cell-sub', text: e.dept + ' · ' + e.role })]),
        el('td', null, [el('code', { class: 'mono', text: acct.username })]),
        el('td', null, [el('span', { class: 'access-badge access-' + e.access, text: accessLabel(e.access) })]),
        el('td', { class: acct.mfa ? '' : 'cell-sub', text: acct.mfa ? '已啟用（簡訊）' : '未啟用' }),
        el('td', null, [status]),
        el('td', { class: 'cell-sub nowrap', text: lastLoginOf(e.id) || '尚未登入' }),
        el('td', null, [actions]),
      ]));
    });
  }

  /* ---- 待辦與通知：依身分即時推導，不另存狀態 ---- */
  function buildNotifications() {
    var me = currentUser();
    if (!me) return [];
    var out = [];
    var TEXT = { submitSelf: '請完成本期自評', submitReview: '待你評核', finalize: '待複核定版', reopen: '申訴待處理' };
    state.employees.filter(canSeeEmployee).forEach(function (e) {
      availableActions(e).forEach(function (k) {
        if (!TEXT[k]) return;
        out.push({
          area: 'perf', level: k === 'reopen' ? 'critical' : 'warning',
          text: TEXT[k] + (k === 'submitSelf' ? '' : '：' + e.name),
          sub: e.dept + ' · ' + D.WORKFLOW.states[e.status].label + ' · ' + D.CYCLE.due + ' 截止',
          go: function () { selectedEmp = e.id; goTo('panel-perf'); renderEmployeeTable(); renderEmployeeDetail(); },
        });
      });
    });
    if (canEditInventory()) {
      state.inventory.filter(function (r) { return r.stock < r.safety; })
        .sort(function (a, b) { return a.stock / a.safety - b.stock / b.safety; })
        .forEach(function (r) {
          out.push({
            area: 'inventory', level: r.stock / r.safety < 0.6 ? 'critical' : 'serious',
            text: '庫存低於安全量：' + r.name, sub: '現有 ' + nt(r.stock) + ' kg · 安全庫存 ' + nt(r.safety) + ' kg',
            go: function () { $('#inv-low').checked = true; goTo('panel-inventory'); renderInventory(); },
          });
        });
    }
    myTodoApprovals().forEach(function (a) {
      var step = currentStep(a);
      out.push({
        area: 'approvals', level: 'warning',
        text: '待你簽核：' + apTitle(a), sub: a.id + ' · ' + empNameOf(a.applicant) + ' · NT$ ' + nt(a.amount) + ' · ' + step.label,
        go: function () { selectedAp = a.id; apTab = 'todo'; goTo('panel-approvals'); renderApprovals(); },
      });
    });
    visibleOrdersAll().filter(function (o) { return o.status === '待付款'; }).forEach(function (o) {
      out.push({
        area: 'orders', level: 'neutral',
        text: '待付款：' + o.customer, sub: o.id + ' · NT$ ' + nt(o.amount) + ' · ' + o.owner,
        go: function () { setOrderFilter({ status: '待付款' }); renderViewSelect('b:unpaid'); goTo('panel-orders'); renderOrders(); },
      });
    });
    if (isAdmin()) {
      state.employees.forEach(function (e) {
        var acct = getAccount(e.id);
        if (acct && lockedUntil(acct.username)) {
          out.push({
            area: 'accounts', level: 'critical', text: '帳號鎖定中：' + acct.username, sub: e.name + ' · 連續登入失敗',
            go: function () { goTo('panel-accounts'); },
          });
        }
      });
    }
    return out;
  }

  function renderNotifBadge() {
    var list = buildNotifications();
    var badge = $('#notif-badge');
    badge.textContent = list.length > 99 ? '99+' : String(list.length);
    badge.hidden = !list.length;
    $('#notif-btn').setAttribute('aria-label', '待辦與通知（' + list.length + ' 則）');
    ['perf', 'orders', 'inventory', 'accounts', 'approvals'].forEach(function (k) {
      var n = list.filter(function (x) { return x.area === k; }).length;
      var node = $('#nav-count-' + k);
      if (!node) return;
      node.textContent = String(n);
      node.hidden = !n;
    });
  }

  function renderNotifications() {
    var host = $('#notif-list');
    clear(host);
    var list = buildNotifications();
    if (!list.length) {
      host.appendChild(el('div', { class: 'empty-state', text: '目前沒有待辦事項' }));
      return;
    }
    list.forEach(function (n) {
      host.appendChild(el('button', {
        class: 'menu-item notif-item', type: 'button',
        onclick: function () { closeMenus(); n.go(); },
      }, [
        el('span', { class: 'chip-dot dot-' + n.level }),
        el('span', null, [el('span', { class: 'notif-text', text: n.text }), el('span', { class: 'cell-sub', text: n.sub })]),
      ]));
    });
  }

  /* ---- 導覽、選單 ---- */
  var NAV_GROUP = {
    'panel-overview': '營運', 'panel-orders': '營運', 'panel-inventory': '營運',
    'panel-approvals': '流程與報表', 'panel-reports': '流程與報表',
    'panel-perf': '人資', 'panel-accounts': '系統管理', 'panel-audit': '系統管理',
  };

  function goTo(panelId) {
    var target = null;
    $$('.tab').forEach(function (t) {
      var on = t.getAttribute('aria-controls') === panelId;
      if (on) target = t;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      $('#' + t.getAttribute('aria-controls')).hidden = !on;
    });
    if (target) {
      $('#crumb-group').textContent = NAV_GROUP[panelId];
      $('#crumb-page').textContent = target.querySelector('span').textContent;
    }
    if (panelId === 'panel-overview') renderOverview();
    if (panelId === 'panel-accounts') renderAccounts();
    if (panelId === 'panel-audit') renderAuthAudit();
    if (panelId === 'panel-approvals') renderApprovals();
    if (panelId === 'panel-reports') renderReports();
    closeNav();
    window.scrollTo(0, 0);
  }

  function openNav() {
    $('#sidebar').classList.add('open');
    $('#side-backdrop').hidden = false;
    $('#nav-toggle').setAttribute('aria-expanded', 'true');
  }
  function closeNav() {
    $('#sidebar').classList.remove('open');
    $('#side-backdrop').hidden = true;
    $('#nav-toggle').setAttribute('aria-expanded', 'false');
  }

  function closeMenus() {
    $$('.menu').forEach(function (m) { m.hidden = true; });
    $('#notif-btn').setAttribute('aria-expanded', 'false');
    $('#user-btn').setAttribute('aria-expanded', 'false');
  }

  function setupShell() {
    function bind(btnSel, menuSel, onOpen) {
      var btn = $(btnSel), menu = $(menuSel);
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var willOpen = menu.hidden;
        closeMenus();
        if (!willOpen) return;
        if (onOpen) onOpen();
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
      });
      menu.addEventListener('click', function (ev) {
        if (!ev.target.closest('.menu-item')) ev.stopPropagation();
      });
    }
    bind('#notif-btn', '#notif-panel', renderNotifications);
    bind('#user-btn', '#user-menu');
    document.addEventListener('click', closeMenus);
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      closeMenus();
      closeNav();
      if (!$('#info-modal').hidden) $('#info-modal').hidden = true;
      if (pwCtx && !pwCtx.forced) closePwModal();
    });
    $('#nav-toggle').addEventListener('click', openNav);
    $('#side-backdrop').addEventListener('click', closeNav);
    $('#menu-password').addEventListener('click', function () {
      openPwModal({ forced: false, empId: currentUser().id, username: getSessionUsername() });
    });
    $('#menu-theme').addEventListener('click', function () { $('#theme-toggle').click(); });

    $('#pw-form').addEventListener('submit', onPwSubmit);
    $('#pw-new').addEventListener('input', renderPwRules);
    $('#pw-cancel').addEventListener('click', function () {
      var forced = pwCtx && pwCtx.forced;
      closePwModal();
      if (forced) backToPassword('已取消登入。');
    });
    $('#info-ok').addEventListener('click', function () { $('#info-modal').hidden = true; });

    Object.keys(AUTH_EVENTS).forEach(function (k) {
      $('#audit-event').appendChild(el('option', { value: k, text: AUTH_EVENTS[k].label }));
    });
    $('#audit-search').addEventListener('input', renderAuthAudit);
    $('#audit-event').addEventListener('change', renderAuthAudit);
    $('#audit-export').addEventListener('click', exportAudit);
  }

  function getSessionUsername() {
    var me = currentUser();
    return me && D.ACCOUNTS[me.id] ? D.ACCOUNTS[me.id].username : '';
  }

  function setupAuth() {
    $('#step-password').addEventListener('submit', onPasswordSubmit);
    $('#step-mfa').addEventListener('submit', onMfaSubmit);
    $('#mfa-back').addEventListener('click', function () { backToPassword(''); });
    $('#mfa-resend').addEventListener('click', function () {
      if (!pendingMfa) return;
      pendingMfa.code = newOtp();
      pendingMfa.exp = Date.now() + AUTH.otpMs;
      pendingMfa.sentAt = Date.now();
      pendingMfa.tries = 0;
      authLog('mfa-sent', pendingMfa.username, pendingMfa.empId, '重新傳送');
      renderSms();
      tickMfa();
      showAuthError('#mfa-error', '');
      toast('已重新傳送驗證碼');
    });
    $('#mfa-code').addEventListener('input', function () {
      this.value = this.value.replace(/\D/g, '').slice(0, 6);
    });

    $('#pw-toggle').addEventListener('click', function () {
      var input = $('#lg-pass');
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      this.textContent = show ? '隱藏' : '顯示';
      this.setAttribute('aria-pressed', String(show));
      this.setAttribute('aria-label', show ? '隱藏密碼' : '顯示密碼');
      input.focus();
    });
    function caps(ev) {
      if (ev.getModifierState) $('#caps-hint').hidden = !ev.getModifierState('CapsLock');
    }
    $('#lg-pass').addEventListener('keydown', caps);
    $('#lg-pass').addEventListener('keyup', caps);
    $('#lg-pass').addEventListener('blur', function () { $('#caps-hint').hidden = true; });

    $('#forgot-btn').addEventListener('click', function () {
      showNotice('密碼重設需由系統管理員（行政 · 王美玲）核對身分後處理。為了安全，系統不提供自助重設。');
    });

    try {
      var remembered = localStorage.getItem(REMEMBER_KEY);
      if (remembered) { $('#lg-user').value = remembered; $('#lg-remember').checked = true; }
    } catch (e) {}

    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (t) {
      document.addEventListener(t, touchSession, { passive: true });
    });
    $('#idle-stay').addEventListener('click', function () {
      var s = getSession();
      if (s) { s.lastActive = Date.now(); setSession(s); }
      $('#idle-modal').hidden = true;
    });
    $('#idle-logout').addEventListener('click', function () { logout('logout'); });

    setInterval(function () { checkSession(); tickMfa(); }, 1000);
  }

  function currentUser() {
    var s = getSession();
    return s ? byId(state.employees, s.empId) : null;
  }

  function accessOf(user) { return (user && user.access) || 'staff'; }
  function accessLabel(key) { return (D.ACCESS_LEVELS[key] || {}).label || key; }

  /* =========================================================
     權限
     ========================================================= */

  function canSeeEmployee(e) {
    var me = currentUser();
    if (!me) return false;
    if (accessOf(me) === 'admin') return true;
    if (accessOf(me) === 'manager') return e.dept === me.managesDept || e.id === me.id;
    return e.id === me.id;
  }

  /** 是不是這個人的評核者。刻意排除自己 —— 沒有人可以評自己。 */
  function isEvaluatorOf(e) {
    var me = currentUser();
    if (!me || e.id === me.id) return false;
    if (accessOf(me) === 'admin') return true;
    return accessOf(me) === 'manager' && e.dept === me.managesDept;
  }

  /** 員工在定版前看不到主管給的分數，這是刻意的。 */
  function canSeeManagerScores(e) {
    var me = currentUser();
    if (!me) return false;
    if (accessOf(me) === 'admin' || isEvaluatorOf(e)) return true;
    return e.status === 'final' || e.status === 'appeal';
  }

  function canSeeCompanyFigures() { return accessOf(currentUser()) !== 'staff'; }
  function canEditInventory() { return accessOf(currentUser()) !== 'staff'; }

  function canDoAction(key, e) {
    var a = D.WORKFLOW.actions[key];
    var me = currentUser();
    if (!a || !me || e.status !== a.from) return false;
    if (a.by === 'owner') return e.id === me.id;
    if (a.by === 'manager') return isEvaluatorOf(e);
    if (a.by === 'admin') return accessOf(me) === 'admin';
    return false;
  }

  function availableActions(e) {
    return Object.keys(D.WORKFLOW.actions).filter(function (k) { return canDoAction(k, e); });
  }

  /* 哪些欄位現在可以編輯 */
  function canEditSelf(e) { var me = currentUser(); return !!me && e.id === me.id && e.status === 'self'; }
  function canEditManagerScores(e) { return isEvaluatorOf(e) && (e.status === 'manager'); }
  function canEditReviewNote(e) { return accessOf(currentUser()) === 'admin' && e.status === 'review'; }
  function canEditAppeal(e) { var me = currentUser(); return !!me && e.id === me.id && e.status === 'final'; }

  /* =========================================================
     績效計算
     ========================================================= */

  function templateOf(emp) { return D.TEMPLATES[emp.template]; }

  function weightedTotal(emp, scores) {
    var src = scores || emp.scores;
    return templateOf(emp).items.reduce(function (sum, it) {
      return sum + (src[it.key] || 0) * it.weight;
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

  var STATUS_RANK = { self: 0, manager: 1, review: 2, appeal: 3, final: 4 };

  /* =========================================================
     庫存與訂單狀態
     ========================================================= */

  var STOCK_LEVELS = [
    { max: 0.6, key: 'critical', label: '急需補貨' },
    { max: 1.0, key: 'serious', label: '低於安全量' },
    { max: 1.3, key: 'warning', label: '接近下限' },
    { max: Infinity, key: 'good', label: '庫存充足' },
  ];

  function stockLevel(row) {
    var ratio = row.safety > 0 ? row.stock / row.safety : 2;
    for (var i = 0; i < STOCK_LEVELS.length; i++) if (ratio < STOCK_LEVELS[i].max) return STOCK_LEVELS[i];
    return STOCK_LEVELS[STOCK_LEVELS.length - 1];
  }

  function chip(levelKey, label) {
    return el('span', { class: 'chip chip-' + levelKey }, [el('span', { class: 'chip-dot' }), label]);
  }

  function statusChip(status) {
    var st = D.WORKFLOW.states[status];
    return chip(st ? st.chip : 'neutral', st ? st.label : status);
  }

  var ORDER_STATUS = { '已出貨': 'good', '備貨中': 'warning', '待付款': 'serious', '已取消': 'neutral' };

  /* =========================================================
     跨分頁同步與線上名單
     ========================================================= */

  var channel = null;
  try { channel = new BroadcastChannel('teaops-demo'); } catch (e) { channel = null; }
  var peers = {};

  function broadcast(msg) {
    msg.tabId = TAB_ID;
    if (channel) { try { channel.postMessage(msg); } catch (e) {} }
  }

  function announce(isReply) {
    var me = currentUser();
    if (!me) return;
    broadcast({ type: 'hello', reply: !!isReply, name: me.name, access: accessOf(me) });
  }

  function renderPresence() {
    var node = $('#presence');
    if (!node) return;
    var now = Date.now();
    Object.keys(peers).forEach(function (k) { if (now - peers[k].ts > 11000) delete peers[k]; });
    var list = Object.keys(peers).map(function (k) { return peers[k]; });
    if (!list.length) {
      node.textContent = '';
      node.title = '目前只有這個分頁在線';
      return;
    }
    node.textContent = '👥 同時在線 ' + list.length;
    node.title = list.map(function (p) { return p.name + '（' + accessLabel(p.access) + '）'; }).join('、');
  }

  if (channel) {
    channel.onmessage = function (ev) {
      var msg = ev.data || {};
      if (msg.tabId === TAB_ID) return;
      if (msg.type === 'auth') { renderAuthAudit(); renderAccounts(); renderNotifBadge(); return; }
      if (msg.type === 'hello') {
        peers[msg.tabId] = { name: msg.name, access: msg.access, ts: Date.now() };
        if (!msg.reply) announce(true);
        renderPresence();
      } else if (msg.type === 'bye') {
        delete peers[msg.tabId];
        renderPresence();
      } else if (msg.type === 'data') {
        loadState();
        renderAll();
        toast(msg.by + ' 剛更新了「' + msg.target + '」：' + msg.note);
      }
    };
  } else {
    /* 沒有 BroadcastChannel 的瀏覽器，退回 storage 事件（只能同步資料，沒有線上名單） */
    window.addEventListener('storage', function (ev) {
      if (ev.key !== STORE_KEY) return;
      loadState();
      renderAll();
      toast('其他分頁更新了資料，已同步');
    });
  }

  window.addEventListener('pagehide', function () { broadcast({ type: 'bye' }); });

  /* =========================================================
     帶版本檢查的寫入（樂觀鎖）
     ========================================================= */

  var conflict = null;   // { empId, theirs, myVersion }

  /**
   * 寫回一筆員工資料。存檔前重讀共用資料比對版本號：
   * 別人在我開啟之後改過，就不覆蓋，改成跳衝突讓人決定。
   */
  function commitEmployee(empId, openedVersion, mutate, audit, force) {
    var shared = readShared();
    if (shared) {
      var cur = byId(shared.employees, empId);
      if (cur && !force && cur.version !== openedVersion) {
        state = shared;
        conflict = { empId: empId, theirs: cur, myVersion: openedVersion };
        renderEmployeeTable();
        renderEmployeeDetail();
        return false;
      }
      state = shared;   // 沒衝突也要用最新的，免得蓋掉別人改的其他筆
    }

    var emp = byId(state.employees, empId);
    if (!emp) return false;

    mutate(emp);
    emp.version = (emp.version || 1) + 1;
    emp.updatedBy = currentUser().name;
    emp.updatedAt = nowStamp();
    if (audit) {
      emp.history.push({
        ts: emp.updatedAt, actor: currentUser().name, action: audit.action,
        from: audit.from || null, to: audit.to || null, note: audit.note,
        snapshot: audit.snapshot || null,
      });
    }

    saveState();
    conflict = null;
    broadcast({ type: 'data', by: currentUser().name, note: audit ? audit.note : '更新評核', target: emp.name });
    return true;
  }

  function commitSimple(mutate, note, target) {
    var shared = readShared();
    if (shared) state = shared;
    mutate(state);
    saveState();
    broadcast({ type: 'data', by: currentUser().name, note: note, target: target });
  }

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
    return 'M' + x + ',' + y + 'H' + (x2 - r) + 'A' + r + ',' + r + ' 0 0 1 ' + x2 + ',' + (y + r) +
      'V' + (y + h - r) + 'A' + r + ',' + r + ' 0 0 1 ' + (x2 - r) + ',' + (y + h) + 'H' + x + 'Z';
  }

  function niceCeil(v) {
    if (v <= 0) return 1;
    var mag = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * mag >= v) return steps[i] * mag;
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

    var x = function (i) { return padL + (i / (data.length - 1)) * plotW; };
    var y = function (v) { return padT + plotH - (v / yMax) * plotH; };

    for (var t = 0; t <= ticks; t++) {
      var val = (yMax / ticks) * t;
      var yy = y(val);
      svg.appendChild(svgEl('line', { class: t === 0 ? 'axisline' : 'gridline', x1: padL, x2: padL + plotW, y1: yy, y2: yy }));
      var lbl = svgEl('text', { class: 'axis-label', x: padL - 10, y: yy + 4, 'text-anchor': 'end' });
      lbl.textContent = t === 0 ? '0' : wan(val);
      svg.appendChild(lbl);
    }

    var linePts = data.map(function (d, i) { return x(i) + ',' + y(d.value); });
    svg.appendChild(svgEl('path', {
      d: 'M' + x(0) + ',' + y(0) + 'L' + linePts.join('L') + 'L' + x(data.length - 1) + ',' + y(0) + 'Z',
      fill: 'var(--series-1-wash)',
    }));
    svg.appendChild(svgEl('path', {
      d: 'M' + linePts.join('L'), fill: 'none', stroke: 'var(--series-1)',
      'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));

    data.forEach(function (d, i) {
      var lb = svgEl('text', { class: 'axis-label', x: x(i), y: padT + plotH + 20, 'text-anchor': 'middle' });
      lb.textContent = d.label;
      svg.appendChild(lb);
    });

    var last = data.length - 1;
    svg.appendChild(svgEl('circle', {
      cx: x(last), cy: y(data[last].value), r: 4.5,
      fill: 'var(--series-1)', stroke: 'var(--surface-1)', 'stroke-width': '2',
    }));
    var endLabel = svgEl('text', { class: 'value-label', x: x(last) + 10, y: y(data[last].value) + 4 });
    endLabel.textContent = wan(data[last].value);
    svg.appendChild(endLabel);

    var cross = svgEl('line', { class: 'gridline', x1: 0, x2: 0, y1: padT, y2: padT + plotH, stroke: 'var(--axis)', opacity: '0' });
    svg.appendChild(cross);
    var hoverDot = svgEl('circle', { r: 4.5, fill: 'var(--series-1)', stroke: 'var(--surface-1)', 'stroke-width': '2', opacity: '0' });
    svg.appendChild(hoverDot);

    var tip = el('div', { class: 'tooltip', hidden: 'hidden' });

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
    function hide() { cross.setAttribute('opacity', '0'); hoverDot.setAttribute('opacity', '0'); tip.hidden = true; }

    data.forEach(function (d, i) {
      var band = plotW / (data.length - 1);
      var r = svgEl('rect', { x: x(i) - band / 2, y: padT, width: band, height: plotH, fill: 'transparent' });
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

    host.appendChild(svg);
    host.appendChild(tip);
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

    var svg = svgEl('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': '本月各通路營收長條圖' });
    var tip = el('div', { class: 'tooltip', hidden: 'hidden' });

    data.forEach(function (d, i) {
      var bandTop = padT + i * bandH;
      var y = bandTop + (bandH - barH) / 2;
      var w = (d.value / xMax) * plotW;

      var name = svgEl('text', { class: 'axis-label', x: padL - 12, y: y + barH / 2 + 4, 'text-anchor': 'end' });
      name.textContent = d.name;
      svg.appendChild(name);

      svg.appendChild(svgEl('path', { d: barPath(padL, y, w, barH, 4), fill: 'var(--series-1)' }));

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

    svg.appendChild(svgEl('line', { class: 'axisline', x1: padL, x2: padL, y1: padT, y2: H - padT }));
    svg.addEventListener('mouseleave', function () { tip.hidden = true; });
    host.appendChild(svg);
    host.appendChild(tip);
  }

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
    table.appendChild(el('thead', null, [el('tr', null, headers.map(function (h, i) {
      return el('th', { class: i === 0 ? '' : 'num', text: h });
    }))]));
    var tbody = el('tbody');
    rows.forEach(function (r) {
      tbody.appendChild(el('tr', null, r.map(function (c, i) { return el('td', { class: i === 0 ? '' : 'num', text: c }); })));
    });
    table.appendChild(tbody);
    return table;
  }

  /* =========================================================
     登入畫面
     ========================================================= */

  function renderLogin() {
    var host = $('#login-accounts');
    clear(host);
    state.employees.forEach(function (e) {
      var lv = D.ACCESS_LEVELS[e.access] || D.ACCESS_LEVELS.staff;
      var acct = D.ACCOUNTS[e.id];
      if (!acct) return;
      host.appendChild(el('button', {
        class: 'login-card', type: 'button', title: '帶入 ' + acct.username,
        onclick: function () {
          backToPassword('');
          $('#lg-user').value = acct.username;
          $('#lg-pass').value = 'Evertrust#1971';
          showAuthError('#lg-error', '');
          $('#lg-submit').focus();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
      }, [
        el('div', { class: 'login-card-top' }, [
          el('span', { class: 'login-name', text: e.name }),
          el('span', { class: 'access-badge access-' + e.access, text: lv.label }),
        ]),
        el('div', { class: 'login-role', text: e.dept + ' · ' + e.role }),
        el('div', { class: 'login-user' }, [
          el('code', { text: acct.username }),
          acct.mfa ? el('span', { class: 'mfa-tag', text: '兩步驟驗證' }) : null,
        ]),
        el('div', { class: 'login-state' }, ['本期評核：', statusChip(e.status)]),
      ]));
    });
  }

  function login(empId, meta) {
    meta = meta || {};
    loadState();            // 進來先拉最新共用資料，免得看到自己分頁的舊快照
    var now = Date.now();
    setSession({ empId: empId, loginAt: now, lastActive: now, mfa: !!meta.mfa, lastLogin: meta.lastLogin || null, pwv: meta.pwv || 0 });
    selectedEmp = null;
    detailDraft = null;
    conflict = null;
    selectedAp = null;
    apTab = 'todo';
    setOrderFilter({});
    showApp();
    goTo('panel-overview');
    announce(false);
    toast('歡迎，' + currentUser().name + (meta.lastLogin ? '。上次登入：' + meta.lastLogin : '。這是你第一次登入'));
  }

  function logout(kind, notice) {
    var me = currentUser();
    if (me) authLog(kind === 'timeout' || kind === 'forced' ? kind : 'logout', getSessionUsername(), me.id, notice || '使用者登出');
    broadcast({ type: 'bye' });
    setSession(null);
    $('#idle-modal').hidden = true;
    $('#info-modal').hidden = true;
    ['#search-modal', '#import-modal', '#ap-modal', '#print-modal'].forEach(function (m) { $(m).hidden = true; });
    closeDrawer();
    ordSelected = {};
    closeMenus();
    closeNav();
    $('#app-view').hidden = true;
    $('#login-view').hidden = false;
    backToPassword(notice || '你已登出。');
    renderLogin();
  }

  function showApp() {
    $('#login-view').hidden = true;
    $('#app-view').hidden = false;
    renderAll();
  }

  /* =========================================================
     分頁一：營運總覽
     ========================================================= */

  function myOrders() {
    var me = currentUser();
    return state.orders.filter(function (o) { return o.owner === me.name; });
  }

  function renderOverview() {
    var me = currentUser();
    if (!me) return;
    var full = canSeeCompanyFigures();

    $('#company-charts').hidden = !full;
    $('#charts-locked').hidden = full;
    $('#period-label').textContent = D.META.period;

    var lowStock = state.inventory.filter(function (r) { return r.stock < r.safety; })
      .sort(function (a, b) { return a.stock / a.safety - b.stock / b.safety; });
    var tiles;

    if (full) {
      var rev = D.MONTHLY_REVENUE;
      var thisMonth = rev[rev.length - 1].value;
      var yoy = (thisMonth - D.LAST_YEAR_SAME_MONTH) / D.LAST_YEAR_SAME_MONTH * 100;

      $('#hero-title').textContent = '本月營收';
      $('#hero-figure').textContent = wan(thisMonth);
      $('#hero-sub').textContent = 'NT$ ' + nt(thisMonth) + ' · 統計至 ' + D.META.asOf;
      var dn = $('#hero-delta');
      dn.className = 'tile-delta ' + (yoy >= 0 ? 'delta-up' : 'delta-down');
      dn.textContent = (yoy >= 0 ? '▲ ' : '▼ ') + pct(yoy) + '　較去年同期（' + wan(D.LAST_YEAR_SAME_MONTH) + '）';

      var scope = state.employees.filter(canSeeEmployee);
      var avg = scope.reduce(function (s, e) { return s + weightedTotal(e); }, 0) / scope.length;
      var avgDelta = avg - D.PREV_PERIOD_AVG;
      var finalized = scope.filter(function (e) { return e.status === 'final'; }).length;
      var openOrders = visibleOrdersAll().filter(function (o) { return o.status === '備貨中' || o.status === '待付款'; });
      var stockValue = state.inventory.reduce(function (s, r) { return s + r.stock * r.unitPrice; }, 0);

      tiles = [
        {
          label: accessOf(me) === 'admin' ? '全體平均績效' : '部門平均績效',
          value: avg.toFixed(1),
          delta: (avgDelta >= 0 ? '▲ ' : '▼ ') + avgDelta.toFixed(1) + '　較上期（' + D.PREV_PERIOD_AVG.toFixed(1) + '）',
          cls: avgDelta >= 0 ? 'delta-up' : 'delta-down',
        },
        {
          label: '評核進度', value: finalized + ' / ' + scope.length,
          delta: '已定版 · 本期 ' + D.CYCLE.period + ' 截止 ' + D.CYCLE.due, cls: 'delta-flat',
        },
        {
          label: '低於安全庫存', value: lowStock.length + ' 項',
          delta: lowStock.length ? '最急：' + lowStock[0].name : '全部品項皆充足',
          cls: lowStock.length ? 'delta-down' : 'delta-up',
        },
        {
          label: '庫存總值', value: wan(stockValue),
          delta: '共 ' + state.inventory.length + ' 個品項', cls: 'delta-flat',
        },
      ];
    } else {
      /* 一般員工：只看得到自己的數字 */
      var mine = byId(state.employees, me.id);
      var raw = (mine.raw && mine.raw.quota) || '—';
      var myTotal = canSeeManagerScores(mine) ? weightedTotal(mine).toFixed(1) : '定版後公開';
      var mineOrders = myOrders();
      var mineOpen = mineOrders.filter(function (o) { return o.status === '備貨中' || o.status === '待付款'; });

      $('#hero-title').textContent = '我的本期業績';
      $('#hero-figure').textContent = mine.template === 'sales' ? raw.split(' / ')[0] : (mine.raw.output || '—');
      $('#hero-sub').textContent = mine.template === 'sales'
        ? '目標 ' + (raw.split(' / ')[1] || '—') + ' · 統計至 ' + D.META.asOf
        : '當期產出 · 統計至 ' + D.META.asOf;
      var dn2 = $('#hero-delta');
      dn2.className = 'tile-delta delta-flat';
      dn2.textContent = mine.dept + ' · ' + mine.role;

      tiles = [
        {
          label: '我的評核狀態', value: D.WORKFLOW.states[mine.status].label,
          delta: D.WORKFLOW.states[mine.status].hint, cls: 'delta-flat',
        },
        { label: '我的加權總分', value: myTotal, delta: '本期 ' + D.CYCLE.period, cls: 'delta-flat' },
        {
          label: '我的未結訂單', value: mineOpen.length + ' 筆',
          delta: '我負責的訂單共 ' + mineOrders.length + ' 筆', cls: 'delta-flat',
        },
        {
          label: '低於安全庫存', value: lowStock.length + ' 項',
          delta: lowStock.length ? '最急：' + lowStock[0].name : '全部品項皆充足',
          cls: lowStock.length ? 'delta-down' : 'delta-up',
        },
      ];
    }

    var host = $('#kpi-tiles');
    clear(host);
    tiles.forEach(function (t) {
      host.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'tile-label', text: t.label }),
        el('div', { class: 'tile-value', text: t.value }),
        el('div', { class: 'tile-delta ' + t.cls, text: t.delta }),
      ]));
    });

    if (full) {
      renderRevenueChart($('#chart-revenue'));
      renderChannelChart($('#chart-channel'));
    }
  }

  /* =========================================================
     分頁二：員工績效
     ========================================================= */

  var selectedEmp = null;
  var detailDraft = null;
  var empSort = { key: 'total', dir: 'desc' };

  function visibleEmployees() {
    var q = $('#emp-search').value.trim().toLowerCase();
    var dept = $('#emp-dept').value;
    var st = $('#emp-status').value;
    var list = state.employees.filter(function (e) {
      if (!canSeeEmployee(e)) return false;
      if (dept && e.dept !== dept) return false;
      if (st && e.status !== st) return false;
      if (!q) return true;
      return (e.name + e.dept + e.role + e.id).toLowerCase().indexOf(q) >= 0;
    });
    var dir = empSort.dir === 'asc' ? 1 : -1;
    list.sort(function (a, b) {
      var av, bv;
      if (empSort.key === 'total') { av = weightedTotal(a); bv = weightedTotal(b); }
      else if (empSort.key === 'status') { av = STATUS_RANK[a.status]; bv = STATUS_RANK[b.status]; }
      else { av = a[empSort.key]; bv = b[empSort.key]; }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return list;
  }

  function renderEmployeeTable() {
    var me = currentUser();
    if (!me) return;

    $('#perf-scope-note').textContent = accessOf(me) === 'admin'
      ? '你是系統管理員，看得到全公司 ' + state.employees.length + ' 位同仁，並可複核與定版。'
      : accessOf(me) === 'manager'
        ? '你是' + me.managesDept + '主管，看得到該部門同仁與自己；自己的評核由管理員處理。'
        : '你是一般員工，只看得到自己的評核。主管給的分數會在定版後公開。';

    $('#open-cycle').hidden = accessOf(me) !== 'admin';

    var list = visibleEmployees();
    var tbody = $('#emp-tbody');
    clear(tbody);

    if (!list.length) {
      tbody.appendChild(el('tr', null, [el('td', { colspan: '6', class: 'empty-state', text: '找不到符合條件的員工' })]));
    }

    list.forEach(function (e) {
      var showScore = canSeeManagerScores(e);
      var total = weightedTotal(e);
      var g = gradeOf(total);
      var tr = el('tr', {
        class: 'clickable' + (selectedEmp === e.id ? ' is-active' : ''),
        tabindex: '0', role: 'button',
        'aria-label': e.name + '，' + D.WORKFLOW.states[e.status].label + (showScore ? '，總分 ' + total.toFixed(1) : ''),
      }, [
        el('td', null, [
          el('div', null, [e.name, e.id === me.id ? el('span', { class: 'self-tag', text: '我' }) : null]),
          el('div', { class: 'cell-sub', text: e.id + ' · ' + e.role }),
        ]),
        el('td', { text: e.dept }),
        el('td', null, [statusChip(e.status)]),
        el('td', { class: 'num', text: showScore ? total.toFixed(1) : '—' }),
        el('td', null, [showScore ? el('span', { class: 'grade grade-' + g, text: g }) : el('span', { class: 'cell-sub', text: '未公開' })]),
        el('td', null, [
          el('div', { class: 'cell-sub', text: e.updatedAt }),
          el('div', { class: 'cell-sub', text: e.updatedBy + ' · v' + e.version }),
        ]),
      ]);
      function open() {
        selectedEmp = e.id;
        detailDraft = null;
        conflict = null;
        renderEmployeeTable();
        renderEmployeeDetail();
      }
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
      });
      tbody.appendChild(tr);
    });

    $('#emp-count').textContent = '共 ' + list.length + ' 位';

    var scope = state.employees.filter(canSeeEmployee);
    var dist = { A: 0, B: 0, C: 0, D: 0 }, hidden = 0;
    scope.forEach(function (e) {
      if (canSeeManagerScores(e)) dist[gradeOf(weightedTotal(e))]++;
      else hidden++;
    });
    $('#emp-dist').textContent = 'A ' + dist.A + ' · B ' + dist.B + ' · C ' + dist.C + ' · D ' + dist.D +
      (hidden ? ' · 未公開 ' + hidden : '');
  }

  var METER_MAX = 130;
  function meterWidth(score) { return clamp(score / METER_MAX * 100, 2, 100); }

  function meterRow(item, score, raw, compareScore) {
    var diff = (compareScore === null || compareScore === undefined) ? null : score - compareScore;
    return el('div', { class: 'meter-row' }, [
      el('div', { class: 'meter-top' }, [
        el('span', { class: 'meter-name', text: item.name }),
        el('span', null, [
          diff !== null ? el('span', {
            class: 'meter-diff ' + (diff > 0 ? 'diff-up' : diff < 0 ? 'diff-down' : 'diff-flat'),
            text: '自評 ' + compareScore + '（' + (diff > 0 ? '主管高 ' : diff < 0 ? '主管低 ' : '一致 ') + Math.abs(diff) + '）',
          }) : null,
          el('span', { class: 'meter-val', text: score.toFixed(0) }),
        ]),
      ]),
      el('div', { class: 'meter-track' }, [
        el('div', { class: 'meter-fill', style: 'width:' + meterWidth(score) + '%;background:' + scoreColor(score) }),
        el('div', { class: 'meter-target', title: '目標 100 分' }),
      ]),
      el('div', { class: 'meter-weight', text: '權重 ' + item.weight + '%　' + item.rawLabel + '：' + (raw || '—') }),
    ]);
  }

  /** 流程進度條 */
  function stepper(emp) {
    var wrap = el('div', { class: 'stepper' });
    var curIdx = D.WORKFLOW.order.indexOf(emp.status);
    D.WORKFLOW.order.forEach(function (key, i) {
      var st = D.WORKFLOW.states[key];
      var cls = 'step';
      if (emp.status === 'appeal') cls += i <= 1 ? ' step-done' : '';
      else if (i < curIdx) cls += ' step-done';
      else if (i === curIdx) cls += ' step-current';
      wrap.appendChild(el('div', { class: cls }, [
        el('span', { class: 'step-dot', text: i < curIdx || (emp.status === 'appeal' && i <= 1) ? '✓' : String(i + 1) }),
        el('span', { class: 'step-label', text: st.label }),
      ]));
    });
    if (emp.status === 'appeal') {
      wrap.appendChild(el('div', { class: 'step step-appeal' }, [
        el('span', { class: 'step-dot', text: '!' }),
        el('span', { class: 'step-label', text: '申訴中' }),
      ]));
    }
    return wrap;
  }

  function draftFor(emp) {
    if (detailDraft && detailDraft.empId === emp.id) return detailDraft;
    detailDraft = {
      empId: emp.id,
      openedVersion: emp.version,
      scores: deepCopy(emp.scores),
      comment: emp.comment,
      selfScores: emp.selfScores ? deepCopy(emp.selfScores) : null,
      selfComment: emp.selfComment,
      reviewNote: emp.reviewNote,
      appealReason: emp.appealReason,
    };
    return detailDraft;
  }

  function conflictBanner(emp) {
    var t = conflict.theirs;
    return el('div', { class: 'conflict' }, [
      el('div', { class: 'conflict-title', text: '⚠ 版本衝突，沒有存檔' }),
      el('p', {
        class: 'conflict-body',
        text: t.updatedBy + ' 在 ' + t.updatedAt + ' 已經把這筆改成 v' + t.version +
          '（你開啟的是 v' + conflict.myVersion + '）。為了不蓋掉對方的修改，這次存檔已中止。',
      }),
      el('div', { class: 'conflict-actions' }, [
        el('button', {
          class: 'btn btn-sm btn-primary', type: 'button', text: '載入對方版本（放棄我的修改）',
          onclick: function () {
            conflict = null;
            detailDraft = null;
            loadState();
            renderEmployeeTable();
            renderEmployeeDetail();
            toast('已載入 v' + t.version);
          },
        }),
        el('button', {
          class: 'btn btn-sm', type: 'button', text: '仍要以我的版本覆蓋',
          onclick: function () {
            var d = detailDraft;
            var ok = commitEmployee(emp.id, t.version, function (fresh) {
              fresh.scores = deepCopy(d.scores);
              fresh.comment = d.comment;
              if (d.selfScores) fresh.selfScores = deepCopy(d.selfScores);
              fresh.selfComment = d.selfComment;
              fresh.reviewNote = d.reviewNote;
              fresh.appealReason = d.appealReason;
            }, {
              action: 'forceOverwrite', from: t.status, to: t.status,
              note: '版本衝突後選擇覆蓋對方的 v' + t.version,
              snapshot: { scores: deepCopy(d.scores) },
            }, true);
            if (ok) {
              detailDraft = null;
              renderAll();
              toast('已覆蓋並存檔');
            }
          },
        }),
      ]),
    ]);
  }

  function scoreEditor(emp, items, target, legend, disabled) {
    var d = draftFor(emp);
    var box = el('div', { class: 'score-input' });
    box.appendChild(el('div', { class: 'editor-legend', text: legend }));
    var liveOut = el('span', { class: 'live-total', text: weightedTotal(emp, d[target] || {}).toFixed(1) });

    items.forEach(function (it) {
      if (!d[target]) d[target] = {};
      if (d[target][it.key] === undefined) d[target][it.key] = 0;
      var out = el('span', { class: 'meter-val', text: String(d[target][it.key]) });
      var range = el('input', {
        type: 'range', min: '0', max: '130', step: '1', value: String(d[target][it.key]),
        disabled: disabled ? 'disabled' : false, 'aria-label': it.name + ' 分數',
      });
      range.addEventListener('input', function () {
        d[target][it.key] = Number(range.value);
        out.textContent = range.value;
        liveOut.textContent = weightedTotal(emp, d[target]).toFixed(1);
      });
      box.appendChild(el('label', null, [el('span', null, [it.name + '（權重 ' + it.weight + '%）　', out]), range]));
    });

    box.appendChild(el('div', { class: 'detail-meta' }, ['加權總分：', liveOut]));
    return box;
  }

  function textField(labelText, value, onInput, disabled, placeholder) {
    var ta = el('textarea', { class: 'field', 'aria-label': labelText, disabled: disabled ? 'disabled' : false, placeholder: placeholder || '' });
    ta.value = value || '';
    ta.addEventListener('input', function () { onInput(ta.value); });
    return el('label', { class: 'field-label' }, [labelText, ta]);
  }

  function historyPanel(emp) {
    var open = false;
    var list = el('div', { class: 'history', hidden: 'hidden' });
    var btn = el('button', {
      class: 'btn btn-sm', type: 'button', text: '稽核軌跡與歷史版本（' + emp.history.length + '）',
      'aria-expanded': 'false',
      onclick: function () {
        open = !open;
        list.hidden = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      },
    });

    emp.history.slice().reverse().forEach(function (h) {
      var row = el('div', { class: 'history-row' }, [
        el('div', { class: 'history-ts', text: h.ts }),
        el('div', null, [
          el('div', null, [
            el('strong', { text: h.actor }),
            ' ',
            el('span', { text: (D.WORKFLOW.actions[h.action] || {}).label || h.action }),
            h.from && h.to ? el('span', { class: 'history-move', text: '　' + D.WORKFLOW.states[h.from].label + ' → ' + D.WORKFLOW.states[h.to].label }) : null,
          ]),
          el('div', { class: 'cell-sub', text: h.note }),
          h.snapshot && h.snapshot.scores
            ? el('div', { class: 'cell-sub', text: '當時加權總分 ' + weightedTotal(emp, h.snapshot.scores).toFixed(1) })
            : null,
        ]),
      ]);
      list.appendChild(row);
    });

    return el('div', { class: 'history-wrap' }, [btn, list]);
  }

  function actionButtons(emp) {
    var acts = availableActions(emp);
    if (!acts.length) return null;
    var d = draftFor(emp);
    var row = el('div', { class: 'action-row' });

    acts.forEach(function (key) {
      var a = D.WORKFLOW.actions[key];
      row.appendChild(el('button', {
        class: 'btn btn-sm ' + (a.tone === 'primary' ? 'btn-primary' : ''), type: 'button', text: a.label,
        onclick: function () {
          if (key === 'appeal' && !(d.appealReason || '').trim()) { toast('請先填寫申訴理由'); return; }
          if (key === 'sendBack' && !(d.reviewNote || '').trim()) { toast('退回時請填寫複核意見，讓主管知道要補什麼'); return; }

          var ok = commitEmployee(emp.id, d.openedVersion, function (fresh) {
            if (key === 'submitSelf') { fresh.selfScores = deepCopy(d.selfScores); fresh.selfComment = d.selfComment; }
            if (key === 'submitReview') { fresh.scores = deepCopy(d.scores); fresh.comment = d.comment; }
            if (key === 'finalize' || key === 'sendBack') fresh.reviewNote = d.reviewNote;
            if (key === 'appeal') fresh.appealReason = d.appealReason;
            fresh.status = a.to;
          }, {
            action: key, from: a.from, to: a.to,
            note: a.label + (key === 'finalize' ? '，核定 ' + gradeOf(weightedTotal(emp, d.scores)) + ' 等' : ''),
            snapshot: { scores: deepCopy(d.scores) },
          });

          if (ok) {
            detailDraft = null;
            renderAll();
            toast(emp.name + '：' + a.label + ' 完成');
          }
        },
      }));
    });

    return row;
  }

  function renderEmployeeDetail() {
    var host = $('#emp-detail');
    clear(host);

    var emp = selectedEmp ? byId(state.employees, selectedEmp) : null;
    if (!emp || !canSeeEmployee(emp)) {
      host.appendChild(el('div', { class: 'empty-state', text: '點選左側任一位員工，查看評核細項、流程狀態與稽核軌跡。' }));
      return;
    }

    var tpl = templateOf(emp);
    var d = draftFor(emp);
    var showScores = canSeeManagerScores(emp);
    var me = currentUser();

    host.appendChild(el('div', { class: 'detail-head' }, [
      el('div', { class: 'detail-name' }, [
        emp.name,
        ' ',
        showScores ? el('span', { class: 'grade grade-' + gradeOf(weightedTotal(emp)), text: gradeOf(weightedTotal(emp)) }) : null,
      ]),
      el('div', { class: 'detail-meta', text: emp.dept + ' · ' + emp.role + ' · 到職 ' + emp.hireDate }),
      el('div', { class: 'detail-meta', text: tpl.label + '評核模板（' + tpl.note + '）' }),
      el('div', { class: 'detail-meta', text: '版本 v' + emp.version + ' · 最後異動 ' + emp.updatedBy + ' @ ' + emp.updatedAt }),
    ]));

    host.appendChild(stepper(emp));
    host.appendChild(el('div', { class: 'state-hint', text: D.WORKFLOW.states[emp.status].hint }));

    if (conflict && conflict.empId === emp.id) host.appendChild(conflictBanner(emp));

    /* --- 主管評分區 --- */
    if (showScores) {
      host.appendChild(el('div', { class: 'section-label', text: '主管評核' }));
      host.appendChild(el('div', { class: 'tile-label', text: '加權總分' }));
      host.appendChild(el('div', { class: 'tile-value', text: weightedTotal(emp).toFixed(1) }));
      tpl.items.forEach(function (it) {
        var selfVal = emp.selfScores ? emp.selfScores[it.key] : null;
        host.appendChild(meterRow(it, emp.scores[it.key] || 0, emp.raw[it.key],
          (selfVal !== null && selfVal !== undefined && isEvaluatorOf(emp)) ? selfVal : null));
      });
      if (emp.comment) host.appendChild(el('p', { class: 'quote', text: emp.comment }));
    } else {
      host.appendChild(el('div', { class: 'locked-note' }, [
        el('strong', { text: '主管評分尚未公開。' }),
        ' 依制度設計，員工在評核定版前看不到主管給的分數，避免流程中途互相影響。',
      ]));
    }

    /* --- 自評區 --- */
    host.appendChild(el('div', { class: 'section-label', text: '本人自評' }));
    if (canEditSelf(emp)) {
      host.appendChild(scoreEditor(emp, tpl.items, 'selfScores', '拉動滑桿填寫自評分數', false));
      host.appendChild(textField('自述（說明本期的成果與困難）', d.selfComment, function (v) { d.selfComment = v; }, false,
        '例：本期成交筆數成長，但報價偏鬆，希望有標準級距表'));
    } else if (emp.selfScores) {
      tpl.items.forEach(function (it) {
        host.appendChild(el('div', { class: 'kv-row' }, [
          el('span', { class: 'meter-name', text: it.name }),
          el('span', { class: 'meter-val', text: String(emp.selfScores[it.key] || 0) }),
        ]));
      });
      host.appendChild(el('div', { class: 'detail-meta', text: '自評加權總分 ' + weightedTotal(emp, emp.selfScores).toFixed(1) }));
      if (emp.selfComment) host.appendChild(el('p', { class: 'quote', text: emp.selfComment }));
    } else {
      host.appendChild(el('div', { class: 'cell-sub', text: '本人尚未送出自評。' }));
    }

    /* --- 主管評分編輯 --- */
    if (canEditManagerScores(emp)) {
      host.appendChild(el('div', { class: 'section-label', text: '填寫主管評核' }));
      host.appendChild(scoreEditor(emp, tpl.items, 'scores', '拉動滑桿調整各項分數', false));
      host.appendChild(textField('主管評語', d.comment, function (v) { d.comment = v; }, false, ''));
    }

    /* --- 複核區 --- */
    if (emp.status === 'review' || emp.reviewNote) {
      host.appendChild(el('div', { class: 'section-label', text: '複核意見' }));
      if (canEditReviewNote(emp)) {
        host.appendChild(textField('複核意見（退回時必填）', d.reviewNote, function (v) { d.reviewNote = v; }, false,
          '例：自評與主管評核落差過大，請補充佐證'));
      } else if (emp.reviewNote) {
        host.appendChild(el('p', { class: 'quote', text: emp.reviewNote }));
      } else {
        host.appendChild(el('div', { class: 'cell-sub', text: '等待管理員複核。' }));
      }
    }

    /* --- 申訴區 --- */
    if (emp.status === 'appeal' || emp.appealReason) {
      host.appendChild(el('div', { class: 'section-label', text: '申訴' }));
      host.appendChild(el('p', { class: 'quote quote-alert', text: emp.appealReason || '（尚未填寫）' }));
    } else if (canEditAppeal(emp)) {
      host.appendChild(el('div', { class: 'section-label', text: '對評核結果有意見？' }));
      host.appendChild(textField('申訴理由', d.appealReason, function (v) { d.appealReason = v; }, false,
        '說明你認為評核應調整的理由與佐證'));
    }

    /* --- 動作 --- */
    var acts = actionButtons(emp);
    if (acts) host.appendChild(acts);
    else if (emp.id === me.id && accessOf(me) !== 'admin' && emp.status === 'manager') {
      host.appendChild(el('div', { class: 'cell-sub', text: '自評已送出，等待主管評分。' }));
    }

    host.appendChild(historyPanel(emp));
  }

  function openCycle() {
    var btn = $('#open-cycle');
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      btn.textContent = '確定要重設全員狀態？再按一次';
      btn.classList.add('btn-danger');
      setTimeout(function () {
        if (btn.dataset.armed === '1') {
          btn.dataset.armed = '';
          btn.textContent = '開啟新評核週期';
          btn.classList.remove('btn-danger');
        }
      }, 5000);
      return;
    }
    btn.dataset.armed = '';
    btn.textContent = '開啟新評核週期';
    btn.classList.remove('btn-danger');

    var actor = currentUser().name;
    var ts = nowStamp();
    commitSimple(function (st) {
      st.employees.forEach(function (e) {
        e.history.push({
          ts: ts, actor: actor, action: 'openCycle', from: e.status, to: 'self',
          note: '開啟新評核週期，封存上期結果',
          snapshot: { scores: deepCopy(e.scores) },
        });
        e.status = 'self';
        e.selfScores = null;
        e.selfComment = '';
        e.reviewNote = '';
        e.appealReason = '';
        e.version = (e.version || 1) + 1;
        e.updatedBy = actor;
        e.updatedAt = ts;
      });
    }, '開啟新評核週期', '全體員工');

    selectedEmp = null;
    detailDraft = null;
    renderAll();
    toast('已開啟新週期，全員狀態重設為待自評（上期分數已封存在稽核軌跡）');
  }

  function exportEmployees() {
    var rows = [['員工編號', '姓名', '部門', '職務', '評核模板', '流程狀態', '加權總分', '等第', '自評總分', '主管評語', '版本', '最後異動']];
    visibleEmployees().forEach(function (e) {
      var show = canSeeManagerScores(e);
      var t = weightedTotal(e);
      rows.push([
        e.id, e.name, e.dept, e.role, templateOf(e).label, D.WORKFLOW.states[e.status].label,
        show ? t.toFixed(1) : '未公開', show ? gradeOf(t) : '未公開',
        e.selfScores ? weightedTotal(e, e.selfScores).toFixed(1) : '未自評',
        show ? e.comment : '未公開', 'v' + e.version, e.updatedBy + ' @ ' + e.updatedAt,
      ]);
    });
    downloadCSV('績效評核_' + D.CYCLE.period + '_' + D.META.asOf + '.csv', rows);
  }

  /* =========================================================
     資料表共用：關聯、權限、版本紀錄、留言
     每筆訂單／茶品的欄位異動都寫進 recordLog（誰、何時、舊值 → 新值），
     單筆表單頁的「版本紀錄」就是讀這裡
     ========================================================= */

  var MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

  function empByName(name) {
    for (var i = 0; i < state.employees.length; i++) if (state.employees[i].name === name) return state.employees[i];
    return null;
  }
  function itemBySku(sku) {
    for (var i = 0; i < state.inventory.length; i++) if (state.inventory[i].sku === sku) return state.inventory[i];
    return null;
  }
  function deptOfOwner(name) { var e = empByName(name); return e ? e.dept : ''; }
  function shortName(item) { return item.name.replace(/（.*）/, ''); }
  /** 品項說明裡的「(28kg)」，沒寫重量的（禮盒、小包裝）回傳 0 */
  function kgOf(o) { var m = /\((\d+(?:\.\d+)?)kg\)/.exec(o.item); return m ? Number(m[1]) : 0; }
  function monthLabel(m) { return Number(m.slice(5, 7)) + ' 月'; }
  function isOpenOrder(o) { return o.status === '備貨中' || o.status === '待付款'; }

  function canEditOrder(o) {
    var me = currentUser(), lv = accessOf(me);
    if (lv === 'admin') return true;
    if (lv === 'manager') return deptOfOwner(o.owner) === me.managesDept || o.owner === me.name;
    return o.owner === me.name && isOpenOrder(o);   // 一般員工只能改自己未結的單
  }

  function allowedOwners() {
    var me = currentUser();
    return accessOf(me) === 'admin' ? state.employees
      : accessOf(me) === 'manager' ? state.employees.filter(function (e) { return e.dept === me.managesDept || e.id === me.id; })
        : [me];
  }

  function logRecord(st, type, id, action, changes, note, actor) {
    st.recordLog.unshift({
      ts: nowStamp(), actor: actor || currentUser().name, type: type, id: id,
      action: action, changes: changes || [], note: note || '',
    });
    if (st.recordLog.length > 600) st.recordLog.length = 600;
  }
  function historyOf(type, id) {
    return state.recordLog.filter(function (h) { return h.type === type && h.id === id; });
  }
  function commentsOf(type, id) { return state.comments[type + ':' + id] || []; }

  function nextOrderId(st) {
    var prefix = 'SO-2610', max = 0;
    st.orders.forEach(function (o) {
      if (o.id.indexOf(prefix) === 0) max = Math.max(max, Number(o.id.slice(prefix.length)) || 0);
    });
    return prefix + String(max + 1).padStart(4, '0');
  }

  function segButtons(host, items, current, onPick) {
    clear(host);
    items.forEach(function (it) {
      host.appendChild(el('button', {
        type: 'button', class: 'seg-btn', 'aria-pressed': String(it.key === current),
        onclick: function () { onPick(it.key); },
      }, [it.label, it.count !== undefined && it.count !== null ? el('em', { class: 'seg-count', text: String(it.count) }) : null]));
    });
  }

  /* =========================================================
     分頁三：訂單（表格／看板／行事曆、進階篩選、儲存檢視、批次作業）
     ========================================================= */

  var orderSort = { key: 'date', dir: 'desc' };
  var ordView = 'table';
  var ordPage = 1;
  var ORD_PAGE_SIZE = 15;
  var ordSelected = {};
  var ordAdv = { from: '', to: '', min: '', max: '', owner: '' };
  var calMonth = D.META.asOf.slice(0, 7);
  var VIEWS_KEY = 'teaops-views-v1';
  var BUILTIN_VIEWS = [
    { id: 'all', name: '全部訂單', f: {} },
    { id: 'open', name: '未結訂單', f: { status: '__open' } },
    { id: 'month', name: '本月訂單', f: { from: '2026-10-01', to: '2026-10-31' } },
    { id: 'big', name: '大額訂單（≥ 10 萬）', f: { min: '100000' } },
    { id: 'unpaid', name: '待付款', f: { status: '待付款' } },
  ];
  var FILTER_LABEL = { q: '關鍵字', status: '狀態', channel: '通路', owner: '業務', from: '起', to: '迄', min: '金額 ≥', max: '金額 ≤' };

  /** 權限範圍內的全部訂單（未套用畫面篩選） */
  function visibleOrdersAll() {
    var me = currentUser();
    if (accessOf(me) === 'admin') return state.orders;
    if (accessOf(me) === 'manager') {
      return state.orders.filter(function (o) { return deptOfOwner(o.owner) === me.managesDept || o.owner === me.name; });
    }
    return state.orders.filter(function (o) { return o.owner === me.name; });
  }

  function orderFilter() {
    return {
      q: $('#ord-search').value.trim(), status: $('#ord-status').value, channel: $('#ord-channel').value,
      owner: ordAdv.owner, from: ordAdv.from, to: ordAdv.to, min: ordAdv.min, max: ordAdv.max,
    };
  }

  function setOrderFilter(f) {
    $('#ord-search').value = f.q || '';
    $('#ord-status').value = f.status || '';
    $('#ord-channel').value = f.channel || '';
    ordAdv = { from: f.from || '', to: f.to || '', min: f.min || '', max: f.max || '', owner: f.owner || '' };
    $('#ord-from').value = ordAdv.from;
    $('#ord-to').value = ordAdv.to;
    $('#ord-min').value = ordAdv.min;
    $('#ord-max').value = ordAdv.max;
    $('#ord-owner').value = ordAdv.owner;
    ordPage = 1;
  }

  function matchOrder(o, f) {
    if (f.status === '__open') { if (!isOpenOrder(o)) return false; }
    else if (f.status && o.status !== f.status) return false;
    if (f.channel && o.channel !== f.channel) return false;
    if (f.owner && o.owner !== f.owner) return false;
    if (f.from && o.date < f.from) return false;
    if (f.to && o.date > f.to) return false;
    if (f.min && o.amount < Number(f.min)) return false;
    if (f.max && o.amount > Number(f.max)) return false;
    if (f.q && (o.id + o.customer + o.item + o.owner).toLowerCase().indexOf(f.q.toLowerCase()) < 0) return false;
    return true;
  }

  function visibleOrders() {
    var f = orderFilter();
    var list = visibleOrdersAll().filter(function (o) { return matchOrder(o, f); });
    var dir = orderSort.dir === 'asc' ? 1 : -1;
    list.sort(function (a, b) {
      var av = a[orderSort.key], bv = b[orderSort.key];
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a.id < b.id ? dir : -dir;
    });
    return list;
  }

  /* ---- 儲存檢視（個人常用篩選，存在這台瀏覽器）---- */
  function readViews() {
    try { return JSON.parse(localStorage.getItem(VIEWS_KEY)) || {}; } catch (e) { return {}; }
  }
  function myViews() { return readViews()[currentUser().id] || []; }
  function writeMyViews(list) {
    var all = readViews();
    all[currentUser().id] = list;
    try { localStorage.setItem(VIEWS_KEY, JSON.stringify(all)); } catch (e) { /* 只是少了個人化 */ }
  }

  function renderViewSelect(selected) {
    var sel = $('#ord-view');
    clear(sel);
    sel.appendChild(el('option', { value: '', text: '自訂條件' }));
    var g1 = el('optgroup', { label: '系統檢視' });
    BUILTIN_VIEWS.forEach(function (v) { g1.appendChild(el('option', { value: 'b:' + v.id, text: v.name })); });
    sel.appendChild(g1);
    var mine = myViews();
    if (mine.length) {
      var g2 = el('optgroup', { label: '我的檢視' });
      mine.forEach(function (v, i) { g2.appendChild(el('option', { value: 'u:' + i, text: v.name })); });
      sel.appendChild(g2);
    }
    sel.value = selected || '';
    $('#ord-view-del').hidden = sel.value.indexOf('u:') !== 0;
  }

  function applyViewKey(key) {
    var f = null;
    if (key.indexOf('b:') === 0) {
      BUILTIN_VIEWS.forEach(function (v) { if ('b:' + v.id === key) f = v.f; });
    } else if (key.indexOf('u:') === 0) {
      var v = myViews()[Number(key.slice(2))];
      if (v) f = v.f;
    }
    if (!f) return;
    setOrderFilter(f);
    $('#ord-adv').hidden = !(f.from || f.to || f.min || f.max || f.owner) && $('#ord-adv').hidden;
    $('#ord-adv-toggle').setAttribute('aria-expanded', String(!$('#ord-adv').hidden));
    renderOrders();
    $('#ord-view').value = key;
    $('#ord-view-del').hidden = key.indexOf('u:') !== 0;
  }

  function renderFilterChips() {
    var host = $('#ord-chips');
    clear(host);
    var f = orderFilter();
    var keys = Object.keys(FILTER_LABEL).filter(function (k) { return f[k]; });
    host.hidden = !keys.length;
    keys.forEach(function (k) {
      var v = f[k];
      if (k === 'status' && v === '__open') v = '未結案';
      if (k === 'min' || k === 'max') v = nt(Number(v));
      host.appendChild(el('button', {
        class: 'filter-chip', type: 'button', title: '移除這個條件',
        onclick: function () {
          var nf = orderFilter();
          nf[k] = '';
          setOrderFilter(nf);
          $('#ord-view').value = '';
          renderOrders();
        },
      }, [el('span', { class: 'filter-chip-k', text: FILTER_LABEL[k] }), String(v), el('span', { class: 'filter-chip-x', 'aria-hidden': 'true', text: '×' })]));
    });
    if (keys.length) {
      host.appendChild(el('button', {
        class: 'link-btn', type: 'button', text: '清除全部',
        onclick: function () { setOrderFilter({}); renderViewSelect(''); renderOrders(); },
      }));
    }
  }

  function renderOrders() {
    var me = currentUser();
    if (!me) return;

    $('#ord-scope-note').textContent = accessOf(me) === 'admin'
      ? '全公司訂單，含 5 月以來的歷史資料。點任一筆打開表單頁：欄位、關聯資料、版本紀錄、留言。'
      : accessOf(me) === 'manager'
        ? me.managesDept + '的訂單。可修改本部門任何一筆，每次修改都會留下版本紀錄。'
        : '你負責的訂單。未結案的可以自己修改，已出貨或取消的需請主管處理。';

    var list = visibleOrders();
    var ids = {};
    list.forEach(function (o) { ids[o.id] = true; });
    Object.keys(ordSelected).forEach(function (id) { if (!ids[id]) delete ordSelected[id]; });

    renderFilterChips();
    segButtons($('#ord-viewseg'), [
      { key: 'table', label: '表格' }, { key: 'board', label: '看板' }, { key: 'calendar', label: '行事曆' },
    ], ordView, function (k) { ordView = k; renderOrders(); });
    $$('.ord-pane').forEach(function (p) { p.hidden = p.getAttribute('data-view') !== ordView; });

    if (ordView === 'table') renderOrderTable(list);
    else if (ordView === 'board') renderOrderBoard(list);
    else renderOrderCalendar(list);
    renderBulkBar();

    var sum = list.filter(function (o) { return o.status !== '已取消'; }).reduce(function (s, o) { return s + o.amount; }, 0);
    $('#ord-count').textContent = list.length + ' 筆 · 有效金額 NT$ ' + nt(sum);
  }

  function renderOrderTable(list) {
    var pages = Math.max(1, Math.ceil(list.length / ORD_PAGE_SIZE));
    ordPage = clamp(ordPage, 1, pages);
    var start = (ordPage - 1) * ORD_PAGE_SIZE;
    var page = list.slice(start, start + ORD_PAGE_SIZE);
    var idList = list.map(function (o) { return o.id; });

    var tbody = $('#ord-tbody');
    clear(tbody);
    if (!list.length) {
      tbody.appendChild(el('tr', null, [el('td', { colspan: '9', class: 'empty-state', text: '沒有符合條件的訂單' })]));
    }
    page.forEach(function (o) {
      var box = el('input', {
        type: 'checkbox', class: 'row-check', 'aria-label': '選取 ' + o.id,
        onclick: function (ev) { ev.stopPropagation(); },
        onchange: function () {
          if (box.checked) ordSelected[o.id] = true; else delete ordSelected[o.id];
          tr.classList.toggle('is-selected', box.checked);
          syncCheckAll(page);
          renderBulkBar();
        },
      });
      box.checked = !!ordSelected[o.id];
      var tr = el('tr', {
        class: 'clickable' + (box.checked ? ' is-selected' : ''), tabindex: '0',
        'aria-label': o.id + ' ' + o.customer + '，開啟表單頁',
      }, [
        el('td', { class: 'col-check' }, [box]),
        el('td', null, [el('span', { class: 'mono', text: o.id })]),
        el('td', { class: 'cell-sub', text: o.date }),
        el('td', { text: o.customer }),
        el('td', { text: o.channel }),
        el('td', { class: 'cell-wrap', text: o.item }),
        el('td', { class: 'num', text: nt(o.amount) }),
        el('td', null, [chip(ORDER_STATUS[o.status] || 'neutral', o.status)]),
        el('td', { text: o.owner }),
      ]);
      function open() { openRecord('order', o.id, idList); }
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', function (ev) {
        if (ev.target !== tr) return;
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
      });
      tbody.appendChild(tr);
    });
    syncCheckAll(page);

    var pager = $('#ord-pager');
    clear(pager);
    pager.appendChild(el('span', {
      class: 'result-count',
      text: list.length ? '第 ' + (start + 1) + '–' + (start + page.length) + ' 筆，共 ' + list.length + ' 筆' : '0 筆',
    }));
    pager.appendChild(el('span', { class: 'spacer' }));
    pager.appendChild(el('button', {
      class: 'btn btn-sm', type: 'button', text: '‹ 上一頁', disabled: ordPage <= 1 ? 'disabled' : null,
      onclick: function () { ordPage--; renderOrders(); },
    }));
    pager.appendChild(el('span', { class: 'pager-pos', text: ordPage + ' / ' + pages }));
    pager.appendChild(el('button', {
      class: 'btn btn-sm', type: 'button', text: '下一頁 ›', disabled: ordPage >= pages ? 'disabled' : null,
      onclick: function () { ordPage++; renderOrders(); },
    }));
  }

  function syncCheckAll(page) {
    var all = $('#ord-check-all');
    var n = page.filter(function (o) { return ordSelected[o.id]; }).length;
    all.checked = page.length > 0 && n === page.length;
    all.indeterminate = n > 0 && n < page.length;
    all._page = page;
  }

  function renderOrderBoard(list) {
    var host = $('#ord-board');
    clear(host);
    var idList = list.map(function (o) { return o.id; });
    Object.keys(ORDER_STATUS).forEach(function (st) {
      var items = list.filter(function (o) { return o.status === st; });
      var sum = items.reduce(function (s, o) { return s + o.amount; }, 0);
      var cards = el('div', { class: 'board-cards' });
      items.slice(0, 30).forEach(function (o) {
        var movable = canEditOrder(o);
        var card = el('button', {
          type: 'button', class: 'board-card', draggable: movable ? 'true' : null,
          title: movable ? '拖曳到其他欄可變更狀態' : '你沒有修改這筆的權限',
          onclick: function () { openRecord('order', o.id, idList); },
        }, [
          el('div', { class: 'board-card-top' }, [el('span', { class: 'mono', text: o.id }), el('span', { class: 'cell-sub', text: o.date.slice(5) })]),
          el('div', { class: 'board-card-title', text: o.customer }),
          el('div', { class: 'cell-sub', text: o.item }),
          el('div', { class: 'board-card-foot' }, [el('span', { class: 'avatar avatar-xs', text: o.owner.slice(0, 1), title: o.owner }), el('strong', { class: 'num', text: 'NT$ ' + nt(o.amount) })]),
        ]);
        if (movable) {
          card.addEventListener('dragstart', function (ev) {
            ev.dataTransfer.setData('text/plain', o.id);
            ev.dataTransfer.effectAllowed = 'move';
            card.classList.add('dragging');
          });
          card.addEventListener('dragend', function () { card.classList.remove('dragging'); });
        }
        cards.appendChild(card);
      });
      if (items.length > 30) cards.appendChild(el('div', { class: 'board-more', text: '還有 ' + (items.length - 30) + ' 筆，請縮小篩選範圍' }));
      if (!items.length) cards.appendChild(el('div', { class: 'board-more', text: '拖曳卡片到這裡' }));

      var col = el('section', { class: 'board-col', 'aria-label': st }, [
        el('header', { class: 'board-head' }, [
          chip(ORDER_STATUS[st], st), el('span', { class: 'seg-count', text: String(items.length) }),
          el('span', { class: 'spacer' }), el('span', { class: 'cell-sub num', text: wan(sum) }),
        ]),
        cards,
      ]);
      col.addEventListener('dragover', function (ev) { ev.preventDefault(); col.classList.add('drop-on'); });
      col.addEventListener('dragleave', function () { col.classList.remove('drop-on'); });
      col.addEventListener('drop', function (ev) {
        ev.preventDefault();
        col.classList.remove('drop-on');
        var id = ev.dataTransfer.getData('text/plain');
        var r = changeOrderStatus([id], st, '看板拖曳');
        if (r.done) toast(id + ' 已改為「' + st + '」');
        else if (r.denied) toast('你沒有修改 ' + id + ' 的權限');
        renderOrders();
        renderOverview();
      });
      host.appendChild(col);
    });
  }

  function renderOrderCalendar(list) {
    var host = $('#ord-cal');
    clear(host);
    var y = Number(calMonth.slice(0, 4)), m = Number(calMonth.slice(5, 7));
    var first = new Date(y, m - 1, 1).getDay();
    var days = new Date(y, m, 0).getDate();
    var inMonth = list.filter(function (o) { return o.date.slice(0, 7) === calMonth; });
    var sum = inMonth.filter(function (o) { return o.status !== '已取消'; }).reduce(function (s, o) { return s + o.amount; }, 0);
    var idList = inMonth.map(function (o) { return o.id; });

    function shift(n) {
      var d = new Date(y, m - 1 + n, 1);
      calMonth = d.getFullYear() + '-' + pad2(d.getMonth() + 1);
      renderOrders();
    }
    host.appendChild(el('div', { class: 'cal-head' }, [
      el('button', { class: 'btn btn-sm', type: 'button', text: '‹', 'aria-label': '上個月', onclick: function () { shift(-1); } }),
      el('strong', { class: 'cal-title', text: y + ' 年 ' + m + ' 月' }),
      el('button', { class: 'btn btn-sm', type: 'button', text: '›', 'aria-label': '下個月', onclick: function () { shift(1); } }),
      el('span', { class: 'spacer' }),
      el('span', { class: 'result-count', text: inMonth.length + ' 筆 · NT$ ' + nt(sum) }),
    ]));
    var grid = el('div', { class: 'cal-grid', role: 'grid' });
    ['日', '一', '二', '三', '四', '五', '六'].forEach(function (w) { grid.appendChild(el('div', { class: 'cal-wd', text: w })); });
    for (var i = 0; i < first; i++) grid.appendChild(el('div', { class: 'cal-cell cal-blank' }));
    for (var d = 1; d <= days; d++) {
      var ds = calMonth + '-' + pad2(d);
      var dayOrders = inMonth.filter(function (o) { return o.date === ds; });
      var cell = el('div', { class: 'cal-cell' + (ds === D.META.asOf ? ' cal-today' : '') }, [el('span', { class: 'cal-day', text: String(d) })]);
      dayOrders.slice(0, 3).forEach(function (o) {
        cell.appendChild(el('button', {
          type: 'button', class: 'cal-ev cal-ev-' + (ORDER_STATUS[o.status] || 'neutral'), title: o.id + ' ' + o.customer + ' NT$ ' + nt(o.amount),
          onclick: function () { openRecord('order', o.id, idList); },
        }, [o.customer]));
      });
      if (dayOrders.length > 3) {
        (function (dsCopy, n) {
          cell.appendChild(el('button', {
            type: 'button', class: 'link-btn cal-more', text: '+' + n + ' 筆',
            onclick: function () {
              var f = orderFilter();
              f.from = dsCopy; f.to = dsCopy;
              setOrderFilter(f);
              $('#ord-view').value = '';
              ordView = 'table';
              renderOrders();
            },
          }));
        })(ds, dayOrders.length - 3);
      }
      grid.appendChild(cell);
    }
    host.appendChild(grid);
  }

  function renderBulkBar() {
    var n = Object.keys(ordSelected).length;
    $('#ord-bulk').hidden = !n;
    $('#ord-bulk-count').textContent = '已選取 ' + n + ' 筆';
  }

  function selectedOrders() {
    return state.orders.filter(function (o) { return ordSelected[o.id]; });
  }

  /** 變更訂單狀態（看板拖曳、批次作業共用）；沒權限的筆數跳過並回報 */
  function changeOrderStatus(ids, status, note) {
    var ok = [], denied = 0;
    ids.forEach(function (id) {
      var o = byId(state.orders, id);
      if (!o || o.status === status) return;
      if (!canEditOrder(o)) { denied++; return; }
      ok.push(id);
    });
    if (ok.length) {
      commitSimple(function (st) {
        ok.forEach(function (id) {
          var o = byId(st.orders, id);
          if (!o) return;
          logRecord(st, 'order', id, '修改', [{ field: '狀態', from: o.status, to: status }], note || '');
          o.status = status;
        });
      }, (ok.length > 1 ? '批次' : '') + '將 ' + ok.length + ' 筆訂單改為「' + status + '」', '訂單');
    }
    return { done: ok.length, denied: denied };
  }

  function exportOrders(list, name) {
    var rows = [['訂單編號', '日期', '客戶', '通路', '茶品SKU', '品項', '金額', '狀態', '負責業務']];
    (list || visibleOrders()).forEach(function (o) {
      rows.push([o.id, o.date, o.customer, o.channel, o.sku || '', o.item, o.amount, o.status, o.owner]);
    });
    downloadCSV((name || '訂單明細') + '_' + D.META.asOf + '.csv', rows);
  }

  function refreshOwnerOptions() {
    var me = currentUser();
    [$('#ord-f-owner')].forEach(function (sel) {
      clear(sel);
      var allowed = allowedOwners();
      allowed.forEach(function (e) { sel.appendChild(el('option', { value: e.name, text: e.name })); });
      sel.value = me.name;
      sel.disabled = allowed.length === 1;
    });
    var adv = $('#ord-owner');
    var cur = adv.value;
    clear(adv);
    adv.appendChild(el('option', { value: '', text: '全部業務' }));
    visibleOrdersAll().map(function (o) { return o.owner; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; })
      .forEach(function (n) { adv.appendChild(el('option', { value: n, text: n })); });
    adv.value = cur;
  }

  function setupOrders() {
    var form = $('#ord-form');
    $('#ord-add-toggle').addEventListener('click', function () {
      form.hidden = !form.hidden;
      if (!form.hidden) { refreshOwnerOptions(); $('#ord-f-customer').focus(); }
    });
    $('#ord-f-cancel').addEventListener('click', function () { form.hidden = true; form.reset(); });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var customer = $('#ord-f-customer').value.trim();
      var item = $('#ord-f-item').value.trim();
      var amount = Number($('#ord-f-amount').value);
      if (!customer || !item || !(amount > 0)) { toast('請填寫客戶、品項，金額需大於 0'); return; }

      var me = currentUser();
      var owner = accessOf(me) === 'staff' ? me.name : $('#ord-f-owner').value;
      var sku = $('#ord-f-sku').value || null;
      var order = {
        id: '', date: D.META.asOf, customer: customer, channel: $('#ord-f-channel').value,
        item: item, amount: amount, status: $('#ord-f-status').value, owner: owner, sku: sku,
      };

      commitSimple(function (st) {
        order.id = nextOrderId(st);
        st.orders.unshift(order);
        logRecord(st, 'order', order.id, '新增', [], '建立訂單');
      }, '新增訂單 ' + customer, '訂單');

      form.reset();
      form.hidden = true;
      refreshOwnerOptions();
      renderOrders();
      renderOverview();
      toast('已新增訂單 ' + order.id);
      openRecord('order', order.id, [order.id]);
    });

    /* 選了茶品就帶入建議品項與金額（關聯欄位自動帶值） */
    $('#ord-f-sku').addEventListener('change', function () {
      var it = itemBySku(this.value);
      if (!it) return;
      var kg = 10;
      $('#ord-f-item').value = shortName(it) + ' (' + kg + 'kg)';
      $('#ord-f-amount').value = String(kg * it.unitPrice);
    });

    function refilter() { ordPage = 1; $('#ord-view').value = ''; $('#ord-view-del').hidden = true; renderOrders(); }
    $('#ord-search').addEventListener('input', refilter);
    $('#ord-status').addEventListener('change', refilter);
    $('#ord-channel').addEventListener('change', refilter);
    [['#ord-from', 'from'], ['#ord-to', 'to'], ['#ord-min', 'min'], ['#ord-max', 'max'], ['#ord-owner', 'owner']].forEach(function (p) {
      $(p[0]).addEventListener('change', function () { ordAdv[p[1]] = this.value; refilter(); });
    });
    $('#ord-adv-toggle').addEventListener('click', function () {
      var adv = $('#ord-adv');
      adv.hidden = !adv.hidden;
      this.setAttribute('aria-expanded', String(!adv.hidden));
    });

    $('#ord-view').addEventListener('change', function () {
      if (this.value) applyViewKey(this.value);
      else $('#ord-view-del').hidden = true;
    });
    $('#ord-view-save').addEventListener('click', function () {
      var f = $('#ord-view-form');
      f.hidden = !f.hidden;
      if (!f.hidden) $('#ord-view-name').focus();
    });
    $('#ord-view-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var name = $('#ord-view-name').value.trim();
      if (!name) { toast('請替這個檢視取個名字'); return; }
      var list = myViews();
      if (list.length >= 12) { toast('最多儲存 12 個檢視'); return; }
      list.push({ name: name, f: orderFilter() });
      writeMyViews(list);
      this.hidden = true;
      this.reset();
      renderViewSelect('u:' + (list.length - 1));
      toast('已儲存檢視「' + name + '」');
    });
    $('#ord-view-del').addEventListener('click', function () {
      var key = $('#ord-view').value;
      if (key.indexOf('u:') !== 0) return;
      var list = myViews();
      var gone = list.splice(Number(key.slice(2)), 1)[0];
      writeMyViews(list);
      renderViewSelect('');
      toast('已刪除檢視「' + (gone ? gone.name : '') + '」');
    });

    $('#ord-check-all').addEventListener('change', function () {
      var on = this.checked;
      (this._page || []).forEach(function (o) { if (on) ordSelected[o.id] = true; else delete ordSelected[o.id]; });
      renderOrders();
    });
    $('#ord-bulk-apply').addEventListener('click', function () {
      var st = $('#ord-bulk-status').value;
      if (!st) { toast('請先選擇要改成的狀態'); return; }
      var r = changeOrderStatus(Object.keys(ordSelected), st, '批次作業');
      toast('已更新 ' + r.done + ' 筆' + (r.denied ? '，' + r.denied + ' 筆沒有權限已略過' : ''));
      $('#ord-bulk-status').value = '';
      renderOrders();
      renderOverview();
    });
    $('#ord-bulk-print').addEventListener('click', function () { openPrint(selectedOrders()); });
    $('#ord-bulk-export').addEventListener('click', function () { exportOrders(selectedOrders(), '選取訂單'); });
    $('#ord-bulk-clear').addEventListener('click', function () { ordSelected = {}; renderOrders(); });
    $('#ord-export').addEventListener('click', function () { exportOrders(); });
    setupSorting('#ord-thead', orderSort, renderOrders);
  }

  /* =========================================================
     分頁四：茶品庫存（表格／圖卡）
     ========================================================= */

  var invView = 'table';

  function visibleInventory() {
    var q = $('#inv-search').value.trim().toLowerCase();
    var onlyLow = $('#inv-low').checked;
    return state.inventory.filter(function (r) {
      if (onlyLow && r.stock >= r.safety) return false;
      if (!q) return true;
      return (r.sku + r.name + r.origin + r.grade + r.lot).toLowerCase().indexOf(q) >= 0;
    });
  }

  /** 近三個月平均每月銷量（kg），用來估可銷售月數 */
  function monthlyKg(sku) {
    var recent = MONTHS.slice(-3);
    var kg = state.orders.filter(function (o) {
      return o.sku === sku && o.status !== '已取消' && recent.indexOf(o.date.slice(0, 7)) >= 0;
    }).reduce(function (s, o) { return s + kgOf(o); }, 0);
    return kg / recent.length;
  }
  function coverOf(r) {
    var per = monthlyKg(r.sku);
    return per > 0 ? r.stock / per : null;
  }

  function adjustStock(r, v) {
    commitSimple(function (st) {
      var row = st.inventory.filter(function (x) { return x.sku === r.sku; })[0];
      if (!row) return;
      logRecord(st, 'item', r.sku, '修改', [{ field: '庫存', from: String(row.stock), to: String(v) }], '庫存清單直接調整');
      row.stock = v;
    }, r.name + ' 庫存改為 ' + v + ' kg', '茶品庫存');
  }

  function renderInventory() {
    var me = currentUser();
    if (!me) return;
    var editable = canEditInventory();

    $('#inv-scope-note').textContent = editable
      ? '狀態依「庫存 ÷ 安全庫存」判定。可直接改庫存欄的數字，或點品項打開表單頁看銷售趨勢、版本紀錄與補貨簽核。'
      : '一般員工可查詢庫存與申請補貨，但不能直接調整數量。';
    $('#inv-adjust-head').textContent = editable ? '調整庫存' : '';

    segButtons($('#inv-viewseg'), [{ key: 'table', label: '表格' }, { key: 'gallery', label: '圖卡' }], invView,
      function (k) { invView = k; renderInventory(); });
    $('#inv-table-pane').hidden = invView !== 'table';
    $('#inv-gallery').hidden = invView !== 'gallery';

    var list = visibleInventory();
    var idList = list.map(function (r) { return r.sku; });
    var tbody = $('#inv-tbody');
    clear(tbody);
    var gallery = $('#inv-gallery');
    clear(gallery);

    if (!list.length) {
      tbody.appendChild(el('tr', null, [el('td', { colspan: '8', class: 'empty-state', text: '沒有符合條件的品項' })]));
      gallery.appendChild(el('div', { class: 'empty-state', text: '沒有符合條件的品項' }));
    }

    list.forEach(function (r) {
      var lv = stockLevel(r);
      function open() { openRecord('item', r.sku, idList); }
      var thumb = r.img ? el('img', {
        class: 'tea-thumb', src: D.IMG_BASE + r.img + '?width=120', alt: '', loading: 'lazy',
        onerror: function () { this.remove(); },
      }) : null;

      if (invView === 'table') {
        var cell;
        if (editable) {
          var input = el('input', {
            type: 'number', class: 'field', min: '0', step: '1', value: String(r.stock),
            style: 'width:92px', 'aria-label': r.name + ' 庫存量（公斤）',
            onclick: function (ev) { ev.stopPropagation(); },
            onkeydown: function (ev) { ev.stopPropagation(); },
          });
          input.addEventListener('change', function () {
            var v = Number(input.value);
            if (!(v >= 0)) { input.value = String(r.stock); return; }
            adjustStock(r, v);
            renderInventory();
            renderOverview();
            toast(r.name + ' 庫存更新為 ' + v + ' kg，已記入版本紀錄');
          });
          cell = el('td', null, [input]);
        } else {
          cell = el('td', null, [el('span', { class: 'cell-sub', text: '唯讀' })]);
        }
        var tr = el('tr', { class: 'clickable', tabindex: '0', 'aria-label': r.name + '，開啟表單頁' }, [
          el('td', null, [
            el('div', { class: 'tea-cell' }, [thumb, el('div', null, [
              el('div', { text: r.name }),
              el('div', { class: 'cell-sub', text: r.sku + ' · ' + r.lot }),
            ])]),
          ]),
          el('td', { text: r.origin }),
          el('td', { text: r.grade }),
          el('td', { class: 'num', text: nt(r.stock) }),
          el('td', { class: 'num', text: nt(r.safety) }),
          el('td', { class: 'num', text: nt(r.unitPrice) }),
          el('td', null, [chip(lv.key, lv.label)]),
          cell,
        ]);
        tr.addEventListener('click', open);
        tr.addEventListener('keydown', function (ev) {
          if (ev.target === tr && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); open(); }
        });
        tbody.appendChild(tr);
      } else {
        var ratio = clamp(r.stock / (r.safety * 2) * 100, 2, 100);
        gallery.appendChild(el('button', { type: 'button', class: 'tea-card', onclick: open }, [
          el('div', { class: 'tea-card-img' }, [r.img ? el('img', {
            src: D.IMG_BASE + r.img + '?width=360', alt: r.name, loading: 'lazy',
            onerror: function () { this.remove(); },
          }) : null]),
          el('div', { class: 'tea-card-body' }, [
            el('div', { class: 'tea-card-top' }, [el('span', { class: 'cell-sub', text: r.origin + ' · ' + r.grade }), chip(lv.key, lv.label)]),
            el('div', { class: 'tea-card-name', text: r.name }),
            el('div', { class: 'stock-bar', title: '庫存 ' + r.stock + ' / 安全量 ' + r.safety }, [
              el('span', { class: 'stock-fill stock-' + lv.key, style: 'width:' + ratio + '%' }),
              el('span', { class: 'stock-mark', style: 'left:50%' }),
            ]),
            el('div', { class: 'tea-card-foot' }, [
              el('span', null, [el('strong', { text: nt(r.stock) }), ' / ' + nt(r.safety) + ' kg']),
              el('span', { class: 'cell-sub', text: 'NT$ ' + nt(r.unitPrice) + '/kg' }),
            ]),
          ]),
        ]));
      }
    });

    var value = list.reduce(function (s, r) { return s + r.stock * r.unitPrice; }, 0);
    $('#inv-count').textContent = list.length + ' 項 · 庫存值 NT$ ' + nt(value);
  }

  function exportInventory() {
    var rows = [['SKU', '品名', '產地', '等級', '批號', '庫存(kg)', '安全庫存(kg)', '單價(元/kg)', '庫存值', '狀態']];
    visibleInventory().forEach(function (r) {
      rows.push([r.sku, r.name, r.origin, r.grade, r.lot, r.stock, r.safety, r.unitPrice, r.stock * r.unitPrice, stockLevel(r).label]);
    });
    downloadCSV('茶品庫存_' + D.META.asOf + '.csv', rows);
  }

  function setupInventory() {
    $('#inv-search').addEventListener('input', renderInventory);
    $('#inv-low').addEventListener('change', renderInventory);
    $('#inv-export').addEventListener('click', exportInventory);
    $('#inv-restock').addEventListener('click', function () { openApForm('restock', {}); });
  }

  /* =========================================================
     單筆表單頁（右側抽屜）：資料／關聯資料／版本紀錄／留言
     ========================================================= */

  var drawer = null;   // { type, id, tab, edit, list, snapshot }
  var drawerReturn = null;

  function drawerRecord() {
    if (!drawer) return null;
    return drawer.type === 'order' ? byId(state.orders, drawer.id) : itemBySku(drawer.id);
  }

  function openRecord(type, id, list) {
    if (!drawer) drawerReturn = document.activeElement;
    drawer = { type: type, id: id, tab: 'data', edit: false, list: list && list.indexOf(id) >= 0 ? list : [id] };
    $('#drawer').hidden = false;
    $('#drawer-backdrop').hidden = false;
    document.body.classList.add('no-scroll');
    renderDrawer();
    $('#drawer-close').focus();
  }

  function closeDrawer() {
    if (!drawer) return;
    drawer = null;
    $('#drawer').hidden = true;
    $('#drawer-backdrop').hidden = true;
    document.body.classList.remove('no-scroll');
    if (drawerReturn && document.body.contains(drawerReturn)) { try { drawerReturn.focus(); } catch (e) {} }
  }

  function stepDrawer(n) {
    if (!drawer || drawer.edit) return;
    var i = drawer.list.indexOf(drawer.id) + n;
    if (i < 0 || i >= drawer.list.length) return;
    drawer.id = drawer.list[i];
    drawer.notice = '';
    renderDrawer();
  }

  function kvRow(label, value) {
    return el('div', { class: 'kv' }, [el('dt', { text: label }), el('dd', null, [value === null || value === undefined || value === '' ? el('span', { class: 'cell-sub', text: '—' }) : value])]);
  }
  function formSec(title, rows) {
    return el('section', { class: 'form-sec' }, [el('h3', { class: 'form-sec-title', text: title }), el('dl', { class: 'kv-grid' }, rows)]);
  }
  function editRow(label, input, wide) {
    return el('label', { class: 'kv kv-edit' + (wide ? ' kv-wide' : '') }, [el('span', { class: 'kv-label', text: label }), input]);
  }
  function linkBtn(text, onclick) { return el('button', { type: 'button', class: 'rec-link', text: text, onclick: onclick }); }
  function selectOf(options, value) {
    var s = el('select', { class: 'field' });
    options.forEach(function (o) { s.appendChild(el('option', { value: o[0], text: o[1] })); });
    s.value = value === null || value === undefined ? '' : value;
    return s;
  }

  function renderDrawer() {
    if (!drawer) return;
    var rec = drawerRecord();
    if (!rec || (drawer.type === 'order' && visibleOrdersAll().indexOf(rec) < 0)) { closeDrawer(); return; }
    var isOrder = drawer.type === 'order';
    var hist = historyOf(drawer.type, drawer.id);
    var cmts = commentsOf(drawer.type, drawer.id);

    $('#drawer-kicker').textContent = (isOrder ? '訂單 · ' + rec.id : '茶品 · ' + rec.sku) + ' · v' + (hist.length + 1);
    $('#drawer-title').textContent = isOrder ? rec.customer : rec.name;
    var chipHost = $('#drawer-chip');
    clear(chipHost);
    if (isOrder) chipHost.appendChild(chip(ORDER_STATUS[rec.status] || 'neutral', rec.status));
    else { var lv = stockLevel(rec); chipHost.appendChild(chip(lv.key, lv.label)); }

    var idx = drawer.list.indexOf(drawer.id);
    $('#drawer-pos').textContent = drawer.list.length > 1 ? (idx + 1) + ' / ' + drawer.list.length : '';
    $('#drawer-prev').disabled = drawer.edit || idx <= 0;
    $('#drawer-next').disabled = drawer.edit || idx >= drawer.list.length - 1;

    var rel = isOrder ? relatedForOrder(rec) : relatedForItem(rec);
    segButtons($('#drawer-tabs'), [
      { key: 'data', label: '資料' },
      { key: 'links', label: '關聯資料', count: rel },
      { key: 'history', label: '版本紀錄', count: hist.length },
      { key: 'comments', label: '留言', count: cmts.length },
    ], drawer.tab, function (k) {
      if (drawer.edit && k !== 'data') { toast('請先儲存或取消編輯'); return; }
      drawer.tab = k;
      renderDrawer();
    });

    var body = $('#drawer-body');
    clear(body);
    var foot = $('#drawer-foot');
    clear(foot);
    if (drawer.notice) body.appendChild(el('div', { class: 'conflict' }, [el('div', { class: 'conflict-title', text: '資料已被他人更新' }), el('div', { class: 'conflict-body', text: drawer.notice })]));

    if (drawer.tab === 'data') {
      if (isOrder) drawerOrderData(rec, body, foot); else drawerItemData(rec, body, foot);
    } else if (drawer.tab === 'links') {
      if (isOrder) drawerOrderLinks(rec, body); else drawerItemLinks(rec, body);
    } else if (drawer.tab === 'history') {
      drawerHistory(rec, hist, body);
    } else {
      drawerComments(cmts, body);
    }
    foot.hidden = !foot.firstChild;
  }

  function relatedForOrder(o) {
    var same = visibleOrdersAll().filter(function (x) { return x.customer === o.customer && x.id !== o.id; }).length;
    var aps = visibleApprovals().filter(function (a) { return a.data.orderId === o.id; }).length;
    return same + aps + (o.sku ? 1 : 0) + 1;
  }
  function relatedForItem(r) {
    var orders = visibleOrdersAll().filter(function (o) { return o.sku === r.sku; }).length;
    var aps = visibleApprovals().filter(function (a) { return a.data.sku === r.sku; }).length;
    return orders + aps;
  }

  function systemInfo(hist) {
    var last = hist[0];
    var created = hist.filter(function (h) { return h.action === '新增' || h.action === '匯入'; })[0];
    return formSec('系統資訊', [
      kvRow('建立', created ? created.actor + ' · ' + created.ts : '系統匯入（期初資料）'),
      kvRow('最後修改', last ? last.actor + ' · ' + last.ts : '—'),
      kvRow('版本', 'v' + (hist.length + 1) + '（' + hist.length + ' 次異動）'),
    ]);
  }

  function drawerOrderData(o, body, foot) {
    var hist = historyOf('order', o.id);
    var item = o.sku ? itemBySku(o.sku) : null;
    var owner = empByName(o.owner);

    if (!drawer.edit) {
      body.appendChild(formSec('訂單資訊', [
        kvRow('訂單編號', el('span', { class: 'mono', text: o.id })),
        kvRow('訂單日期', o.date),
        kvRow('客戶', o.customer),
        kvRow('通路', o.channel),
        kvRow('負責業務', owner ? o.owner + '（' + owner.dept + '）' : o.owner),
      ]));
      body.appendChild(formSec('品項與金額', [
        kvRow('茶品', item ? linkBtn(item.name + ' · ' + item.sku, function () { openRecord('item', item.sku, [item.sku]); }) : el('span', { class: 'cell-sub', text: '客製品項（不對應單一茶品）' })),
        kvRow('品項說明', o.item),
        kvRow('金額', el('strong', { class: 'num', text: 'NT$ ' + nt(o.amount) })),
        kvRow('狀態', chip(ORDER_STATUS[o.status] || 'neutral', o.status)),
      ]));
      body.appendChild(systemInfo(hist));

      var can = canEditOrder(o);
      if (can) foot.appendChild(el('button', { class: 'btn btn-primary', type: 'button', text: '編輯', onclick: function () {
        drawer.edit = true;
        drawer.snapshot = JSON.stringify(o);
        drawer.notice = '';
        renderDrawer();
      } }));
      if (can && isOpenOrder(o)) foot.appendChild(el('button', { class: 'btn', type: 'button', text: '申請折扣', onclick: function () { openApForm('discount', { orderId: o.id }); } }));
      foot.appendChild(el('button', { class: 'btn', type: 'button', text: '列印出貨單', onclick: function () { openPrint([o]); } }));
      if (!can) foot.appendChild(el('span', { class: 'cell-sub', text: '你沒有修改這筆訂單的權限' }));
      return;
    }

    var inputs = {
      date: el('input', { class: 'field', type: 'date', value: o.date }),
      customer: el('input', { class: 'field', type: 'text', value: o.customer }),
      channel: selectOf(D.CHANNELS.map(function (c) { return [c.name, c.name]; }), o.channel),
      sku: selectOf([['', '（客製品項）']].concat(state.inventory.map(function (r) { return [r.sku, r.name + ' · ' + r.sku]; })), o.sku || ''),
      item: el('input', { class: 'field', type: 'text', value: o.item }),
      amount: el('input', { class: 'field', type: 'number', min: '1', step: '1', value: String(o.amount) }),
      status: selectOf(Object.keys(ORDER_STATUS).map(function (s) { return [s, s]; }), o.status),
      owner: selectOf(allowedOwners().map(function (e) { return [e.name, e.name]; }), o.owner),
    };
    if (accessOf(currentUser()) === 'staff') inputs.owner.disabled = true;
    body.appendChild(el('div', { class: 'form-sec' }, [
      el('h3', { class: 'form-sec-title', text: '編輯訂單 ' + o.id }),
      el('div', { class: 'kv-grid' }, [
        editRow('訂單日期', inputs.date), editRow('客戶', inputs.customer),
        editRow('通路', inputs.channel), editRow('負責業務', inputs.owner),
        editRow('茶品', inputs.sku, true), editRow('品項說明', inputs.item, true),
        editRow('金額（元）', inputs.amount), editRow('狀態', inputs.status),
      ]),
    ]));
    body.appendChild(el('p', { class: 'inline-note', text: '儲存時會比對版本：若有人在你編輯期間改過這筆，系統不會覆蓋，會請你重新開啟。' }));
    foot.appendChild(el('button', { class: 'btn', type: 'button', text: '取消', onclick: function () { drawer.edit = false; renderDrawer(); } }));
    foot.appendChild(el('button', { class: 'btn btn-primary', type: 'button', text: '儲存變更', onclick: function () {
      var vals = {
        date: inputs.date.value, customer: inputs.customer.value.trim(), channel: inputs.channel.value,
        sku: inputs.sku.value || null, item: inputs.item.value.trim(), amount: Number(inputs.amount.value),
        status: inputs.status.value, owner: inputs.owner.value,
      };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(vals.date) || !vals.customer || !vals.item || !(vals.amount > 0)) {
        toast('日期、客戶、品項必填，金額需大於 0');
        return;
      }
      saveRecord('order', vals, [
        ['date', '訂單日期'], ['customer', '客戶'], ['channel', '通路'], ['sku', '茶品'], ['item', '品項說明'],
        ['amount', '金額'], ['status', '狀態'], ['owner', '負責業務'],
      ]);
    } }));
  }

  /** 帶版本比對的單筆存檔：開始編輯後若共用資料已變，就不覆蓋 */
  function saveRecord(type, vals, fields) {
    var shared = readShared();
    if (shared) state = shared;
    var cur = drawerRecord();
    if (!cur) { closeDrawer(); return; }
    if (JSON.stringify(cur) !== drawer.snapshot) {
      var last = historyOf(type, drawer.id)[0];
      drawer.edit = false;
      drawer.notice = (last ? last.actor + ' 在 ' + last.ts + ' ' : '其他人') + '修改了這筆資料。你的變更沒有存入，已載入最新版本，請確認後再編輯。';
      renderAll();
      return;
    }
    var changes = [];
    fields.forEach(function (f) {
      var a = cur[f[0]], b = vals[f[0]];
      if (String(a === null || a === undefined ? '' : a) === String(b === null || b === undefined ? '' : b)) return;
      changes.push({ field: f[1], from: a === null || a === undefined ? '' : String(a), to: b === null || b === undefined ? '' : String(b) });
    });
    if (!changes.length) { drawer.edit = false; renderDrawer(); toast('沒有任何變更'); return; }
    var id = drawer.id;
    commitSimple(function (st) {
      var row = type === 'order' ? byId(st.orders, id) : st.inventory.filter(function (x) { return x.sku === id; })[0];
      fields.forEach(function (f) { row[f[0]] = vals[f[0]]; });
      logRecord(st, type, id, '修改', changes, '');
    }, '修改' + (type === 'order' ? '訂單 ' : '茶品 ') + id, type === 'order' ? '訂單' : '茶品庫存');
    drawer.edit = false;
    drawer.notice = '';
    renderAll();
    toast('已儲存，共 ' + changes.length + ' 個欄位變更，已記入版本紀錄');
  }

  function drawerItemData(r, body, foot) {
    var hist = historyOf('item', r.sku);
    if (r.img) {
      body.appendChild(el('div', { class: 'drawer-hero' }, [el('img', {
        src: D.IMG_BASE + r.img + '?width=640', alt: r.name, loading: 'lazy',
        onerror: function () { this.parentNode.remove(); },
      })]));
    }
    if (!drawer.edit) {
      var cover = coverOf(r);
      var lv = stockLevel(r);
      body.appendChild(formSec('基本資料', [
        kvRow('SKU', el('span', { class: 'mono', text: r.sku })), kvRow('品名', r.name),
        kvRow('產地', r.origin), kvRow('等級', r.grade), kvRow('批號', r.lot), kvRow('最後進貨', r.lastIn),
      ]));
      body.appendChild(formSec('庫存與價格', [
        kvRow('庫存', el('strong', { text: nt(r.stock) + ' kg' })),
        kvRow('安全庫存', nt(r.safety) + ' kg'),
        kvRow('狀態', chip(lv.key, lv.label)),
        kvRow('可銷售月數', cover === null ? '近三月無秤重銷售' : (cover >= 12 ? '12 個月以上' : cover.toFixed(1) + ' 個月')),
        kvRow('單價', 'NT$ ' + nt(r.unitPrice) + ' / kg'),
        kvRow('庫存值', 'NT$ ' + nt(r.stock * r.unitPrice)),
      ]));
      body.appendChild(systemInfo(hist));
      if (canEditInventory()) foot.appendChild(el('button', { class: 'btn btn-primary', type: 'button', text: '編輯', onclick: function () {
        drawer.edit = true;
        drawer.snapshot = JSON.stringify(r);
        drawer.notice = '';
        renderDrawer();
      } }));
      foot.appendChild(el('button', { class: 'btn', type: 'button', text: '申請補貨', onclick: function () { openApForm('restock', { sku: r.sku }); } }));
      if (!canEditInventory()) foot.appendChild(el('span', { class: 'cell-sub', text: '一般員工唯讀，可申請補貨' }));
      return;
    }
    var inputs = {
      stock: el('input', { class: 'field', type: 'number', min: '0', step: '1', value: String(r.stock) }),
      safety: el('input', { class: 'field', type: 'number', min: '0', step: '1', value: String(r.safety) }),
      unitPrice: el('input', { class: 'field', type: 'number', min: '1', step: '1', value: String(r.unitPrice) }),
      lot: el('input', { class: 'field', type: 'text', value: r.lot }),
    };
    body.appendChild(el('div', { class: 'form-sec' }, [
      el('h3', { class: 'form-sec-title', text: '編輯茶品 ' + r.sku }),
      el('div', { class: 'kv-grid' }, [
        editRow('庫存（kg）', inputs.stock), editRow('安全庫存（kg）', inputs.safety),
        editRow('單價（元/kg）', inputs.unitPrice), editRow('批號', inputs.lot),
      ]),
    ]));
    foot.appendChild(el('button', { class: 'btn', type: 'button', text: '取消', onclick: function () { drawer.edit = false; renderDrawer(); } }));
    foot.appendChild(el('button', { class: 'btn btn-primary', type: 'button', text: '儲存變更', onclick: function () {
      var vals = {
        stock: Number(inputs.stock.value), safety: Number(inputs.safety.value),
        unitPrice: Number(inputs.unitPrice.value), lot: inputs.lot.value.trim(),
      };
      if (!(vals.stock >= 0) || !(vals.safety >= 0) || !(vals.unitPrice > 0) || !vals.lot) { toast('數量不可為負、單價需大於 0、批號必填'); return; }
      saveRecord('item', vals, [['stock', '庫存'], ['safety', '安全庫存'], ['unitPrice', '單價'], ['lot', '批號']]);
    } }));
  }

  function miniOrderTable(list, emptyText) {
    if (!list.length) return el('div', { class: 'empty-state', text: emptyText });
    var ids = list.map(function (o) { return o.id; });
    var tb = el('tbody');
    list.forEach(function (o) {
      var tr = el('tr', { class: 'clickable', tabindex: '0' }, [
        el('td', { class: 'cell-sub', text: o.date }),
        el('td', null, [el('div', { text: o.customer }), el('div', { class: 'cell-sub', text: o.id + ' · ' + o.item })]),
        el('td', { class: 'num', text: nt(o.amount) }),
        el('td', null, [chip(ORDER_STATUS[o.status] || 'neutral', o.status)]),
      ]);
      tr.addEventListener('click', function () { openRecord('order', o.id, ids); });
      tr.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') openRecord('order', o.id, ids); });
      tb.appendChild(tr);
    });
    return el('div', { class: 'table-scroll' }, [el('table', { class: 'table-compact' }, [tb])]);
  }

  function apMiniList(list) {
    if (!list.length) return el('div', { class: 'empty-state', text: '沒有相關簽核單' });
    return el('div', { class: 'link-list' }, list.map(function (a) {
      return el('button', { type: 'button', class: 'link-card', onclick: function () { closeDrawer(); selectedAp = a.id; apTab = 'all'; goTo('panel-approvals'); renderApprovals(); } }, [
        el('div', null, [el('div', { text: apTitle(a) }), el('div', { class: 'cell-sub', text: a.id + ' · ' + empNameOf(a.applicant) + ' · ' + a.createdAt })]),
        apStatusChip(a),
      ]);
    }));
  }

  function drawerOrderLinks(o, body) {
    var item = o.sku ? itemBySku(o.sku) : null;
    var owner = empByName(o.owner);
    var cards = [];
    if (item) {
      var lv = stockLevel(item);
      cards.push(el('button', { type: 'button', class: 'link-card', onclick: function () { openRecord('item', item.sku, [item.sku]); } }, [
        item.img ? el('img', { class: 'tea-thumb', src: D.IMG_BASE + item.img + '?width=120', alt: '', onerror: function () { this.remove(); } }) : null,
        el('div', { class: 'link-card-main' }, [el('div', { class: 'cell-sub', text: '茶品' }), el('div', { text: item.name }), el('div', { class: 'cell-sub', text: '庫存 ' + nt(item.stock) + ' kg · 安全量 ' + nt(item.safety) + ' kg' })]),
        chip(lv.key, lv.label),
      ]));
    }
    if (owner) {
      cards.push(el('div', { class: 'link-card' }, [
        el('span', { class: 'avatar', text: owner.name.slice(0, 1) }),
        el('div', { class: 'link-card-main' }, [el('div', { class: 'cell-sub', text: '負責業務' }), el('div', { text: owner.name }), el('div', { class: 'cell-sub', text: owner.dept + ' · ' + owner.role })]),
      ]));
    }
    body.appendChild(el('section', { class: 'form-sec' }, [el('h3', { class: 'form-sec-title', text: '連結的資料' }), el('div', { class: 'link-list' }, cards)]));

    var same = visibleOrdersAll().filter(function (x) { return x.customer === o.customer && x.id !== o.id; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var total = same.filter(function (x) { return x.status !== '已取消'; }).reduce(function (s, x) { return s + x.amount; }, 0);
    body.appendChild(el('section', { class: 'form-sec' }, [
      el('h3', { class: 'form-sec-title' }, ['同客戶其他訂單', el('span', { class: 'cell-sub', text: '　' + same.length + ' 筆 · 累計 NT$ ' + nt(total) })]),
      miniOrderTable(same.slice(0, 8), '這位客戶沒有其他訂單'),
    ]));
    body.appendChild(el('section', { class: 'form-sec' }, [
      el('h3', { class: 'form-sec-title', text: '相關簽核單' }),
      apMiniList(visibleApprovals().filter(function (a) { return a.data.orderId === o.id; })),
    ]));
  }

  function drawerItemLinks(r, body) {
    var orders = visibleOrdersAll().filter(function (o) { return o.sku === r.sku; });
    var byMonth = MONTHS.map(function (m) {
      var list = orders.filter(function (o) { return o.date.slice(0, 7) === m && o.status !== '已取消'; });
      return { m: m, amt: list.reduce(function (s, o) { return s + o.amount; }, 0), kg: list.reduce(function (s, o) { return s + kgOf(o); }, 0) };
    });
    var max = Math.max.apply(null, byMonth.map(function (x) { return x.amt; }).concat([1]));
    var bars = el('div', { class: 'mini-bars', role: 'img', 'aria-label': '近六個月銷售額：' + byMonth.map(function (x) { return monthLabel(x.m) + ' ' + nt(x.amt) + ' 元'; }).join('、') });
    byMonth.forEach(function (x) {
      bars.appendChild(el('div', { class: 'mini-bar' }, [
        el('span', { class: 'mini-bar-val', text: x.amt ? wan(x.amt) : '—' }),
        el('span', { class: 'mini-bar-track' }, [el('span', { class: 'mini-bar-fill', style: 'height:' + Math.max(2, x.amt / max * 100) + '%' })]),
        el('span', { class: 'mini-bar-lbl', text: monthLabel(x.m) }),
      ]));
    });
    body.appendChild(el('section', { class: 'form-sec' }, [
      el('h3', { class: 'form-sec-title' }, ['近六個月銷售', el('span', { class: 'cell-sub', text: accessOf(currentUser()) === 'admin' ? '　全公司' : '　你權限內的訂單' })]),
      bars,
    ]));
    body.appendChild(el('section', { class: 'form-sec' }, [
      el('h3', { class: 'form-sec-title' }, ['使用這個茶品的訂單', el('span', { class: 'cell-sub', text: '　' + orders.length + ' 筆' })]),
      miniOrderTable(orders.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 8), '權限範圍內沒有這個茶品的訂單'),
    ]));
    body.appendChild(el('section', { class: 'form-sec' }, [
      el('h3', { class: 'form-sec-title', text: '補貨簽核單' }),
      apMiniList(visibleApprovals().filter(function (a) { return a.data.sku === r.sku; })),
    ]));
  }

  function drawerHistory(rec, hist, body) {
    var ol = el('ol', { class: 'timeline' });
    hist.forEach(function (h, i) {
      var rows = h.changes.map(function (c) {
        return el('tr', null, [
          el('td', { class: 'cell-sub', text: c.field }),
          el('td', null, [el('del', { class: 'diff-old', text: c.from || '（空白）' })]),
          el('td', { class: 'diff-arrow', 'aria-hidden': 'true', text: '→' }),
          el('td', null, [el('ins', { class: 'diff-new', text: c.to || '（空白）' })]),
        ]);
      });
      ol.appendChild(el('li', { class: 'tl-item' }, [
        el('span', { class: 'tl-dot' }),
        el('div', { class: 'tl-head' }, [
          el('strong', { text: 'v' + (hist.length - i + 1) }), ' · ' + h.action + ' · ', h.actor,
          el('span', { class: 'cell-sub', text: '　' + h.ts }),
        ]),
        h.note ? el('div', { class: 'tl-note', text: h.note }) : null,
        rows.length ? el('table', { class: 'diff-table' }, [el('tbody', null, rows)]) : null,
      ]));
    });
    ol.appendChild(el('li', { class: 'tl-item tl-origin' }, [
      el('span', { class: 'tl-dot' }),
      el('div', { class: 'tl-head' }, [el('strong', { text: 'v1' }), ' · 期初資料', el('span', { class: 'cell-sub', text: '　系統匯入' })]),
    ]));
    body.appendChild(el('p', { class: 'inline-note', style: 'margin:0 0 12px', text: '每一次儲存都會產生新版本，保留修改人、時間與每個欄位的前後值，不可刪除。' }));
    body.appendChild(ol);
  }

  function drawerComments(list, body) {
    var me = currentUser();
    var ul = el('ul', { class: 'comments' });
    if (!list.length) ul.appendChild(el('li', { class: 'empty-state', text: '還沒有留言。可以在這裡跟同事討論這筆資料。' }));
    list.forEach(function (c) {
      ul.appendChild(el('li', { class: 'comment' + (c.actor === me.name ? ' comment-me' : '') }, [
        el('span', { class: 'avatar avatar-sm', text: c.actor.slice(0, 1) }),
        el('div', { class: 'comment-main' }, [
          el('div', { class: 'comment-head' }, [el('strong', { text: c.actor }), el('span', { class: 'cell-sub', text: c.ts })]),
          el('div', { class: 'comment-text', text: c.text }),
        ]),
      ]));
    });
    body.appendChild(ul);
    var ta = el('textarea', { class: 'field', id: 'cm-text', rows: '3', placeholder: '輸入留言，Ctrl + Enter 送出', 'aria-label': '留言內容' });
    function send() {
      var text = ta.value.trim();
      if (!text) return;
      var key = drawer.type + ':' + drawer.id;
      var target = drawer.id;
      commitSimple(function (st) {
        if (!st.comments[key]) st.comments[key] = [];
        st.comments[key].push({ ts: nowStamp(), actor: me.name, text: text.slice(0, 500) });
      }, '在 ' + target + ' 留言', target);
      renderDrawer();
      toast('留言已送出');
      var again = $('#cm-text');
      if (again) again.focus();
    }
    ta.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); send(); } });
    body.appendChild(el('div', { class: 'comment-form' }, [ta, el('div', { class: 'comment-actions' }, [
      el('span', { class: 'cell-sub', text: '以 ' + me.name + ' 的身分留言，所有能看到這筆資料的人都看得到' }),
      el('button', { class: 'btn btn-primary btn-sm', id: 'cm-send', type: 'button', text: '送出留言', onclick: send }),
    ])]));
  }

  function setupDrawer() {
    $('#drawer-close').addEventListener('click', closeDrawer);
    $('#drawer-backdrop').addEventListener('click', closeDrawer);
    $('#drawer-prev').addEventListener('click', function () { stepDrawer(-1); });
    $('#drawer-next').addEventListener('click', function () { stepDrawer(1); });
    $('#drawer').addEventListener('keydown', function (ev) {
      if (drawer && !drawer.edit && ev.altKey && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        ev.preventDefault();
        stepDrawer(ev.key === 'ArrowDown' ? 1 : -1);
      }
    });
  }

  /* =========================================================
     簽核中心：補貨採購／特殊折扣／費用報支
     關卡依條件產生：部門主管 →（金額 ≥ 3 萬、折扣、或無主管時）會計覆核；
     申請人不能簽自己的單，最後一關核准後自動回寫庫存或訂單
     ========================================================= */

  var AP_STATUS = {
    pending:   { label: '簽核中', chip: 'warning' },
    approved:  { label: '已核准', chip: 'good' },
    rejected:  { label: '已駁回', chip: 'critical' },
    withdrawn: { label: '已撤回', chip: 'neutral' },
  };
  var STEP_LABEL = { approved: '核准', rejected: '駁回', pending: '待簽核', waiting: '尚未送達', skipped: '略過', void: '流程終止' };
  var AP_ADMIN_MIN = 30000;
  var COST_RATE = 0.6;   // 補貨以售價六成估進貨成本
  var apTab = 'todo';
  var selectedAp = null;
  var apForm = null;     // 新增申請表單的狀態

  function empNameOf(id) { var e = byId(state.employees, id); return e ? e.name : '—'; }
  function apStatusChip(a) { var s = AP_STATUS[a.status]; return chip(s.chip, s.label); }

  function apTitle(a) {
    if (a.type === 'restock') {
      var it = itemBySku(a.data.sku);
      return '補貨 ' + (it ? shortName(it) : a.data.sku) + ' ' + a.data.qty + ' kg';
    }
    if (a.type === 'discount') {
      var o = byId(state.orders, a.data.orderId);
      return (o ? o.customer : a.data.orderId) + ' 折扣 ' + a.data.pct + '%';
    }
    return a.data.desc;
  }

  function managerOf(dept) {
    return state.employees.filter(function (e) { return e.access === 'manager' && e.managesDept === dept; })[0] || null;
  }

  function buildSteps(type, applicant, amount) {
    var steps = [];
    var mgr = managerOf(applicant.dept);
    var skipped = false;
    if (!mgr) {
      steps.push({ label: '部門主管', approver: null, status: 'skipped', note: applicant.dept + '未設部門主管，依規定直接送會計覆核' });
      skipped = true;
    } else if (mgr.id === applicant.id) {
      steps.push({ label: '部門主管', approver: mgr.id, status: 'skipped', note: '申請人即部門主管，自動略過' });
      skipped = true;
    } else {
      steps.push({ label: '部門主管', approver: mgr.id, status: 'pending' });
    }
    if (skipped || amount >= AP_ADMIN_MIN || type === 'discount') {
      var adm = state.employees.filter(function (e) { return e.access === 'admin'; })[0];
      var first = steps[0].status === 'pending';
      if (adm && adm.id !== applicant.id) {
        steps.push({ label: '會計覆核', approver: adm.id, status: first ? 'waiting' : 'pending' });
      } else {
        /* 職能分離：會計自己的申請不能自己核，改送系統外的總經理 */
        steps.push({ label: '總經理簽核', approver: null, status: first ? 'waiting' : 'pending', note: '申請人為會計本人，依職能分離原則改由總經理線下簽核' });
      }
    }
    return steps;
  }

  function currentStep(a) {
    for (var i = 0; i < a.steps.length; i++) if (a.steps[i].status === 'pending') return a.steps[i];
    return null;
  }
  function canApprove(a) {
    var me = currentUser();
    var s = currentStep(a);
    return a.status === 'pending' && !!s && s.approver === me.id && a.applicant !== me.id;
  }
  function canSeeApproval(a) {
    var me = currentUser(), lv = accessOf(me);
    if (lv === 'admin' || a.applicant === me.id) return true;
    if (a.steps.some(function (s) { return s.approver === me.id; })) return true;
    var app = byId(state.employees, a.applicant);
    return lv === 'manager' && !!app && app.dept === me.managesDept;
  }
  function visibleApprovals() { return state.approvals.filter(canSeeApproval); }
  function myTodoApprovals() { return state.approvals.filter(canApprove); }

  function apListFor(tab) {
    var me = currentUser();
    var list = tab === 'todo' ? myTodoApprovals()
      : tab === 'mine' ? state.approvals.filter(function (a) { return a.applicant === me.id; })
        : visibleApprovals();
    var q = $('#ap-search').value.trim().toLowerCase();
    var ty = $('#ap-type').value;
    var st = $('#ap-status').value;
    return list.filter(function (a) {
      if (ty && a.type !== ty) return false;
      if (st && a.status !== st) return false;
      if (q && (a.id + apTitle(a) + empNameOf(a.applicant) + a.reason).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (x, y) { return x.createdAt < y.createdAt ? 1 : -1; });
  }

  function renderApprovals() {
    var me = currentUser();
    if (!me) return;
    var me2 = me;
    var counts = {
      todo: myTodoApprovals().length,
      mine: state.approvals.filter(function (a) { return a.applicant === me2.id; }).length,
      all: visibleApprovals().length,
    };
    segButtons($('#ap-tabs'), [
      { key: 'todo', label: '待我簽核', count: counts.todo },
      { key: 'mine', label: '我的申請', count: counts.mine },
      { key: 'all', label: accessOf(me) === 'admin' ? '全部簽核單' : accessOf(me) === 'manager' ? '本部門與經手' : '我經手的', count: counts.all },
    ], apTab, function (k) { apTab = k; selectedAp = null; renderApprovals(); });

    var list = apListFor(apTab);
    if (selectedAp && !list.some(function (a) { return a.id === selectedAp; })) {
      var keep = byId(state.approvals, selectedAp);
      if (!keep || !canSeeApproval(keep)) selectedAp = null;
    }
    if (!selectedAp && list.length) selectedAp = list[0].id;

    var tbody = $('#ap-tbody');
    clear(tbody);
    if (!list.length) {
      tbody.appendChild(el('tr', null, [el('td', { colspan: '5', class: 'empty-state', text: apTab === 'todo' ? '目前沒有等你簽核的單據 🎉' : '沒有符合條件的簽核單' })]));
    }
    list.forEach(function (a) {
      var step = currentStep(a);
      var tr = el('tr', { class: 'clickable' + (selectedAp === a.id ? ' is-active' : ''), tabindex: '0' }, [
        el('td', null, [el('div', { class: 'mono', text: a.id }), el('div', { class: 'cell-sub', text: a.createdAt.slice(0, 10) })]),
        el('td', null, [el('div', { class: 'cell-wrap', text: apTitle(a) }), el('div', { class: 'cell-sub', text: D.APPROVAL_TYPES[a.type].label })]),
        el('td', { text: empNameOf(a.applicant) }),
        el('td', { class: 'num', text: nt(a.amount) }),
        el('td', null, [apStatusChip(a), step ? el('div', { class: 'cell-sub', text: '目前：' + step.label + (step.approver ? ' · ' + empNameOf(step.approver) : '') }) : null]),
      ]);
      function pick() { selectedAp = a.id; renderApprovals(); }
      tr.addEventListener('click', pick);
      tr.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } });
      tbody.appendChild(tr);
    });
    $('#ap-count').textContent = list.length + ' 張';
    renderApDetail();
  }

  function renderApDetail() {
    var host = $('#ap-detail');
    clear(host);
    var a = selectedAp ? byId(state.approvals, selectedAp) : null;
    if (!a) {
      host.appendChild(el('div', { class: 'empty-state', text: '從左側選一張簽核單查看內容與流程' }));
      return;
    }
    var me = currentUser();
    var T = D.APPROVAL_TYPES[a.type];
    host.appendChild(el('div', { class: 'detail-head' }, [
      el('div', { class: 'ap-kicker' }, [el('span', { class: 'mono', text: a.id }), ' · ' + T.label]),
      el('div', { class: 'detail-name' }, [apTitle(a), ' ', apStatusChip(a)]),
      el('div', { class: 'detail-meta', text: empNameOf(a.applicant) + ' · ' + (byId(state.employees, a.applicant) || {}).dept + ' · ' + a.createdAt + ' 送出' }),
    ]));

    var rows = [kvRow('申請金額', el('strong', { text: 'NT$ ' + nt(a.amount) }))];
    if (a.type === 'restock') {
      var it = itemBySku(a.data.sku);
      rows.push(kvRow('茶品', it ? linkBtn(it.name, function () { openRecord('item', it.sku, [it.sku]); }) : a.data.sku));
      rows.push(kvRow('數量', a.data.qty + ' kg'));
      rows.push(kvRow('入庫批號', a.data.lot));
      if (it) rows.push(kvRow('目前庫存', nt(it.stock) + ' / 安全量 ' + nt(it.safety) + ' kg'));
    } else if (a.type === 'discount') {
      var o = byId(state.orders, a.data.orderId);
      var visible = o && visibleOrdersAll().indexOf(o) >= 0;
      rows.push(kvRow('訂單', o ? (visible ? linkBtn(o.id + ' · ' + o.customer, function () { openRecord('order', o.id, [o.id]); }) : o.id) : a.data.orderId));
      rows.push(kvRow('折扣', a.data.pct + '%'));
      if (o) rows.push(kvRow(a.status === 'approved' ? '折後金額' : '目前訂單金額', 'NT$ ' + nt(o.amount)));
    } else {
      rows.push(kvRow('費用類別', a.data.category));
      rows.push(kvRow('說明', a.data.desc));
    }
    host.appendChild(el('dl', { class: 'kv-grid' }, rows));
    host.appendChild(el('div', { class: 'section-label', text: '申請理由' }));
    host.appendChild(el('div', { class: 'quote', text: a.reason }));

    host.appendChild(el('div', { class: 'section-label', text: '簽核流程' }));
    var flow = el('ol', { class: 'flow' });
    flow.appendChild(el('li', { class: 'flow-step flow-approved' }, [
      el('span', { class: 'flow-dot', 'aria-hidden': 'true', text: '✓' }),
      el('div', null, [el('div', { class: 'flow-title' }, ['送出申請 · ', empNameOf(a.applicant)]), el('div', { class: 'cell-sub', text: a.createdAt })]),
    ]));
    a.steps.forEach(function (s) {
      var icon = { approved: '✓', rejected: '✕', pending: '●', waiting: '○', skipped: '–', void: '×' }[s.status];
      flow.appendChild(el('li', { class: 'flow-step flow-' + s.status }, [
        el('span', { class: 'flow-dot', 'aria-hidden': 'true', text: icon }),
        el('div', null, [
          el('div', { class: 'flow-title' }, [s.label + ' · ', s.approver ? empNameOf(s.approver) : '—', el('span', { class: 'flow-state', text: STEP_LABEL[s.status] })]),
          s.at ? el('div', { class: 'cell-sub', text: s.at }) : null,
          s.note ? el('div', { class: 'flow-note', text: s.note }) : null,
        ]),
      ]));
    });
    if (a.status === 'withdrawn') {
      flow.appendChild(el('li', { class: 'flow-step flow-void' }, [
        el('span', { class: 'flow-dot', 'aria-hidden': 'true', text: '↩' }),
        el('div', null, [el('div', { class: 'flow-title', text: '申請人撤回' }), el('div', { class: 'cell-sub', text: a.closedAt || '' })]),
      ]));
    }
    host.appendChild(flow);

    if (a.status === 'approved' && a.effect) host.appendChild(el('div', { class: 'locked-note', text: '✓ ' + a.effect }));

    if (canApprove(a)) {
      var note = el('textarea', { class: 'field', id: 'ap-note', rows: '2', placeholder: '簽核意見（駁回時必填）', 'aria-label': '簽核意見' });
      host.appendChild(el('div', { class: 'ap-action' }, [
        el('div', { class: 'editor-legend', text: '輪到你簽核（' + currentStep(a).label + '）' }),
        note,
        el('div', { class: 'action-row' }, [
          el('button', { class: 'btn btn-primary', id: 'ap-approve', type: 'button', text: '核准', onclick: function () { decideAp(a.id, 'approved', note.value.trim()); } }),
          el('button', { class: 'btn btn-danger', id: 'ap-reject', type: 'button', text: '駁回', onclick: function () {
            if (!note.value.trim()) { toast('駁回請填寫原因，申請人才知道要補什麼'); note.focus(); return; }
            decideAp(a.id, 'rejected', note.value.trim());
          } }),
        ]),
      ]));
    } else if (a.status === 'pending' && a.applicant === me.id) {
      host.appendChild(el('div', { class: 'action-row' }, [
        armedButton('撤回申請', '確定撤回', true, function () { withdrawAp(a.id); }),
      ]));
    } else if (a.status === 'pending') {
      var cs = currentStep(a);
      host.appendChild(el('p', { class: 'inline-note', text: '目前等待 ' + (cs ? cs.label + (cs.approver ? '（' + empNameOf(cs.approver) + '）' : '') : '') + ' 簽核。' }));
    }
  }

  /** 核准／駁回：先重讀共用資料，確認還輪得到我，避免兩個分頁重複簽 */
  function decideAp(id, decision, note) {
    var shared = readShared();
    if (shared) state = shared;
    var a = byId(state.approvals, id);
    if (!a || !canApprove(a)) {
      toast('這張簽核單剛被處理過，畫面已更新');
      renderAll();
      return;
    }
    var effect = '';
    commitSimple(function (st) {
      var ap = byId(st.approvals, id);
      var step = null;
      for (var i = 0; i < ap.steps.length; i++) if (ap.steps[i].status === 'pending') { step = ap.steps[i]; break; }
      step.status = decision;
      step.at = nowStamp();
      step.note = note || (decision === 'approved' ? '核准' : '');
      if (decision === 'rejected') {
        ap.status = 'rejected';
        ap.steps.forEach(function (s) { if (s.status === 'waiting') s.status = 'void'; });
        return;
      }
      var next = null;
      for (var j = 0; j < ap.steps.length; j++) if (ap.steps[j].status === 'waiting') { next = ap.steps[j]; break; }
      if (next) { next.status = 'pending'; return; }
      ap.status = 'approved';
      effect = applyApEffect(st, ap);
      ap.effect = effect;
    }, (decision === 'approved' ? '核准 ' : '駁回 ') + id, '簽核中心');
    renderAll();
    toast(decision === 'approved' ? (effect ? '已核准，' + effect : '已核准，送往下一關') : '已駁回，已通知申請人');
  }

  /** 最後一關核准後自動回寫資料，並記入該筆資料的版本紀錄 */
  function applyApEffect(st, ap) {
    if (ap.type === 'restock') {
      var it = st.inventory.filter(function (x) { return x.sku === ap.data.sku; })[0];
      if (!it) return '';
      var before = it.stock;
      it.stock += ap.data.qty;
      var changes = [{ field: '庫存', from: String(before), to: String(it.stock) }];
      if (ap.data.lot && ap.data.lot !== it.lot) { changes.push({ field: '批號', from: it.lot, to: ap.data.lot }); it.lot = ap.data.lot; }
      changes.push({ field: '最後進貨', from: it.lastIn, to: D.META.asOf });
      it.lastIn = D.META.asOf;
      logRecord(st, 'item', it.sku, '入庫', changes, '補貨簽核 ' + ap.id + ' 核准入庫 ' + ap.data.qty + ' kg', '簽核系統');
      return it.name + ' 已入庫 ' + ap.data.qty + ' kg（' + before + ' → ' + it.stock + ' kg）';
    }
    if (ap.type === 'discount') {
      var o = byId(st.orders, ap.data.orderId);
      if (!o) return '';
      var amt = Math.round(o.amount * (1 - ap.data.pct / 100));
      logRecord(st, 'order', o.id, '折扣', [{ field: '金額', from: String(o.amount), to: String(amt) }], '折扣簽核 ' + ap.id + ' 核准 ' + ap.data.pct + '%', '簽核系統');
      var txt = o.id + ' 金額已改為 NT$ ' + nt(amt);
      o.amount = amt;
      return txt;
    }
    return '費用已核准，會計將於下次付款作業撥款';
  }

  function withdrawAp(id) {
    var shared = readShared();
    if (shared) state = shared;
    var a = byId(state.approvals, id);
    if (!a || a.status !== 'pending') { toast('這張單已經結案，無法撤回'); renderAll(); return; }
    commitSimple(function (st) {
      var ap = byId(st.approvals, id);
      ap.status = 'withdrawn';
      ap.closedAt = nowStamp();
      ap.steps.forEach(function (s) { if (s.status === 'pending' || s.status === 'waiting') s.status = 'void'; });
    }, '撤回簽核單 ' + id, '簽核中心');
    renderAll();
    toast('已撤回 ' + id);
  }

  /* ---- 新增申請（表單欄位依類型切換，流程即時預覽）---- */
  function openApForm(type, preset) {
    apForm = { type: type || 'restock', preset: preset || {} };
    $('#ap-modal').hidden = false;
    renderApForm();
    var first = $('#ap-form select, #ap-form input');
    if (first) first.focus();
  }
  function closeApForm() { $('#ap-modal').hidden = true; apForm = null; }

  function apFormValues() {
    var v = { type: $('#apf-type').value, data: {}, amount: 0, reason: $('#apf-reason').value.trim() };
    if (v.type === 'restock') {
      var it = itemBySku($('#apf-sku').value);
      var qty = Number($('#apf-qty').value);
      v.data = { sku: $('#apf-sku').value, qty: qty, lot: $('#apf-lot').value.trim() };
      v.amount = it && qty > 0 ? Math.round(qty * it.unitPrice * COST_RATE) : 0;
    } else if (v.type === 'discount') {
      var o = byId(state.orders, $('#apf-order').value);
      var p = Number($('#apf-pct').value);
      v.data = { orderId: $('#apf-order').value, pct: p };
      v.amount = o && p > 0 ? Math.round(o.amount * p / 100) : 0;
    } else {
      v.data = { category: $('#apf-cat').value, desc: $('#apf-desc').value.trim() };
      v.amount = Number($('#apf-amount').value) || 0;
    }
    return v;
  }

  function discountableOrders() {
    return visibleOrdersAll().filter(function (o) { return isOpenOrder(o) && canEditOrder(o); });
  }

  function renderApForm() {
    var host = $('#ap-fields');
    clear(host);
    var t = apForm.type;
    var p = apForm.preset;
    $('#apf-type').value = t;
    $('#apf-type-note').textContent = D.APPROVAL_TYPES[t].note;

    function row(label, input, hint) {
      return el('label', { class: 'auth-field' }, [el('span', { text: label }), input, hint ? el('span', { class: 'cell-sub', text: hint }) : null]);
    }
    if (t === 'restock') {
      var sku = selectOf(state.inventory.map(function (r) { return [r.sku, r.name + '（現有 ' + r.stock + ' / 安全 ' + r.safety + ' kg）']; }), p.sku || (state.inventory.filter(function (r) { return r.stock < r.safety; })[0] || state.inventory[0]).sku);
      sku.id = 'apf-sku';
      var it0 = itemBySku(sku.value);
      var qty = el('input', { class: 'field', id: 'apf-qty', type: 'number', min: '1', step: '1', value: String(it0 ? Math.max(10, it0.safety * 2 - it0.stock) : 20) });
      var lot = el('input', { class: 'field', id: 'apf-lot', type: 'text', value: 'L2610-' + pad2(state.approvals.length + 1) });
      sku.addEventListener('change', function () {
        var it = itemBySku(sku.value);
        if (it) qty.value = String(Math.max(10, it.safety * 2 - it.stock));
        renderApPreview();
      });
      host.appendChild(row('茶品', sku));
      host.appendChild(el('div', { class: 'form-2' }, [row('數量（kg）', qty, '預設補到安全量的兩倍'), row('入庫批號', lot)]));
    } else if (t === 'discount') {
      var list = discountableOrders();
      if (!list.length) {
        host.appendChild(el('div', { class: 'locked-note', text: '你權限內沒有未結案、可修改的訂單，無法申請折扣。' }));
      } else {
        var ord = selectOf(list.map(function (o) { return [o.id, o.id + ' · ' + o.customer + ' · NT$ ' + nt(o.amount)]; }), p.orderId && list.some(function (o) { return o.id === p.orderId; }) ? p.orderId : list[0].id);
        ord.id = 'apf-order';
        host.appendChild(row('訂單', ord));
        host.appendChild(row('折扣（%）', el('input', { class: 'field', id: 'apf-pct', type: 'number', min: '1', max: '30', step: '1', value: '5' }), '上限 30%；折扣申請一律需會計覆核'));
      }
    } else {
      var cat = selectOf([['門市活動', '門市活動'], ['廣告投放', '廣告投放'], ['差旅', '差旅'], ['設備採購', '設備採購'], ['其他', '其他']], '門市活動');
      cat.id = 'apf-cat';
      host.appendChild(el('div', { class: 'form-2' }, [row('費用類別', cat), row('金額（元）', el('input', { class: 'field', id: 'apf-amount', type: 'number', min: '1', step: '1', value: '' }))]));
      host.appendChild(row('說明', el('input', { class: 'field', id: 'apf-desc', type: 'text', placeholder: '例：11 月冬茶品飲週茶席布置' })));
    }
    $$('#ap-fields input, #ap-fields select').forEach(function (n) { n.addEventListener('input', renderApPreview); });
    $('#apf-error').hidden = true;
    renderApPreview();
  }

  function renderApPreview() {
    if (!apForm) return;
    var v = apFormValues();
    var me = currentUser();
    var steps = buildSteps(v.type, me, v.amount);
    var host = $('#ap-preview');
    clear(host);
    host.appendChild(el('div', { class: 'ap-preview-amt' }, ['預估金額 ', el('strong', { text: 'NT$ ' + nt(v.amount) }), v.type === 'restock' ? el('span', { class: 'cell-sub', text: '（以售價 6 成估進貨成本）' }) : null]));
    var ol = el('ol', { class: 'flow flow-compact' });
    ol.appendChild(el('li', { class: 'flow-step flow-approved' }, [el('span', { class: 'flow-dot', text: '✓' }), el('div', { class: 'flow-title', text: '送出 · ' + me.name })]));
    steps.forEach(function (s) {
      ol.appendChild(el('li', { class: 'flow-step flow-' + (s.status === 'skipped' ? 'skipped' : 'waiting') }, [
        el('span', { class: 'flow-dot', text: s.status === 'skipped' ? '–' : '○' }),
        el('div', null, [el('div', { class: 'flow-title', text: s.label + ' · ' + (s.approver ? empNameOf(s.approver) : '—') }), s.note ? el('div', { class: 'flow-note', text: s.note }) : null]),
      ]));
    });
    host.appendChild(ol);
    host.appendChild(el('div', { class: 'cell-sub', text: '規則：金額 ≥ ' + nt(AP_ADMIN_MIN) + '、折扣申請、或部門主管關被略過時，加簽會計覆核。' }));
  }

  function submitApForm(ev) {
    ev.preventDefault();
    var v = apFormValues();
    var err = '';
    if (v.type === 'restock' && !(v.data.qty > 0 && v.data.qty <= 2000)) err = '數量需介於 1–2000 kg';
    if (v.type === 'restock' && !v.data.lot) err = '請填入庫批號';
    if (v.type === 'discount' && !v.data.orderId) err = '沒有可申請折扣的訂單';
    if (v.type === 'discount' && !(v.data.pct >= 1 && v.data.pct <= 30)) err = '折扣需介於 1–30%';
    if (v.type === 'expense' && (!v.data.desc || !(v.amount > 0))) err = '請填寫說明與金額';
    if (!err && v.reason.length < 6) err = '申請理由至少 6 個字，簽核人才能判斷';
    if (err) { var box = $('#apf-error'); box.textContent = err; box.hidden = false; return; }

    var me = currentUser();
    var ap = null;
    commitSimple(function (st) {
      var max = 0;
      st.approvals.forEach(function (a) { max = Math.max(max, Number(a.id.slice(-3)) || 0); });
      ap = {
        id: 'AP-2610-' + String(max + 1).padStart(3, '0'), type: v.type, applicant: me.id, createdAt: nowStamp(),
        status: 'pending', data: v.data, amount: v.amount, reason: v.reason, steps: buildSteps(v.type, me, v.amount),
      };
      st.approvals.unshift(ap);
    }, '送出簽核單', '簽核中心');
    closeApForm();
    closeDrawer();
    selectedAp = ap.id;
    apTab = 'mine';
    goTo('panel-approvals');
    renderAll();
    var s = currentStep(ap);
    toast('已送出 ' + ap.id + (s ? '，等待 ' + s.label + (s.approver ? '（' + empNameOf(s.approver) + '）' : '') : ''));
  }

  function setupApprovals() {
    Object.keys(D.APPROVAL_TYPES).forEach(function (k) {
      $('#ap-type').appendChild(el('option', { value: k, text: D.APPROVAL_TYPES[k].label }));
      $('#apf-type').appendChild(el('option', { value: k, text: D.APPROVAL_TYPES[k].label }));
    });
    Object.keys(AP_STATUS).forEach(function (k) {
      $('#ap-status').appendChild(el('option', { value: k, text: AP_STATUS[k].label }));
    });
    $('#ap-search').addEventListener('input', renderApprovals);
    $('#ap-type').addEventListener('change', renderApprovals);
    $('#ap-status').addEventListener('change', renderApprovals);
    $('#ap-new').addEventListener('click', function () { openApForm('restock', {}); });
    $('#apf-type').addEventListener('change', function () { apForm.type = this.value; apForm.preset = {}; renderApForm(); });
    $('#ap-form').addEventListener('submit', submitApForm);
    $('#apf-reason').addEventListener('input', function () { $('#apf-error').hidden = true; });
    $('#ap-cancel').addEventListener('click', closeApForm);
  }

  /* =========================================================
     報表中心：樞紐分析／業務排行／茶品銷售
     所有報表都從權限範圍內的訂單即時計算
     ========================================================= */

  var rpTab = 'pivot';
  var rpLast = null;   // 最近一次產生的表格，給匯出用
  var PIVOT_DIMS = {
    channel: { label: '通路', of: function (o) { return o.channel; } },
    owner:   { label: '負責業務', of: function (o) { return o.owner; } },
    status:  { label: '狀態', of: function (o) { return o.status; } },
    month:   { label: '月份', of: function (o) { return o.date.slice(0, 7); }, fmt: monthLabel },
    product: { label: '茶品', of: function (o) { var it = o.sku ? itemBySku(o.sku) : null; return it ? shortName(it) : '客製品項'; } },
    none:    { label: '（不分欄）', of: function () { return '合計'; } },
  };
  var PIVOT_MEASURES = {
    sum:   { label: '金額合計', calc: function (l) { return l.reduce(function (s, o) { return s + o.amount; }, 0); }, fmt: nt },
    count: { label: '訂單筆數', calc: function (l) { return l.length; }, fmt: function (n) { return String(n); } },
    avg:   { label: '平均客單價', calc: function (l) { return l.length ? l.reduce(function (s, o) { return s + o.amount; }, 0) / l.length : 0; }, fmt: nt },
  };

  function reportOrders() {
    var period = $('#rp-period').value;
    var noCancel = $('#rp-nocancel').checked;
    return visibleOrdersAll().filter(function (o) {
      if (noCancel && o.status === '已取消') return false;
      if (period && o.date.slice(0, 7) !== period) return false;
      return true;
    });
  }

  function renderReports() {
    var me = currentUser();
    if (!me) return;
    segButtons($('#rp-tabs'), [
      { key: 'pivot', label: '樞紐分析' }, { key: 'rank', label: '業務排行' }, { key: 'product', label: '茶品銷售與週轉' },
    ], rpTab, function (k) { rpTab = k; renderReports(); });
    $('#rp-pivot-ctl').hidden = rpTab !== 'pivot';
    $('#rp-scope').textContent = accessOf(me) === 'admin' ? '資料範圍：全公司'
      : accessOf(me) === 'manager' ? '資料範圍：' + me.managesDept + '與本人' : '資料範圍：僅本人負責的訂單';
    var host = $('#rp-body');
    clear(host);
    var list = reportOrders();
    if (rpTab === 'pivot') renderPivot(host, list);
    else if (rpTab === 'rank') renderRank(host, list);
    else renderProductReport(host, list);
  }

  function renderPivot(host, list) {
    var rk = $('#rp-rows').value, ck = $('#rp-cols').value, mk = $('#rp-measure').value;
    var R = PIVOT_DIMS[rk], C = PIVOT_DIMS[ck], M = PIVOT_MEASURES[mk];
    function uniq(fn) {
      return list.map(fn).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
    }
    var rows = uniq(R.of), cols = uniq(C.of);
    var cell = {}, max = 0;
    rows.forEach(function (r) {
      cols.forEach(function (c) {
        var v = M.calc(list.filter(function (o) { return R.of(o) === r && C.of(o) === c; }));
        cell[r + '|' + c] = v;
        if (v > max) max = v;
      });
    });
    var rowTotal = {};
    rows.forEach(function (r) { rowTotal[r] = M.calc(list.filter(function (o) { return R.of(o) === r; })); });
    rows.sort(function (a, b) { return rk === 'month' ? (a < b ? -1 : 1) : rowTotal[b] - rowTotal[a]; });
    var showTotalCol = ck !== 'none';
    var rfmt = R.fmt || String, cfmt = C.fmt || String;

    var thead = el('thead', null, [el('tr', null, [el('th', { text: R.label + ' ＼ ' + C.label })].concat(
      cols.map(function (c) { return el('th', { class: 'num', text: cfmt(c) }); }),
      showTotalCol ? [el('th', { class: 'num pivot-total', text: '總計' })] : []
    ))]);
    var tbody = el('tbody');
    var csv = [[R.label].concat(cols.map(cfmt), showTotalCol ? ['總計'] : [])];
    rows.forEach(function (r) {
      var line = [rfmt(r)];
      var tr = el('tr', null, [el('th', { scope: 'row', text: rfmt(r) })]);
      cols.forEach(function (c) {
        var v = cell[r + '|' + c];
        line.push(Math.round(v));
        var td = el('td', { class: 'num heat' }, [
          el('span', { class: 'heat-bg', style: 'opacity:' + (max ? (v / max * 0.85).toFixed(3) : 0) }),
          el('span', { class: 'heat-v' + (max && v / max > 0.7 ? ' heat-strong' : ''), text: v ? M.fmt(v) : '—' }),
        ]);
        tr.appendChild(td);
      });
      if (showTotalCol) { tr.appendChild(el('td', { class: 'num pivot-total', text: M.fmt(rowTotal[r]) })); line.push(Math.round(rowTotal[r])); }
      tbody.appendChild(tr);
      csv.push(line);
    });
    var totalLine = ['總計'];
    var tfoot = el('tfoot', null, [el('tr', null, [el('th', { scope: 'row', text: '總計' })].concat(
      cols.map(function (c) {
        var v = M.calc(list.filter(function (o) { return C.of(o) === c; }));
        totalLine.push(Math.round(v));
        return el('td', { class: 'num', text: M.fmt(v) });
      }),
      showTotalCol ? [el('td', { class: 'num', text: M.fmt(M.calc(list)) })] : []
    ))]);
    if (showTotalCol) totalLine.push(Math.round(M.calc(list)));
    csv.push(totalLine);
    rpLast = { name: '樞紐分析_' + R.label + 'x' + C.label, rows: csv };

    if (!list.length) { host.appendChild(el('div', { class: 'empty-state', text: '這個範圍沒有訂單資料' })); return; }
    host.appendChild(el('div', { class: 'table-scroll' }, [el('table', { class: 'pivot' }, [
      el('caption', { text: M.label + ' · 依' + R.label + '與' + C.label + ' · ' + list.length + ' 筆訂單 · 顏色越深數值越大' }), thead, tbody, tfoot,
    ])]));
  }

  function renderRank(host, list) {
    var by = {};
    list.forEach(function (o) {
      if (!by[o.owner]) by[o.owner] = { name: o.owner, amt: 0, n: 0, customers: {} };
      by[o.owner].amt += o.amount;
      by[o.owner].n++;
      by[o.owner].customers[o.customer] = true;
    });
    var arr = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.amt - a.amt; });
    var max = arr.length ? arr[0].amt : 1;
    var total = arr.reduce(function (s, x) { return s + x.amt; }, 0);
    rpLast = { name: '業務排行', rows: [['名次', '業務', '部門', '金額', '筆數', '客戶數', '平均客單', '占比']] };
    if (!arr.length) { host.appendChild(el('div', { class: 'empty-state', text: '這個範圍沒有訂單資料' })); return; }
    var ol = el('ol', { class: 'rank' });
    arr.forEach(function (x, i) {
      var e = empByName(x.name);
      var nCust = Object.keys(x.customers).length;
      rpLast.rows.push([i + 1, x.name, e ? e.dept : '', x.amt, x.n, nCust, Math.round(x.amt / x.n), (x.amt / total * 100).toFixed(1) + '%']);
      ol.appendChild(el('li', { class: 'rank-row' }, [
        el('span', { class: 'rank-no' + (i < 3 ? ' rank-top' : ''), text: String(i + 1) }),
        el('span', { class: 'avatar avatar-sm', text: x.name.slice(0, 1) }),
        el('div', { class: 'rank-who' }, [el('div', { text: x.name }), el('div', { class: 'cell-sub', text: (e ? e.dept : '') + ' · ' + x.n + ' 筆 · ' + nCust + ' 位客戶' })]),
        el('div', { class: 'rank-bar' }, [el('span', { class: 'rank-fill', style: 'width:' + Math.max(2, x.amt / max * 100) + '%' })]),
        el('div', { class: 'rank-val' }, [el('strong', { class: 'num', text: wan(x.amt) }), el('div', { class: 'cell-sub num', text: (x.amt / total * 100).toFixed(1) + '% · 客單 ' + wan(x.amt / x.n) })]),
      ]));
    });
    host.appendChild(ol);
  }

  function renderProductReport(host, list) {
    rpLast = { name: '茶品銷售與週轉', rows: [['SKU', '品名', '銷售額', '銷量(kg)', '庫存(kg)', '近三月月均(kg)', '可銷售月數']] };
    var tbody = el('tbody');
    var rows = state.inventory.map(function (r) {
      var mine = list.filter(function (o) { return o.sku === r.sku; });
      return {
        r: r, amt: mine.reduce(function (s, o) { return s + o.amount; }, 0),
        kg: mine.reduce(function (s, o) { return s + kgOf(o); }, 0), per: monthlyKg(r.sku),
      };
    }).sort(function (a, b) { return b.amt - a.amt; });
    var max = Math.max.apply(null, rows.map(function (x) { return x.amt; }).concat([1]));
    rows.forEach(function (x) {
      var cover = x.per > 0 ? x.r.stock / x.per : null;
      var level = cover === null ? 'neutral' : cover < 1 ? 'critical' : cover < 2 ? 'serious' : cover < 3 ? 'warning' : 'good';
      var label = cover === null ? '無近期銷售' : cover >= 12 ? '12 個月以上' : cover.toFixed(1) + ' 個月';
      rpLast.rows.push([x.r.sku, x.r.name, x.amt, x.kg, x.r.stock, x.per.toFixed(1), cover === null ? '' : cover.toFixed(1)]);
      var tr = el('tr', { class: 'clickable', tabindex: '0' }, [
        el('td', null, [el('div', { class: 'tea-cell' }, [
          x.r.img ? el('img', { class: 'tea-thumb', src: D.IMG_BASE + x.r.img + '?width=120', alt: '', loading: 'lazy', onerror: function () { this.remove(); } }) : null,
          el('div', null, [el('div', { text: x.r.name }), el('div', { class: 'cell-sub', text: x.r.sku })]),
        ])]),
        el('td', { class: 'bar-cell' }, [el('span', { class: 'inline-bar' }, [el('span', { style: 'width:' + Math.max(1, x.amt / max * 100) + '%' })]), el('span', { class: 'num', text: nt(x.amt) })]),
        el('td', { class: 'num', text: x.kg ? nt(x.kg) : '—' }),
        el('td', { class: 'num', text: nt(x.r.stock) }),
        el('td', { class: 'num', text: x.per ? x.per.toFixed(1) : '—' }),
        el('td', null, [chip(level, label)]),
      ]);
      tr.addEventListener('click', function () { openRecord('item', x.r.sku, rows.map(function (y) { return y.r.sku; })); });
      tr.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') tr.click(); });
      tbody.appendChild(tr);
    });
    host.appendChild(el('div', { class: 'table-scroll' }, [el('table', null, [
      el('caption', { text: '可銷售月數 = 庫存 ÷ 近三個月平均月銷量（僅計秤重出貨）；低於 1 個月建議立即補貨' }),
      el('thead', null, [el('tr', null, [
        el('th', { text: '茶品' }), el('th', { text: '銷售額（元）' }), el('th', { class: 'num', text: '銷量 kg' }),
        el('th', { class: 'num', text: '庫存 kg' }), el('th', { class: 'num', text: '月均 kg' }), el('th', { text: '可銷售' }),
      ])]),
      tbody,
    ])]));
  }

  function setupReports() {
    ['channel', 'owner', 'status', 'month', 'product'].forEach(function (k) {
      $('#rp-rows').appendChild(el('option', { value: k, text: PIVOT_DIMS[k].label }));
    });
    ['month', 'channel', 'status', 'none'].forEach(function (k) {
      $('#rp-cols').appendChild(el('option', { value: k, text: PIVOT_DIMS[k].label }));
    });
    Object.keys(PIVOT_MEASURES).forEach(function (k) {
      $('#rp-measure').appendChild(el('option', { value: k, text: PIVOT_MEASURES[k].label }));
    });
    MONTHS.slice().reverse().forEach(function (m) {
      $('#rp-period').appendChild(el('option', { value: m, text: '2026 年 ' + monthLabel(m) }));
    });
    $('#rp-rows').value = 'channel';
    $('#rp-cols').value = 'month';
    ['#rp-rows', '#rp-cols', '#rp-measure', '#rp-period', '#rp-nocancel'].forEach(function (s) {
      $(s).addEventListener('change', renderReports);
    });
    $('#rp-export').addEventListener('click', function () {
      if (!rpLast) return;
      downloadCSV(rpLast.name + '_' + D.META.asOf + '.csv', rpLast.rows);
    });
  }

  /* =========================================================
     全文檢索（Ctrl + K）：頁面、訂單、茶品、同仁、簽核單，依權限過濾
     ========================================================= */

  var searchHits = [];
  var searchIdx = 0;

  function openSearch() {
    if (!currentUser()) return;
    $('#search-modal').hidden = false;
    var input = $('#search-input');
    input.value = '';
    runSearch();
    input.focus();
  }
  function closeSearch() { $('#search-modal').hidden = true; }

  function runSearch() {
    var q = $('#search-input').value.trim().toLowerCase();
    var groups = [];
    function has(s) { return String(s).toLowerCase().indexOf(q) >= 0; }

    var pages = $$('.sidenav .tab').filter(function (t) { return !t.hidden; }).map(function (t) {
      var name = t.querySelector('span').textContent;
      return { label: name, sub: '前往頁面', icon: '↗', go: function () { goTo(t.getAttribute('aria-controls')); } };
    }).filter(function (p) { return !q || has(p.label); });
    if (pages.length) groups.push({ title: '頁面', items: pages.slice(0, q ? 6 : 8) });

    if (q) {
      var ords = visibleOrdersAll().filter(function (o) { return has(o.id + ' ' + o.customer + ' ' + o.item + ' ' + o.owner); })
        .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      if (ords.length) groups.push({ title: '訂單', total: ords.length, items: ords.slice(0, 6).map(function (o) {
        return { label: o.customer + ' · ' + o.item, sub: o.id + ' · ' + o.date + ' · NT$ ' + nt(o.amount) + ' · ' + o.status, icon: '▤', go: function () { goTo('panel-orders'); openRecord('order', o.id, ords.map(function (x) { return x.id; })); } };
      }) });
      var items = state.inventory.filter(function (r) { return has(r.sku + ' ' + r.name + ' ' + r.origin + ' ' + r.lot); });
      if (items.length) groups.push({ title: '茶品', total: items.length, items: items.slice(0, 5).map(function (r) {
        return { label: r.name, sub: r.sku + ' · ' + r.origin + ' · 庫存 ' + nt(r.stock) + ' kg', icon: '◇', go: function () { goTo('panel-inventory'); openRecord('item', r.sku, items.map(function (x) { return x.sku; })); } };
      }) });
      var emps = state.employees.filter(canSeeEmployee).filter(function (e) { return has(e.name + ' ' + e.role + ' ' + e.dept + ' ' + e.id); });
      if (emps.length) groups.push({ title: '同仁', total: emps.length, items: emps.slice(0, 5).map(function (e) {
        return { label: e.name, sub: e.dept + ' · ' + e.role, icon: '◉', go: function () { selectedEmp = e.id; detailDraft = null; goTo('panel-perf'); renderEmployeeTable(); renderEmployeeDetail(); } };
      }) });
      var aps = visibleApprovals().filter(function (a) { return has(a.id + ' ' + apTitle(a) + ' ' + empNameOf(a.applicant)); });
      if (aps.length) groups.push({ title: '簽核單', total: aps.length, items: aps.slice(0, 5).map(function (a) {
        return { label: apTitle(a), sub: a.id + ' · ' + empNameOf(a.applicant) + ' · ' + AP_STATUS[a.status].label, icon: '✓', go: function () { selectedAp = a.id; apTab = 'all'; goTo('panel-approvals'); renderApprovals(); } };
      }) });
    }

    searchHits = [];
    var host = $('#search-results');
    clear(host);
    groups.forEach(function (g) {
      host.appendChild(el('div', { class: 'search-group', text: g.title + (g.total > g.items.length ? '（顯示 ' + g.items.length + ' / ' + g.total + '）' : '') }));
      g.items.forEach(function (h) {
        var i = searchHits.length;
        searchHits.push(h);
        host.appendChild(el('button', {
          type: 'button', class: 'search-hit', role: 'option', id: 'sh-' + i,
          onclick: function () { closeSearch(); h.go(); },
          onmousemove: function () { if (searchIdx !== i) { searchIdx = i; markSearch(); } },
        }, [el('span', { class: 'search-ico', 'aria-hidden': 'true', text: h.icon }), el('span', null, [el('span', { class: 'search-label', text: h.label }), el('span', { class: 'cell-sub', text: h.sub })])]));
      });
    });
    if (!searchHits.length) host.appendChild(el('div', { class: 'empty-state', text: '找不到「' + q + '」。可搜尋訂單編號、客戶、茶品、批號、同仁姓名或簽核單號。' }));
    searchIdx = 0;
    markSearch();
  }

  function markSearch() {
    $$('.search-hit').forEach(function (n, i) { n.classList.toggle('is-active', i === searchIdx); n.setAttribute('aria-selected', String(i === searchIdx)); });
    var cur = $('#sh-' + searchIdx);
    if (cur) { cur.scrollIntoView({ block: 'nearest' }); $('#search-input').setAttribute('aria-activedescendant', cur.id); }
  }

  function setupSearch() {
    $('#search-open').addEventListener('click', openSearch);
    $('#search-modal').addEventListener('click', function (ev) { if (ev.target === this) closeSearch(); });
    $('#search-input').addEventListener('input', runSearch);
    $('#search-input').addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); searchIdx = Math.min(searchHits.length - 1, searchIdx + 1); markSearch(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); searchIdx = Math.max(0, searchIdx - 1); markSearch(); }
      else if (ev.key === 'Enter') { ev.preventDefault(); var h = searchHits[searchIdx]; if (h) { closeSearch(); h.go(); } }
    });
    document.addEventListener('keydown', function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'k' || ev.key === 'K')) { ev.preventDefault(); openSearch(); return; }
      if (ev.key !== 'Escape') return;
      if (!$('#search-modal').hidden) closeSearch();
      else if (!$('#print-modal').hidden) $('#print-modal').hidden = true;
      else if (!$('#import-modal').hidden) $('#import-modal').hidden = true;
      else if (!$('#ap-modal').hidden) closeApForm();
      else if (drawer) closeDrawer();
    });
  }

  /* =========================================================
     Excel / CSV 匯入：貼上或選檔 → 逐列檢查 → 只匯入通過的列
     ========================================================= */

  var IMPORT_COLS = { '日期': 'date', '客戶': 'customer', '通路': 'channel', '茶品SKU': 'sku', 'SKU': 'sku', '品項': 'item', '金額': 'amount', '狀態': 'status', '負責業務': 'owner' };
  var importRows = [];

  function parseCSV(text) {
    var rows = [], row = [], cur = '', q = false;
    text = text.replace(/^﻿/, '');
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === '\t') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.some(function (x) { return x.trim(); })) rows.push(row);
        row = [];
      } else cur += c;
    }
    row.push(cur);
    if (row.some(function (x) { return x.trim(); })) rows.push(row);
    return rows;
  }

  function validateImport(text) {
    var grid = parseCSV(text);
    importRows = [];
    if (grid.length < 2) return '至少需要標題列與一列資料';
    var head = grid[0].map(function (h) { return IMPORT_COLS[h.trim()] || null; });
    var need = ['date', 'customer', 'channel', 'item', 'amount'];
    var missing = need.filter(function (k) { return head.indexOf(k) < 0; });
    if (missing.length) return '缺少必要欄位：' + missing.map(function (k) { for (var n in IMPORT_COLS) if (IMPORT_COLS[n] === k) return n; return k; }).join('、');
    var me = currentUser();
    var owners = allowedOwners().map(function (e) { return e.name; });
    var channels = D.CHANNELS.map(function (c) { return c.name; });
    grid.slice(1).forEach(function (cells, i) {
      var o = { date: '', customer: '', channel: '', sku: null, item: '', amount: 0, status: '備貨中', owner: me.name };
      head.forEach(function (k, j) { if (k && cells[j] !== undefined) o[k] = cells[j].trim(); });
      o.amount = Number(String(o.amount).replace(/[,\s]/g, ''));
      if (!o.sku) o.sku = null;
      var errs = [];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date)) errs.push('日期格式需為 YYYY-MM-DD');
      if (!o.customer) errs.push('客戶必填');
      if (channels.indexOf(o.channel) < 0) errs.push('通路需為 ' + channels.join('／'));
      if (!o.item) errs.push('品項必填');
      if (!(o.amount > 0) || Math.round(o.amount) !== o.amount) errs.push('金額需為正整數');
      if (!ORDER_STATUS[o.status]) errs.push('狀態不正確');
      if (o.sku && !itemBySku(o.sku)) errs.push('查無茶品 ' + o.sku);
      if (owners.indexOf(o.owner) < 0) errs.push('你不能替「' + o.owner + '」建立訂單');
      var dup = state.orders.some(function (x) { return x.date === o.date && x.customer === o.customer && x.item === o.item && x.amount === o.amount; });
      if (dup) errs.push('與既有訂單重複');
      importRows.push({ line: i + 2, o: o, errs: errs });
    });
    return '';
  }

  function renderImportPreview() {
    var err = validateImport($('#imp-text').value);
    var host = $('#imp-preview');
    clear(host);
    var ok = importRows.filter(function (r) { return !r.errs.length; });
    $('#imp-go').disabled = !ok.length;
    $('#imp-go').textContent = ok.length ? '匯入 ' + ok.length + ' 筆' : '匯入';
    if (err) { host.appendChild(el('div', { class: 'auth-error', text: err })); return; }
    host.appendChild(el('div', { class: 'imp-sum' }, [
      chip('good', '可匯入 ' + ok.length), chip(importRows.length - ok.length ? 'critical' : 'neutral', '有問題 ' + (importRows.length - ok.length)),
      el('span', { class: 'cell-sub', text: '有問題的列不會匯入，修正後重新檢查即可' }),
    ]));
    var tb = el('tbody');
    importRows.forEach(function (r) {
      tb.appendChild(el('tr', { class: r.errs.length ? 'imp-bad' : '' }, [
        el('td', { class: 'cell-sub', text: String(r.line) }),
        el('td', { text: r.o.date }), el('td', { text: r.o.customer }), el('td', { text: r.o.channel }),
        el('td', { class: 'cell-wrap', text: r.o.item }), el('td', { class: 'num', text: r.o.amount ? nt(r.o.amount) : '' }),
        el('td', { text: r.o.owner }),
        el('td', null, [r.errs.length ? el('span', { class: 'imp-err', text: r.errs.join('；') }) : chip('good', '通過')]),
      ]));
    });
    host.appendChild(el('div', { class: 'table-scroll imp-table' }, [el('table', { class: 'table-compact' }, [
      el('thead', null, [el('tr', null, ['列', '日期', '客戶', '通路', '品項', '金額', '業務', '檢查結果'].map(function (h) { return el('th', { text: h }); }))]),
      tb,
    ])]));
  }

  function sampleImport() {
    var me = currentUser();
    return [
      '日期,客戶,通路,茶品SKU,品項,金額,狀態,負責業務',
      '2026-10-27,山嵐茶坊,批發,TEA-004,凍頂烏龍茶 (20kg),57000,備貨中,' + me.name,
      '2026-10-27,"晴川建設 · 客戶禮盒",企業客製,,客製錦雲禮盒 ×80,208000,待付款,' + me.name,
      '2026/10/27,個人客戶 · 何,電商,TEA-008,蜜香紅烏龍 (1kg),4100,已出貨,' + me.name,
      '2026-10-27,翠峰茶行,批發,TEA-099,不存在的茶 (5kg),abc,備貨中,' + me.name,
    ].join('\n');
  }

  function doImport() {
    var ok = importRows.filter(function (r) { return !r.errs.length; });
    if (!ok.length) return;
    var ids = [];
    commitSimple(function (st) {
      ok.forEach(function (r) {
        var o = deepCopy(r.o);
        o.id = nextOrderId(st);
        st.orders.unshift(o);
        logRecord(st, 'order', o.id, '匯入', [], '由 CSV 匯入');
        ids.push(o.id);
      });
    }, '匯入 ' + ok.length + ' 筆訂單', '訂單');
    $('#import-modal').hidden = true;
    setOrderFilter({});
    renderViewSelect('');
    renderAll();
    toast('已匯入 ' + ids.length + ' 筆：' + ids[0] + (ids.length > 1 ? ' 等' : ''));
  }

  function setupImport() {
    $('#ord-import').addEventListener('click', function () {
      $('#import-modal').hidden = false;
      $('#imp-text').value = '';
      importRows = [];
      clear($('#imp-preview'));
      $('#imp-go').disabled = true;
      $('#imp-go').textContent = '匯入';
      $('#imp-text').focus();
    });
    $('#imp-sample').addEventListener('click', function () { $('#imp-text').value = sampleImport(); renderImportPreview(); });
    $('#imp-template').addEventListener('click', function () {
      downloadCSV('訂單匯入範本.csv', [['日期', '客戶', '通路', '茶品SKU', '品項', '金額', '狀態', '負責業務'], [D.META.asOf, '客戶名稱', '批發', 'TEA-004', '凍頂烏龍茶 (20kg)', 57000, '備貨中', currentUser().name]]);
    });
    $('#imp-file').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      if (f.size > 2e6) { toast('檔案超過 2 MB'); return; }
      var reader = new FileReader();
      reader.onload = function () { $('#imp-text').value = String(reader.result); renderImportPreview(); };
      reader.readAsText(f, 'utf-8');
      this.value = '';
    });
    $('#imp-check').addEventListener('click', renderImportPreview);
    $('#imp-go').addEventListener('click', doImport);
    $('#imp-cancel').addEventListener('click', function () { $('#import-modal').hidden = true; });
  }

  /* =========================================================
     產生文件：出貨單（可多筆批次列印，或另存 PDF）
     ========================================================= */

  function openPrint(list) {
    if (!list.length) { toast('請先選取訂單'); return; }
    var host = $('#print-docs');
    clear(host);
    list.forEach(function (o) {
      var it = o.sku ? itemBySku(o.sku) : null;
      var kg = kgOf(o);
      var qty = kg ? kg + ' kg' : (/×\s*(\d+)/.exec(o.item) ? /×\s*(\d+)/.exec(o.item)[1] + ' 件' : '1 批');
      host.appendChild(el('article', { class: 'doc' }, [
        el('header', { class: 'doc-head' }, [
          el('div', { class: 'doc-brand' }, [
            el('div', { class: 'doc-brand-name', text: '長信名茶' }),
            el('div', { class: 'doc-brand-sub', text: 'Ever Trust Tea · Since 1971' }),
          ]),
          el('div', { class: 'doc-title' }, [el('div', { text: '出 貨 單' }), el('div', { class: 'doc-no', text: 'No. ' + o.id.replace('SO', 'DN') })]),
        ]),
        el('dl', { class: 'doc-meta' }, [
          el('dt', { text: '客戶' }), el('dd', { text: o.customer }),
          el('dt', { text: '訂單編號' }), el('dd', { text: o.id }),
          el('dt', { text: '訂單日期' }), el('dd', { text: o.date }),
          el('dt', { text: '出貨日期' }), el('dd', { text: D.META.asOf }),
          el('dt', { text: '通路' }), el('dd', { text: o.channel }),
          el('dt', { text: '業務' }), el('dd', { text: o.owner }),
        ]),
        el('table', { class: 'doc-table' }, [
          el('thead', null, [el('tr', null, [el('th', { text: '#' }), el('th', { text: '品項' }), el('th', { text: '茶品編號 / 批號' }), el('th', { class: 'num', text: '數量' }), el('th', { class: 'num', text: '金額（元）' })])]),
          el('tbody', null, [el('tr', null, [
            el('td', { text: '1' }), el('td', { text: o.item }),
            el('td', { text: it ? it.sku + ' / ' + it.lot : '客製品項' }),
            el('td', { class: 'num', text: qty }), el('td', { class: 'num', text: nt(o.amount) }),
          ])]),
          el('tfoot', null, [el('tr', null, [el('td', { colspan: '4', class: 'num', text: '合計（含稅）' }), el('td', { class: 'num', text: 'NT$ ' + nt(o.amount) })])]),
        ]),
        el('div', { class: 'doc-sign' }, [
          el('div', null, [el('span', { text: '出貨人' }), el('i')]),
          el('div', null, [el('span', { text: '覆核' }), el('i')]),
          el('div', null, [el('span', { text: '客戶簽收' }), el('i')]),
        ]),
        el('footer', { class: 'doc-foot', text: '本單由內部管理系統產生 · ' + nowStamp() + ' · 示範文件，非正式單據' }),
      ]));
    });
    $('#print-count').textContent = '共 ' + list.length + ' 張出貨單';
    $('#print-modal').hidden = false;
    $('#print-go').focus();
  }

  function setupPrint() {
    $('#print-go').addEventListener('click', function () { window.print(); });
    $('#print-close').addEventListener('click', function () { $('#print-modal').hidden = true; });
  }

  /* =========================================================
     權限矩陣（帳號與權限頁）
     ========================================================= */

  var PERM_MATRIX = [
    ['營運總覽', '個人業績與待辦', '＋營收圖表、部門績效', '全公司'],
    ['訂單管理', '本人訂單；未結可改', '本部門訂單可改、批次作業', '全部可改、匯入匯出'],
    ['茶品庫存', '查詢、申請補貨', '＋直接調整庫存與價格', '同主管'],
    ['簽核中心', '送出申請、追蹤進度', '＋簽核本部門申請', '＋會計覆核、看全部'],
    ['報表中心', '僅本人資料', '本部門資料', '全公司資料'],
    ['員工績效', '本人自評、申訴', '評核本部門同仁', '複核、定版、開新週期'],
    ['帳號與權限', '—', '—', '停用、解鎖、重設密碼'],
    ['稽核紀錄', '—', '—', '查詢、匯出'],
  ];

  function renderPermMatrix() {
    var me = currentUser();
    if (!me) return;
    var col = { staff: 1, manager: 2, admin: 3 }[accessOf(me)];
    var host = $('#perm-matrix');
    clear(host);
    host.appendChild(el('thead', null, [el('tr', null, [el('th', { text: '模組' })].concat(['staff', 'manager', 'admin'].map(function (k, i) {
      return el('th', { class: i + 1 === col ? 'perm-me' : '' }, [el('span', { class: 'access-badge access-' + k, text: D.ACCESS_LEVELS[k].label })]);
    })))]));
    var tb = el('tbody');
    PERM_MATRIX.forEach(function (r) {
      tb.appendChild(el('tr', null, r.map(function (c, i) {
        return el(i ? 'td' : 'th', { scope: i ? null : 'row', class: (i === col ? 'perm-me ' : '') + (c === '—' ? 'perm-none' : ''), text: c });
      })));
    });
    host.appendChild(tb);
  }

  /* =========================================================
     分頁切換 / 主題 / 啟動
     ========================================================= */

  function setupTabs() {
    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { goTo(tab.getAttribute('aria-controls')); });
    });
  }

  function setupTheme() {
    var btn = $('#theme-toggle');
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (saved) document.documentElement.setAttribute('data-theme', saved);

    function label() {
      btn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀ 淺色' : '☾ 深色';
    }
    label();

    btn.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      if (!cur) cur = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      var next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
      label();
      /* 圖表端點有 2px 表面色外環，換主題要重畫才吃得到新顏色 */
      if (currentUser() && canSeeCompanyFigures()) renderOverview();
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

  function renderHeaderUser() {
    var me = currentUser();
    if (!me) return;
    var sess = getSession() || {};
    var acct = getAccount(me.id) || {};
    $('#user-avatar').textContent = me.name.slice(0, 1);
    $('#user-name').textContent = me.name;
    $('#user-role').textContent = accessLabel(accessOf(me));
    var head = $('#user-menu-head');
    clear(head);
    head.appendChild(el('div', { class: 'menu-user-name', text: me.name }));
    head.appendChild(el('div', { class: 'cell-sub', text: acct.username + ' · ' + me.dept + ' · ' + me.role }));
    head.appendChild(el('div', { class: 'menu-user-meta' }, [
      el('span', { class: 'access-badge access-' + accessOf(me), text: accessLabel(accessOf(me)) }),
      sess.mfa ? el('span', { class: 'mfa-tag', text: '已通過兩步驟驗證' }) : null,
    ]));
    head.appendChild(el('div', { class: 'cell-sub', text: '上次登入：' + (sess.lastLogin || '首次登入') }));
    $('#cycle-label').textContent = D.CYCLE.period + ' 評核期 · ' + D.CYCLE.due + ' 截止';
    $$('.admin-only').forEach(function (n) { n.hidden = accessOf(me) !== 'admin'; });
  }

  function renderAll() {
    if (!currentUser()) return;
    renderHeaderUser();
    renderPresence();
    renderOverview();
    renderEmployeeTable();
    renderEmployeeDetail();
    refreshOwnerOptions();
    renderViewSelect($('#ord-view').value);
    renderOrders();
    renderInventory();
    renderApprovals();
    renderReports();
    renderAccounts();
    renderPermMatrix();
    renderAuthAudit();
    renderNotifBadge();
    if (drawer && !drawer.edit) renderDrawer();
  }

  function init() {
    loadState();
    if (!readShared()) saveState();   // 首次進站就把種子寫進共用區，跨分頁才看得到同一份

    /* 下拉選單選項由資料推導，不寫死 */
    state.employees.map(function (e) { return e.dept; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; })
      .forEach(function (d) { $('#emp-dept').appendChild(el('option', { value: d, text: d })); });

    Object.keys(D.WORKFLOW.states).forEach(function (k) {
      $('#emp-status').appendChild(el('option', { value: k, text: D.WORKFLOW.states[k].label }));
    });

    D.CHANNELS.forEach(function (c) {
      $('#ord-channel').appendChild(el('option', { value: c.name, text: c.name }));
      $('#ord-f-channel').appendChild(el('option', { value: c.name, text: c.name }));
    });
    $('#ord-status').appendChild(el('option', { value: '__open', text: '未結案' }));
    Object.keys(ORDER_STATUS).forEach(function (s) {
      $('#ord-status').appendChild(el('option', { value: s, text: s }));
      $('#ord-f-status').appendChild(el('option', { value: s, text: s }));
      $('#ord-bulk-status').appendChild(el('option', { value: s, text: '改為「' + s + '」' }));
    });
    state.inventory.forEach(function (r) {
      $('#ord-f-sku').appendChild(el('option', { value: r.sku, text: r.name + ' · ' + r.sku }));
    });

    setupTabs();
    setupTheme();
    setupOrders();
    setupInventory();
    setupDrawer();
    setupApprovals();
    setupReports();
    setupSearch();
    setupImport();
    setupPrint();

    $('#emp-search').addEventListener('input', renderEmployeeTable);
    $('#emp-dept').addEventListener('change', renderEmployeeTable);
    $('#emp-status').addEventListener('change', renderEmployeeTable);
    $('#emp-export').addEventListener('click', exportEmployees);
    $('#open-cycle').addEventListener('click', openCycle);
    setupSorting('#emp-thead', empSort, renderEmployeeTable);

    $('#reset-demo').addEventListener('click', resetState);
    $('#switch-user').addEventListener('click', function () { logout('logout'); });
    setupAuth();
    setupShell();

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

    var sess = getSession();
    if (sess && !sess.loginAt) setSession(null);   // 舊版「點身分直接進」留下的工作階段一律作廢
    if (currentUser()) { showApp(); announce(false); checkSession(); }
    else { renderLogin(); $('#lg-user').value ? $('#lg-pass').focus() : $('#lg-user').focus(); }

    setInterval(function () { announce(false); renderPresence(); }, 4000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
