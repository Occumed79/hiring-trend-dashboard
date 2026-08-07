const { spawnSync } = require('child_process');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (typeof result.status === 'number' && result.status !== 0) process.exit(result.status);
}

if (process.env.DATABASE_URL) {
  console.log('DATABASE_URL detected; applying database migrations before production build...');
  run(process.execPath, ['scripts/migrate.js']);
} else {
  console.log('DATABASE_URL not set; skipping database migrations for this build environment.');
}

run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'build']);
