const { getConfig, missingConfig } = require('./config');
const { getGoogleAccessToken } = require('./google');

const SHEET_TAB = 'Untitled';

// Hardcoded from the Site API response — update if locales ever change in Webflow
const PRIMARY_LOCALE_ID = '6a79abe1cc11378161cdf05a';
const TC_LOCALE_ID = '6aa0f152be9ed0179e7e9a64';
const SC_LOCALE_ID = '6aa0f152be9ed0179e7e9a65';
const SECONDARY_LOCALE_IDS = [TC_LOCALE_ID, SC_LOCALE_ID];
const ALL_LOCALE_IDS = [PRIMARY_LOCALE_ID, ...SECONDARY_LOCALE_IDS];

// Fields that are language-dependent — only sheet-driven on primary,
// only seeded (not overwritten) on TC/SC since editors translate manually after.
const PRIMARY_ONLY_FIELDS = ['name', 'summary', 'slug'];

// Fields that should always match the sheet, regardless of locale.
const SYNC_ALWAYS_FIELDS = [
  'start-date-time-2',
  'end-date-time-2',
  'event-id',
  'eventbrite-url',
  'image-url',
];

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

function webflowEventId(fieldData) {
  const direct = fieldData?.['event-id'];
  if (direct !== undefined && direct !== null) return String(direct);
  return eventIdFromSlug(fieldData?.slug);
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

function buildFieldData(row, colMap, { includeSlug = true, includeImages = true } = {}) {
  const eventId = cell(row, colMap, 'event_id');
  const title = cell(row, colMap, 'title');
  const start = toIsoDateTime(cell(row, colMap, 'start_datetime'));
  const end = toIsoDateTime(cell(row, colMap, 'end_datetime'));
  const summary = cell(row, colMap, 'summary');
  const imageUrl = cell(row, colMap, 'image_url');
  const eventbriteUrl = cell(row, colMap, 'eventbrite_url');

const fieldData = {
  name: title,
  'start-date-time-2': start,
  'end-date-time-2': end,
  'event-id': eventId ? Number(eventId) : null,
};

  if (includeSlug) {
    fieldData.slug = createSlug(title, eventId);
  }
  if (summary) {
    fieldData.summary = singleLine(summary);
  }
  if (eventbriteUrl) {
    fieldData['eventbrite-url'] = eventbriteUrl;
  }
  if (includeImages && imageUrl) {
    fieldData['image-url'] = { url: imageUrl };
  }

  return { eventId, title, fieldData };
}

// Returns a copy of fieldData containing only the always-synced fields
function syncAlwaysSubset(fieldData) {
  const subset = {};
  for (const key of SYNC_ALWAYS_FIELDS) {
    if (fieldData[key] !== undefined) subset[key] = fieldData[key];
  }
  return subset;
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

// Lists items across ALL locales in one paginated sweep
async function listCollectionItemsAllLocales(token, collectionId) {
  const items = [];
  let offset = 0;
  const localeParam = ALL_LOCALE_IDS.join(',');
  while (true) {
    const { ok, status, data } = await webflowRequest(
      token,
      `https://api.webflow.com/v2/collections/${collectionId}/items?limit=100&offset=${offset}&cmsLocaleId=${localeParam}`
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
    'start-date-time-2': toIsoDateTime(fieldData['start-date-time-2']) || '',
    'end-date-time-2': toIsoDateTime(fieldData['end-date-time-2']) || '',
    'event-id': Number(fieldData['event-id']) || 0,
    summary: singleLine(fieldData.summary || ''),
    'eventbrite-url': linkValue(fieldData['eventbrite-url']),
  };
}

// Builds a patch delta, but restricts to allowed field keys only
function changedFieldData(desired, existing, allowedKeys) {
  const next = comparableFields(desired);
  const current = comparableFields(existing || {});
  const delta = {};

  for (const key of Object.keys(next)) {
    if (!allowedKeys.includes(key)) continue;
    if (next[key] === current[key]) continue;
    delta[key] = desired[key] ?? '';
  }

  if (allowedKeys.includes('image-url')) {
    const hasImage = Boolean(existing?.['image-url']);
    if (!hasImage && desired['image-url']) {
      delta['image-url'] = desired['image-url'];
    }
  }

  return delta;
}

// Groups raw Webflow items (across locales) by shared item id + eventId
function indexItemsByEventId(items) {
  // eventId -> { itemId, locales: { [cmsLocaleId]: fieldData } }
  const map = new Map();

  for (const item of items) {
    const eventId = webflowEventId(item.fieldData);
    if (!eventId) continue;

    if (!map.has(eventId)) {
      map.set(eventId, { itemId: item.id, locales: {} });
    }
    const entry = map.get(eventId);
    entry.locales[item.cmsLocaleId] = item.fieldData;
  }

  return map;
}

async function insertItems(token, collectionId, items) {
  return webflowRequest(
    token,
    `https://api.webflow.com/v2/collections/${collectionId}/items/insert`,
    {
      method: 'POST',
      body: JSON.stringify({ items }),
    }
  );
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
            body: JSON.stringify({
              cmsLocaleId: item.cmsLocaleId,
              fieldData: item.fieldData,
            }),
          }
        );
        if (single.ok) {
          updated += 1;
        } else {
          errors.push({
            id: item.id,
            cmsLocaleId: item.cmsLocaleId,
            error: single.data?.message || `HTTP ${single.status}`,
            details: single.data?.details || single.data?.problems || undefined,
          });
        }
        await delay(1100);
      }
    }

    await delay(1100);
  }

  return { updated, errors };
}

// publishTargets: array of { id, cmsLocaleIds: [...] }
async function publishItems(token, collectionId, publishTargets) {
  const errors = [];
  let published = 0;

  for (let i = 0; i < publishTargets.length; i += 100) {
    const batch = publishTargets.slice(i, i + 100);
    const { ok, status, data } = await webflowRequest(
      token,
      `https://api.webflow.com/v2/collections/${collectionId}/items/publish`,
      {
        method: 'POST',
        body: JSON.stringify({ items: batch }),
      }
    );
    if (ok) {
      published += batch.reduce((sum, t) => sum + (t.cmsLocaleIds?.length || 1), 0);
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

  const rawItems = await listCollectionItemsAllLocales(
    config.webflowToken,
    config.webflowCollectionId
  );
  const existing = indexItemsByEventId(rawItems);

  const toInsertNew = [];       // brand new events — allCmsLocales: true
  const toBackfill = [];        // existing primary item missing TC/SC — insert with id + cmsLocaleIds
  const toPatch = [];           // flat list of { id, cmsLocaleId, fieldData }
  const publishTargets = new Map(); // itemId -> Set of cmsLocaleIds

  let skipped = 0;
  let unchanged = 0;

  function markForPublish(itemId, localeId) {
    if (!publishTargets.has(itemId)) publishTargets.set(itemId, new Set());
    publishTargets.get(itemId).add(localeId);
  }

  for (const row of dataRows) {
    const status = cell(row, colMap, 'status');
    const listed = cell(row, colMap, 'listed');
    if (status !== 'live' || listed !== 'TRUE') {
      skipped += 1;
      continue;
    }

    const eventId = cell(row, colMap, 'event_id');
    const entry = existing.get(eventId);
    const { title, fieldData } = buildFieldData(row, colMap, {
      includeSlug: !entry,
    });

    if (!eventId || !title) {
      skipped += 1;
      continue;
    }

    if (!entry) {
      // Brand new event — create in all 3 locales with identical starting content
      toInsertNew.push({ allCmsLocales: true, fieldData });
      continue;
    }

    // Event already exists in at least one locale (should be primary at minimum)
    const { itemId, locales } = entry;
    const missingLocales = ALL_LOCALE_IDS.filter((id) => !locales[id]);

    if (missingLocales.length) {
      // Backfill missing locale variants with full content (translation starting point)
      toBackfill.push({ id: itemId, cmsLocaleIds: missingLocales, fieldData });
      missingLocales.forEach((id) => markForPublish(itemId, id));
    }

    // Primary locale: full sync including text fields
    if (locales[PRIMARY_LOCALE_ID]) {
      const delta = changedFieldData(
        fieldData,
        locales[PRIMARY_LOCALE_ID],
        [...PRIMARY_ONLY_FIELDS, ...SYNC_ALWAYS_FIELDS]
      );
      if (Object.keys(delta).length) {
        toPatch.push({ id: itemId, cmsLocaleId: PRIMARY_LOCALE_ID, fieldData: delta });
        markForPublish(itemId, PRIMARY_LOCALE_ID);
      } else {
        unchanged += 1;
      }
    }

    // Secondary locales: only sync non-text fields, never touch manually-translated text
    for (const localeId of SECONDARY_LOCALE_IDS) {
      if (!locales[localeId]) continue; // handled by backfill above
      const delta = changedFieldData(
        syncAlwaysSubset(fieldData),
        locales[localeId],
        SYNC_ALWAYS_FIELDS
      );
      if (Object.keys(delta).length) {
        toPatch.push({ id: itemId, cmsLocaleId: localeId, fieldData: delta });
        markForPublish(itemId, localeId);
      }
    }
  }

  const errors = [];
  let created = 0;
  let backfilled = 0;

  // 1. Brand new events in all locales
  for (const entry of toInsertNew) {
    const result = await insertItems(config.webflowToken, config.webflowCollectionId, [entry]);
    if (result.ok) {
      created += 1;
      const createdItems = result.data?.items || [];
      createdItems.forEach((item) => markForPublish(item.id, item.cmsLocaleId));
    } else {
      errors.push({
        title: entry.fieldData?.name,
        error: result.data?.message || `HTTP ${result.status}`,
      });
    }
    await delay(1100);
  }

  // 2. Backfill missing locale variants on existing items
  for (const entry of toBackfill) {
    const result = await insertItems(config.webflowToken, config.webflowCollectionId, [entry]);
    if (result.ok) {
      backfilled += entry.cmsLocaleIds.length;
    } else {
      errors.push({
        id: entry.id,
        cmsLocaleIds: entry.cmsLocaleIds,
        error: result.data?.message || `HTTP ${result.status}`,
      });
    }
    await delay(1100);
  }

  // 3. Patch deltas on existing locale variants
  const patchResult = await patchItems(config.webflowToken, config.webflowCollectionId, toPatch);
  errors.push(...patchResult.errors);

  // 4. Publish everything touched
  const publishPayload = Array.from(publishTargets.entries()).map(([id, localeSet]) => ({
    id,
    cmsLocaleIds: Array.from(localeSet),
  }));
  const publishResult = await publishItems(
    config.webflowToken,
    config.webflowCollectionId,
    publishPayload
  );
  errors.push(...publishResult.errors);

  return {
    success: errors.length === 0,
    created,
    backfilled,
    updated: patchResult.updated,
    published: publishResult.published,
    skipped,
    unchanged,
    total: dataRows.length,
    errors,
  };
}

module.exports = {
  runSync,
  buildFieldData,
  buildColMap,
  changedFieldData,
};