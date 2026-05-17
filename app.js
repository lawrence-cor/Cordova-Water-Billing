/* ══════════════════════════════════════════════════════
   BILLING TRACKER — app.js
   ══════════════════════════════════════════════════════

   SETUP CHECKLIST
   ───────────────
   1. Create a free Supabase project at https://supabase.com
   2. Run supabase-setup.sql in the SQL Editor
   3. Fill in SUPABASE_URL and SUPABASE_ANON below
   4. Host index.html + style.css + app.js on GitHub Pages
      (Settings → Pages → Deploy from branch: main / root)

   ══════════════════════════════════════════════════════ */

// ── Supabase config ───────────────────────────────────
const SUPABASE_URL  = 'https://eztutdgqsqkoivshflgv.supabase.co';
const SUPABASE_ANON = 'sb_publishable_PRo6bOt_InAW4eaoBokiLw_CrXIwaHE';

// ── Family password gate ──────────────────────────────
const FAMILY_NAME = 'Cordova';
const FAMILY_PASS = '1234';
const AUTH_KEY    = 'bt_family_auth';   // localStorage key

// ─────────────────────────────────────────────────────
//  SUPABASE CLIENT
// ─────────────────────────────────────────────────────
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: false }   // we handle our own session
});

// ─────────────────────────────────────────────────────
//  IN-MEMORY STATE
// ─────────────────────────────────────────────────────
let recipients   = [];
let transactions = [];
let currentDetail = null;
let clockInterval = null;

// ─────────────────────────────────────────────────────
//  UTILITY
// ─────────────────────────────────────────────────────
const fmt2    = n  => String(n).padStart(2, '0');
const fmtTime = (h, m, p) => `${fmt2(h)}:${fmt2(m)} ${p}`;
const fmtDate = iso => new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
const esc     = s  => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const empty   = (icon, txt) => `<div class="empty"><div class="empty-icon">${icon}</div><div class="empty-text">${txt}</div></div>`;
const genId   = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 18);

// ─────────────────────────────────────────────────────
//  TOAST (in-app notifications)
// ─────────────────────────────────────────────────────
function showToast(title, body, type = '') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<div class="toast-title">${title}</div><div class="toast-body">${body}</div>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .4s ease, transform .4s ease';
    el.style.opacity = '0'; el.style.transform = 'translateY(-8px) scale(.97)';
    setTimeout(() => el.remove(), 420);
  }, 4500);
}

// ─────────────────────────────────────────────────────
//  PUSH / BROWSER NOTIFICATIONS
// ─────────────────────────────────────────────────────
async function requestNotifPermission() {
  if (!('Notification' in window)) return;
  const perm = await Notification.requestPermission();
  renderNotifBar();
  if (perm === 'granted') showToast('Notifications on', 'You\'ll be notified when sessions start & stop.', 'success');
}

function fireNotification(title, body) {
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: 'https://em-content.zobj.net/source/apple/391/droplet_1f4a7.png' });
  }
  // Also show in-app toast so everyone on screen sees it too
  const type = title.toLowerCase().includes('finish') ? 'success' : 'warn';
  showToast(title, body, type);
}

function renderNotifBar() {
  const bar = document.getElementById('notif-bar');
  if (!bar) return;
  if (!('Notification' in window) || Notification.permission === 'granted') {
    bar.style.display = 'none';
  } else {
    bar.style.display = 'flex';
  }
}

// ─────────────────────────────────────────────────────
//  SUPABASE REALTIME — broadcast timer events to all
//  family members who have the app open
// ─────────────────────────────────────────────────────
let realtimeChannel = null;

function subscribeRealtime() {
  realtimeChannel = db.channel('family-timer-events')
    .on('broadcast', { event: 'timer' }, ({ payload }) => {
      handleTimerBroadcast(payload);
    })
    .subscribe();
}

function broadcastTimerEvent(payload) {
  if (!realtimeChannel) return;
  realtimeChannel.send({ type: 'broadcast', event: 'timer', payload });
}

function handleTimerBroadcast(payload) {
  const { type, recipientName, startTime, cost, mins } = payload;
  if (type === 'start') {
    fireNotification(
      `⏱ Session Started`,
      `${recipientName} started using water at ${startTime}`
    );
  } else if (type === 'stop') {
    fireNotification(
      `✅ Session Finished`,
      `${recipientName} finished using water at ${startTime}. ${mins} min · ₱${cost}`
    );
  }
}

// ─────────────────────────────────────────────────────
//  AUTH (family password gate)
// ─────────────────────────────────────────────────────
function isAuthenticated() {
  return localStorage.getItem(AUTH_KEY) === 'yes';
}

function doLogin() {
  const name = document.getElementById('login-name').value.trim();
  const pass = document.getElementById('login-pass').value;
  const err  = document.getElementById('login-err');

  if (name.toLowerCase() !== FAMILY_NAME.toLowerCase() || pass !== FAMILY_PASS) {
    err.textContent = 'Incorrect family name or password.';
    err.style.display = 'block';
    document.getElementById('login-pass').value = '';
    return;
  }
  err.style.display = 'none';
  localStorage.setItem(AUTH_KEY, 'yes');
  showApp();
}

function doLogout() {
  localStorage.removeItem(AUTH_KEY);
  location.reload();
}

// Allow Enter key in login form
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('screen-login').style.display !== 'none') {
    doLogin();
  }
});

// ─────────────────────────────────────────────────────
//  SCREEN MANAGEMENT
// ─────────────────────────────────────────────────────
function showLoading(show) {
  document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none';
}

async function showApp() {
  document.getElementById('screen-login').style.display = 'none';
  document.getElementById('app-shell').style.display    = 'block';
  showLoading(true);
  await loadData();
  subscribeRealtime();
  renderNotifBar();
  renderHome();
  refreshTxSelect();
  restoreManualEntry();   // rebuild manual entry step from localStorage if pending
  updateNavDot();
  renderTimer();
  showLoading(false);
}

function boot() {
  showLoading(false);
  if (isAuthenticated()) {
    document.getElementById('screen-login').style.display = 'none';
    showApp();
  } else {
    document.getElementById('screen-login').style.display = 'flex';
    document.getElementById('app-shell').style.display    = 'none';
  }
}

// ─────────────────────────────────────────────────────
//  DATA — load from Supabase (shared family tables)
// ─────────────────────────────────────────────────────
async function loadData() {
  const [rRes, tRes] = await Promise.all([
    db.from('recipients').select('*').order('created_at'),
    db.from('transactions').select('*').order('date', { ascending: false })
  ]);

  if (!rRes.error && rRes.data) recipients   = rRes.data.map(mapR);
  if (!tRes.error && tRes.data) transactions = tRes.data.map(mapT);
}

function mapR(r) { return { id: r.id, name: r.name }; }
function mapT(t) {
  return {
    id: t.id, recipientId: t.recipient_id, recipientName: t.recipient_name,
    sh: t.sh, sm: t.sm, sp: t.sp, eh: t.eh, em: t.em, ep: t.ep,
    mins: t.mins, cost: t.cost, paid: t.paid, date: t.date
  };
}

// ─────────────────────────────────────────────────────
//  SUPABASE CRUD
// ─────────────────────────────────────────────────────
async function dbInsertRecipient(r) {
  const { error } = await db.from('recipients').insert({ id: r.id, name: r.name });
  if (error) console.error('insertRecipient:', error.message);
}

async function dbDeleteRecipient(id) {
  await db.from('recipients').delete().eq('id', id);
}

async function dbInsertTransaction(t) {
  const { error } = await db.from('transactions').insert({
    id: t.id, recipient_id: t.recipientId, recipient_name: t.recipientName,
    sh: t.sh, sm: t.sm, sp: t.sp, eh: t.eh, em: t.em, ep: t.ep,
    mins: t.mins, cost: t.cost, paid: t.paid, date: t.date
  });
  if (error) console.error('insertTransaction:', error.message);
}

async function dbTogglePaid(id, paid) {
  await db.from('transactions').update({ paid }).eq('id', id);
}

async function dbDeleteTransaction(id) {
  await db.from('transactions').delete().eq('id', id);
}

// ─────────────────────────────────────────────────────
//  COST CALCULATION
// ─────────────────────────────────────────────────────
function calcCostHM(sh, sm, sp, eh, em, ep) {
  let s = (sp === 'PM' && sh !== 12 ? sh + 12 : sp === 'AM' && sh === 12 ? 0 : sh) * 60 + sm;
  let e = (ep === 'PM' && eh !== 12 ? eh + 12 : ep === 'AM' && eh === 12 ? 0 : eh) * 60 + em;
  if (e <= s) e += 24 * 60;
  const mins = e - s;
  return { cost: Math.floor(mins / 5) * 6 + (mins % 5), mins };
}

function calcCostMs(ms) {
  const mins = Math.floor(ms / 60000);
  return { cost: Math.floor(mins / 5) * 6 + (mins % 5), mins };
}

// ─────────────────────────────────────────────────────
//  NAV
// ─────────────────────────────────────────────────────
const NAV_MAP = {
  'view-home': 'nav-home', 'view-timer': 'nav-timer', 'view-newtx': 'nav-newtx',
  'view-recipients': 'nav-recipients', 'view-history': 'nav-history',
  'view-detail': 'nav-recipients'
};

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const nav = document.getElementById(NAV_MAP[id]);
  if (nav) nav.classList.add('active');
  if (id === 'view-home')       renderHome();
  if (id === 'view-newtx')      restoreManualEntry();
  if (id === 'view-recipients') renderRecipients();
  if (id === 'view-history')    renderHistory();
  if (id === 'view-timer')      renderTimer();
  window.scrollTo(0, 0);
}

// ─────────────────────────────────────────────────────
//  AUTO TIMER  (localStorage backed for persistence)
//  bt_ts = state: 'running' | 'stopped'  (absent = idle)
//  bt_tr = recipient id
//  bt_t0 = start timestamp (ms)
//  bt_t1 = stop  timestamp (ms)
// ─────────────────────────────────────────────────────
const LS = {
  state: () => localStorage.getItem('bt_ts') || 'idle',
  rid:   () => localStorage.getItem('bt_tr') || '',
  t0:    () => parseInt(localStorage.getItem('bt_t0') || '0'),
  t1:    () => parseInt(localStorage.getItem('bt_t1') || '0'),
  set:   (state, rid, t0, t1) => {
    state ? localStorage.setItem('bt_ts', state) : localStorage.removeItem('bt_ts');
    rid   ? localStorage.setItem('bt_tr', rid)   : localStorage.removeItem('bt_tr');
    t0    ? localStorage.setItem('bt_t0', t0)    : localStorage.removeItem('bt_t0');
    t1    ? localStorage.setItem('bt_t1', t1)    : localStorage.removeItem('bt_t1');
  },
  clear: () => ['bt_ts', 'bt_tr', 'bt_t0', 'bt_t1'].forEach(k => localStorage.removeItem(k))
};

function timerStart() {
  const rid = document.getElementById('timer-recipient').value;
  if (!rid) { alert('Choose a recipient first!'); return; }
  const rec = recipients.find(r => r.id === rid);
  const t0  = Date.now();
  LS.set('running', rid, t0.toString(), null);
  renderTimer();
  updateNavDot();

  // Notify all family members
  const startTime = fmtFull(t0);
  broadcastTimerEvent({ type: 'start', recipientName: rec.name, startTime });
  fireNotification('⏱ Session Started', `${rec.name} started using water at ${startTime}`);
}

function timerStop() {
  if (LS.state() !== 'running') return;
  clearInterval(clockInterval); clockInterval = null;
  LS.set('stopped', LS.rid(), LS.t0().toString(), Date.now().toString());
  renderTimer();
  updateNavDot();
}

async function timerSave() {
  const rid = LS.rid();
  const rec = recipients.find(r => r.id === rid);
  if (!rec) { alert('Recipient not found!'); timerDiscard(); return; }

  const ms = LS.t1() - LS.t0();
  const { cost, mins } = calcCostMs(ms);
  const s = msTo12(LS.t0()), e = msTo12(LS.t1());
  const tx = {
    id: genId(), recipientId: rid, recipientName: rec.name,
    sh: s.h, sm: s.m, sp: s.p, eh: e.h, em: e.m, ep: e.p,
    mins, cost, paid: false, date: new Date(LS.t0()).toISOString()
  };

  transactions.unshift(tx);
  await dbInsertTransaction(tx);

  // Notify all family members
  const endTime = fmtFull(LS.t1());
  broadcastTimerEvent({ type: 'stop', recipientName: rec.name, startTime: endTime, cost, mins });
  fireNotification('✅ Session Finished', `${rec.name} finished using water. ${mins} min · ₱${cost}`);

  LS.clear();
  renderTimer();
  updateNavDot();
  renderHome();
}

function timerDiscard() {
  clearInterval(clockInterval); clockInterval = null;
  LS.clear(); renderTimer(); updateNavDot();
}

function msTo12(ms) {
  const d = new Date(ms); let h = d.getHours(); const m = d.getMinutes();
  const p = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return { h, m, p };
}
function fmtElapsed(ms) {
  const t = Math.floor(ms / 1000);
  return `${fmt2(Math.floor(t / 3600))}:${fmt2(Math.floor((t % 3600) / 60))}:${fmt2(t % 60)}`;
}
function fmtFull(ms) {
  return new Date(ms).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderTimer() {
  const state = LS.state();
  document.getElementById('tp-idle').style.display    = state === 'idle'    ? 'block' : 'none';
  document.getElementById('tp-running').style.display = state === 'running' ? 'block' : 'none';
  document.getElementById('tp-preview').style.display = state === 'stopped' ? 'block' : 'none';
  clearInterval(clockInterval); clockInterval = null;

  if (state === 'idle') {
    buildTimerSelect();
  } else if (state === 'running') {
    const rec = recipients.find(r => r.id === LS.rid());
    document.getElementById('tr-name').textContent    = rec ? rec.name : '—';
    document.getElementById('tr-started').textContent = 'Started at ' + fmtFull(LS.t0());
    const tick = () => { document.getElementById('tr-clock').textContent = fmtElapsed(Date.now() - LS.t0()); };
    tick(); clockInterval = setInterval(tick, 1000);
  } else if (state === 'stopped') {
    const rec = recipients.find(r => r.id === LS.rid());
    const ms = LS.t1() - LS.t0();
    const { cost, mins } = calcCostMs(ms);
    const s = msTo12(LS.t0()), e = msTo12(LS.t1());
    document.getElementById('tp-preview-inner').innerHTML = `
      <div style="font-size:10px;font-weight:800;letter-spacing:2.5px;color:var(--accent);text-transform:uppercase;margin-bottom:8px">Session Complete</div>
      <div style="font-weight:800;font-size:17px;margin-bottom:16px">${rec ? esc(rec.name) : '—'}</div>
      <div class="result-amount">&#8369;${cost}</div>
      <div class="result-sub">${mins} min &nbsp;&#183;&nbsp; ${fmtTime(s.h, s.m, s.p)} &#8594; ${fmtTime(e.h, e.m, e.p)}</div>
      <div style="font-size:12px;color:var(--muted);font-family:var(--mono);margin-top:4px">${fmtFull(LS.t0())} &#8594; ${fmtFull(LS.t1())}</div>`;
  }
}

function buildTimerSelect() {
  const sel = document.getElementById('timer-recipient');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Select recipient —</option>' +
    recipients.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  if (cur) sel.value = cur;
}

function toggleTimerAdd() {
  const el = document.getElementById('timer-add-row');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
  if (el.style.display === 'block') document.getElementById('timer-new-name').focus();
}

async function saveTimerNewRec() {
  const name = document.getElementById('timer-new-name').value.trim();
  if (!name) return;
  if (recipients.find(r => r.name.toLowerCase() === name.toLowerCase())) { alert('Already exists!'); return; }
  const r = { id: genId(), name };
  recipients.push(r);
  await dbInsertRecipient(r);
  document.getElementById('timer-new-name').value = '';
  document.getElementById('timer-add-row').style.display = 'none';
  buildTimerSelect();
  document.getElementById('timer-recipient').value = r.id;
}

function updateNavDot() {
  const st = LS.state();
  document.getElementById('nav-live-dot').classList.toggle('on', st === 'running');
  const sub = document.getElementById('home-timer-sub');
  if (sub) sub.textContent = st === 'running' ? 'Session running…' : st === 'stopped' ? 'Tap to review' : 'Tap to start';
}

// ─────────────────────────────────────────────────────
//  MANUAL ENTRY
//  bt_ms = JSON { sh, sm, sp, rid } — persists across
//          refreshes/exits until end time is saved or
//          user explicitly discards
// ─────────────────────────────────────────────────────
const MS_KEY = 'bt_ms';

function msLoad()        { try { return JSON.parse(localStorage.getItem(MS_KEY)); } catch { return null; } }
function msSave(o)       { localStorage.setItem(MS_KEY, JSON.stringify(o)); }
function msClear()       { localStorage.removeItem(MS_KEY); }

function clampH(el) { let v = parseInt(el.value) || 0; if (v > 12) el.value = 12; if (v < 0) el.value = ''; }
function clampM(el) { let v = parseInt(el.value) || 0; if (v > 59) el.value = 59; if (v < 0) el.value = ''; }
function togglePeriod(id) { const el = document.getElementById(id); el.textContent = el.textContent === 'AM' ? 'PM' : 'AM'; }

// Called on showView('view-newtx') and on app boot — restores saved state
function restoreManualEntry() {
  const saved = msLoad();
  if (saved) {
    // Rebuild step 1 fields from saved state
    document.getElementById('sh').value            = saved.sh;
    document.getElementById('sm').value            = fmt2(saved.sm);
    document.getElementById('sp').textContent      = saved.sp;
    // Restore recipient selection after refreshTxSelect populates the list
    refreshTxSelect();
    document.getElementById('tx-recipient').value  = saved.rid || '';
    // Show the locked banner and go to step 2
    document.getElementById('start-locked-time').textContent = fmtTime(saved.sh, saved.sm, saved.sp);
    document.getElementById('step-start').style.display = 'none';
    document.getElementById('step-end').style.display   = 'block';
    document.getElementById('result-box').style.display = 'none';
  } else {
    // Nothing saved — clean step 1
    _clearManualUI();
  }
}

function setStartTime() {
  const rid = document.getElementById('tx-recipient').value;
  if (!rid) { alert('Choose a recipient first!'); return; }
  const sh = parseInt(document.getElementById('sh').value) || 0;
  const sm = parseInt(document.getElementById('sm').value) || 0;
  const sp = document.getElementById('sp').textContent;
  if (!sh) { alert('Enter a valid start hour!'); return; }

  // Persist to localStorage so refresh/exit won't lose it
  msSave({ sh, sm, sp, rid });

  // Show locked banner
  document.getElementById('start-locked-time').textContent = fmtTime(sh, sm, sp);

  // Switch steps
  document.getElementById('step-start').style.display = 'none';
  document.getElementById('step-end').style.display   = 'block';
  document.getElementById('result-box').style.display = 'none';

  // Clear end time fields
  ['eh', 'em'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('ep').textContent = 'PM';

  window.scrollTo(0, 0);
}

function editStartTime() {
  // Keep localStorage — user is just editing, not discarding
  msClear();
  document.getElementById('step-end').style.display   = 'none';
  document.getElementById('step-start').style.display = 'block';
  document.getElementById('result-box').style.display = 'none';
  window.scrollTo(0, 0);
}

function discardManualEntry() {
  msClear();
  _clearManualUI();
}

// Internal — resets all fields and goes back to step 1, no localStorage touch
function _clearManualUI() {
  ['sh', 'sm', 'eh', 'em'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('sp').textContent = 'AM';
  document.getElementById('ep').textContent = 'PM';
  document.getElementById('result-box').style.display = 'none';
  document.getElementById('add-inline').style.display = 'none';
  document.getElementById('step-start').style.display = 'block';
  document.getElementById('step-end').style.display   = 'none';
  refreshTxSelect();
}

function toggleAddInline() {
  const el = document.getElementById('add-inline');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
  if (el.style.display === 'block') document.getElementById('inline-name').focus();
}

async function saveInlineRecipient() {
  const name = document.getElementById('inline-name').value.trim();
  if (!name) return;
  if (recipients.find(r => r.name.toLowerCase() === name.toLowerCase())) { alert('Already exists!'); return; }
  const r = { id: genId(), name };
  recipients.push(r);
  await dbInsertRecipient(r);
  document.getElementById('inline-name').value = '';
  document.getElementById('add-inline').style.display = 'none';
  refreshTxSelect();
  document.getElementById('tx-recipient').value = r.id;
  // Update persisted rid if we're already in step 2
  const saved = msLoad();
  if (saved) { saved.rid = r.id; msSave(saved); }
}

function refreshTxSelect() {
  const sel = document.getElementById('tx-recipient');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Select recipient —</option>' +
    recipients.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  if (cur) sel.value = cur;
}

function calculate() {
  const saved = msLoad();
  if (!saved) { alert('Please set a start time first!'); return; }
  const rid = document.getElementById('tx-recipient').value || saved.rid;
  if (!rid) { alert('Choose a recipient first!'); return; }
  const { sh, sm, sp } = saved;
  const eh = parseInt(document.getElementById('eh').value) || 0;
  const em = parseInt(document.getElementById('em').value) || 0;
  const ep = document.getElementById('ep').textContent;
  if (!eh) { alert('Enter a valid end hour!'); return; }
  const res = calcCostHM(sh, sm, sp, eh, em, ep);
  const box = document.getElementById('result-box');
  box.style.display = 'block';
  box.innerHTML = `
    <div class="result-card">
      <div style="font-size:10px;font-weight:800;letter-spacing:2.5px;color:var(--accent);text-transform:uppercase;margin-bottom:4px">Result</div>
      <div class="result-amount">&#8369;${res.cost}</div>
      <div class="result-sub">${res.mins} min &nbsp;&#183;&nbsp; ${fmtTime(sh, sm, sp)} &#8594; ${fmtTime(eh, em, ep)}</div>
      <button class="btn-primary" style="margin-top:12px" onclick="saveTxManual('${rid}',${sh},${sm},'${sp}',${eh},${em},'${ep}',${res.cost},${res.mins})">Save Transaction</button>
    </div>`;
}

async function saveTxManual(rid, sh, sm, sp, eh, em, ep, cost, mins) {
  const rec = recipients.find(r => r.id === rid);
  if (!rec) return;
  const tx = { id: genId(), recipientId: rid, recipientName: rec.name, sh, sm, sp, eh, em, ep, mins, cost, paid: false, date: new Date().toISOString() };
  transactions.unshift(tx);
  await dbInsertTransaction(tx);
  // Clear persistence — transaction is now saved
  msClear();
  document.getElementById('result-box').innerHTML = `
    <div class="result-card success">
      <div style="font-size:34px;margin-bottom:6px">&#10003;</div>
      <div style="color:var(--success);font-weight:800;font-size:17px">Transaction Saved!</div>
      <button class="btn-ghost" style="color:var(--success);margin-top:14px" onclick="resetNewTx()">+ Add Another</button>
    </div>`;
  renderHome();
}

// Called after a successful save or "+ Add Another" — full clean reset
function resetNewTx() {
  msClear();
  _clearManualUI();
}

// ─────────────────────────────────────────────────────
//  RECIPIENTS
// ─────────────────────────────────────────────────────
async function addRecipient() {
  const name = document.getElementById('new-rec-name').value.trim();
  if (!name) return;
  if (recipients.find(r => r.name.toLowerCase() === name.toLowerCase())) { alert('Already exists!'); return; }
  const r = { id: genId(), name };
  recipients.push(r);
  await dbInsertRecipient(r);
  document.getElementById('new-rec-name').value = '';
  renderRecipients();
}

async function deleteRecipient(id) {
  if (!confirm('Delete this recipient and all their transactions?')) return;
  recipients = recipients.filter(r => r.id !== id);
  transactions = transactions.filter(t => t.recipientId !== id);
  await dbDeleteRecipient(id);   // cascade deletes transactions in DB
  renderRecipients();
}

function openDetail(id) {
  currentDetail = id;
  document.getElementById('detail-title').textContent = recipients.find(r => r.id === id).name;
  renderDetail();
  showView('view-detail');
}

function renderRecipients() {
  const el = document.getElementById('recipients-list');
  if (!recipients.length) { el.innerHTML = empty('👤', 'No recipients yet'); return; }
  el.innerHTML = recipients.map(r => {
    const txs = transactions.filter(t => t.recipientId === r.id);
    const u = txs.filter(t => !t.paid).reduce((s, t) => s + t.cost, 0);
    return `<div class="list-item" onclick="openDetail('${r.id}')">
      <div class="li-top">
        <div>
          <div class="li-name">${esc(r.name)}</div>
          <div class="li-date">${txs.length} transaction${txs.length !== 1 ? 's' : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${u ? `<span style="color:var(--danger);font-family:var(--mono);font-weight:500;font-size:16px">&#8369;${u}</span>`
              : (txs.length ? `<span style="color:var(--success);font-size:12px;font-weight:700">All paid &#10003;</span>` : '')}
          <button class="btn-delete" onclick="event.stopPropagation();deleteRecipient('${r.id}')">&#10005;</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────
//  HISTORY & DETAIL
// ─────────────────────────────────────────────────────
function renderHistory() {
  const el = document.getElementById('history-list');
  if (!transactions.length) { el.innerHTML = empty('📋', 'No transactions yet'); return; }
  el.innerHTML = transactions.map(t => txCard(t)).join('');
}

function renderDetail() {
  const txs  = transactions.filter(t => t.recipientId === currentDetail);
  const uAmt = txs.filter(t => !t.paid).reduce((s, t) => s + t.cost, 0);
  const pAmt = txs.filter(t =>  t.paid).reduce((s, t) => s + t.cost, 0);
  document.getElementById('detail-stats').innerHTML = `
    <div class="stat-row">
      <div class="stat-pill" style="color:var(--danger);border-color:rgba(248,113,113,0.25);background:rgba(248,113,113,0.08)">
        <div class="stat-pill-val">&#8369;${uAmt}</div><div class="stat-pill-label">Unpaid</div>
      </div>
      <div class="stat-pill" style="color:var(--success);border-color:rgba(52,211,153,0.25);background:rgba(52,211,153,0.08)">
        <div class="stat-pill-val">&#8369;${pAmt}</div><div class="stat-pill-label">Paid</div>
      </div>
      <div class="stat-pill" style="color:var(--accent);border-color:rgba(56,189,248,0.25);background:rgba(56,189,248,0.08)">
        <div class="stat-pill-val">${txs.length}</div><div class="stat-pill-label">Sessions</div>
      </div>
    </div>`;
  const el = document.getElementById('detail-list');
  if (!txs.length) { el.innerHTML = empty('📋', 'No transactions yet'); return; }
  el.innerHTML = txs.map(t => txCard(t, true)).join('');
}

function txCard(t, hideRec = false) {
  const pc = t.paid ? 'paid' : 'unpaid';
  return `<div class="list-item" style="cursor:default">
    <div class="li-top">
      <div>
        ${!hideRec ? `<div class="li-name">${esc(t.recipientName)}</div>` : ''}
        <div class="li-date">${fmtDate(t.date)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="li-amount ${pc}">&#8369;${t.cost}</span>
        <button class="btn-delete" onclick="deleteTx('${t.id}')">&#10005;</button>
      </div>
    </div>
    <div class="li-bottom">
      <span class="li-times">${fmtTime(t.sh, t.sm, t.sp)} &#8594; ${fmtTime(t.eh, t.em, t.ep)} &nbsp;&#183;&nbsp; ${t.mins}min</span>
      <button class="paid-pill ${pc}" onclick="togglePaid('${t.id}')">${t.paid ? 'PAID &#10003;' : 'UNPAID'}</button>
    </div>
  </div>`;
}

async function togglePaid(id) {
  const tx = transactions.find(t => t.id === id); if (!tx) return;
  tx.paid = !tx.paid;
  await dbTogglePaid(id, tx.paid);
  const av = document.querySelector('.view.active').id;
  if (av === 'view-history') renderHistory();
  if (av === 'view-detail')  renderDetail();
  renderHome();
}

async function deleteTx(id) {
  if (!confirm('Delete this transaction?')) return;
  transactions = transactions.filter(t => t.id !== id);
  await dbDeleteTransaction(id);
  const av = document.querySelector('.view.active').id;
  if (av === 'view-history') renderHistory();
  if (av === 'view-detail')  renderDetail();
  renderHome();
}

// ─────────────────────────────────────────────────────
//  HOME SUMMARY
// ─────────────────────────────────────────────────────
function renderHome() {
  document.getElementById('home-rec-count').textContent = `${recipients.length} saved`;
  document.getElementById('home-tx-count').textContent  = `${transactions.length} records`;
  const rows = recipients.map(r => {
    const amt = transactions.filter(t => t.recipientId === r.id && !t.paid).reduce((s, t) => s + t.cost, 0);
    if (!amt) return '';
    return `<div class="summary-row">
      <span style="font-weight:600;font-size:15px">${esc(r.name)}</span>
      <span style="color:var(--danger);font-family:var(--mono);font-weight:500;font-size:16px">&#8369;${amt}</span>
    </div>`;
  }).join('');
  document.getElementById('unpaid-summary').innerHTML = rows ||
    `<div style="color:var(--muted);font-size:14px;text-align:center;padding:12px">All clear! No unpaid transactions &#10003;</div>`;
}

// ─────────────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────────────
boot();
