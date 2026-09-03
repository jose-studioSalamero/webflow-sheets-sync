const { google } = require("googleapis");
const { Webflow } = require("@webflow/js-webflow-api");

// Initialize Google Sheets
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const sheets = google.sheets({ version: "v4", auth });

// Initialize Webflow
const webflow = new Webflow({ token: process.env.WEBFLOW_API_TOKEN });

// Helper function to parse date strings
function parseEventDate(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toISOString();
  } catch (e) {
    return null;
  }
}

// Main sync function
async function syncSheetsToWebflow() {
  try {
    // 1. Fetch data from Google Sheets
    console.log("Fetching data from Google Sheets...");
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Sheet1!A2:Z", // Adjust range as needed (A2:Z means skip header row)
    });

    const rows = response.data.values;

    if (!rows || rows.length === 0) {
      console.log("No data found in sheet");
      return { success: true, message: "No data to sync" };
    }

    console.log(`Found ${rows.length} rows in Google Sheets`);

    // 2. Get existing items from Webflow CMS
    console.log("Fetching existing Webflow CMS items...");
    const existingItems = await webflow.collections.items.listItems(
      process.env.WEBFLOW_COLLECTION_ID,
    );

    // Create a map of existing items by a unique identifier (e.g., event name)
    const existingItemsMap = new Map();
    existingItems.items.forEach((item) => {
      existingItemsMap.set(item.fieldData.name, item.id);
    });

    // 3. Process each row and sync to Webflow
    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const row of rows) {
      try {
        // Map spreadsheet columns to your data structure
        // ADJUST THESE COLUMN INDEXES based on your sheet structure
        const eventData = {
          name: row[0] || "Untitled Event",
          slug: (row[0] || "untitled-event").toLowerCase().replace(/\s+/g, "-"),
          "event-date": parseEventDate(row[1]),
          "event-time": row[2] || "",
          description: row[3] || "",
          location: row[4] || "",
          "image-url": row[5] || "",
          "ticket-link": row[6] || "",
          _archived: false,
          _draft: false,
        };

        // Check if item already exists
        const existingItemId = existingItemsMap.get(eventData.name);

        if (existingItemId) {
          // Update existing item
          await webflow.collections.items.updateItem(
            process.env.WEBFLOW_COLLECTION_ID,
            existingItemId,
            { fieldData: eventData },
          );
          updated++;
          console.log(`✓ Updated: ${eventData.name}`);
        } else {
          // Create new item
          await webflow.collections.items.createItem(
            process.env.WEBFLOW_COLLECTION_ID,
            { fieldData: eventData },
          );
          created++;
          console.log(`✓ Created: ${eventData.name}`);
        }
      } catch (error) {
        errors++;
        console.error(`✗ Error processing row: ${error.message}`);
      }
    }

    return {
      success: true,
      message: `Sync complete: ${created} created, ${updated} updated, ${errors} errors`,
      stats: { created, updated, errors, total: rows.length },
    };
  } catch (error) {
    console.error("Sync failed:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Vercel serverless function handler
module.exports = async (req, res) => {
  // Optional: Add basic auth to prevent unauthorized access
  const authHeader = req.headers.authorization;
  const expectedAuth = process.env.SYNC_SECRET || "your-secret-key";

  if (authHeader !== `Bearer ${expectedAuth}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const result = await syncSheetsToWebflow();

  if (result.success) {
    res.status(200).json(result);
  } else {
    res.status(500).json(result);
  }
};
