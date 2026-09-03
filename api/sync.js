// Configuration
const GOOGLE_SHEET_ID = "1NUBPIj4fZPEb6Y-5yVDn3wBDL_bYw7LSQP-KPVaP_Bw";
const SHEET_NAME = "Untitled";
const WEBFLOW_COLLECTION_ID = "66f6f0b3c9e1dc700a85a10d";
const WEBFLOW_API_TOKEN = "673bbe492ec8c898ffca8e522c988924af51a02681d70bc724cd7de4e0250469";

// Helper function to clean and validate URL
function cleanUrl(value) {
  if (!value) return null;
  
  // If it's an object, try to extract URL from it
  if (typeof value === 'object') {
    if (value.url) return value.url;
    if (value.href) return value.href;
    return null;
  }
  
  // Convert to string and trim
  const urlString = String(value).trim();
  
  // If empty, return null
  if (!urlString || urlString === '') return null;
  
  // Basic URL validation
  try {
    new URL(urlString);
    return urlString;
  } catch (e) {
    console.log(`Invalid URL: ${urlString}`);
    return null;
  }
}

// Helper function to clean single-line text (remove line breaks)
function cleanSingleLineText(value) {
  if (!value) return null;
  
  // Convert to string, remove all line breaks, and trim
  return String(value)
    .replace(/\\n/g, ' ')  // Replace literal \n
    .replace(/\n/g, ' ')   // Replace actual line breaks
    .replace(/\r/g, ' ')   // Replace carriage returns
    .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
    .trim();
}

// Helper function to transform Google Sheets data to Webflow format
function transformToWebflowFormat(row) {
  const fieldData = {
    "event-id": row["event-id"] || null,
    "name": row["name"] || "Untitled Event",
    "slug": row["slug"] || null,
    "tags": row["tags"] || null,
    "rsvp-link": cleanUrl(row["rsvp-link"]),  // Clean URL
    "short-description": cleanSingleLineText(row["short-description"]),  // Remove line breaks
    "description": row["description"] || null,
    "venue": row["venue"] || null,
    "location": row["location"] || null,
    "start-date": row["start-date"] || null,
    "end-date": row["end-date"] || null,
    "organizer-email": row["organizer-email"] || null,
    "ticket-required": row["ticket-required"] === "TRUE" || row["ticket-required"] === true,
    "going": parseInt(row["going"]) || 0,
    "capacity": parseInt(row["capacity"]) || 0
  };

  return {
    id: row["_id"] || null,  // Webflow item ID if updating
    fieldData: fieldData
  };
}

// Main sync function
async function syncGoogleSheetToWebflow() {
  try {
    console.log("Starting sync from Google Sheets to Webflow...");

    // Fetch data from Google Sheets
    const sheetResponse = await fetch(
      `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:json&sheet=${SHEET_NAME}`
    );
    const sheetText = await sheetResponse.text();
    const jsonData = JSON.parse(sheetText.substring(47, sheetText.length - 2));

    // Parse Google Sheets data
    const headers = jsonData.table.cols.map(col => col.label);
    const rows = jsonData.table.rows.map(row => {
      const rowData = {};
      row.c.forEach((cell, index) => {
        rowData[headers[index]] = cell ? cell.v : null;
      });
      return rowData;
    });

    console.log(`Found ${rows.length} rows in Google Sheets`);

    // Track sync results
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = [];

    // Process each row
    for (const row of rows) {
      try {
        // Skip rows without event-id
        if (!row["event-id"]) {
          skipped++;
          continue;
        }

        // Transform data to Webflow format
        const webflowItem = transformToWebflowFormat(row);

        // Check if item exists in Webflow by event-id
        const existingItemResponse = await fetch(
          `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}/items?fieldData.event-id=${row["event-id"]}`,
          {
            headers: {
              Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
              "accept-version": "1.0.0"
            }
          }
        );

        const existingItems = await existingItemResponse.json();

        if (existingItems.items && existingItems.items.length > 0) {
          // Update existing item
          const itemId = existingItems.items[0].id;
          const updateResponse = await fetch(
            `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}/items/${itemId}`,
            {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
                "Content-Type": "application/json",
                "accept-version": "1.0.0"
              },
              body: JSON.stringify({ fieldData: webflowItem.fieldData })
            }
          );

          if (updateResponse.ok) {
            updated++;
            console.log(`Updated: ${row["name"]} (${row["event-id"]})`);
          } else {
            const errorData = await updateResponse.json();
            errors.push({
              event_id: row["event-id"],
              title: row["name"],
              error: `${errorData.message || 'Update failed'}\nStatus code: ${updateResponse.status}\nBody: ${JSON.stringify(errorData, null, 2)}`
            });
            console.error(`Error updating ${row["name"]}:`, errorData);
          }
        } else {
          // Create new item
          const createResponse = await fetch(
            `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}/items`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
                "Content-Type": "application/json",
                "accept-version": "1.0.0"
              },
              body: JSON.stringify({ fieldData: webflowItem.fieldData })
            }
          );

          if (createResponse.ok) {
            created++;
            console.log(`Created: ${row["name"]} (${row["event-id"]})`);
          } else {
            const errorData = await createResponse.json();
            errors.push({
              event_id: row["event-id"],
              title: row["name"],
              error: `${errorData.message || 'Create failed'}\nStatus code: ${createResponse.status}\nBody: ${JSON.stringify(errorData, null, 2)}`
            });
            console.error(`Error creating ${row["name"]}:`, errorData);
          }
        }

        // Rate limiting: wait 100ms between requests
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        errors.push({
          event_id: row["event-id"],
          title: row["name"],
          error: error.message
        });
        console.error(`Error processing ${row["name"]}:`, error);
      }
    }

    // Return summary
    return {
      success: true,
      created,
      updated,
      skipped,
      total: rows.length,
      errors
    };

  } catch (error) {
    console.error("Sync failed:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Vercel serverless function handler
export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = await syncGoogleSheetToWebflow();
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
}