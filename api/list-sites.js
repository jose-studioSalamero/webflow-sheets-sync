const WEBFLOW_API_TOKEN = "673bbe492ec8c898ffca8e522c988924af51a02681d70bc724cd7de4e0250469";

export default async function handler(req, res) {
  try {
    const response = await fetch(
      'https://api.webflow.com/v2/sites',
      {
        headers: {
          Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
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