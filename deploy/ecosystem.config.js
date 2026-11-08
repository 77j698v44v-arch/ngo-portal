// PM2 config. Start with:  pm2 start deploy/ecosystem.config.js
// The name must be different from every other app on the VPS (the college portal has its own).
module.exports = {
  apps: [
    {
      name: 'ngo-portal',
      script: 'server.js',
      cwd: __dirname + '/../backend', // so dotenv finds backend/.env
      env: { NODE_ENV: 'production' },
      max_memory_restart: '300M',
    },
  ],
};
