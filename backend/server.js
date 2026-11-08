require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true }));
app.use(express.json({ limit: '100kb' }));

// Throttle password guessing
const loginLimit = () => rateLimit({ windowMs: 15 * 60 * 1000, max: Number(process.env.LOGIN_RATE_MAX) || 30,
  standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in 15 minutes.' } });
app.use('/api/auth/login', loginLimit());
app.use('/api/auth/first-login', loginLimit());

// Express 4 doesn't catch rejected promises in async handlers, so wrap each route layer.
function wrapAsync(router) {
  router.stack.forEach((layer) => {
    if (layer.route) layer.route.stack.forEach((l) => {
      const fn = l.handle;
      if (fn.length <= 3) l.handle = (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
    });
  });
  return router;
}

app.use('/api/auth', wrapAsync(require('./routes/auth')));
app.use('/api/users', wrapAsync(require('./routes/users')));
app.use('/api/members', wrapAsync(require('./routes/members')));
app.use('/api/income', wrapAsync(require('./routes/income')));
app.use('/api/reports', wrapAsync(require('./routes/reports')));
app.use('/api/activity', wrapAsync(require('./routes/activity')));
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve the frontend from the same server (or deploy ../frontend separately and set CORS_ORIGIN)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`NGO portal running on http://localhost:${PORT}`));
}
module.exports = app;
