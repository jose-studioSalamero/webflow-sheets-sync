const { google } = require('googleapis');
const { WebflowClient } = require('webflow-api');

// Validate environment variables
const requiredEnvVars = [
  'GOOGLE_SERVICE_ACCOUNT',
  'SPREADSHEET_ID',
  'SHEET_NAME',
  'WEBFLOW_API_TOKEN',
  'WEBFLOW_COLLECTION_ID'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

const GOOGLE_SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME;
const WEBFLOW_API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const WEBFLOW_COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID;

module.exports = async (req, res) => {
  try {
    // Authenticate with Google Sheets
    const auth = new google.auth.GoogleAuth({
      credentials: GOOGLE_SERVICE_ACCOUNT,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Fetch data from Google Sheets
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:N`,
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return res.status(200).json({ message: 'No data found in sheet' });
    }

    // Parse headers and rows
    const headers = rows[0];
    const dataRows = rows.slice(1);

    // Initialize Webflow client
    const webflow = new WebflowClient({ accessToken: WEBFLOW_API_TOKEN });

    // Get existing items to check for duplicates
    let existingEventIds = new Set();
    try {
      const existingResponse = await webflow.collections.items.listItems(WEBFLOW_COLLECTION_ID);
      if (existingResponse && existingResponse.items) {
        existingEventIds = new Set(
          existingResponse.items
            .map(item => item.fieldData?.slug)
            .filter(Boolean)
        );
      }
    } catch (listError) {
      console.log('Could not fetch existing items, proceeding anyway:', listError.message);
    }

    let created = 0;
    let skipped = 0;
    const errors = [];

    // Process each row
    for (const row of dataRows) {
      const rowData = {};
      headers.forEach((header, index) => {
        rowData[header] = row[index] || '';
      });

      // Skip if missing required fields
      if (!rowData.title || !rowData.event_id) {
        skipped++;
        continue;
      }

      // Skip if event_id already exists
      if (existingEventIds.has(rowData.event_id)) {
        skipped++;
        continue;
      }

      try {
        // Prepare item data
        const itemData = {
          isArchived: false,
          isDraft: false,
          fieldData: {
            name: rowData.title,
            slug: rowData.event_id,
          }
        };

        // Add optional fields only if they exist
        if (rowData.start_datetime) {
          itemData.fieldData['start-date-time'] = rowData.start_datetime;
        }
        
        if (rowData.end_datetime) {
          itemData.fieldData['end-date-time'] = rowData.end_datetime;
        }
        
        if (rowData.venue_name) {
          itemData.fieldData.location = rowData.venue_name;
        }
        
        if (rowData.summary) {
          itemData.fieldData.description = rowData.summary;
          itemData.fieldData['short-description'] = rowData.summary.substring(0, 200);
        }
        
        if (rowData.eventbrite_url) {
          itemData.fieldData['rsvp-link'] = {
            url: rowData.eventbrite_url,
            target: '_blank'
          };
        }
        
        if (rowData.image_url) {
          itemData.fieldData.image = {
            url: rowData.image_url
          };
        }

        // Create item in Webflow
        await webflow.collections.items.createItem(WEBFLOW_COLLECTION_ID, itemData);
        created++;
        existingEventIds.add(rowData.event_id);

      } catch (error) {
        errors.push({
          event_id: rowData.event_id,
          title: rowData.title,
          error: error.message
        });
      }
    }

    res.status(200).json({
      success: true,
      created,
      skipped,
      total: dataRows.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};