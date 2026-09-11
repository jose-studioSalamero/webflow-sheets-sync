const { runSync } = require('../lib/sync-events');
const { startSheetWatch } = require('../lib/sheet-watch');
const { requireSecret } = require('../lib/auth');

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requireSecret(req, res)) return;

  try {
    let watch = null;
    let watchError = null;
    try {
      watch = await startSheetWatch();
    } catch (error) {
      watchError = error.message;
      console.error('Watch renew error:', error);
    }

    const result = await runSync();
    res.status(result.success ? 200 : 207).json({
      source: 'cron',
      watch,
      watchError,
      ...result,
    });
  } catch (error) {
    console.error('Cron sync error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
