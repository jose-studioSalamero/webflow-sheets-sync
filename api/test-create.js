const WEBFLOW_API_TOKEN = "673bbe492ec8c898ffca8e522c988924af51a02681d70bc724cd7de4e0250469";
const WEBFLOW_COLLECTION_ID = "6a79abe171f09344bb01ff15";

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Test with minimal data
    const testData = {
      fieldData: {
        "name": "Test Event",
        "slug": "test-event-" + Date.now()
      }
    };

    console.log("Sending:", JSON.stringify(testData, null, 2));

    const response = await fetch(
      `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}/items`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
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