// Configuration
const GOOGLE_SHEET_ID = "1fymh7kY8cme4rYP3Tb7g1YzzxnJI2pc9o9dXHTPCGfU";
const SHEET_NAME = "Untitled";
const WEBFLOW_COLLECTION_ID = "66f6f0b3c9e1dc700a85a10d";
const WEBFLOW_API_TOKEN = "673bbe492ec8c898ffca8e522c988924af51a02681d70bc724cd7de4e0250469";

// Helper function to create JWT for Google API
function createJWT(serviceAccount) {
  const header = {
    alg: "RS256",
    typ: "JWT"
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const base64UrlEncode = (obj) => {
    return Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  const headerEncoded = base64UrlEncode(header);
  const payloadEncoded = base64UrlEncode(payload);
  const signatureInput = `${headerEncoded}.${payloadEncoded}`;

  const crypto = require('crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signatureInput);
  const signature = sign.sign(serviceAccount.private_key, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${signatureInput}.${signature}`;
}

// Get access token from Google
async function getGoogleAccessToken() {
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  
  if (!serviceAccountKey) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY environment variable not set");
  }

  const serviceAccount = JSON.parse(serviceAccountKey);
  const jwt = createJWT(serviceAccount);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get access token: ${error}`);
  }

  const data = await response.json();
  return data.access_token;
}

// Helper function to clean and validate URL
function cleanUrl(value) {
  if (!value) return null;
  
  if (typeof value === 'object') {
    if (value.url) return value.url;
    if (value.href) return value.href;
    return null;
  }
  
  const urlString = String(value).trim();
  
  if (!urlString || urlString === '') return null;
  
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
  
  return String(value)
    .replace(/\\n/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Helper function to transform Google Sheets data to Webflow format
function transformToWebflowFormat(row) {
  const fieldData = {
    "event-id": row["event_id"] || null,
    "name": row["title"] || "Untitled Event",
    "slug": row["title"] ? row["title"].toLowerCase().replace(/[^a-z0-9]+/g, '-') : null,
    "tags": row["brand"] || null,
    "rsvp-link": cleanUrl(row["eventbrite_url"]),
    "short-description": cleanSingleLineText(row["summary"]),
    "description": row["summary"] || null,
    "venue": row["venue_name"] || null,
    "location": row["venue_name"] || null,
    "start-date": row["start_datetime"] || null,
    "end-date": row["end_datetime"] || null,
    "organizer-email": null,
    "ticket-required": row["is_free"] === "FALSE" || row["is_free"] === false,
    "going": 0,
    "capacity": 0
  };

  return {
    id: row["_id"] || null,
    fieldData: fieldData
  };
}

// Main sync function
async function syncGoogleSheetToWebflow() {
  try {
    console.log("Starting sync from Google Sheets to Webflow...");

    console.log("Getting Google access token...");
    const accessToken = await getGoogleAccessToken();

    const sheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}`;
    console.log("Fetching from:", sheetUrl);
    
    const sheetResponse = await fetch(sheetUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (!sheetResponse.ok) {
      const errorText = await sheetResponse.text();
      throw new Error(`Google Sheets fetch failed: ${sheetResponse.status} ${sheetResponse.statusText}\n${errorText}`);
    }
    
    const sheetData = await sheetResponse.json();
    console.log("Sheet data received");

    if (!sheetData.values || sheetData.values.length === 0) {
      throw new Error("No data found in Google Sheet");
    }

    const headers = sheetData.values[0];
    const rows = sheetData.values.slice(1)
      .filter(row => row && row.length > 0 && row.some(cell => cell))
      .map(row => {
        const rowData = {};
        headers.forEach((header, index) => {
          rowData[header] = row[index] || null;
        });
        return rowData;
      });

    console.log(`Found ${rows.length} rows in Google Sheets`);
    console.log("Headers:", headers);
    console.log("First row sample:", rows[0]);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = [];

    for (const row of rows) {
      try {
        if (!row["event_id"]) {
          skipped++;
          continue;
        }

        const webflowItem = transformToWebflowFormat(row);

        const existingItemResponse = await fetch(
          `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}/items?fieldData.event-id=${row["event_id"]}`,
          {
            headers: {
              Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
              "accept-version": "1.0.0"
            }
          }
        );

        const existingItems = await existingItemResponse.json();

        if (existingItems.items && existingItems.items.length > 0) {
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
            console.log(`Updated: ${row["title"]} (${row["event_id"]})`);
          } else {
            const errorData = await updateResponse.json();
            errors.push({
              event_id: row["event_id"],
              title: row["title"],
              error: `${errorData.message || 'Update failed'}`
            });
            console.error(`Error updating ${row["title"]}:`, errorData);
          }
        } else {
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
            console.log(`Created: ${row["title"]} (${row["event_id"]})`);
          } else {
            const errorData = await createResponse.json();
            errors.push({
              event_id: row["event_id"],
              title: row["title"],
              error: `${errorData.message || 'Create failed'}`
            });
            console.error(`Error creating ${row["title"]}:`, errorData);
          }
        }

        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        errors.push({
          event_id: row["event_id"],
          title: row["title"],
          error: error.message
        });
        console.error(`Error processing ${row["title"]}:`, error);
      }
    }

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