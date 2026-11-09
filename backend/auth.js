const jwt = require('jsonwebtoken');
const db = require('./db');

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16) {
  throw new Error('JWT_SECRET must be set (min 16 characters). See .env.example');
}

const CHIEF_ROLES = ['project_admin', 'project_coordinator'];

function sign(user) {
  return jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '12h' });
}

// Loads the user fresh from the DB on every request so a deactivated, re-roled or
// password-reset account loses access immediately instead of when the token expires.
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not logged in' });

    const payload = jwt.verify(token, SECRET);
    const { rows } = await db.query(
      `SELECT u.id, u.full_name, u.username, u.role, u.active, u.password_set, r.label AS role_label
         FROM users u JOIN role_limits r ON r.role = u.role WHERE u.id = $1`,
      [payload.id]
    );
    const user = rows[0];
    if (!user || !user.active || !user.password_set) return res.status(401).json({ error: 'Account disabled or not found' });

    user.is_chief = CHIEF_ROLES.includes(user.role);
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

function requireChief(req, res, next) {
  if (!req.user || !req.user.is_chief) {
    return res.status(403).json({ error: 'Only the Project Admin or Project Coordinator can do this' });
  }
  next();
}

// Activity log. Never blocks the action it describes, and must never be given passwords.
async function audit(actorId, action, entity, entityId, details) {
  try {
    await db.query(
      'INSERT INTO audit_log(actor_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [actorId, action, entity, entityId, details ? JSON.stringify(details) : null]
    );
  } catch (e) {
    console.error('audit log write failed:', e.message);
  }
}

module.exports = { sign, requireAuth, requireChief, audit, CHIEF_ROLES };
