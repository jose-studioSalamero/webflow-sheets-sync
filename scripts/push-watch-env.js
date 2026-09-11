const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const env = {};
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split(/\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    env[m[1]] = v.replace(/\\n/g, '\n');
  }
  return env;
}

const env = loadEnv(path.join(__dirname, '..', '.env.local'));

function addEnv(name, value) {
  const result = spawnSync(
    'vercel',
    ['env', 'add', name, 'production,preview,development', '--yes', '--sensitive', '--force'],
    { input: value, encoding: 'utf8' }
  );
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const ok = result.status === 0 || /already exists|Added|Overwrote|Saving/i.test(output);
  console.log(`${name}: ${ok ? 'ok' : 'failed'} (${result.status})`);
  if (!ok) console.log(output.slice(0, 400));
}

addEnv('SYNC_SECRET', env.SYNC_SECRET);
addEnv('CRON_SECRET', env.SYNC_SECRET);
addEnv('APP_URL', env.APP_URL || 'https://webflow-sheets-sync.vercel.app');
