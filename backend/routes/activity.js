const express = require('express');
const db = require('../db');
const { requireAuth, requireChief } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireChief);

const TYPES = {
  logins: `a.entity = 'session'`,
  members: `a.entity = 'member'`,
  income: `a.entity = 'income_record'`,
  accounts: `a.entity = 'user'`,
  settings: `a.entity = 'settings'`,
};

// Everything that happens in the portal, newest first. Only the two chiefs can read this.
router.get('/', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const where = [];
  const params = [];
  if (TYPES[req.query.type]) where.push(TYPES[req.query.type]);
  if (req.query.actor) { params.push(Number(req.query.actor)); where.push(`a.actor_id = $${params.length}`); }
  params.push(limit + 1, offset);
  const { rows } = await db.query(
    `SELECT a.id, a.action, a.entity, a.entity_id, a.details, a.created_at, a.actor_id,
            u.full_name AS actor_name, r.label AS actor_role
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_id
       LEFT JOIN role_limits r ON r.role = u.role
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json({ rows: rows.slice(0, limit), has_more: rows.length > limit });
});

module.exports = router;
