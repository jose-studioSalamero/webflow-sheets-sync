const { google } = require('googleapis');
const { WebflowClient } = require('webflow-api');

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const WEBFLOW_API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const WEBFLOW_COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID;

module.exports = async (req, res) => {
  try {
    // Initialize Google Sheets API with JWT
    const auth = new google.auth.JWT({
      email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: GOOGLE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Read data from Google Sheets
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Sheet1!A2:Z',
    });

    const rows = response.data.values;

    if (!rows || rows.length === 0) {
      return res.status(200).json({ message: 'No data found in sheet' });
    }

    // Initialize Webflow API
    const webflow = new WebflowClient({ accessToken: WEBFLOW_API_TOKEN });

    // Get existing items from Webflow
    const existingItems = await webflow.collections.items.listItems(WEBFLOW_COLLECTION_ID);

    // Process each row
    for (const row of rows) {
      const itemData = {
        fieldData: {
          name: row[0] || '',
          slug: (row[0] || '').toLowerCase().replace(/\s+/g, '-'),
        }
      };

      const existingItem = existingItems.items?.find(
        item => item.fieldData.slug === itemData.fieldData.slug
      );

      if (existingItem) {
        await webflow.collections.items.updateItem(
          WEBFLOW_COLLECTION_ID,
          existingItem.id,
          itemData
        );
      } else {
        await webflow.collections.items.createItem(
          WEBFLOW_COLLECTION_ID,
          itemData
        );
      }
    }

    await webflow.collections.items.publishItem(WEBFLOW_COLLECTION_ID);

    res.status(200).json({ 
      success: true, 
      message: `Synced ${rows.length} items to Webflow`,
      itemsProcessed: rows.length
    });

  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.stack
    });
  }
};