const fs = require('fs');
const path = require('path');
const db = require('./db');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.query(sql);
  console.log('Schema applied.');
}

if (require.main === module) {
  migrate()
    .then(() => db.pool.end())
    .catch((e) => { console.error(e); process.exit(1); });
}

module.exports = migrate;
