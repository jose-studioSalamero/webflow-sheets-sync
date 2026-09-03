// Configuration
const GOOGLE_SHEET_ID = "1fymh7kY8cme4rYP3Tb7g1YzzxnJI2pc9o9dXHTPCGfU";
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

// Helper function to parse CSV
function parseCSV(csvText) {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  
  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        currentField += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      currentRow.push(currentField);
      currentField = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      // End of row
      if (char === '\r' && nextChar === '\n') {
        i++; // Skip \n in \r\n
      }
      if (currentField || currentRow.length > 0) {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
      }
    } else {
      currentField += char;
    }
  }
  
  // Add last field and row
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }
  
  return rows;
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

    // Fetch data from Google Sheets using CSV export (works with "Anyone with link" permission)
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;
    console.log("Fetching from:", sheetUrl);
    
    const sheetResponse = await fetch(sheetUrl);
    
    if (!sheetResponse.ok) {
      throw new Error(`Google Sheets fetch failed: ${sheetResponse.status} ${sheetResponse.statusText}`);
    }
    
    const csvText = await sheetResponse.text();
    console.log("CSV Response length:", csvText.length);
    console.log("First 200 chars:", csvText.substring(0, 200));
    
    // Parse CSV
    const csvRows = parseCSV(csvText);
    
    if (csvRows.length === 0) {
      throw new Error("No data found in Google Sheet");
    }
    
    // First row is headers
    const headers = csvRows[0];
    console.log("Headers:", headers);
    
    // Convert remaining rows to objects
    const rows = csvRows.slice(1)
      .filter(row => row.some(cell => cell && cell.trim())) // Filter empty rows
      .map(row => {
        const rowData = {};
        headers.forEach((header, index) => {
          rowData[header] = row[index] || null;
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