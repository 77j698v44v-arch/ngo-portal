const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { sign, requireAuth, audit, CHIEF_ROLES } = require('../auth');
const { canonPhone } = require('../util');

const router = express.Router();

const publicUser = (u) => ({
  id: u.id, full_name: u.full_name, username: u.username,
  role: u.role, role_label: u.role_label, is_chief: CHIEF_ROLES.includes(u.role),
});

router.post('/login', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Enter your Log in ID and password' });

  const { rows } = await db.query(
    `SELECT u.*, r.label AS role_label FROM users u JOIN role_limits r ON r.role=u.role WHERE u.username=$1`,
    [username]
  );
  const user = rows[0];
  // Same message for unknown ID / wrong password / disabled / not yet set up, so accounts can't be probed
  const ok = user && user.active && user.password_set && (await bcrypt.compare(password, user.password_hash));
  if (!ok) {
    await audit(user ? user.id : null, 'login_failed', 'session', user ? user.id : null, { username, ip: req.ip });
    return res.status(401).json({ error: 'Invalid Log in ID or password. If this is your first time, use FIRST TIME LOG IN.' });
  }

  await db.query('UPDATE users SET last_login_at = now() WHERE id=$1', [user.id]);
  await audit(user.id, 'login', 'session', user.id, { ip: req.ip });
  res.json({ token: sign(user), user: publicUser(user) });
});

// FIRST TIME LOG IN. Works exactly once per account: the UPDATE only matches while password_set is FALSE,
// so after the person sets a password this can never be used again (unless a chief deliberately reopens it).
// The phone number the chief registered for the person proves it's really them and not someone who guessed the ID.
router.post('/first-login', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const phone = canonPhone(req.body.phone);
  const password = String(req.body.new_password || '');
  const fail = async (status, msg, id) => {
    await audit(id || null, 'first_login_failed', 'session', id || null, { username, ip: req.ip });
    return res.status(status).json({ error: msg });
  };

  if (!username || !phone) return res.status(400).json({ error: 'Enter your Log in ID and the phone number registered for you' });
  if (password.length < 8) return res.status(400).json({ error: 'Your password must be at least 8 characters' });
  if (req.body.confirm_password !== undefined && req.body.confirm_password !== req.body.new_password) {
    return res.status(400).json({ error: 'The two passwords do not match' });
  }
  if (password.toLowerCase() === username) return res.status(400).json({ error: 'Your password cannot be the same as your Log in ID' });

  const { rows } = await db.query(
    `SELECT u.*, r.label AS role_label FROM users u JOIN role_limits r ON r.role=u.role WHERE u.username=$1`,
    [username]
  );
  const user = rows[0];
  const eligible = user && user.active && !user.password_set && user.phone && canonPhone(user.phone) === phone;
  if (!eligible) {
    return fail(400, "We couldn't verify those details. Check your Log in ID and phone number. If you have already set a password, use Log in instead.", user && user.id);
  }

  const hash = await bcrypt.hash(password, 12);
  const upd = await db.query(
    `UPDATE users SET password_hash=$1, password_set=TRUE, last_login_at=now()
      WHERE id=$2 AND password_set=FALSE RETURNING id`,
    [hash, user.id]
  );
  if (!upd.rowCount) return fail(400, "We couldn't verify those details. If you have already set a password, use Log in instead.", user.id);

  await audit(user.id, 'first_login', 'session', user.id, { ip: req.ip });
  res.json({ token: sign(user), user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  const { id, full_name, username, role, role_label, is_chief } = req.user;
  res.json({ id, full_name, username, role, role_label, is_chief });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || String(new_password).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(String(current_password || ''), rows[0].password_hash))) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  const hash = await bcrypt.hash(String(new_password), 12);
  await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.user.id]);
  await audit(req.user.id, 'password_change', 'session', req.user.id, null);
  res.json({ ok: true });
});

module.exports = router;
