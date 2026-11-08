const express = require('express');
const db = require('../db');
const { requireAuth, requireChief, audit } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const STREAMS = ['poshomill', 'public_transport', 'chicken_butcher'];

async function clean(body, user) {
  // Non-chiefs can only record income for themselves. Chiefs can credit any leader.
  const earner = user.is_chief && body.earner_id ? Number(body.earner_id) : user.id;
  const amount = Number(body.amount);
  const date = body.record_date ? String(body.record_date) : new Date().toISOString().slice(0, 10);
  if (!STREAMS.includes(body.stream)) return { error: 'Choose poshomill, public transport or chicken butcher' };
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Amount must be greater than zero' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Date is invalid' };
  if (date > new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10)) return { error: 'Date cannot be in the future' };
  const ok = await db.query('SELECT full_name FROM users WHERE id=$1 AND active', [earner]);
  if (!ok.rowCount) return { error: 'Selected leader not found' };
  return { value: { stream: body.stream, amount, earner_id: earner, earner_name: ok.rows[0].full_name, record_date: date, notes: body.notes ? String(body.notes).trim() : null } };
}

// Everyone can enter a record. They cannot change it afterwards.
router.post('/', async (req, res) => {
  const c = await clean(req.body, req.user);
  if (c.error) return res.status(400).json({ error: c.error });
  const v = c.value;
  const { rows } = await db.query(
    `INSERT INTO income_records(stream, amount, earner_id, record_date, notes, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [v.stream, v.amount, v.earner_id, v.record_date, v.notes, req.user.id]
  );
  await audit(req.user.id, 'create', 'income_record', rows[0].id,
    { stream: v.stream, amount: v.amount, earner_id: v.earner_id, earner_name: v.earner_name, record_date: v.record_date });
  res.status(201).json(req.user.is_chief ? rows[0] : { id: rows[0].id, stream: v.stream, amount: rows[0].amount, record_date: rows[0].record_date, notes: v.notes });
});

// Chiefs see all records. Everyone else sees only income credited to them, with no admin details.
router.get('/', async (req, res) => {
  const where = [];
  const params = [];
  if (!req.user.is_chief) { params.push(req.user.id); where.push(`i.earner_id = $1`); }
  if (STREAMS.includes(req.query.stream)) { params.push(req.query.stream); where.push(`i.stream = $${params.length}`); }
  if (req.query.from) { params.push(req.query.from); where.push(`i.record_date >= $${params.length}`); }
  if (req.query.to) { params.push(req.query.to); where.push(`i.record_date <= $${params.length}`); }
  const cols = req.user.is_chief
    ? 'i.*, e.full_name AS earner_name, e.role AS earner_role, r.full_name AS recorded_by_name'
    : 'i.id, i.stream, i.amount, i.record_date, i.notes, i.created_at';
  const sql = `SELECT ${cols}
      FROM income_records i
      LEFT JOIN users e ON e.id = i.earner_id
      JOIN users r ON r.id = i.recorded_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.record_date DESC, i.id DESC LIMIT 1000`;
  res.json((await db.query(sql, params)).rows);
});

router.put('/:id', requireChief, async (req, res) => {
  const id = Number(req.params.id);
  const before = (await db.query('SELECT * FROM income_records WHERE id=$1', [id])).rows[0];
  if (!before) return res.status(404).json({ error: 'Record not found' });
  const c = await clean(req.body, req.user);
  if (c.error) return res.status(400).json({ error: c.error });
  const v = c.value;
  const { rows } = await db.query(
    `UPDATE income_records SET stream=$1, amount=$2, earner_id=$3, record_date=$4, notes=$5, updated_at=now(), updated_by=$6
      WHERE id=$7 RETURNING *`,
    [v.stream, v.amount, v.earner_id, v.record_date, v.notes, req.user.id, id]
  );
  await audit(req.user.id, 'update', 'income_record', id, { before: { stream: before.stream, amount: before.amount, earner_id: before.earner_id, record_date: before.record_date }, after: { stream: v.stream, amount: v.amount, earner_id: v.earner_id, earner_name: v.earner_name, record_date: v.record_date } });
  res.json(rows[0]);
});

router.delete('/:id', requireChief, async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await db.query('DELETE FROM income_records WHERE id=$1 RETURNING stream, amount, earner_id, record_date', [id]);
  if (!rows.length) return res.status(404).json({ error: 'Record not found' });
  await audit(req.user.id, 'delete', 'income_record', id, rows[0]);
  res.json({ ok: true });
});

module.exports = router;
