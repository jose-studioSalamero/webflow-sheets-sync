const { getConfig, missingConfig } = require('../lib/config');

export default async function handler(req, res) {
  try {
    const missing = missingConfig(['webflowToken']);
    if (missing.length) {
      return res.status(500).json({ error: `Missing environment variables: ${missing.join(', ')}` });
    }

    const { webflowToken } = getConfig();

    const response = await fetch(
      'https://api.webflow.com/v2/sites',
      {
        headers: {
          Authorization: `Bearer ${webflowToken}`,
          "accept-version": "1.0.0"
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ 
        error: `Failed to fetch sites: ${errorText}` 
      });
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
