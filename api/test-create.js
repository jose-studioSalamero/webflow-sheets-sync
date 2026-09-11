const { getConfig, missingConfig } = require('../lib/config');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const missing = missingConfig(['webflowToken', 'webflowCollectionId']);
    if (missing.length) {
      return res.status(500).json({ error: `Missing environment variables: ${missing.join(', ')}` });
    }

    const { webflowToken, webflowCollectionId } = getConfig();

    // Test with minimal data
    const testData = {
      fieldData: {
        "name": "Test Event",
        "slug": "test-event-" + Date.now()
      }
    };

    console.log("Sending:", JSON.stringify(testData, null, 2));

    const response = await fetch(
      `https://api.webflow.com/v2/collections/${webflowCollectionId}/items`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${webflowToken}`,
          "Content-Type": "application/json",
          "accept-version": "1.0.0"
        },
        body: JSON.stringify(testData)
      }
    );

    const responseData = await response.json();

    res.status(200).json({
      success: response.ok,
      status: response.status,
      response: responseData
    });

  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
}
