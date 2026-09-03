const { GoogleAuth } = require('google-auth-library');

const WEBFLOW_API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const WEBFLOW_COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

function parseDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  
  try {
    // Parse date in format like "9/6/2024"
    const [month, day, year] = dateStr.split('/').map(Number);
    
    // Parse time if provided, otherwise use midnight
    let hours = 0, minutes = 0;
    if (timeStr) {
      const timeMatch = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
      if (timeMatch) {
        hours = parseInt(timeMatch[1]);
        minutes = parseInt(timeMatch[2]);
        const period = timeMatch[3];
        
        if (period && period.toUpperCase() === 'PM' && hours !== 12) {
          hours += 12;
        } else if (period && period.toUpperCase() === 'AM' && hours === 12) {
          hours = 0;
        }
      }
    }
    
    // Create date in Hong Kong timezone (UTC+8)
    const date = new Date(year, month - 1, day, hours, minutes);
    return date.toISOString();
  } catch (error) {
    console.error('Date parse error:', error, dateStr, timeStr);
    return null;
  }
}

function createSlug(title, eventId) {
  if (!title) return `event-${eventId}`;
  
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-')      // Replace spaces with hyphens
    .replace(/-+/g, '-')       // Replace multiple hyphens with single
    .substring(0, 100)         // Limit length
    + `-${eventId}`;           // Add unique ID
}

async function getGoogleSheetsData() {
  const auth = new GoogleAuth({
    credentials: {
      client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: GOOGLE_PRIVATE_KEY,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/Events!A:I`,
    {
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Google Sheets fetch failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.values || [];
}

async function createOrUpdateWebflowItem(event) {
  const eventId = event['Event ID']?.toString();
  const title = event['Event Title'];
  
  if (!title || !eventId) {
    return { success: false, error: 'Missing required fields: title or event ID' };
  }

  const slug = createSlug(title, eventId);
  const startDateTime = parseDateTime(event['Start Date'], event['Start Time']);
  const endDateTime = parseDateTime(event['End Date'], event['End Time']);

  const itemData = {
    fieldData: {
      "name": title,
      "slug": slug,
      "start-date-time": startDateTime,
      "end-date-time": endDateTime,
      "location": event['Location'] || null,
      "short-description": event['Short Description'] || null,
      "description": event['Description'] || null,
      "rsvp-link": event['RSVP Link'] || null,
    }
  };

  // Remove null values
  Object.keys(itemData.fieldData).forEach(key => {
    if (itemData.fieldData[key] === null || itemData.fieldData[key] === '') {
      delete itemData.fieldData[key];
    }
  });

  try {
    // Try to create new item
    const response = await fetch(
      `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}/items`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
          "Content-Type": "application/json",
          "accept-version": "1.0.0"
        },
        body: JSON.stringify(itemData)
      }
    );

    const responseData = await response.json();

    if (response.ok) {
      return { success: true, action: 'created', data: responseData };
    } else {
      return { 
        success: false, 
        error: responseData.message || JSON.stringify(responseData) 
      };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Fetch data from Google Sheets
    const rows = await getGoogleSheetsData();
    
    if (rows.length === 0) {
      return res.status(200).json({ 
        success: true, 
        message: 'No data in sheet',
        total: 0 
      });
    }

    // Parse headers and data
    const headers = rows[0];
    const dataRows = rows.slice(1);

    const events = dataRows.map(row => {
      const event = {};
      headers.forEach((header, index) => {
        event[header] = row[index] || '';
      });
      return event;
    });

    // Process events with rate limiting
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (const event of events) {
      const result = await createOrUpdateWebflowItem(event);
      
      if (result.success) {
        if (result.action === 'created') created++;
        else if (result.action === 'updated') updated++;
      } else {
        errors.push({
          event_id: event['Event ID'],
          title: event['Event Title'],
          error: result.error
        });
        skipped++;
      }

      // Rate limiting: 2 requests per second max
      await sleep(600);
    }

    res.status(200).json({
      success: true,
      created,
      updated,
      skipped,
      total: events.length,
      errors: errors.slice(0, 10) // Only return first 10 errors
    });

  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
}