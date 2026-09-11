const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split(/\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v.replace(/\\n/g, '\n');
  }
}

loadEnv(path.join(__dirname, '..', '.env.local'));

const { runSync } = require('../lib/sync-events');

runSync()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) process.exit(1);
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
