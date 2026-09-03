const { WebflowClient } = require('webflow-api');

const WEBFLOW_API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const WEBFLOW_COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID;

module.exports = async (req, res) => {
  try {
    const webflow = new WebflowClient({ accessToken: WEBFLOW_API_TOKEN });
    
    // Get collection details including field names
    const collection = await webflow.collections.get(WEBFLOW_COLLECTION_ID);
    
    res.status(200).json(collection);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.stack
    });
  }
};