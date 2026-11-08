const express = require('express');
const db = require('../db');
const { requireAuth, requireChief, audit } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// One row per leader: referral commission (confirmed members only) + each project stream.
const EARNINGS_SQL = `
  SELECT u.id, u.full_name, u.role, r.label AS role_label,
         COALESCE(ref.confirmed, 0)::int        AS referrals_confirmed,
         COALESCE(ref.pending, 0)::int          AS referrals_pending,
         COALESCE(ref.commission, 0)::float     AS referrals,
         COALESCE(s.poshomill, 0)::float        AS poshomill,
         COALESCE(s.public_transport, 0)::float AS public_transport,
         COALESCE(s.chicken_butcher, 0)::float  AS chicken_butcher
    FROM users u
    JOIN role_limits r ON r.role = u.role
    LEFT JOIN (
      SELECT admitted_by,
             COUNT(*) FILTER (WHERE status='confirmed') AS confirmed,
             COUNT(*) FILTER (WHERE status='pending_payment') AS pending,
             COALESCE(SUM(commission_amount) FILTER (WHERE status='confirmed'), 0) AS commission
        FROM members GROUP BY admitted_by
    ) ref ON ref.admitted_by = u.id
    LEFT JOIN (
      SELECT earner_id,
             SUM(amount) FILTER (WHERE stream='poshomill')        AS poshomill,
             SUM(amount) FILTER (WHERE stream='public_transport') AS public_transport,
             SUM(amount) FILTER (WHERE stream='chicken_butcher')  AS chicken_butcher
        FROM income_records GROUP BY earner_id
    ) s ON s.earner_id = u.id`;

function withTotal(r) {
  return { ...r, total: +(r.referrals + r.poshomill + r.public_transport + r.chicken_butcher).toFixed(2) };
}

router.get('/me', async (req, res) => {
  const { rows } = await db.query(`${EARNINGS_SQL} WHERE u.id = $1`, [req.user.id]);
  res.json(withTotal(rows[0]));
});

// Public to any logged-in user: needed to prefill the add-member form
router.get('/settings', async (req, res) => {
  const { rows } = await db.query('SELECT key, value FROM settings');
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json(req.user.is_chief ? s : { membership_fee: s.membership_fee });
});

router.put('/settings', requireChief, async (req, res) => {
  const allowed = ['membership_fee', 'referral_commission', 'max_recruiters'];
  const changed = {};
  for (const k of allowed) {
    if (req.body[k] === undefined) continue;
    const n = Number(req.body[k]);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: `${k} must be a number 0 or more` });
    const old = (await db.query('SELECT value FROM settings WHERE key=$1', [k])).rows[0];
    if (old && old.value !== String(n)) changed[k] = { from: Number(old.value), to: n };
    await db.query('UPDATE settings SET value=$1 WHERE key=$2', [String(n), k]);
  }
  if (Object.keys(changed).length) await audit(req.user.id, 'update', 'settings', null, changed);
  res.json({ ok: true });
});

router.get('/summary', requireChief, async (req, res) => {
  const leaders = (await db.query(`${EARNINGS_SQL} WHERE u.active ORDER BY r.sort_order, u.full_name`)).rows.map(withTotal);

  const streams = (await db.query(
    `SELECT stream, COALESCE(SUM(amount),0)::float AS total, COUNT(*)::int AS records FROM income_records GROUP BY stream`
  )).rows;
  const members = (await db.query(
    `SELECT COUNT(*) FILTER (WHERE status='confirmed')::int AS confirmed,
            COUNT(*) FILTER (WHERE status='pending_payment')::int AS pending,
            COALESCE(SUM(fee_amount) FILTER (WHERE status='confirmed'),0)::float AS fees_confirmed,
            COALESCE(SUM(fee_amount) FILTER (WHERE status='pending_payment'),0)::float AS fees_pending,
            COALESCE(SUM(commission_amount) FILTER (WHERE status='confirmed'),0)::float AS commissions
       FROM members`
  )).rows[0];

  const byStream = { poshomill: 0, public_transport: 0, chicken_butcher: 0 };
  streams.forEach((s) => { byStream[s.stream] = s.total; });
  const projectIncome = Object.values(byStream).reduce((a, b) => a + b, 0);

  res.json({ byStream, projectIncome, members, leaders });
});

module.exports = router;
