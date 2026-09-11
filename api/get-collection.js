const { WebflowClient } = require('webflow-api');
const { getConfig, missingConfig } = require('../lib/config');

module.exports = async (req, res) => {
  try {
    const missing = missingConfig(['webflowToken', 'webflowCollectionId']);
    if (missing.length) {
      return res.status(500).json({ error: `Missing environment variables: ${missing.join(', ')}` });
    }

    const { webflowToken, webflowCollectionId } = getConfig();
    const webflow = new WebflowClient({ accessToken: webflowToken });
    
    const collection = await webflow.collections.get(webflowCollectionId);
    
    res.status(200).json(collection);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: error.message,
    });
  }
};
