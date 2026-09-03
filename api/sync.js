const { GoogleAuth } = require('google-auth-library');

const WEBFLOW_TOKEN = process.env.WEBFLOW_TOKEN;
const SITE_ID = '6a705d088ea81dba5d21cc45';
const COLLECTION_ID = '6a79abe171f09344bb01ff15';
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

const SHEET_TAB = 'Untitled'; // The actual sheet tab name

async function fetchGoogleSheetData() {
  const auth = new GoogleAuth({
    credentials: {
      client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: GOOGLE_PRIVATE_KEY,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();

  const range = `${SHEET_TAB}!A:Z`; // Get all columns
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken.token}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google Sheets fetch failed: ${response.status} ${response.statusText} - ${error}`);
  }

  const data = await response.json();
  return data.values || [];
}

function parseDateTime(dateStr, timeStr, timezone = 'Asia/Hong_Kong') {
  if (!dateStr || !timeStr) return null;
  
  try {
    // Parse date: "2026-09-02T04:00:00.000Z"
    const date = new Date(dateStr);
    
    // Parse time: "2026-09-02T04:00:00.000Z" 
    const time = new Date(timeStr);
    
    // Combine them
    const combined = new Date(date);
    combined.setHours(time.getHours(), time.getMinutes(), time.getSeconds());
    
    return combined.toISOString();
  } catch (error) {
    console.error('DateTime parse error:', error, { dateStr, timeStr });
    return null;
  }
}

function createSlug(title, eventId) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 200);
  
  return `${slug}-${eventId}`;
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Fetch data from Google Sheet
    const rows = await fetchGoogleSheetData();
    
    if (rows.length < 2) {
      return res.status(400).json({ error: 'Sheet has no data' });
    }

    const headers = rows[0];
    const dataRows = rows.slice(1);

    // Map column indices
    const colMap = {
      event_id: headers.indexOf('event_id'),
      brand: headers.indexOf('brand'),
      title: headers.indexOf('title'),
      status: headers.indexOf('status'),
      listed: headers.indexOf('listed'),
      start_datetime: headers.indexOf('start_datetime'),
      end_datetime: headers.indexOf('end_datetime'),
      timezone: headers.indexOf('timezone'),
      venue_id: headers.indexOf('venue_id'),
    };

    console.log('Column mapping:', colMap);
    console.log(`Processing ${dataRows.length} rows`);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    // Process each row
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const event_id = row[colMap.event_id];
      const title = row[colMap.title];
      const status = row[colMap.status];
      const listed = row[colMap.listed];

      // Skip if not live and listed
      if (status !== 'live' || listed !== 'TRUE') {
        skipped++;
        continue;
      }

      const start_datetime = row[colMap.start_datetime];
      const end_datetime = row[colMap.end_datetime];
      const timezone = row[colMap.timezone];

      try {
        const startDate = parseDateTime(start_datetime, start_datetime, timezone);
        const endDate = parseDateTime(end_datetime, end_datetime, timezone);

        const fieldData = {
          name: title,
          slug: createSlug(title, event_id),
          'start-date-time': startDate,
          'end-date-time': endDate,
        };

        console.log(`Processing event ${i + 1}/${dataRows.length}: ${title}`);
        console.log('Field data:', JSON.stringify(fieldData, null, 2));

        // Create item in Webflow
        const webflowResponse = await fetch(
          `https://api.webflow.com/v2/collections/${COLLECTION_ID}/items`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${WEBFLOW_TOKEN}`,
              'Content-Type': 'application/json',
              'accept': 'application/json',
            },
            body: JSON.stringify({
              fieldData,
              isDraft: false,
            }),
          }
        );

        const responseData = await webflowResponse.json();

        if (!webflowResponse.ok) {
          console.error(`Failed to create item for event ${event_id}:`, responseData);
          errors.push({
            event_id,
            title,
            error: responseData.message || 'Validation Error',
          });
        } else {
          console.log(`✓ Created: ${title}`);
          created++;
        }

        // Rate limiting: 60 requests per minute = 1 per second
        await delay(1100);

      } catch (error) {
        console.error(`Error processing row ${i}:`, error);
        errors.push({
          event_id,
          title,
          error: error.message,
        });
      }
    }

    res.status(200).json({
      success: true,
      created,
      updated,
      skipped,
      total: dataRows.length,
      errors,
    });

  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}