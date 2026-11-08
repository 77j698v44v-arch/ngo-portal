// End-to-end permission and flow test. WARNING: wipes the database in DATABASE_URL. Use a throwaway DB.
require('dotenv').config();
process.env.LOGIN_RATE_MAX = '10000'; // the suite logs in far more than a human would
const assert = require('assert');
const db = require('./db');
const migrate = require('./migrate');
const seedUser = require('./seed');
const app = require('./server');

let base;
let passed = 0;
async function call(token, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { console.error('  FAIL', name, '\n      ', e.message); process.exitCode = 1; }
}
const login = async (username, password) => (await call(null, 'POST', '/api/auth/login', { username, password })).data;

(async () => {
  await db.query('DROP TABLE IF EXISTS audit_log, income_records, members, users, settings, role_limits CASCADE');
  await migrate();

  // A Project Coordinator test account (generic credentials, safe to commit)
  await seedUser({ username: 'COORD@TEST', password: 'Coord@Test-2026', role: 'project_coordinator' });
  const server = app.listen(0);
  base = 'http://127.0.0.1:' + server.address().port;

  console.log('Login ID + password');
  let coord;
  await t('coordinator COORD@TEST logs in with the given password', async () => {
    const r = await call(null, 'POST', '/api/auth/login', { username: 'COORD@TEST', password: 'Coord@Test-2026' });
    assert.equal(r.status, 200); assert.equal(r.data.user.role, 'project_coordinator'); assert.equal(r.data.user.is_chief, true);
    coord = r.data.token;
  });
  await t('Log in ID is not case sensitive, password is', async () => {
    assert.equal((await call(null, 'POST', '/api/auth/login', { username: 'coord@test', password: 'Coord@Test-2026' })).status, 200);
    assert.equal((await call(null, 'POST', '/api/auth/login', { username: 'COORD@TEST', password: 'coord@test-2026' })).status, 401);
  });
  await t('no token rejected', async () => assert.equal((await call(null, 'GET', '/api/members')).status, 401));

  const mk = (role, username, name, phone) => call(coord, 'POST', '/api/users', { full_name: name || username, username, phone: phone || '0700000000', role });

  console.log('Accounts and seats');
  await t('chief creates a Project Admin (second chief)', async () => assert.equal((await mk('project_admin', 'padmin', 'Project Admin', '0711000001')).status, 201));
  await t('second project_coordinator blocked (seat full)', async () => assert.equal((await mk('project_coordinator', 'coord2')).status, 409));
  await t('account needs a valid phone number', async () => {
    assert.equal((await call(coord, 'POST', '/api/users', { full_name: 'x', username: 'nophone', role: 'champion' })).status, 400);
    assert.equal((await call(coord, 'POST', '/api/users', { full_name: 'x', username: 'badphone', phone: '12', role: 'champion' })).status, 400);
  });
  await t('13 champions allowed, 14th blocked', async () => {
    for (let i = 1; i <= 13; i++) assert.equal((await mk('champion', 'champ' + i, 'Champion ' + i, '07220000' + String(i).padStart(2, '0'))).status, 201);
    assert.equal((await mk('champion', 'champ14')).status, 409);
  });
  await t('2 deputy chaplains ok, 3rd blocked', async () => {
    assert.equal((await mk('deputy_lead_chaplain', 'dc1')).status, 201);
    assert.equal((await mk('deputy_lead_chaplain', 'dc2')).status, 201);
    assert.equal((await mk('deputy_lead_chaplain', 'dc3')).status, 409);
  });
  await t('duplicate Log in ID rejected', async () => assert.equal((await mk('lead_chaplain', 'champ1')).status, 409));
  await mk('till_champion', 'till1', 'Till One', '0733000001');

  console.log('FIRST TIME LOG IN');
  await t('cannot log in before first-time setup (no password exists)', async () => {
    assert.equal((await call(null, 'POST', '/api/auth/login', { username: 'champ1', password: '' })).status, 400);
    assert.equal((await call(null, 'POST', '/api/auth/login', { username: 'champ1', password: 'anything123' })).status, 401);
  });
  await t('first-time log in refuses a wrong phone number', async () => {
    const r = await call(null, 'POST', '/api/auth/first-login', { username: 'champ1', phone: '0799999999', new_password: 'MyPassword1' });
    assert.equal(r.status, 400);
  });
  await t('first-time log in refuses unknown ID', async () => assert.equal((await call(null, 'POST', '/api/auth/first-login', { username: 'ghost', phone: '0722000001', new_password: 'MyPassword1' })).status, 400));
  await t('rejects short password and mismatched confirmation', async () => {
    assert.equal((await call(null, 'POST', '/api/auth/first-login', { username: 'champ1', phone: '0722000001', new_password: 'short' })).status, 400);
    assert.equal((await call(null, 'POST', '/api/auth/first-login', { username: 'champ1', phone: '0722000001', new_password: 'MyPassword1', confirm_password: 'Different1' })).status, 400);
  });
  let champ1;
  await t('correct ID + phone sets the password and logs them in (phone formats are normalised)', async () => {
    const r = await call(null, 'POST', '/api/auth/first-login', { username: 'CHAMP1', phone: '+254 722 000 001', new_password: 'MyPassword1', confirm_password: 'MyPassword1' });
    assert.equal(r.status, 200); assert.ok(r.data.token); assert.equal(r.data.user.role, 'champion');
    champ1 = r.data;
  });
  await t('they can now log in normally with that password', async () => assert.equal((await call(null, 'POST', '/api/auth/login', { username: 'champ1', password: 'MyPassword1' })).status, 200));
  await t('first-time log in NEVER works again for that account', async () => {
    const r = await call(null, 'POST', '/api/auth/first-login', { username: 'champ1', phone: '0722000001', new_password: 'Hijacked123' });
    assert.equal(r.status, 400);
    assert.equal((await call(null, 'POST', '/api/auth/login', { username: 'champ1', password: 'Hijacked123' })).status, 401);
    assert.equal((await call(null, 'POST', '/api/auth/login', { username: 'champ1', password: 'MyPassword1' })).status, 200);
  });
  await t('two simultaneous first-time attempts: only one wins', async () => {
    const go = (pw) => call(null, 'POST', '/api/auth/first-login', { username: 'champ2', phone: '0722000002', new_password: pw });
    const rs = await Promise.all([go('RacePassword1'), go('RacePassword2')]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 400]);
  });
  await t('disabled account cannot do first-time log in', async () => {
    const id = (await call(coord, 'GET', '/api/users')).data.find((u) => u.username === 'champ3').id;
    await call(coord, 'PATCH', `/api/users/${id}`, { active: false });
    assert.equal((await call(null, 'POST', '/api/auth/first-login', { username: 'champ3', phone: '0722000003', new_password: 'MyPassword1' })).status, 400);
    await call(coord, 'PATCH', `/api/users/${id}`, { active: true });
  });
  await t('chief can deliberately reopen it once; old session dies; then it closes again', async () => {
    const id = (await call(coord, 'GET', '/api/users')).data.find((u) => u.username === 'champ1').id;
    assert.equal((await call(coord, 'PATCH', `/api/users/${id}`, { reopen_first_login: true })).status, 200);
    assert.equal((await call(champ1.token, 'GET', '/api/members')).status, 401);
    assert.equal((await call(null, 'POST', '/api/auth/login', { username: 'champ1', password: 'MyPassword1' })).status, 401);
    const r = await call(null, 'POST', '/api/auth/first-login', { username: 'champ1', phone: '0722000001', new_password: 'BrandNew1234' });
    assert.equal(r.status, 200); champ1 = r.data;
    assert.equal((await call(null, 'POST', '/api/auth/first-login', { username: 'champ1', phone: '0722000001', new_password: 'Again123456' })).status, 400);
  });
  await t('chief cannot reset own account', async () => {
    const me = (await call(coord, 'GET', '/api/auth/me')).data;
    assert.equal((await call(coord, 'PATCH', `/api/users/${me.id}`, { reopen_first_login: true })).status, 400);
  });

  // activate the rest we need
  const first = async (u, phone) => (await call(null, 'POST', '/api/auth/first-login', { username: u, phone, new_password: 'Password-' + u })).data;
  const champ2 = await login('champ2', 'RacePassword1').then((d) => d && d.token ? d : login('champ2', 'RacePassword2'));
  const till1 = await first('till1', '0733000001');
  const padmin = await first('padmin', '0711000001');

  console.log('Members and payment confirmation');
  const m1 = { full_name: 'Jane Wanjiku', phone: '0712345678', fee_amount: 500, payment_method: 'mpesa', payment_reference: 'SJK4X9ABCD' };
  let memberId;
  await t('champion admits member -> pending', async () => {
    const r = await call(champ1.token, 'POST', '/api/members', m1);
    assert.equal(r.status, 201); assert.equal(r.data.status, 'pending_payment'); memberId = r.data.id;
  });
  await t('duplicate phone / payment code / bad phone / missing mpesa code rejected', async () => {
    assert.equal((await call(champ2.token, 'POST', '/api/members', { ...m1, payment_reference: 'OTHER12345' })).status, 409);
    assert.equal((await call(champ2.token, 'POST', '/api/members', { ...m1, phone: '0799999999' })).status, 409);
    assert.equal((await call(champ2.token, 'POST', '/api/members', { ...m1, phone: '0711111111', payment_reference: '' })).status, 400);
    assert.equal((await call(champ2.token, 'POST', '/api/members', { ...m1, phone: '123' })).status, 400);
  });
  await t('non-chiefs cannot confirm, edit or delete', async () => {
    for (const who of [champ1, till1]) {
      assert.equal((await call(who.token, 'POST', `/api/members/${memberId}/confirm`)).status, 403);
      assert.equal((await call(who.token, 'PUT', `/api/members/${memberId}`, m1)).status, 403);
      assert.equal((await call(who.token, 'DELETE', `/api/members/${memberId}`)).status, 403);
    }
  });
  await t('pending member earns no referral yet', async () => {
    const r = await call(champ1.token, 'GET', '/api/reports/me');
    assert.equal(r.data.referrals, 0); assert.equal(r.data.referrals_pending, 1);
  });
  await t('chief (coordinator) confirms; then referral commission is credited', async () => {
    const r = await call(coord, 'POST', `/api/members/${memberId}/confirm`);
    assert.equal(r.status, 200); assert.equal(Number(r.data.commission_amount), 100);
    assert.equal((await call(padmin.token, 'POST', `/api/members/${memberId}/confirm`)).status, 404);
    assert.equal((await call(champ1.token, 'GET', '/api/reports/me')).data.referrals, 100);
  });
  await t('chief edits payment details', async () => {
    const r = await call(padmin.token, 'PUT', `/api/members/${memberId}`, { ...m1, fee_amount: 600 });
    assert.equal(r.status, 200); assert.equal(Number(r.data.fee_amount), 600);
  });

  console.log('Income');
  let recId;
  await t('champion records income (credited to self)', async () => {
    const r = await call(champ1.token, 'POST', '/api/income', { stream: 'poshomill', amount: 1000 });
    assert.equal(r.status, 201); recId = r.data.id;
  });
  await t('non-chief cannot credit income to someone else (ignored, goes to self)', async () => {
    const champ2id = (await call(champ2.token, 'GET', '/api/auth/me')).data.id;
    const r = await call(till1.token, 'POST', '/api/income', { stream: 'chicken_butcher', amount: 400, earner_id: champ2id });
    assert.equal(r.status, 201);
    assert.equal((await call(champ2.token, 'GET', '/api/income')).data.length, 0);
    assert.equal((await call(till1.token, 'GET', '/api/reports/me')).data.chicken_butcher, 400);
  });
  await t('chief can credit income to a chosen leader', async () => {
    const champ2id = (await call(champ2.token, 'GET', '/api/auth/me')).data.id;
    assert.equal((await call(coord, 'POST', '/api/income', { stream: 'public_transport', amount: 250, earner_id: champ2id })).status, 201);
    assert.equal((await call(champ2.token, 'GET', '/api/reports/me')).data.public_transport, 250);
  });
  await t('invalid stream / amount / future date rejected', async () => {
    assert.equal((await call(champ1.token, 'POST', '/api/income', { stream: 'bogus', amount: 5 })).status, 400);
    assert.equal((await call(champ1.token, 'POST', '/api/income', { stream: 'poshomill', amount: -5 })).status, 400);
    assert.equal((await call(champ1.token, 'POST', '/api/income', { stream: 'poshomill', amount: 5, record_date: '2999-01-01' })).status, 400);
  });
  await t('non-chief cannot edit or delete records', async () => {
    assert.equal((await call(champ1.token, 'PUT', `/api/income/${recId}`, { stream: 'poshomill', amount: 9999 })).status, 403);
    assert.equal((await call(champ1.token, 'DELETE', `/api/income/${recId}`)).status, 403);
  });
  await t('chiefs edit and delete records', async () => {
    const me = (await call(champ1.token, 'GET', '/api/auth/me')).data;
    assert.equal((await call(coord, 'PUT', `/api/income/${recId}`, { stream: 'public_transport', amount: 1200, earner_id: me.id })).status, 200);
    assert.equal((await call(champ1.token, 'GET', '/api/reports/me')).data.public_transport, 1200);
    assert.equal((await call(padmin.token, 'DELETE', `/api/income/${recId}`)).status, 200);
    assert.equal((await call(champ1.token, 'GET', '/api/reports/me')).data.public_transport, 0);
  });

  console.log('Everyone else sees ONLY their own members and earnings');
  await call(champ2.token, 'POST', '/api/members', { ...m1, phone: '0744444444', payment_reference: 'CH2PAYMENT1' });
  await call(champ1.token, 'POST', '/api/income', { stream: 'poshomill', amount: 700 });
  await t('non-chief sees only members they registered, with no admin fields', async () => {
    const r = (await call(champ1.token, 'GET', '/api/members')).data;
    assert.equal(r.length, 1); assert.equal(r[0].phone, '0712345678');
    for (const k of ['admitted_by', 'admitted_by_name', 'confirmed_by', 'confirmed_by_name']) assert.equal(r[0][k], undefined, k);
    assert.equal((await call(champ2.token, 'GET', '/api/members')).data.length, 1);
  });
  await t('non-chief sees only income credited to them, with no recorder/admin fields', async () => {
    const r = (await call(champ1.token, 'GET', '/api/income')).data;
    assert.equal(r.length, 1); assert.equal(Number(r[0].amount), 700);
    for (const k of ['earner_id', 'recorded_by', 'recorded_by_name', 'earner_name']) assert.equal(r[0][k], undefined, k);
  });
  await t('non-chief cannot see other leaders, seats, summary, settings detail or activity', async () => {
    for (const path of ['/api/users', '/api/users/seats', '/api/reports/summary', '/api/activity']) {
      assert.equal((await call(champ1.token, 'GET', path)).status, 403, path);
    }
    assert.deepEqual(Object.keys((await call(champ1.token, 'GET', '/api/reports/settings')).data), ['membership_fee']);
    assert.equal((await call(champ1.token, 'PUT', '/api/reports/settings', { membership_fee: 1 })).status, 403);
    assert.equal((await call(champ1.token, 'POST', '/api/users', { full_name: 'x', username: 'xxx', phone: '0700000000', role: 'champion' })).status, 403);
  });
  await t("one leader's earnings never include another's", async () => {
    const a = (await call(champ1.token, 'GET', '/api/reports/me')).data, b = (await call(champ2.token, 'GET', '/api/reports/me')).data;
    assert.equal(a.poshomill, 700); assert.equal(b.poshomill, 0);
  });

  console.log('Chiefs see everything');
  await t('both chiefs see all members, all income, all leaders', async () => {
    for (const who of [coord, padmin.token]) {
      assert.equal((await call(who, 'GET', '/api/members')).data.length, 2);
      assert.ok((await call(who, 'GET', '/api/income')).data.length >= 3);
      const us = (await call(who, 'GET', '/api/users')).data;
      assert.ok(us.length >= 16); assert.ok('password_set' in us[0] && 'last_login_at' in us[0]);
      assert.equal((await call(who, 'GET', '/api/reports/summary')).status, 200);
    }
  });
  await t('activity feed covers logins, first logins, failed attempts, members, income, accounts, settings', async () => {
    await call(coord, 'PUT', '/api/reports/settings', { referral_commission: 150 });
    const feed = (await call(coord, 'GET', '/api/activity?limit=500')).data;
    const has = (action, entity) => feed.rows.some((r) => r.action === action && r.entity === entity);
    for (const [a, e] of [['login', 'session'], ['login_failed', 'session'], ['first_login', 'session'], ['first_login_failed', 'session'],
      ['create', 'member'], ['confirm', 'member'], ['update', 'member'], ['create', 'income_record'], ['update', 'income_record'],
      ['delete', 'income_record'], ['create', 'user'], ['reopen_first_login', 'user'], ['update', 'settings']]) {
      assert.ok(has(a, e), `missing ${a}/${e}`);
    }
    assert.ok(feed.rows[0].actor_name !== undefined);
  });
  await t('activity filters by type and person; paginates', async () => {
    const mem = (await call(padmin.token, 'GET', '/api/activity?type=members')).data.rows;
    assert.ok(mem.length >= 3 && mem.every((r) => r.entity === 'member'));
    const me = (await call(champ1.token, 'GET', '/api/auth/me')).data;
    const mine = (await call(coord, 'GET', `/api/activity?actor=${me.id}`)).data.rows;
    assert.ok(mine.length > 0 && mine.every((r) => r.actor_id === me.id));
    const p1 = (await call(coord, 'GET', '/api/activity?limit=5')).data;
    assert.equal(p1.rows.length, 5); assert.equal(p1.has_more, true);
    const p2 = (await call(coord, 'GET', '/api/activity?limit=5&offset=5')).data;
    assert.ok(!p2.rows.some((r) => p1.rows.some((q) => q.id === r.id)));
  });
  await t('activity log never contains a password', async () => {
    const raw = JSON.stringify((await call(coord, 'GET', '/api/activity?limit=500')).data);
    for (const pw of ['MyPassword1', 'BrandNew1234', 'Coord@Test-2026', 'Password-', 'RacePassword', 'Hijacked123']) assert.ok(!raw.includes(pw), pw);
  });

  console.log('Limits');
  await t('disabled account loses access immediately', async () => {
    const id = (await call(champ2.token, 'GET', '/api/auth/me')).data.id;
    assert.equal((await call(coord, 'PATCH', `/api/users/${id}`, { active: false })).status, 200);
    assert.equal((await call(champ2.token, 'GET', '/api/members')).status, 401);
  });
  await t('200 recruiter cap enforced', async () => {
    const total = (await call(coord, 'GET', '/api/users/seats')).data.total_active;
    await call(coord, 'PUT', '/api/reports/settings', { max_recruiters: total });
    assert.equal((await mk('proposal_writer', 'pw1')).status, 409);
    await call(coord, 'PUT', '/api/reports/settings', { max_recruiters: 200 });
    assert.equal((await mk('proposal_writer', 'pw1')).status, 201);
  });

  console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`);
  server.close();
  await db.pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
