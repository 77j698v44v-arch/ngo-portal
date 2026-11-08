// Creates a first chief account (with its password already set) so someone can log in and create the rest.
//
//   ADMIN_USERNAME='your-login-id' ADMIN_PASSWORD='...' ADMIN_ROLE=project_coordinator npm run seed
//
// ADMIN_ROLE is project_admin (default) or project_coordinator.
const bcrypt = require('bcryptjs');
const db = require('./db');
const migrate = require('./migrate');

async function seedUser({ username, password, name, role = 'project_admin' }) {
  await migrate();
  username = String(username || 'admin').trim().toLowerCase();
  if (!password || password.length < 8) throw new Error('Set ADMIN_PASSWORD (min 8 characters) before seeding.');
  if (!['project_admin', 'project_coordinator'].includes(role)) throw new Error('ADMIN_ROLE must be project_admin or project_coordinator');

  const exists = await db.query('SELECT 1 FROM users WHERE username=$1', [username]);
  if (exists.rowCount) return { created: false, username };
  const hash = await bcrypt.hash(password, 12);
  await db.query(
    `INSERT INTO users(full_name, username, password_hash, password_set, role) VALUES ($1,$2,$3,TRUE,$4)`,
    [name || (role === 'project_admin' ? 'Project Admin' : 'Project Coordinator'), username, hash, role]
  );
  return { created: true, username };
}

if (require.main === module) {
  seedUser({
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD,
    name: process.env.ADMIN_NAME,
    role: process.env.ADMIN_ROLE || 'project_admin',
  })
    .then((r) => console.log(r.created ? `Created "${r.username}".` : `"${r.username}" already exists, nothing to do.`))
    .then(() => db.pool.end())
    .catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = seedUser;
