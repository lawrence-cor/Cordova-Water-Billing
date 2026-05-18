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
const AUTH_KEY    = 'bt_family_auth';   // localStorage key (auth only)

// ─────────────────────────────────────────────────────
//  SUPABASE CLIENT
// ─────────────────────────────────────────────────────
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: false }
});

// ─────────────────────────────────────────────────────
//  IN-MEMORY STATE
// ─────────────────────────────────────────────────────
let recipients    = [];
let transactions  = [];
let currentDetail = null;

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
  renderHome();
  refreshTxSelect();
  showLoading(false);
  // restoreManualEntry fetches pendingSession itself when the view is opened
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

// ─────────────────────────────────────────────────────
//  NAV
// ─────────────────────────────────────────────────────
const NAV_MAP = {
  'view-home':       'nav-home',
  'view-newtx':      'nav-newtx',
  'view-recipients': 'nav-recipients',
  'view-history':    'nav-history',
  'view-detail':     'nav-recipients'
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
  window.scrollTo(0, 0);
}

// ─────────────────────────────────────────────────────
//  SAVE AS IMAGE  (html2canvas)
// ─────────────────────────────────────────────────────
async function saveAsImage(cardId) {
  const card = document.getElementById(cardId);
  if (!card) return;

  const wrap = document.createElement('div');
  wrap.style.cssText = `
    position:fixed; left:-9999px; top:-9999px;
    width:360px; background:#080b12;
    border-radius:24px; padding:32px 28px;
    font-family:'Sora',sans-serif; color:#f0f6ff;
    border:1.5px solid rgba(56,189,248,0.25);
    box-shadow: 0 24px 64px rgba(0,0,0,0.6);
  `;

  const badge = document.createElement('div');
  badge.style.cssText = 'text-align:center;margin-bottom:20px';
  badge.innerHTML = `
    <div style="font-size:36px;margin-bottom:6px">💧</div>
    <div style="font-size:13px;font-weight:900;letter-spacing:3px;color:#38bdf8;text-transform:uppercase">Cordova Billing</div>
  `;
  wrap.appendChild(badge);

  const clone = card.cloneNode(true);
  clone.style.cssText = 'margin:0;border:none;background:transparent;animation:none;';
  wrap.appendChild(clone);

  const footer = document.createElement('div');
  footer.style.cssText = 'text-align:center;margin-top:18px;font-size:11px;color:#64748b;letter-spacing:1px;font-family:DM Mono,monospace';
  footer.textContent = new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  wrap.appendChild(footer);

  document.body.appendChild(wrap);

  try {
    if (!window.html2canvas) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }

    const canvas = await html2canvas(wrap, {
      backgroundColor: '#080b12',
      scale: 2,
      useCORS: true,
      logging: false
    });

    const link = document.createElement('a');
    link.download = `cordova-billing-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();

    showToast('📸 Image Saved', 'Transaction screenshot downloaded!', 'success');
  } catch (err) {
    console.error('saveAsImage:', err);
    showToast('⚠️ Error', 'Could not save image. Try again.', '');
  } finally {
    document.body.removeChild(wrap);
  }
}

// ─────────────────────────────────────────────────────
//  MANUAL ENTRY — shared via Supabase pending_session
//
//  Table: pending_session
//  Columns: id (uuid PK), recipient_id (text),
//           recipient_name (text), sh (int), sm (int),
//           sp (text), created_at (timestamptz)
//
//  Only one row ever exists (singleton pattern).
//  All devices read/write this same row so every
//  family member sees the same locked start time.
// ─────────────────────────────────────────────────────

// In-memory mirror of the pending_session row
// { id, recipient_id, recipient_name, sh, sm, sp } | null
let pendingSession = null;

async function psLoad() {
  const { data, error } = await db
    .from('pending_session')
    .select('*')
    .limit(1)
    .maybeSingle();
  if (error) { console.error('psLoad:', error.message); pendingSession = null; return; }
  pendingSession = data || null;
}

async function psSave(rid, recipientName, sh, sm, sp) {
  // Delete any existing row first (singleton)
  await db.from('pending_session').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  const { data, error } = await db.from('pending_session').insert({
    id: genId(), recipient_id: rid, recipient_name: recipientName,
    sh, sm, sp
  }).select().single();
  if (error) { console.error('psSave:', error.message); return; }
  pendingSession = data;
}

async function psClear() {
  await db.from('pending_session').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  pendingSession = null;
}

function clampH(el) { let v = parseInt(el.value) || 0; if (v > 12) el.value = 12; if (v < 0) el.value = ''; }
function clampM(el) { let v = parseInt(el.value) || 0; if (v > 59) el.value = 59; if (v < 0) el.value = ''; }
function togglePeriod(id) { const el = document.getElementById(id); el.textContent = el.textContent === 'AM' ? 'PM' : 'AM'; }

async function restoreManualEntry() {
  // Always fetch latest from Supabase so all devices stay in sync
  showLoading(true);
  await psLoad();
  showLoading(false);
  const saved = pendingSession;
  if (saved) {
    refreshTxSelect();
    document.getElementById('tx-recipient').value  = saved.recipient_id || '';
    document.getElementById('start-locked-time').textContent = fmtTime(saved.sh, saved.sm, saved.sp);
    document.getElementById('step-start').style.display = 'none';
    document.getElementById('step-end').style.display   = 'block';
    document.getElementById('result-box').style.display = 'none';
  } else {
    _clearManualUI();
  }
}

async function setStartTime() {
  const rid = document.getElementById('tx-recipient').value;
  if (!rid) { alert('Choose a recipient first!'); return; }
  const sh = parseInt(document.getElementById('sh').value) || 0;
  const sm = parseInt(document.getElementById('sm').value) || 0;
  const sp = document.getElementById('sp').textContent;
  if (!sh) { alert('Enter a valid start hour!'); return; }

  const rec = recipients.find(r => r.id === rid);
  showLoading(true);
  await psSave(rid, rec ? rec.name : rid, sh, sm, sp);
  showLoading(false);

  document.getElementById('start-locked-time').textContent = fmtTime(sh, sm, sp);
  document.getElementById('step-start').style.display = 'none';
  document.getElementById('step-end').style.display   = 'block';
  document.getElementById('result-box').style.display = 'none';
  ['eh', 'em'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('ep').textContent = 'PM';
  window.scrollTo(0, 0);
}

async function editStartTime() {
  showLoading(true);
  await psClear();
  showLoading(false);
  document.getElementById('step-end').style.display   = 'none';
  document.getElementById('step-start').style.display = 'block';
  document.getElementById('result-box').style.display = 'none';
  window.scrollTo(0, 0);
}

async function discardManualEntry() {
  showLoading(true);
  await psClear();
  showLoading(false);
  _clearManualUI();
}

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
  // Update the shared pending session's recipient if one is active
  if (pendingSession) {
    showLoading(true);
    await psSave(r.id, r.name, pendingSession.sh, pendingSession.sm, pendingSession.sp);
    showLoading(false);
  }
}

function refreshTxSelect() {
  const sel = document.getElementById('tx-recipient');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Select recipient —</option>' +
    recipients.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  if (cur) sel.value = cur;
}

function calculate() {
  const saved = pendingSession;
  if (!saved) { alert('Please set a start time first!'); return; }
  const rid = document.getElementById('tx-recipient').value || saved.recipient_id;
  if (!rid) { alert('Choose a recipient first!'); return; }
  const { sh, sm, sp } = saved;
  const eh = parseInt(document.getElementById('eh').value) || 0;
  const em = parseInt(document.getElementById('em').value) || 0;
  const ep = document.getElementById('ep').textContent;
  if (!eh) { alert('Enter a valid end hour!'); return; }
  const res = calcCostHM(sh, sm, sp, eh, em, ep);
  const rec = recipients.find(r => r.id === rid);
  const box = document.getElementById('result-box');
  box.style.display = 'block';
  box.innerHTML = `
    <div class="result-card" id="manual-receipt-card">
      <div style="font-size:10px;font-weight:800;letter-spacing:2.5px;color:var(--accent);text-transform:uppercase;margin-bottom:4px">Result</div>
      <div style="font-weight:800;font-size:15px;margin-bottom:8px;color:var(--text)">${esc(rec ? rec.name : '—')}</div>
      <div class="result-amount">&#8369;${res.cost}</div>
      <div class="result-sub">${res.mins} min &nbsp;&#183;&nbsp; ${fmtTime(sh, sm, sp)} &#8594; ${fmtTime(eh, em, ep)}</div>
      <button class="btn-primary" style="margin-top:12px" onclick="saveTxManual('${rid}',${sh},${sm},'${sp}',${eh},${em},'${ep}',${res.cost},${res.mins})">Save Transaction</button>
      <button class="btn-save-img" onclick="saveAsImage('manual-receipt-card')">📸 Save as Image</button>
    </div>`;
}

async function saveTxManual(rid, sh, sm, sp, eh, em, ep, cost, mins) {
  const rec = recipients.find(r => r.id === rid);
  if (!rec) return;
  const tx = { id: genId(), recipientId: rid, recipientName: rec.name, sh, sm, sp, eh, em, ep, mins, cost, paid: false, date: new Date().toISOString() };
  transactions.unshift(tx);
  showLoading(true);
  await dbInsertTransaction(tx);
  await psClear();
  showLoading(false);
  document.getElementById('result-box').innerHTML = `
    <div class="result-card success">
      <div style="font-size:34px;margin-bottom:6px">&#10003;</div>
      <div style="color:var(--success);font-weight:800;font-size:17px">Transaction Saved!</div>
      <button class="btn-ghost" style="color:var(--success);margin-top:14px" onclick="resetNewTx()">+ Add Another</button>
    </div>`;
  renderHome();
  showToast('💾 Saved', `${rec.name} · ${mins} min · ₱${cost}`, 'success');
}

async function resetNewTx() {
  await psClear();
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
  await dbDeleteRecipient(id);
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
