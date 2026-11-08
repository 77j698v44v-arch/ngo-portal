/* CBO / NGO portal frontend: vanilla JS, no build step. */
// When index.html is double-clicked (file://) there is no server behind "/api", so point at the local backend.
const API = window.API_BASE || (location.protocol === 'file:' ? 'http://localhost:3000/api' : '/api');
const app = document.getElementById('app');

const STREAMS = {
  poshomill: 'Poshomill',
  public_transport: 'Public Transport',
  chicken_butcher: 'Chicken Butcher',
};
const METHODS = { mpesa: 'M-Pesa', cash: 'Cash', bank: 'Bank' };

const state = {
  token: localStorage.getItem('cbo_token'),
  user: null,
  view: null,
  pending: 0,
  settings: {},
  leaders: [],
  userMap: {},
};

/* ---------- helpers ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kes = (n) => 'KES ' + Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 });
const fdate = (d) => (d ? new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const today = () => new Date().toISOString().slice(0, 10);
const $ = (sel, root = document) => root.querySelector(sel);

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = ''), 3200);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* empty body */ }
  if (res.status === 401 && state.token && !path.startsWith('/auth/login')) {
    logout(true);
    throw new Error('Session expired, please log in again');
  }
  if (!res.ok) throw new Error((data && data.error) || 'Request failed');
  return data;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

/* Runs an async submit handler with a disabled button and error banner */
function onSubmit(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const err = form.querySelector('.error');
    if (err) err.remove();
    if (btn) btn.disabled = true;
    try {
      await handler(formData(form));
    } catch (ex) {
      const div = document.createElement('div');
      div.className = 'error';
      div.textContent = ex.message;
      form.prepend(div);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

function openModal(title, bodyHtml, bind) {
  const m = $('#modal');
  $('#modal-body').innerHTML = `<h2>${esc(title)}</h2>${bodyHtml}`;
  bind && bind($('#modal-body'));
  m.showModal();
}
const closeModal = () => $('#modal').close();

/* ---------- auth ---------- */
function logout(expired) {
  localStorage.removeItem('cbo_token');
  state.token = null; state.user = null; state.view = null;
  renderLogin(expired ? 'Your session ended. Please log in again.' : '');
}

function renderLogin(message = '') {
  app.innerHTML = `
    <div class="login-wrap"><div class="login-card">
      <div class="logo">C</div>
      <h1>CBO Portal</h1>
      <p class="muted">Enter your Log in ID and password.</p>
      ${message ? `<div class="notice">${esc(message)}</div>` : ''}
      <form id="login-form">
        <div style="margin-bottom:.75rem"><label for="u">Log in ID</label>
          <input id="u" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
        <div style="margin-bottom:1rem"><label for="p">Log in password</label>
          <input id="p" name="password" type="password" autocomplete="current-password" required></div>
        <div class="btn-row">
          <button class="btn" type="submit">Log in</button>
          <button class="btn secondary" type="button" id="first-time">First time log in</button>
        </div>
      </form>
    </div></div>`;
  onSubmit($('#login-form'), async (d) => {
    const r = await api('/auth/login', { method: 'POST', body: d });
    state.token = r.token;
    localStorage.setItem('cbo_token', r.token);
    await boot();
  });
  $('#first-time').addEventListener('click', () => renderFirstTime($('#u').value));
}

// One-time screen for brand-new accounts: Log in ID + the phone number the chiefs registered + choose a password.
// After the password is set the server refuses this screen for that account for good.
function renderFirstTime(prefillId = '') {
  app.innerHTML = `
    <div class="login-wrap"><div class="login-card">
      <div class="logo">C</div>
      <h1>First time log in</h1>
      <p class="muted">Enter the Log in ID you were given and the phone number registered for you, then choose your own password.
        You can only do this once. After that, use Log in.</p>
      <form id="first-form">
        <div style="margin-bottom:.75rem"><label for="fu">Log in ID</label>
          <input id="fu" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(prefillId)}" required></div>
        <div style="margin-bottom:.75rem"><label for="fp">Your phone number</label>
          <input id="fp" name="phone" inputmode="tel" placeholder="0712345678" autocomplete="tel" required></div>
        <div style="margin-bottom:.75rem"><label for="fn">Choose a password (min 8 characters)</label>
          <input id="fn" name="new_password" type="password" minlength="8" autocomplete="new-password" required></div>
        <div style="margin-bottom:1rem"><label for="fc">Confirm password</label>
          <input id="fc" name="confirm_password" type="password" minlength="8" autocomplete="new-password" required></div>
        <div class="btn-row">
          <button class="btn" type="submit">Set password &amp; log in</button>
          <button class="btn secondary" type="button" id="back">Back</button>
        </div>
      </form>
    </div></div>`;
  onSubmit($('#first-form'), async (d) => {
    if (d.new_password !== d.confirm_password) throw new Error('The two passwords do not match');
    const r = await api('/auth/first-login', { method: 'POST', body: d });
    state.token = r.token;
    localStorage.setItem('cbo_token', r.token);
    toast('Password set. Welcome!');
    await boot();
  });
  $('#back').addEventListener('click', () => renderLogin());
}

/* ---------- shell ---------- */
function navItems() {
  const u = state.user;
  if (u.is_chief) {
    return [
      ['overview', 'Overview'],
      ['approvals', 'Approvals', state.pending],
      ['activity', 'Activity'],
      ['members', 'All Members'],
      ['income', 'All Income'],
      ['add-member', 'Add Member'],
      ['add-income', 'Record Income'],
      ['leaders', 'Leaders'],
      ['settings', 'Settings'],
      ['account', 'Account'],
    ];
  }
  return [
    ['home', 'My Earnings'],
    ['add-member', 'Add Member'],
    ['members', 'My Members'],
    ['add-income', 'Record Income'],
    ['income', 'My Records'],
    ['account', 'Account'],
  ];
}

function renderShell() {
  const u = state.user;
  app.innerHTML = `
    <div class="topbar">
      <div class="title">CBO Portal · ${esc(u.role_label)} Section</div>
      <div class="who">${esc(u.full_name)}<br><a href="#" id="logout" style="color:#cfe8da">Log out</a></div>
    </div>
    <nav class="nav" id="nav"></nav>
    <main id="main"></main>`;
  $('#logout').addEventListener('click', (e) => { e.preventDefault(); logout(); });
  renderNav();
}

function renderNav() {
  $('#nav').innerHTML = navItems().map(([id, label, badge]) =>
    `<button data-view="${id}" class="${state.view === id ? 'active' : ''}">${label}${badge ? `<span class="badge count">${badge}</span>` : ''}</button>`
  ).join('');
}

async function go(view) {
  state.view = view;
  renderNav();
  const main = $('#main');
  main.innerHTML = '<p class="muted">Loading…</p>';
  try {
    await views[view](main);
  } catch (e) {
    main.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
  window.scrollTo(0, 0);
}

async function refreshPending() {
  if (!state.user.is_chief) return;
  const rows = await api('/members?status=pending_payment');
  state.pending = rows.length;
  renderNav();
}

/* ---------- shared pieces ---------- */
function earningsCards(e) {
  return `
    <div class="grid stats">
      <div class="stat"><div class="label">Referrals</div><div class="value">${kes(e.referrals)}</div>
        <div class="sub">${e.referrals_confirmed} confirmed · ${e.referrals_pending} awaiting confirmation</div></div>
      <div class="stat"><div class="label">Poshomill</div><div class="value">${kes(e.poshomill)}</div></div>
      <div class="stat"><div class="label">Public Transport</div><div class="value">${kes(e.public_transport)}</div></div>
      <div class="stat"><div class="label">Chicken Butcher</div><div class="value">${kes(e.chicken_butcher)}</div></div>
      <div class="stat total"><div class="label">Total earned</div><div class="value">${kes(e.total)}</div></div>
    </div>`;
}

const roleName = (r) => String(r || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const statusBadge = (s) => s === 'confirmed'
  ? '<span class="badge ok">Confirmed</span>'
  : '<span class="badge pending">Awaiting payment confirmation</span>';

function membersTable(rows, chief) {
  if (!rows.length) return '<div class="empty">No members yet.</div>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Name</th><th>Phone</th>${chief ? '<th>Admitted by</th>' : ''}<th class="num">Fee paid</th><th>Payment</th><th>Status</th><th>Date</th>${chief ? '<th>Confirmed by</th><th></th>' : ''}</tr></thead>
    <tbody>${rows.map((m) => `<tr>
      <td>${esc(m.full_name)}<div class="muted small">${esc(m.location || '')}</div></td>
      <td>${esc(m.phone)}</td>
      ${chief ? `<td>${esc(m.admitted_by_name)}<div class="muted small">${esc(roleName(m.admitted_by_role))}</div></td>` : ''}
      <td class="num">${kes(m.fee_amount)}</td>
      <td>${esc(METHODS[m.payment_method])}<div class="muted small">${esc(m.payment_reference || '')}</div></td>
      <td>${statusBadge(m.status)}${!chief && m.status === 'confirmed' ? `<div class="muted small">Earned you ${kes(m.commission_amount)}</div>` : ''}</td>
      <td>${fdate(m.created_at)}</td>
      ${chief ? `<td>${esc(m.confirmed_by_name || '')}<div class="muted small">${fdate(m.confirmed_at)}</div></td><td><div class="actions">
        ${m.status === 'pending_payment' ? `<button class="btn small" data-act="confirm-member" data-id="${m.id}">Confirm payment</button>` : ''}
        <button class="btn small secondary" data-act="edit-member" data-id="${m.id}">Edit</button>
        <button class="btn small danger" data-act="delete-member" data-id="${m.id}">Delete</button>
      </div></td>` : ''}
    </tr>`).join('')}</tbody></table></div>`;
}

function incomeTable(rows, chief) {
  if (!rows.length) return '<div class="empty">No records yet.</div>';
  const total = rows.reduce((a, r) => a + Number(r.amount), 0);
  return `<div class="table-wrap"><table>
    <thead><tr><th>Date</th><th>Project</th>${chief ? '<th>Credited to</th>' : ''}<th class="num">Amount</th><th>Notes</th>${chief ? '<th>Entered by</th><th></th>' : ''}</tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td>${fdate(r.record_date)}</td>
      <td>${esc(STREAMS[r.stream])}</td>
      ${chief ? `<td>${esc(r.earner_name || '—')}<div class="muted small">${esc(roleName(r.earner_role))}</div></td>` : ''}
      <td class="num">${kes(r.amount)}</td>
      <td>${esc(r.notes || '')}</td>
      ${chief ? `<td>${esc(r.recorded_by_name)}</td><td><div class="actions">
        <button class="btn small secondary" data-act="edit-income" data-id="${r.id}">Edit</button>
        <button class="btn small danger" data-act="delete-income" data-id="${r.id}">Delete</button></div></td>` : ''}
    </tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="${chief ? 3 : 2}">Total (${rows.length} records)</td><td class="num">${kes(total)}</td><td colspan="${chief ? 3 : 1}"></td></tr></tfoot>
  </table></div>`;
}

const memberFields = (m = {}) => `
  <div class="row">
    <div><label>Full name</label><input name="full_name" value="${esc(m.full_name)}" required></div>
    <div><label>Phone number</label><input name="phone" inputmode="tel" placeholder="0712345678" value="${esc(m.phone)}" required></div>
  </div>
  <div class="row">
    <div><label>National ID (optional)</label><input name="national_id" value="${esc(m.national_id)}"></div>
    <div><label>Location / village</label><input name="location" value="${esc(m.location)}"></div>
  </div>
  <div class="row">
    <div><label>Membership fee paid (KES)</label><input name="fee_amount" type="number" min="0" step="1" value="${esc(m.fee_amount ?? state.settings.membership_fee ?? '')}" required></div>
    <div><label>Payment method</label><select name="payment_method">
      ${Object.entries(METHODS).map(([k, v]) => `<option value="${k}" ${m.payment_method === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div><label>M-Pesa code / reference</label><input name="payment_reference" placeholder="e.g. SJK4X9ABCD" value="${esc(m.payment_reference)}"></div>
  </div>`;

const incomeFields = (r = {}) => `
  <div class="row">
    <div><label>Project</label><select name="stream" required>
      ${Object.entries(STREAMS).map(([k, v]) => `<option value="${k}" ${r.stream === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div><label>Amount (KES)</label><input name="amount" type="number" min="1" step="0.01" value="${esc(r.amount)}" required></div>
  </div>
  <div class="row">
    ${state.user.is_chief ? `<div><label>Credited to (leader)</label><select name="earner_id">
      ${state.leaders.map((l) => `<option value="${l.id}" ${(r.earner_id ?? state.user.id) === l.id ? 'selected' : ''}>${esc(l.full_name)} (${esc(l.role_label)})</option>`).join('')}</select></div>` : ''}
    <div><label>Date</label><input name="record_date" type="date" max="${today()}" value="${esc((r.record_date || today()).slice(0, 10))}" required></div>
  </div>
  <div style="margin-bottom:.75rem"><label>Notes (optional)</label><input name="notes" value="${esc(r.notes)}" placeholder="e.g. Saturday market sales"></div>`;

/* ---------- activity feed (chiefs only) ---------- */
async function loadUsers() {
  const users = await api('/users');
  state.userMap = Object.fromEntries(users.map((u) => [u.id, u]));
  return users;
}
const uname = (id) => (state.userMap[id] ? state.userMap[id].full_name : id ? `#${id}` : 'unknown');
const fdatetime = (d) => new Date(d).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function describe(a) {
  const d = a.details || {};
  const money = (n) => kes(n);
  const key = `${a.action}/${a.entity}`;
  switch (key) {
    case 'login/session': return 'Logged in';
    case 'login_failed/session': return `Failed log in attempt for Log in ID “${d.username}”`;
    case 'first_login/session': return 'Set their password (first time log in)';
    case 'first_login_failed/session': return `Failed FIRST TIME LOG IN attempt for Log in ID “${d.username}”`;
    case 'password_change/session': return 'Changed their password';
    case 'create/member': return `Admitted member ${d.name} (${d.phone}) · fee ${money(d.fee_amount)} by ${METHODS[d.payment_method] || d.payment_method}${d.payment_reference ? ' ' + d.payment_reference : ''} · awaiting confirmation`;
    case 'confirm/member': return `Confirmed payment for ${d.name} (${money(d.fee_amount)}) · ${money(d.commission)} commission to ${d.admitted_by_name || uname(d.admitted_by_id)}`;
    case 'update/member': return `Edited member ${d.name}: fee ${money(d.before && d.before.fee_amount)} → ${money(d.after && d.after.fee_amount)}, payment ref ${(d.before && d.before.payment_reference) || '–'} → ${(d.after && d.after.payment_reference) || '–'}`;
    case 'delete/member': return `Deleted member ${d.name} (${money(d.fee_amount)}, ${d.status === 'confirmed' ? 'was confirmed' : 'was pending'})`;
    case 'create/income_record': return `Recorded ${STREAMS[d.stream] || d.stream} income ${money(d.amount)} for ${d.record_date ? fdate(d.record_date) : 'today'}, credited to ${d.earner_name || uname(d.earner_id)}`;
    case 'update/income_record': return `Edited income record #${a.entity_id}: ${STREAMS[d.before.stream]} ${money(d.before.amount)} (${uname(d.before.earner_id)}) → ${STREAMS[d.after.stream]} ${money(d.after.amount)} (${d.after.earner_name || uname(d.after.earner_id)})`;
    case 'delete/income_record': return `Deleted income record #${a.entity_id}: ${STREAMS[d.stream] || d.stream} ${money(d.amount)} credited to ${uname(d.earner_id)}`;
    case 'create/user': return `Created account for ${d.name} (${roleName(d.role)}), Log in ID “${d.username}”`;
    case 'update/user': return `Updated account of ${d.name}: role ${roleName(d.role)}, ${d.active ? 'active' : 'disabled'}`;
    case 'reopen_first_login/user': return `Reset password for ${d.name}: FIRST TIME LOG IN reopened once`;
    case 'update/settings': return 'Changed settings: ' + Object.entries(d).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v.from} → ${v.to}`).join(', ');
    default: return `${a.action} ${a.entity}`;
  }
}

const ACTION_TONE = { login_failed: 'pending', first_login_failed: 'pending', delete: 'danger', reopen_first_login: 'pending' };

function activityTable(rows) {
  if (!rows.length) return '<div class="empty">Nothing has happened yet.</div>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>When</th><th>Who</th><th>What happened</th></tr></thead>
    <tbody>${rows.map((a) => `<tr>
      <td style="white-space:nowrap">${fdatetime(a.created_at)}</td>
      <td>${a.actor_name ? `${esc(a.actor_name)}<div class="muted small">${esc(a.actor_role || '')}</div>` : '<span class="muted">Not logged in</span>'}</td>
      <td><span class="${ACTION_TONE[a.action] ? 'tone-' + ACTION_TONE[a.action] : ''}">${esc(describe(a))}</span>${a.details && a.details.ip && /fail/.test(a.action) ? `<div class="muted small">from ${esc(a.details.ip)}</div>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

/* ---------- views ---------- */
const views = {
  /* Everyone (non-chief landing page) */
  async home(main) {
    const [e, mine, inc] = await Promise.all([api('/reports/me'), api('/members'), api('/income')]);
    main.innerHTML = `
      <h1>Welcome, ${esc(state.user.full_name)}</h1>
      <p class="muted">${esc(state.user.role_label)} · here is what you have earned so far.</p>
      ${earningsCards(e)}
      <div class="card" style="margin-top:1rem">
        <div class="head-row"><h2>Members you admitted (${mine.length})</h2>
          <button class="btn small" data-go="add-member">+ Add member</button></div>
        ${mine.some((m) => m.status === 'pending_payment') ? '<div class="notice">Members marked “awaiting payment confirmation” only count (and earn you a referral) once the Project Admin or Project Coordinator confirms their payment.</div>' : ''}
        ${membersTable(mine.slice(0, 8), false)}
      </div>
      <div class="card">
        <div class="head-row"><h2>Recent income records</h2>
          <button class="btn small" data-go="add-income">+ Record income</button></div>
        ${incomeTable(inc.slice(0, 8), false)}
      </div>`;
  },

  /* Chief landing page */
  async overview(main) {
    const [s, act] = await Promise.all([api('/reports/summary'), api('/activity?limit=8'), loadUsers()]);
    const sum = (k) => s.leaders.reduce((a, l) => a + l[k], 0);
    main.innerHTML = `
      <h1>Overview</h1>
      <div class="grid stats" style="margin-bottom:1rem">
        <div class="stat"><div class="label">Poshomill</div><div class="value">${kes(s.byStream.poshomill)}</div></div>
        <div class="stat"><div class="label">Public Transport</div><div class="value">${kes(s.byStream.public_transport)}</div></div>
        <div class="stat"><div class="label">Chicken Butcher</div><div class="value">${kes(s.byStream.chicken_butcher)}</div></div>
        <div class="stat total"><div class="label">Total project income</div><div class="value">${kes(s.projectIncome)}</div></div>
      </div>
      <div class="grid stats" style="margin-bottom:1rem">
        <div class="stat"><div class="label">Confirmed members</div><div class="value">${s.members.confirmed}</div>
          <div class="sub">${kes(s.members.fees_confirmed)} in fees</div></div>
        <div class="stat"><div class="label">Awaiting confirmation</div><div class="value">${s.members.pending}</div>
          <div class="sub">${kes(s.members.fees_pending)} to verify</div></div>
        <div class="stat"><div class="label">Referral commissions owed</div><div class="value">${kes(s.members.commissions)}</div></div>
      </div>
      <div class="card"><h2>Earnings by leader</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Leader</th><th>Role</th><th class="num">Referrals</th><th class="num">Poshomill</th><th class="num">Transport</th><th class="num">Chicken</th><th class="num">Total</th></tr></thead>
          <tbody>${s.leaders.map((l) => `<tr>
            <td>${esc(l.full_name)}</td><td>${esc(l.role_label)}</td>
            <td class="num">${kes(l.referrals)}<div class="muted small">${l.referrals_confirmed} members</div></td>
            <td class="num">${kes(l.poshomill)}</td><td class="num">${kes(l.public_transport)}</td><td class="num">${kes(l.chicken_butcher)}</td>
            <td class="num"><b>${kes(l.total)}</b></td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="2">All leaders</td><td class="num">${kes(sum('referrals'))}</td><td class="num">${kes(sum('poshomill'))}</td>
            <td class="num">${kes(sum('public_transport'))}</td><td class="num">${kes(sum('chicken_butcher'))}</td><td class="num">${kes(sum('total'))}</td></tr></tfoot>
        </table></div>
      </div>
      <div class="card">
        <div class="head-row"><h2>Latest activity</h2><button class="btn small secondary" data-go="activity">See everything</button></div>
        ${activityTable(act.rows)}
      </div>`;
  },

  async approvals(main) {
    const rows = await api('/members?status=pending_payment');
    state.pending = rows.length; renderNav();
    main.innerHTML = `
      <h1>Pending approvals</h1>
      <p class="muted">Check each payment (M-Pesa code, cash received or bank slip) then confirm. Confirming locks in the referral commission for whoever admitted the member. Delete a member if the payment is not genuine.</p>
      <div class="card">${membersTable(rows, true)}</div>`;
  },

  async members(main) {
    const chief = state.user.is_chief;
    const rows = await api('/members');
    main.innerHTML = `
      <div class="head-row"><h1>${chief ? 'All members' : 'My members'} (${rows.length})</h1>
        <button class="btn small" data-go="add-member">+ Add member</button></div>
      <div class="card">${membersTable(rows, chief)}</div>`;
    main._members = rows;
  },

  async 'add-member'(main) {
    state.settings = await api('/reports/settings');
    main.innerHTML = `
      <h1>Admit a new member</h1>
      <p class="muted">Enter the member's details and the payment they made. They are officially in once the Project Admin or Project Coordinator confirms the payment.</p>
      <div class="card"><form id="f">${memberFields()}<button class="btn" type="submit">Submit member</button></form></div>`;
    onSubmit($('#f'), async (d) => {
      await api('/members', { method: 'POST', body: d });
      toast('Member submitted. Awaiting payment confirmation.');
      await refreshPending();
      go('members');
    });
  },

  async income(main) {
    const chief = state.user.is_chief;
    const params = new URLSearchParams(window.__incomeFilter || {});
    const rows = await api('/income?' + params);
    main.innerHTML = `
      <div class="head-row"><h1>${chief ? 'All income records' : 'My records'}</h1>
        <button class="btn small" data-go="add-income">+ Record income</button></div>
      <form class="filters" id="flt">
        <div><label>Project</label><select name="stream"><option value="">All</option>
          ${Object.entries(STREAMS).map(([k, v]) => `<option value="${k}" ${params.get('stream') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div><label>From</label><input type="date" name="from" value="${esc(params.get('from') || '')}"></div>
        <div><label>To</label><input type="date" name="to" value="${esc(params.get('to') || '')}"></div>
        <button class="btn secondary" type="submit">Filter</button>
      </form>
      <div class="card">${incomeTable(rows, chief)}</div>`;
    main._income = rows;
    $('#flt').addEventListener('submit', (e) => {
      e.preventDefault();
      const d = formData(e.target);
      window.__incomeFilter = Object.fromEntries(Object.entries(d).filter(([, v]) => v));
      go('income');
    });
  },

  async 'add-income'(main) {
    if (state.user.is_chief) state.leaders = (await api('/users')).filter((u) => u.active);
    main.innerHTML = `
      <h1>Record income</h1>
      <p class="muted">${state.user.is_chief ? 'As a chief you can credit the income to any leader.' : 'This income is added to your earnings. Once saved, it can only be corrected by the Project Admin or Project Coordinator, so double-check the amount.'}</p>
      <div class="card"><form id="f">${incomeFields()}<button class="btn" type="submit">Save record</button></form></div>`;
    onSubmit($('#f'), async (d) => {
      await api('/income', { method: 'POST', body: d });
      toast('Income recorded.');
      go('income');
    });
  },

  async activity(main) {
    const users = await loadUsers();
    const f = window.__activityFilter || { type: '', actor: '' };
    const PAGE = 100;
    const q = (offset) => new URLSearchParams({ limit: PAGE, offset, ...(f.type ? { type: f.type } : {}), ...(f.actor ? { actor: f.actor } : {}) });
    let data = await api('/activity?' + q(0));
    let rows = data.rows;
    const draw = () => {
      main.innerHTML = `
        <h1>Activity</h1>
        <p class="muted">Everything happening in the portal, newest first: log ins, new members, payment confirmations, income records, edits, deletions and account changes.</p>
        <form class="filters" id="aflt">
          <div><label>Show</label><select name="type">
            ${[['', 'Everything'], ['logins', 'Log ins & passwords'], ['members', 'Members & payments'], ['income', 'Income records'], ['accounts', 'Leader accounts'], ['settings', 'Settings']]
              .map(([v, l]) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div><label>Person</label><select name="actor"><option value="">Everyone</option>
            ${users.map((u) => `<option value="${u.id}" ${String(f.actor) === String(u.id) ? 'selected' : ''}>${esc(u.full_name)} (${esc(u.role_label)})</option>`).join('')}</select></div>
          <button class="btn secondary" type="submit">Apply</button>
        </form>
        <div class="card">${activityTable(rows)}
          ${data.has_more ? '<div style="text-align:center;margin-top:.75rem"><button class="btn secondary" id="more">Show older activity</button></div>' : ''}</div>`;
      $('#aflt').addEventListener('submit', (e) => {
        e.preventDefault();
        window.__activityFilter = formData(e.target);
        go('activity');
      });
      const more = $('#more');
      if (more) more.addEventListener('click', async () => {
        more.disabled = true;
        data = await api('/activity?' + q(rows.length));
        rows = rows.concat(data.rows);
        draw();
      });
    };
    draw();
  },

  async leaders(main) {
    const [users, seats] = await Promise.all([loadUsers(), api('/users/seats')]);
    const status = (u) => !u.active ? '<span class="badge off">Disabled</span>'
      : !u.password_set ? '<span class="badge pending">Awaiting first log in</span>' : '<span class="badge ok">Active</span>';
    main.innerHTML = `
      <h1>Leaders</h1>
      <div class="card"><h2>Seats</h2>
        <p class="muted small">${seats.total_active} of ${seats.max_recruiters} accounts used (everyone with an account can admit members).</p>
        <div class="table-wrap"><table><thead><tr><th>Role</th><th class="num">Filled</th><th class="num">Seats</th></tr></thead><tbody>
          ${seats.roles.map((r) => `<tr><td>${esc(r.label)}${r.is_chief ? ' <span class="badge ok">chief</span>' : ''}</td><td class="num">${r.used}</td><td class="num">${r.seat_limit}</td></tr>`).join('')}
        </tbody></table></div></div>
      <div class="card"><h2>Add a leader</h2>
        <form id="f"><div class="row">
          <div><label>Full name</label><input name="full_name" required></div>
          <div><label>Phone number</label><input name="phone" inputmode="tel" placeholder="0712345678" required></div>
          <div><label>Role</label><select name="role">${seats.roles.map((r) => `<option value="${r.role}" ${r.used >= r.seat_limit ? 'disabled' : ''}>${esc(r.label)}${r.used >= r.seat_limit ? ' (full)' : ''}</option>`).join('')}</select></div>
        </div><div class="row">
          <div><label>Log in ID</label><input name="username" autocapitalize="none" spellcheck="false" required></div>
        </div><button class="btn" type="submit">Create account</button></form>
        <p class="muted small" style="margin-top:.5rem">No password is set by you. Give them their Log in ID. They tap <b>First time log in</b>, enter the ID and this phone number, and choose their own password. That works only once.</p></div>
      <div class="card"><h2>All leaders</h2><div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Role</th><th>Log in ID</th><th>Status</th><th>Last log in</th><th></th></tr></thead><tbody>
        ${users.map((u) => `<tr><td>${esc(u.full_name)}<div class="muted small">${esc(u.phone || '')}</div></td><td>${esc(u.role_label)}</td><td>${esc(u.username)}</td>
          <td>${status(u)}</td><td>${u.last_login_at ? fdatetime(u.last_login_at) : '<span class="muted">Never</span>'}</td>
          <td><div class="actions">
            ${u.id !== state.user.id && u.password_set ? `<button class="btn small secondary" data-act="reopen-login" data-id="${u.id}">Reset password</button>` : ''}
            ${u.id !== state.user.id ? `<button class="btn small ${u.active ? 'danger' : ''}" data-act="toggle-user" data-id="${u.id}" data-active="${u.active}">${u.active ? 'Disable' : 'Enable'}</button>` : ''}
          </div></td></tr>`).join('')}</tbody></table></div></div>`;
    onSubmit($('#f'), async (d) => {
      await api('/users', { method: 'POST', body: d });
      toast('Account created. They can now use First time log in.');
      go('leaders');
    });
  },

  async settings(main) {
    const s = await api('/reports/settings');
    main.innerHTML = `
      <h1>Settings</h1>
      <div class="card"><form id="f"><div class="row">
        <div><label>Membership fee (KES)</label><input name="membership_fee" type="number" min="0" value="${esc(s.membership_fee)}"></div>
        <div><label>Referral commission per confirmed member (KES)</label><input name="referral_commission" type="number" min="0" value="${esc(s.referral_commission)}"></div>
        <div><label>Max people who can admit members</label><input name="max_recruiters" type="number" min="1" value="${esc(s.max_recruiters)}"></div>
      </div><button class="btn" type="submit">Save settings</button>
      <p class="muted small" style="margin-top:.5rem">A commission change only affects members confirmed from now on. Past commissions stay as they were.</p></form></div>`;
    onSubmit($('#f'), async (d) => {
      await api('/reports/settings', { method: 'PUT', body: d });
      toast('Settings saved.');
    });
  },

  async account(main) {
    const u = state.user;
    main.innerHTML = `
      <h1>My account</h1>
      <div class="card"><p><b>${esc(u.full_name)}</b><br><span class="muted">${esc(u.role_label)} · @${esc(u.username)}</span></p></div>
      <div class="card"><h2>Change password</h2>
        <form id="f"><div class="row">
          <div><label>Current password</label><input name="current_password" type="password" autocomplete="current-password" required></div>
          <div><label>New password (min 8)</label><input name="new_password" type="password" minlength="8" autocomplete="new-password" required></div>
        </div><button class="btn" type="submit">Update password</button></form></div>`;
    onSubmit($('#f'), async (d) => {
      await api('/auth/change-password', { method: 'POST', body: d });
      toast('Password updated.');
      go(state.user.is_chief ? 'overview' : 'home');
    });
  },
};

/* ---------- click handling (delegated) ---------- */
document.addEventListener('click', async (e) => {
  const nav = e.target.closest('[data-view]');
  if (nav) return go(nav.dataset.view);
  const goBtn = e.target.closest('[data-go]');
  if (goBtn) return go(goBtn.dataset.go);

  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const main = $('#main');
  const act = btn.dataset.act;

  try {
    if (act === 'confirm-member') {
      if (!confirm('Confirm that this payment was received? This makes them an official member.')) return;
      await api(`/members/${id}/confirm`, { method: 'POST' });
      toast('Member confirmed.');
      await refreshPending(); go(state.view);
    }
    if (act === 'delete-member') {
      if (!confirm('Delete this member and their payment record? This cannot be undone.')) return;
      await api(`/members/${id}`, { method: 'DELETE' });
      toast('Member deleted.');
      await refreshPending(); go(state.view);
    }
    if (act === 'edit-member') {
      const m = (await api('/members')).find((x) => x.id === id);
      openModal('Edit member & payment', `<form id="mf">${memberFields(m)}
        <div class="actions"><button type="button" class="btn secondary" data-act="close">Cancel</button><button class="btn" type="submit">Save</button></div></form>`,
      (root) => onSubmit($('#mf', root), async (d) => {
        await api(`/members/${id}`, { method: 'PUT', body: d });
        closeModal(); toast('Member updated.'); go(state.view);
      }));
    }
    if (act === 'delete-income') {
      if (!confirm('Delete this income record? This cannot be undone.')) return;
      await api(`/income/${id}`, { method: 'DELETE' });
      toast('Record deleted.'); go(state.view);
    }
    if (act === 'edit-income') {
      const r = (main._income || []).find((x) => x.id === id);
      state.leaders = (await api('/users')).filter((u) => u.active);
      openModal('Edit income record', `<form id="mf">${incomeFields(r)}
        <div class="actions"><button type="button" class="btn secondary" data-act="close">Cancel</button><button class="btn" type="submit">Save</button></div></form>`,
      (root) => onSubmit($('#mf', root), async (d) => {
        await api(`/income/${id}`, { method: 'PUT', body: d });
        closeModal(); toast('Record updated.'); go(state.view);
      }));
    }
    if (act === 'toggle-user') {
      const active = btn.dataset.active === 'true';
      if (!confirm(active ? 'Disable this account? They will be logged out.' : 'Enable this account?')) return;
      await api(`/users/${id}`, { method: 'PATCH', body: { active: !active } });
      toast(active ? 'Account disabled.' : 'Account enabled.'); go('leaders');
    }
    if (act === 'reopen-login') {
      if (!confirm('Reset this person\'s password? Their current password stops working and they must use First time log in again (Log in ID + phone number) to choose a new one.')) return;
      await api(`/users/${id}`, { method: 'PATCH', body: { reopen_first_login: true } });
      toast('Password reset. They can use First time log in once.'); go('leaders');
    }
    if (act === 'close') closeModal();
  } catch (ex) {
    toast(ex.message, true);
  }
});

/* ---------- boot ---------- */
async function boot() {
  if (!state.token) return renderLogin();
  try {
    state.user = await api('/auth/me');
  } catch (e) {
    return renderLogin();
  }
  state.leaders = [];
  renderShell();
  await refreshPending().catch(() => {});
  go(state.user.is_chief ? 'overview' : 'home');
}

boot();
