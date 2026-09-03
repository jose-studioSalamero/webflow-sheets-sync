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
      range: 'Untitled!A2:Z',
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
      // Map Google Sheets columns to Webflow fields
      // Columns: event_id, brand, title, status, listed, start_datetime, end_datetime, 
      //          timezone, venue_name, summary, image_url, eventbrite_url, is_free, price_from
      
      const eventId = row[0] || '';
      const title = row[2] || ''; // Column C - title
      const startDateTime = row[5] || ''; // Column F - start_datetime
      const endDateTime = row[6] || ''; // Column G - end_datetime
      const venueName = row[8] || ''; // Column I - venue_name
      const summary = row[9] || ''; // Column J - summary
      const imageUrl = row[10] || ''; // Column K - image_url
      const eventbriteUrl = row[11] || ''; // Column L - eventbrite_url

      const itemData = {
        fieldData: {
          name: title,
          slug: eventId, // Use event_id as unique slug
          'start-date-time': startDateTime,
          'end-date-time': endDateTime,
          location: venueName,
          description: summary,
          'short-description': summary.substring(0, 100), // First 100 chars
          image: imageUrl,
          'rsvp-link': eventbriteUrl
        }
      };

      // Check if item already exists by event_id (slug)
      const existingItem = existingItems.items?.find(
        item => item.fieldData.slug === eventId
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

    // Publish all items
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