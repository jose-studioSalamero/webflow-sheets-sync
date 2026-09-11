const { startSheetWatch } = require('../lib/sheet-watch');
const { requireSecret } = require('../lib/auth');

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requireSecret(req, res)) return;

  try {
    const watch = await startSheetWatch();
    res.status(200).json({ success: true, watch });
  } catch (error) {
    console.error('Watch setup error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
