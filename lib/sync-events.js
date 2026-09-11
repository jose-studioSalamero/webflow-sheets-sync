const { getConfig, missingConfig } = require('./config');
const { getGoogleAccessToken } = require('./google');

const SHEET_TAB = 'Untitled';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cell(row, colMap, key) {
  const index = colMap[key];
  if (index < 0) return '';
  return String(row[index] ?? '').trim();
}

function toIsoDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function singleLine(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function toRichText(value) {
  const escaped = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((part) => `<p>${part.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return paragraphs || `<p>${escaped}</p>`;
}

function createSlug(title, eventId) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 200);

  return `${slug}-${eventId}`;
}

function eventIdFromSlug(slug) {
  const match = String(slug || '').match(/-(\d{10,})(?:-[a-z0-9]+)?$/i);
  return match ? match[1] : null;
}

function buildColMap(headers) {
  return {
    event_id: headers.indexOf('event_id'),
    brand: headers.indexOf('brand'),
    title: headers.indexOf('title'),
    status: headers.indexOf('status'),
    listed: headers.indexOf('listed'),
    start_datetime: headers.indexOf('start_datetime'),
    end_datetime: headers.indexOf('end_datetime'),
    timezone: headers.indexOf('timezone'),
    venue_id: headers.indexOf('venue_id'),
    venue_name: headers.indexOf('venue_name'),
    summary: headers.indexOf('summary'),
    image_url: headers.indexOf('image_url'),
    eventbrite_url: headers.indexOf('eventbrite_url'),
    is_free: headers.indexOf('is_free'),
    price_from: headers.indexOf('price_from'),
    description: headers.indexOf('description'),
  };
}

function buildFieldData(row, colMap, { includeSlug = true } = {}) {
  const eventId = cell(row, colMap, 'event_id');
  const title = cell(row, colMap, 'title');
  const start = toIsoDateTime(cell(row, colMap, 'start_datetime'));
  const end = toIsoDateTime(cell(row, colMap, 'end_datetime'));
  const location = cell(row, colMap, 'venue_name');
  const summary = cell(row, colMap, 'summary');
  const description = cell(row, colMap, 'description') || summary;
  const imageUrl = cell(row, colMap, 'image_url');
  const eventbriteUrl = cell(row, colMap, 'eventbrite_url');

  const fieldData = {
    name: title,
    'start-date-time': start,
    'end-date-time': end,
    'start-date-time-2': start,
    'end-date-time-2': end,
  };

  if (includeSlug) {
    fieldData.slug = createSlug(title, eventId);
  }

  if (location) fieldData.location = location;
  if (summary) {
    fieldData.summary = singleLine(summary);
    fieldData['short-description'] = singleLine(summary);
  }
  if (description) fieldData.description = toRichText(description);
  if (eventbriteUrl) {
    fieldData['eventbrite-url'] = eventbriteUrl;
    fieldData['rsvp-link'] = eventbriteUrl;
  }
  if (imageUrl) {
    fieldData.image = { url: imageUrl };
    fieldData['image-url'] = { url: imageUrl };
  }

  return { eventId, title, fieldData };
}

async function fetchGoogleSheetData({ googleSheetId }) {
  const accessToken = await getGoogleAccessToken([
    'https://www.googleapis.com/auth/spreadsheets.readonly',
  ]);
  const range = `${SHEET_TAB}!A:Z`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${googleSheetId}/values/${encodeURIComponent(range)}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google Sheets fetch failed: ${response.status} ${response.statusText} - ${error}`);
  }

  const data = await response.json();
  return data.values || [];
}

async function webflowRequest(token, url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(120000),
      headers: {
        Authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    return { ok: false, status: 0, data: { message: error.message } };
  }
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  return { ok: response.ok, status: response.status, data };
}

async function listCollectionItems(token, collectionId) {
  const items = [];
  let offset = 0;
  while (true) {
    const { ok, status, data } = await webflowRequest(
      token,
      `https://api.webflow.com/v2/collections/${collectionId}/items?limit=100&offset=${offset}`
    );
    if (!ok) {
      throw new Error(`Failed to list CMS items: ${status} ${data?.message || ''}`);
    }
    items.push(...(data.items || []));
    if (!data.items || data.items.length < 100) break;
    offset += 100;
  }
  return items;
}

function linkValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  return String(value.url || '').trim();
}

function comparableFields(fieldData) {
  return {
    name: fieldData.name || '',
    'start-date-time': toIsoDateTime(fieldData['start-date-time']) || '',
    'end-date-time': toIsoDateTime(fieldData['end-date-time']) || '',
    'start-date-time-2': toIsoDateTime(fieldData['start-date-time-2']) || '',
    'end-date-time-2': toIsoDateTime(fieldData['end-date-time-2']) || '',
    location: fieldData.location || '',
    summary: fieldData.summary || '',
    'short-description': fieldData['short-description'] || '',
    description: fieldData.description || '',
    'eventbrite-url': linkValue(fieldData['eventbrite-url']),
    'rsvp-link': linkValue(fieldData['rsvp-link']),
  };
}

function fieldsChanged(desired, existing) {
  const next = comparableFields(desired);
  const current = comparableFields(existing || {});
  return JSON.stringify(next) !== JSON.stringify(current);
}

function indexItemsByEventId(items) {
  const map = new Map();
  for (const item of items) {
    const eventId = eventIdFromSlug(item.fieldData?.slug);
    if (eventId && !map.has(eventId)) map.set(eventId, item);
  }
  return map;
}

async function patchItems(token, collectionId, items) {
  const errors = [];
  let updated = 0;

  for (let i = 0; i < items.length; i += 10) {
    const batch = items.slice(i, i + 10);
    console.log(`Updating CMS items ${i + 1}-${Math.min(i + 10, items.length)} of ${items.length}`);
    const { ok } = await webflowRequest(
      token,
      `https://api.webflow.com/v2/collections/${collectionId}/items`,
      {
        method: 'PATCH',
        body: JSON.stringify({ items: batch }),
      }
    );

    if (ok) {
      updated += batch.length;
    } else {
      for (const item of batch) {
        const single = await webflowRequest(
          token,
          `https://api.webflow.com/v2/collections/${collectionId}/items/${item.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ fieldData: item.fieldData }),
          }
        );
        if (single.ok) {
          updated += 1;
        } else {
          errors.push({
            id: item.id,
            error: single.data?.message || `HTTP ${single.status}`,
          });
        }
        await delay(1100);
      }
    }

    await delay(1100);
  }

  return { updated, errors };
}

async function publishItems(token, collectionId, itemIds) {
  const errors = [];
  let published = 0;

  for (let i = 0; i < itemIds.length; i += 100) {
    const batch = itemIds.slice(i, i + 100);
    const { ok, status, data } = await webflowRequest(
      token,
      `https://api.webflow.com/v2/collections/${collectionId}/items/publish`,
      {
        method: 'POST',
        body: JSON.stringify({ itemIds: batch }),
      }
    );
    if (ok) {
      published += (data?.publishedItemIds || batch).length;
    } else {
      errors.push({
        publish: true,
        error: data?.message || `HTTP ${status}`,
      });
    }
    await delay(1100);
  }

  return { published, errors };
}

async function createItem(token, collectionId, fieldData) {
  return webflowRequest(
    token,
    `https://api.webflow.com/v2/collections/${collectionId}/items`,
    {
      method: 'POST',
      body: JSON.stringify({ fieldData, isDraft: false }),
    }
  );
}

async function runSync() {
  const missing = missingConfig([
    'webflowToken',
    'webflowCollectionId',
    'googleSheetId',
    'googleServiceAccountEmail',
    'googlePrivateKey',
  ]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }

  const config = getConfig();
  const rows = await fetchGoogleSheetData(config);
  if (rows.length < 2) {
    throw new Error('Sheet has no data');
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const colMap = buildColMap(headers);
  const existing = indexItemsByEventId(
    await listCollectionItems(config.webflowToken, config.webflowCollectionId)
  );

  const toUpdate = [];
  const toCreate = [];
  let skipped = 0;
  let unchanged = 0;

  for (const row of dataRows) {
    const status = cell(row, colMap, 'status');
    const listed = cell(row, colMap, 'listed');
    if (status !== 'live' || listed !== 'TRUE') {
      skipped += 1;
      continue;
    }

    const existingItem = existing.get(cell(row, colMap, 'event_id'));
    const { eventId, title, fieldData } = buildFieldData(row, colMap, {
      includeSlug: !existingItem,
    });

    if (!eventId || !title) {
      skipped += 1;
      continue;
    }

    if (existingItem) {
      if (fieldsChanged(fieldData, existingItem.fieldData)) {
        toUpdate.push({ id: existingItem.id, fieldData });
      } else {
        unchanged += 1;
      }
    } else {
      toCreate.push({ eventId, title, fieldData });
    }
  }

  if (toUpdate.length === 0 && toCreate.length === 0) {
    return {
      success: true,
      created: 0,
      updated: 0,
      published: 0,
      skipped,
      unchanged,
      total: dataRows.length,
      errors: [],
    };
  }

  const updateResult = await patchItems(
    config.webflowToken,
    config.webflowCollectionId,
    toUpdate
  );

  let created = 0;
  const errors = [...updateResult.errors];
  const createdIds = [];

  for (const item of toCreate) {
    const result = await createItem(
      config.webflowToken,
      config.webflowCollectionId,
      item.fieldData
    );
    if (result.ok) {
      created += 1;
      if (result.data?.id) createdIds.push(result.data.id);
    } else {
      errors.push({
        event_id: item.eventId,
        title: item.title,
        error: result.data?.message || `HTTP ${result.status}`,
      });
    }
    await delay(1100);
  }

  const publishIds = [...toUpdate.map((item) => item.id), ...createdIds];
  const publishResult = await publishItems(
    config.webflowToken,
    config.webflowCollectionId,
    publishIds
  );

  return {
    success: errors.length === 0 && publishResult.errors.length === 0,
    created,
    updated: updateResult.updated,
    published: publishResult.published,
    skipped,
    unchanged,
    total: dataRows.length,
    errors: [...errors, ...publishResult.errors],
  };
}

module.exports = {
  runSync,
  buildFieldData,
  buildColMap,
};
