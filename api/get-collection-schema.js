const { getConfig, missingConfig } = require('../lib/config');

export default async function handler(req, res) {
  try {
    const missing = missingConfig(['webflowToken', 'webflowCollectionId']);
    if (missing.length) {
      return res.status(500).json({ error: `Missing environment variables: ${missing.join(', ')}` });
    }

    const { webflowToken, webflowCollectionId } = getConfig();

    const response = await fetch(
      `https://api.webflow.com/v2/collections/${webflowCollectionId}`,
      {
        headers: {
          Authorization: `Bearer ${webflowToken}`,
          "accept-version": "1.0.0"
        }
      }
    );

    const data = await response.json();
    
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
