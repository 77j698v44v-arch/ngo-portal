const express = require('express');
const db = require('../db');
const { requireAuth, requireChief, audit } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const METHODS = ['mpesa', 'cash', 'bank'];

function clean(body) {
  return {
    full_name: String(body.full_name || '').trim(),
    phone: String(body.phone || '').replace(/[\s-]/g, ''),
    national_id: body.national_id ? String(body.national_id).trim() : null,
    location: body.location ? String(body.location).trim() : null,
    fee_amount: body.fee_amount === undefined || body.fee_amount === '' ? 0 : Number(body.fee_amount),
    payment_method: String(body.payment_method || 'mpesa'),
    payment_reference: body.payment_reference ? String(body.payment_reference).trim().toUpperCase() : null,
  };
}

function validate(m) {
  if (!m.full_name) return 'Full name is required';
  if (!/^(\+?254|0)\d{9}$/.test(m.phone)) return 'Enter a valid Kenyan phone number (e.g. 0712345678)';
  if (!Number.isFinite(m.fee_amount) || m.fee_amount < 0) return 'Fee amount is invalid';
  if (!METHODS.includes(m.payment_method)) return 'Payment method must be mpesa, cash or bank';
  if (m.payment_method === 'mpesa' && m.fee_amount > 0 && !m.payment_reference) {
    return 'M-Pesa code is required so the payment can be confirmed';
  }
  return null;
}

function dupMessage(e) {
  if (e.code !== '23505') return null;
  if (String(e.constraint).includes('phone')) return 'A member with this phone number already exists';
  return 'That payment reference has already been used';
}

const SELECT = `
  SELECT m.*, a.full_name AS admitted_by_name, a.role AS admitted_by_role, c.full_name AS confirmed_by_name
    FROM members m
    JOIN users a ON a.id = m.admitted_by
    LEFT JOIN users c ON c.id = m.confirmed_by`;

// Non-chiefs only ever see the members they registered, without any admin details about who handled them.
function forViewer(user, row) {
  if (user.is_chief) return row;
  const { admitted_by, admitted_by_name, admitted_by_role, confirmed_by, confirmed_by_name, ...rest } = row;
  return rest;
}

// Anyone with a portal account can admit a member. It starts as pending_payment.
router.post('/', async (req, res) => {
  const m = clean(req.body);
  const err = validate(m);
  if (err) return res.status(400).json({ error: err });
  try {
    const { rows } = await db.query(
      `INSERT INTO members(full_name, phone, national_id, location, admitted_by, fee_amount, payment_method, payment_reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [m.full_name, m.phone, m.national_id, m.location, req.user.id, m.fee_amount, m.payment_method, m.payment_reference]
    );
    await audit(req.user.id, 'create', 'member', rows[0].id,
      { name: m.full_name, phone: m.phone, fee_amount: m.fee_amount, payment_method: m.payment_method, payment_reference: m.payment_reference });
    res.status(201).json(forViewer(req.user, rows[0]));
  } catch (e) {
    const msg = dupMessage(e);
    if (msg) return res.status(409).json({ error: msg });
    throw e;
  }
});

// Chiefs see every member. Everyone else sees only the people they admitted.
router.get('/', async (req, res) => {
  const where = [];
  const params = [];
  if (!req.user.is_chief) { params.push(req.user.id); where.push(`m.admitted_by = $${params.length}`); }
  if (['pending_payment', 'confirmed'].includes(req.query.status)) {
    params.push(req.query.status); where.push(`m.status = $${params.length}`);
  }
  const sql = `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.created_at DESC LIMIT 1000`;
  res.json((await db.query(sql, params)).rows.map((r) => forViewer(req.user, r)));
});

// Chief only from here: approve, edit, delete
router.post('/:id/confirm', requireChief, async (req, res) => {
  const id = Number(req.params.id);
  const fee = await db.query(`SELECT value FROM settings WHERE key='referral_commission'`);
  const { rows } = await db.query(
    `UPDATE members SET status='confirmed', commission_amount=$1, confirmed_by=$2, confirmed_at=now(), updated_at=now()
      WHERE id=$3 AND status='pending_payment' RETURNING *`,
    [Number(fee.rows[0].value), req.user.id, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Member not found or already confirmed' });
  const who = (await db.query('SELECT full_name FROM users WHERE id=$1', [rows[0].admitted_by])).rows[0];
  await audit(req.user.id, 'confirm', 'member', id,
    { name: rows[0].full_name, fee_amount: rows[0].fee_amount, commission: rows[0].commission_amount, admitted_by_id: rows[0].admitted_by, admitted_by_name: who && who.full_name });
  res.json(rows[0]);
});

router.put('/:id', requireChief, async (req, res) => {
  const id = Number(req.params.id);
  const m = clean(req.body);
  const err = validate(m);
  if (err) return res.status(400).json({ error: err });
  const before = (await db.query('SELECT * FROM members WHERE id=$1', [id])).rows[0];
  if (!before) return res.status(404).json({ error: 'Member not found' });
  try {
    const { rows } = await db.query(
      `UPDATE members SET full_name=$1, phone=$2, national_id=$3, location=$4, fee_amount=$5,
              payment_method=$6, payment_reference=$7, updated_at=now()
        WHERE id=$8 RETURNING *`,
      [m.full_name, m.phone, m.national_id, m.location, m.fee_amount, m.payment_method, m.payment_reference, id]
    );
    await audit(req.user.id, 'update', 'member', id, { name: before.full_name, before: { fee_amount: before.fee_amount, payment_reference: before.payment_reference, payment_method: before.payment_method }, after: { fee_amount: m.fee_amount, payment_reference: m.payment_reference, payment_method: m.payment_method } });
    res.json(rows[0]);
  } catch (e) {
    const msg = dupMessage(e);
    if (msg) return res.status(409).json({ error: msg });
    throw e;
  }
});

router.delete('/:id', requireChief, async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await db.query('DELETE FROM members WHERE id=$1 RETURNING full_name AS name, phone, fee_amount, status', [id]);
  if (!rows.length) return res.status(404).json({ error: 'Member not found' });
  await audit(req.user.id, 'delete', 'member', id, rows[0]);
  res.json({ ok: true });
});

module.exports = router;
