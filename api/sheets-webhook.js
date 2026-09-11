const { runSync } = require('../lib/sync-events');
const { isAuthorized } = require('../lib/auth');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const state = String(req.headers['x-goog-resource-state'] || '');
  if (state === 'sync') {
    return res.status(200).json({ ok: true, ignored: 'sync' });
  }

  try {
    const result = await runSync();
    res.status(result.success ? 200 : 207).json({ source: 'sheets-webhook', ...result });
  } catch (error) {
    console.error('Sheet webhook sync error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
