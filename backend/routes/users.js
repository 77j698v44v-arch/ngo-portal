const express = require('express');
const db = require('../db');
const { requireAuth, requireChief, audit } = require('../auth');
const { isKenyanPhone } = require('../util');

const router = express.Router();
router.use(requireAuth);

// Staff directory. Chiefs only: everyone else sees nothing about other leaders.
router.get('/', requireChief, async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.full_name, u.username, u.phone, u.role, r.label AS role_label, u.active,
            u.password_set, u.last_login_at, u.created_at
       FROM users u JOIN role_limits r ON r.role=u.role
      ORDER BY r.sort_order, u.full_name`
  );
  res.json(rows);
});

// Seat usage per role + the global recruiter cap
router.get('/seats', requireChief, async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.role, r.label, r.seat_limit, r.is_chief,
            COUNT(u.id) FILTER (WHERE u.active)::int AS used
       FROM role_limits r LEFT JOIN users u ON u.role=r.role
      GROUP BY r.role ORDER BY r.sort_order`
  );
  const cap = await db.query(`SELECT value FROM settings WHERE key='max_recruiters'`);
  const total = await db.query('SELECT COUNT(*)::int AS n FROM users WHERE active');
  res.json({ roles: rows, max_recruiters: Number(cap.rows[0].value), total_active: total.rows[0].n });
});

async function seatCheck(role, excludeUserId) {
  const lim = await db.query('SELECT seat_limit, label FROM role_limits WHERE role=$1', [role]);
  if (!lim.rowCount) return 'Unknown role';
  const used = await db.query(
    'SELECT COUNT(*)::int AS n FROM users WHERE role=$1 AND active AND id <> COALESCE($2,-1)',
    [role, excludeUserId || null]
  );
  if (used.rows[0].n >= lim.rows[0].seat_limit) {
    return `All ${lim.rows[0].seat_limit} ${lim.rows[0].label} seat(s) are already filled`;
  }
  const cap = await db.query(`SELECT value FROM settings WHERE key='max_recruiters'`);
  const total = await db.query('SELECT COUNT(*)::int AS n FROM users WHERE active AND id <> COALESCE($1,-1)', [excludeUserId || null]);
  if (total.rows[0].n >= Number(cap.rows[0].value)) {
    return `The limit of ${cap.rows[0].value} members who can admit new people has been reached`;
  }
  return null;
}

// Creates the account WITHOUT a password. The person sets it themselves at FIRST TIME LOG IN.
router.post('/', requireChief, async (req, res) => {
  const full_name = String(req.body.full_name || '').trim();
  const username = String(req.body.username || '').trim().toLowerCase();
  const role = String(req.body.role || '');
  const phone = String(req.body.phone || '').trim();

  if (!full_name || !username || !role) return res.status(400).json({ error: 'Name, Log in ID and role are required' });
  if (!/^[a-z0-9._@-]{3,30}$/.test(username)) return res.status(400).json({ error: 'Log in ID: 3-30 characters (letters, numbers, . _ - @)' });
  if (!isKenyanPhone(phone)) return res.status(400).json({ error: "A valid phone number is required. They'll use it to verify themselves at first-time log in" });

  const problem = await seatCheck(role);
  if (problem) return res.status(409).json({ error: problem });

  try {
    const { rows } = await db.query(
      `INSERT INTO users(full_name, username, phone, role) VALUES ($1,$2,$3,$4)
       RETURNING id, full_name, username, role`,
      [full_name, username, phone, role]
    );
    await audit(req.user.id, 'create', 'user', rows[0].id, { name: full_name, username, role });
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That Log in ID is already taken' });
    throw e;
  }
});

router.patch('/:id', requireChief, async (req, res) => {
  const id = Number(req.params.id);
  const cur = (await db.query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'User not found' });

  const full_name = req.body.full_name !== undefined ? String(req.body.full_name).trim() : cur.full_name;
  const phone = req.body.phone !== undefined ? (String(req.body.phone).trim() || null) : cur.phone;
  const role = req.body.role !== undefined ? String(req.body.role) : cur.role;
  const active = req.body.active !== undefined ? !!req.body.active : cur.active;

  if (id === req.user.id && (!active || role !== cur.role || req.body.reopen_first_login)) {
    return res.status(400).json({ error: "You can't deactivate, re-role or reset your own account" });
  }
  if (phone && !isKenyanPhone(phone)) return res.status(400).json({ error: 'Phone number is invalid' });
  if ((role !== cur.role || (active && !cur.active))) {
    const problem = await seatCheck(role, id);
    if (problem) return res.status(409).json({ error: problem });
  }

  // Deliberate chief action: wipes the password and reopens FIRST TIME LOG IN once, e.g. for someone who forgot it.
  // Any session they had stops working immediately.
  if (req.body.reopen_first_login) {
    if (!phone) return res.status(400).json({ error: 'Add a phone number for this person first so they can verify themselves' });
    await db.query('UPDATE users SET password_hash=NULL, password_set=FALSE WHERE id=$1', [id]);
  }
  await db.query('UPDATE users SET full_name=$1, phone=$2, role=$3, active=$4 WHERE id=$5', [full_name, phone, role, active, id]);
  await audit(req.user.id, req.body.reopen_first_login ? 'reopen_first_login' : 'update', 'user', id,
    { name: cur.full_name, username: cur.username, role, active });
  res.json({ ok: true });
});

module.exports = router;
