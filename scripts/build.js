const { spawnSync } = require('child_process');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (typeof result.status === 'number' && result.status !== 0) process.exit(result.status);
}

function runOptional(command, args, label) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.error) {
    console.warn(`${label} could not run: ${result.error.message}`);
    return false;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    console.warn(`${label} exited with status ${result.status}; continuing the production build.`);
    return false;
  }
  return true;
}

function hasTheirStackKey() {
  return ['THEIRSTACK_API_KEY','THEIRSTACK_API_KEY_2','THEIRSTACK_API_KEY_3','THEIRSTACK_API_KEY_4','THEIRSTACK_API_KEY_5']
    .some(name => String(process.env[name] || '').trim());
}

if (process.env.DATABASE_URL) {
  console.log('DATABASE_URL detected; applying database migrations before production build...');
  run(process.execPath, ['scripts/migrate.js']);

  if (hasTheirStackKey()) {
    console.log('Synchronizing TheirStack saved-list employers into the profile registry before build...');
    runOptional(process.execPath, ['scripts/sync-theirstack-monitors.js'], 'TheirStack profile registry sync');
  }
} else {
  console.log('DATABASE_URL not set; skipping database migrations and tracker profile sync for this build environment.');
}

run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'build']);
