const { getConfig, missingConfig } = require('./config');
const { getGoogleAccessToken } = require('./google');
const {
  cmsLocalesFromSite,
  missingCmsLocaleIds,
  replacedSlug,
  isReplacedSlug,
  eventIdFromSlug,
  eventIdFromItem,
  publishPayload,
  fieldDataFromExisting,
} = require('./locales');

const SHEET_TAB = 'Untitled';
const WRITE_BATCH_SIZE = 50;
const PATCH_BATCH_SIZE = 10;

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
  const eventIdNumber = Number(eventId);

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

  if (Number.isFinite(eventIdNumber)) fieldData['event-id'] = eventIdNumber;
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

function cmsWriteFieldData(fieldData, { includeSlug = true } = {}) {
  const keys = [
    ...(includeSlug ? ['slug'] : []),
    'name',
    'start-date-time-2',
    'end-date-time-2',
    'summary',
    'image-url',
    'eventbrite-url',
    'event-id',
  ];
  const next = {};
  for (const key of keys) {
    const value = fieldData[key];
    if (value == null || value === '') continue;
    next[key] = value;
  }
  return next;
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

async function resolveSiteId(token, siteId) {
  if (siteId) return siteId;
  const { ok, status, data } = await webflowRequest(
    token,
    'https://api.webflow.com/v2/sites'
  );
  if (!ok) {
    throw new Error(`Failed to list sites: ${status} ${data?.message || ''}`.trim());
  }
  const sites = data.sites || [];
  if (sites.length === 1) return sites[0].id;
  throw new Error('WEBFLOW_SITE_ID is required when the token can access multiple sites');
}

async function fetchCmsLocales(token, siteId) {
  const resolvedSiteId = await resolveSiteId(token, siteId);
  const { ok, status, data } = await webflowRequest(
    token,
    `https://api.webflow.com/v2/sites/${resolvedSiteId}`
  );
  if (!ok) {
    throw new Error(`Failed to fetch site locales: ${status} ${data?.message || ''}`.trim());
  }
  return cmsLocalesFromSite(data);
}

async function listCollectionItems(token, collectionId, cmsLocaleId) {
  const items = [];
  let offset = 0;
  const localeQuery = cmsLocaleId ? `&cmsLocaleId=${encodeURIComponent(cmsLocaleId)}` : '';
  while (true) {
    const { ok, status, data } = await webflowRequest(
      token,
      `https://api.webflow.com/v2/collections/${collectionId}/items?limit=100&offset=${offset}${localeQuery}`
    );
    if (!ok) {
      throw new Error(`Failed to list CMS items: ${status} ${data?.message || ''}`.trim());
    }
    items.push(...(data.items || []));
    if (!data.items || data.items.length < 100) break;
    offset += 100;
  }
  return items;
}

async function listItemsByEventId(token, collectionId, locales) {
  const byEventId = new Map();
  const localeIds = locales.length ? locales.map((locale) => locale.cmsLocaleId) : [undefined];

  for (const cmsLocaleId of localeIds) {
    const items = await listCollectionItems(token, collectionId, cmsLocaleId);
    for (const item of items) {
      if (isReplacedSlug(item.fieldData?.slug)) continue;
      const eventId = eventIdFromItem(item);
      if (!eventId) continue;
      if (!byEventId.has(eventId)) byEventId.set(eventId, new Map());
      const localeKey = item.cmsLocaleId || cmsLocaleId || 'primary';
      if (!byEventId.get(eventId).has(localeKey)) {
        byEventId.get(eventId).set(localeKey, item);
      }
    }
  }

  return byEventId;
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
    summary: fieldData.summary || '',
    'eventbrite-url': linkValue(fieldData['eventbrite-url']),
    'event-id': fieldData['event-id'] == null || fieldData['event-id'] === ''
      ? ''
      : String(fieldData['event-id']),
  };
}

function fieldsChanged(desired, existing) {
  const next = comparableFields(desired);
  const current = comparableFields(existing || {});
  return JSON.stringify(next) !== JSON.stringify(current);
}

function uniqueIds(items) {
  return [...new Set((items || []).map((item) => item?.id).filter(Boolean))];
}

async function patchItems(token, collectionId, items) {
  const errors = [];
  let updated = 0;

  for (let i = 0; i < items.length; i += PATCH_BATCH_SIZE) {
    const batch = items.slice(i, i + PATCH_BATCH_SIZE);
    console.log(`Updating CMS items ${i + 1}-${Math.min(i + PATCH_BATCH_SIZE, items.length)} of ${items.length}`);
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
        const localeQuery = item.cmsLocaleId
          ? `?cmsLocaleId=${encodeURIComponent(item.cmsLocaleId)}`
          : '';
        const single = await webflowRequest(
          token,
          `https://api.webflow.com/v2/collections/${collectionId}/items/${item.id}${localeQuery}`,
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
            cmsLocaleId: item.cmsLocaleId,
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

async function publishItems(token, collectionId, itemIds, cmsLocaleIds = []) {
  const errors = [];
  let published = 0;
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (!ids.length) return { published, errors };

  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const body = publishPayload(batch, cmsLocaleIds);
    const { ok, status, data } = await webflowRequest(
      token,
      `https://api.webflow.com/v2/collections/${collectionId}/items/publish`,
      {
        method: 'POST',
        body: JSON.stringify(body),
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

async function deleteItemBatch(token, collectionId, itemIds, cmsLocaleIds, live) {
  const errors = [];
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (!ids.length) return { deleted: 0, errors };

  const path = live
    ? `https://api.webflow.com/v2/collections/${collectionId}/items/live`
    : `https://api.webflow.com/v2/collections/${collectionId}/items`;

  for (let i = 0; i < ids.length; i += WRITE_BATCH_SIZE) {
    const batch = ids.slice(i, i + WRITE_BATCH_SIZE);
    const items = batch.map((id) => (
      cmsLocaleIds.length ? { id, cmsLocaleIds } : { id }
    ));
    const { ok, status, data } = await webflowRequest(
      token,
      path,
      {
        method: 'DELETE',
        body: JSON.stringify({ items }),
      }
    );

    if (ok || status === 204) {
      await delay(1100);
      continue;
    }

    for (const id of batch) {
      const singleItems = cmsLocaleIds.length
        ? [{ id, cmsLocaleIds }]
        : [{ id }];
      const single = await webflowRequest(
        token,
        path,
        {
          method: 'DELETE',
          body: JSON.stringify({ items: singleItems }),
        }
      );
      if (!single.ok && single.status !== 204 && single.status !== 404) {
        errors.push({
          id,
          live,
          error: single.data?.message || `HTTP ${single.status}`,
        });
      }
      await delay(1100);
    }
  }

  return { deleted: ids.length, errors };
}

async function deleteItems(token, collectionId, itemIds, cmsLocaleIds = []) {
  const staged = await deleteItemBatch(token, collectionId, itemIds, cmsLocaleIds, false);
  const live = await deleteItemBatch(token, collectionId, itemIds, cmsLocaleIds, true);
  return {
    deleted: staged.deleted,
    errors: [...staged.errors, ...live.errors],
  };
}

async function createItems(token, collectionId, fieldDataList, cmsLocaleIds = []) {
  const createdIds = [];
  const errors = [];
  if (!fieldDataList.length) return { createdIds, errors };

  for (let i = 0; i < fieldDataList.length; i += WRITE_BATCH_SIZE) {
    const batch = fieldDataList.slice(i, i + WRITE_BATCH_SIZE);
    console.log(`Creating CMS items ${i + 1}-${Math.min(i + WRITE_BATCH_SIZE, fieldDataList.length)} of ${fieldDataList.length}`);
    const body = {
      isDraft: false,
      fieldData: batch.length === 1 ? batch[0] : batch,
    };
    if (cmsLocaleIds.length) body.cmsLocaleIds = cmsLocaleIds;

    const { ok, status, data } = await webflowRequest(
      token,
      `https://api.webflow.com/v2/collections/${collectionId}/items/bulk`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    );

    if (ok) {
      createdIds.push(...uniqueIds(data.items || (data.id ? [data] : [])));
    } else {
      for (const fieldData of batch) {
        const singleBody = {
          isDraft: false,
          fieldData,
        };
        if (cmsLocaleIds.length) singleBody.cmsLocaleIds = cmsLocaleIds;
        const single = await webflowRequest(
          token,
          `https://api.webflow.com/v2/collections/${collectionId}/items/bulk`,
          {
            method: 'POST',
            body: JSON.stringify(singleBody),
          }
        );
        if (single.ok) {
          createdIds.push(...uniqueIds(single.data?.items || (single.data?.id ? [single.data] : [])));
        } else {
          errors.push({
            slug: fieldData.slug,
            name: fieldData.name,
            error: single.data?.message || `HTTP ${single.status}`,
          });
        }
        await delay(1100);
      }
    }

    await delay(1100);
  }

  return { createdIds, errors };
}

async function recreateForLocales(token, collectionId, records, cmsLocaleIds) {
  const errors = [];
  const createdIds = [];
  if (!records.length) return { createdIds, errors };

  for (let i = 0; i < records.length; i += WRITE_BATCH_SIZE) {
    const batch = records.slice(i, i + WRITE_BATCH_SIZE);
    console.log(`Recreating ${batch.length} CMS items across ${cmsLocaleIds.length} locales`);

    const renames = batch.map((item) => ({
      id: item.id,
      fieldData: {
        name: item.fieldData.name,
        slug: replacedSlug(item.id),
      },
    }));
    const renameResult = await patchItems(token, collectionId, renames);
    errors.push(...renameResult.errors);

    const slugPublish = await publishItems(
      token,
      collectionId,
      batch.map((item) => item.id)
    );
    errors.push(...slugPublish.errors);

    const createResult = await createItems(
      token,
      collectionId,
      batch.map((item) => item.fieldData),
      cmsLocaleIds
    );
    errors.push(...createResult.errors);
    createdIds.push(...createResult.createdIds);

    const publishResult = await publishItems(
      token,
      collectionId,
      createResult.createdIds,
      cmsLocaleIds
    );
    errors.push(...publishResult.errors);

    const deleteResult = await deleteItems(
      token,
      collectionId,
      batch.map((item) => item.id)
    );
    errors.push(...deleteResult.errors);
  }

  return { createdIds, errors };
}

function existingItemForEvent(existingByLocale, cmsLocaleIds) {
  if (!existingByLocale?.size) return null;
  for (const cmsLocaleId of cmsLocaleIds) {
    if (existingByLocale.has(cmsLocaleId)) return existingByLocale.get(cmsLocaleId);
  }
  return existingByLocale.values().next().value || null;
}

async function syncCollection({ token, siteId, collectionId, planned }) {
  const locales = await fetchCmsLocales(token, siteId);
  const cmsLocaleIds = locales.map((locale) => locale.cmsLocaleId);
  const existingByEventId = await listItemsByEventId(token, collectionId, locales);

  const toUpdate = [];
  const toCreate = [];
  const toRecreate = [];
  let skipped = planned.skipped || 0;
  let unchanged = 0;

  for (const item of planned.items) {
    const existingByLocale = existingByEventId.get(item.eventId);
    const existingItem = existingItemForEvent(existingByLocale, cmsLocaleIds);
    const missingLocales = missingCmsLocaleIds(existingByLocale, cmsLocaleIds);

    if (!existingItem) {
      toCreate.push(cmsWriteFieldData(item.fieldData));
      continue;
    }

    if (missingLocales.length) {
      toRecreate.push({
        id: existingItem.id,
        fieldData: cmsWriteFieldData(item.fieldData),
      });
      continue;
    }

    let eventChanged = false;
    const updateFieldData = cmsWriteFieldData(item.fieldData, { includeSlug: false });
    const localeIds = cmsLocaleIds.length ? cmsLocaleIds : [undefined];
    for (const cmsLocaleId of localeIds) {
      const localeItem = cmsLocaleId
        ? existingByLocale.get(cmsLocaleId)
        : existingItem;
      if (!localeItem) continue;
      if (fieldsChanged(updateFieldData, localeItem.fieldData)) {
        eventChanged = true;
        toUpdate.push({
          id: localeItem.id,
          ...(cmsLocaleId ? { cmsLocaleId } : {}),
          fieldData: updateFieldData,
        });
      }
    }
    if (!eventChanged) unchanged += 1;
  }

  if (toUpdate.length === 0 && toCreate.length === 0 && toRecreate.length === 0) {
    return {
      success: true,
      created: 0,
      recreated: 0,
      updated: 0,
      published: 0,
      skipped,
      unchanged,
      total: planned.total,
      locales,
      errors: [],
    };
  }

  const recreateResult = await recreateForLocales(
    token,
    collectionId,
    toRecreate,
    cmsLocaleIds
  );

  const createResult = await createItems(
    token,
    collectionId,
    toCreate,
    cmsLocaleIds
  );

  const updateResult = await patchItems(token, collectionId, toUpdate);

  const publishIds = [
    ...toUpdate.map((item) => item.id),
    ...createResult.createdIds,
  ];
  const publishResult = await publishItems(
    token,
    collectionId,
    publishIds,
    cmsLocaleIds
  );

  const errors = [
    ...recreateResult.errors,
    ...createResult.errors,
    ...updateResult.errors,
    ...publishResult.errors,
  ];

  return {
    success: errors.length === 0,
    created: createResult.createdIds.length,
    recreated: recreateResult.createdIds.length,
    updated: updateResult.updated,
    published: publishResult.published + (recreateResult.createdIds.length ? recreateResult.createdIds.length : 0),
    skipped,
    unchanged,
    total: planned.total,
    locales,
    errors,
  };
}

function planFromSheetRows(rows) {
  if (rows.length < 2) {
    throw new Error('Sheet has no data');
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const colMap = buildColMap(headers);
  const items = [];
  let skipped = 0;

  for (const row of dataRows) {
    const status = cell(row, colMap, 'status');
    const listed = cell(row, colMap, 'listed');
    if (status !== 'live' || listed !== 'TRUE') {
      skipped += 1;
      continue;
    }

    const { eventId, title, fieldData } = buildFieldData(row, colMap, {
      includeSlug: true,
    });

    if (!eventId || !title) {
      skipped += 1;
      continue;
    }

    items.push({ eventId, title, fieldData });
  }

  return { items, skipped, total: dataRows.length };
}

function planFromExistingItems(existingByEventId, cmsLocaleIds) {
  const items = [];
  for (const [eventId, existingByLocale] of existingByEventId.entries()) {
    const existingItem = existingItemForEvent(existingByLocale, cmsLocaleIds);
    if (!existingItem) continue;
    const fieldData = fieldDataFromExisting(existingItem);
    if (!fieldData.name || !fieldData.slug) continue;
    items.push({ eventId, title: fieldData.name, fieldData });
  }
  return { items, skipped: 0, total: items.length };
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
  return syncCollection({
    token: config.webflowToken,
    siteId: config.webflowSiteId,
    collectionId: config.webflowCollectionId,
    planned: planFromSheetRows(rows),
  });
}

async function runLocaleBackfill() {
  const missing = missingConfig([
    'webflowToken',
    'webflowCollectionId',
  ]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }

  const config = getConfig();
  const locales = await fetchCmsLocales(config.webflowToken, config.webflowSiteId);
  const cmsLocaleIds = locales.map((locale) => locale.cmsLocaleId);
  const existingByEventId = await listItemsByEventId(
    config.webflowToken,
    config.webflowCollectionId,
    locales
  );

  return syncCollection({
    token: config.webflowToken,
    siteId: config.webflowSiteId,
    collectionId: config.webflowCollectionId,
    planned: planFromExistingItems(existingByEventId, cmsLocaleIds),
  });
}

module.exports = {
  runSync,
  runLocaleBackfill,
  buildFieldData,
  buildColMap,
  cmsWriteFieldData,
  fieldsChanged,
  eventIdFromSlug,
};
