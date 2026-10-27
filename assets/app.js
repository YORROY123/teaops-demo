/* ===========================================================
   長信名茶 內部管理與績效系統 — Demo
   傳統 script（非 ES module），file:// 直接開也能運作。

   三個重點：
   1. 權限分級   身分存在 sessionStorage，所以同一瀏覽器的不同分頁可以是不同人
   2. 評核流程   自評 → 主管評核 → 複核 → 定版（+ 申訴退回），每步留稽核軌跡
   3. 多人同時用 共用資料存 localStorage 當「伺服器」，存檔時比對版本號，
                 跨分頁用 BroadcastChannel 即時同步並顯示線上名單
   =========================================================== */
(function () {
  'use strict';

  var D = window.DEMO;
  var STORE_KEY = 'teaops-demo-v3';
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
    return { employees: employees, orders: deepCopy(D.ORDERS), inventory: deepCopy(D.INVENTORY) };
  }

  var state = defaultState();

  function readShared() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var saved = JSON.parse(raw);
      if (saved && saved.employees && saved.orders && saved.inventory) return saved;
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
    visibleOrdersAll().filter(function (o) { return o.status === '待付款'; }).forEach(function (o) {
      out.push({
        area: 'orders', level: 'neutral',
        text: '待付款：' + o.customer, sub: o.id + ' · NT$ ' + nt(o.amount) + ' · ' + o.owner,
        go: function () { $('#ord-status').value = '待付款'; goTo('panel-orders'); renderOrders(); },
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
    ['perf', 'orders', 'inventory', 'accounts'].forEach(function (k) {
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
     分頁三：訂單
     ========================================================= */

  var orderSort = { key: 'date', dir: 'desc' };

  function deptOfOwner(name) {
    var e = state.employees.filter(function (x) { return x.name === name; })[0];
    return e ? e.dept : '';
  }

  /** 權限範圍內的全部訂單（未套用畫面篩選） */
  function visibleOrdersAll() {
    var me = currentUser();
    if (accessOf(me) === 'admin') return state.orders;
    if (accessOf(me) === 'manager') {
      return state.orders.filter(function (o) { return deptOfOwner(o.owner) === me.managesDept || o.owner === me.name; });
    }
    return state.orders.filter(function (o) { return o.owner === me.name; });
  }

  function visibleOrders() {
    var q = $('#ord-search').value.trim().toLowerCase();
    var st = $('#ord-status').value;
    var ch = $('#ord-channel').value;
    var list = visibleOrdersAll().filter(function (o) {
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
    var me = currentUser();
    if (!me) return;

    $('#ord-scope-note').textContent = accessOf(me) === 'admin'
      ? '你看得到全公司訂單。'
      : accessOf(me) === 'manager'
        ? '你看得到 ' + me.managesDept + ' 的訂單。'
        : '你只看得到自己負責的訂單；新增訂單時負責人固定是你。';

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

    var sum = list.filter(function (o) { return o.status !== '已取消'; }).reduce(function (s, o) { return s + o.amount; }, 0);
    $('#ord-count').textContent = '共 ' + list.length + ' 筆 · 有效金額 NT$ ' + nt(sum);
  }

  function exportOrders() {
    var rows = [['訂單編號', '日期', '客戶', '通路', '品項', '金額', '狀態', '負責業務']];
    visibleOrders().forEach(function (o) {
      rows.push([o.id, o.date, o.customer, o.channel, o.item, o.amount, o.status, o.owner]);
    });
    downloadCSV('訂單明細_' + D.META.asOf + '.csv', rows);
  }

  function refreshOwnerOptions() {
    var me = currentUser();
    var sel = $('#ord-f-owner');
    clear(sel);
    var allowed = accessOf(me) === 'admin' ? state.employees
      : accessOf(me) === 'manager' ? state.employees.filter(function (e) { return e.dept === me.managesDept || e.id === me.id; })
        : [me];
    allowed.forEach(function (e) { sel.appendChild(el('option', { value: e.name, text: e.name })); });
    sel.value = me.name;
    sel.disabled = allowed.length === 1;
  }

  function setupOrderForm() {
    var form = $('#ord-form');
    $('#ord-add-toggle').addEventListener('click', function () {
      form.hidden = !form.hidden;
      this.textContent = form.hidden ? '＋ 新增訂單' : '收起表單';
      if (!form.hidden) { refreshOwnerOptions(); $('#ord-f-customer').focus(); }
    });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var customer = $('#ord-f-customer').value.trim();
      var item = $('#ord-f-item').value.trim();
      var amount = Number($('#ord-f-amount').value);
      if (!customer || !item || !(amount > 0)) { toast('請填寫客戶、品項，金額需大於 0'); return; }

      var me = currentUser();
      var owner = accessOf(me) === 'staff' ? me.name : $('#ord-f-owner').value;
      var order = {
        id: '', date: D.META.asOf, customer: customer, channel: $('#ord-f-channel').value,
        item: item, amount: amount, status: $('#ord-f-status').value, owner: owner,
      };

      commitSimple(function (st) {
        order.id = 'SO-261' + String(st.orders.length + 143).padStart(5, '0');
        st.orders.unshift(order);
      }, '新增訂單 ' + customer, '訂單');

      form.reset();
      refreshOwnerOptions();
      renderOrders();
      renderOverview();
      toast('已新增訂單 ' + order.id);
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
    var me = currentUser();
    if (!me) return;
    var editable = canEditInventory();

    $('#inv-scope-note').textContent = editable
      ? '狀態依「庫存 ÷ 安全庫存」判定：< 0.6 急需補貨、< 1.0 低於安全量、< 1.3 接近下限。可直接改最右欄的數字。'
      : '一般員工可查詢庫存，但不能調整數量。想試調整，請切換成部門主管或系統管理員。';
    $('#inv-adjust-head').textContent = editable ? '調整庫存' : '（唯讀）';

    var list = visibleInventory();
    var tbody = $('#inv-tbody');
    clear(tbody);

    if (!list.length) {
      tbody.appendChild(el('tr', null, [el('td', { colspan: '8', class: 'empty-state', text: '沒有符合條件的品項' })]));
    }

    list.forEach(function (r) {
      var lv = stockLevel(r);
      var cell;
      if (editable) {
        var input = el('input', {
          type: 'number', class: 'field', min: '0', step: '1', value: String(r.stock),
          style: 'width:92px', 'aria-label': r.name + ' 庫存量（公斤）',
        });
        input.addEventListener('change', function () {
          var v = Number(input.value);
          if (!(v >= 0)) { input.value = String(r.stock); return; }
          commitSimple(function (st) {
            var row = st.inventory.filter(function (x) { return x.sku === r.sku; })[0];
            if (row) row.stock = v;
          }, r.name + ' 庫存改為 ' + v + ' kg', '茶品庫存');
          renderInventory();
          renderOverview();
          toast(r.name + ' 庫存更新為 ' + v + ' kg');
        });
        cell = el('td', null, [input]);
      } else {
        cell = el('td', null, [el('span', { class: 'cell-sub', text: '無編輯權限' })]);
      }

      tbody.appendChild(el('tr', null, [
        el('td', null, [
          el('div', { class: 'tea-cell' }, [
            r.img ? el('img', {
              class: 'tea-thumb', src: D.IMG_BASE + r.img + '?width=120', alt: '', loading: 'lazy',
              onerror: function () { this.remove(); },
            }) : null,
            el('div', null, [
              el('div', { text: r.name }),
              el('div', { class: 'cell-sub', text: r.sku + ' · ' + r.lot }),
            ]),
          ]),
        ]),
        el('td', { text: r.origin }),
        el('td', { text: r.grade }),
        el('td', { class: 'num', text: nt(r.stock) }),
        el('td', { class: 'num', text: nt(r.safety) }),
        el('td', { class: 'num', text: nt(r.unitPrice) }),
        el('td', null, [chip(lv.key, lv.label)]),
        cell,
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
    renderOrders();
    renderInventory();
    renderAccounts();
    renderAuthAudit();
    renderNotifBadge();
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
    Object.keys(ORDER_STATUS).forEach(function (s) {
      $('#ord-status').appendChild(el('option', { value: s, text: s }));
      $('#ord-f-status').appendChild(el('option', { value: s, text: s }));
    });

    setupTabs();
    setupTheme();
    setupOrderForm();

    $('#emp-search').addEventListener('input', renderEmployeeTable);
    $('#emp-dept').addEventListener('change', renderEmployeeTable);
    $('#emp-status').addEventListener('change', renderEmployeeTable);
    $('#emp-export').addEventListener('click', exportEmployees);
    $('#open-cycle').addEventListener('click', openCycle);
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
