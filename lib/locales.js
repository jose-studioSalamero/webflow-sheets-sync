function cmsLocalesFromSite(site) {
  const locales = [];
  const primary = site?.locales?.primary;
  if (primary?.cmsLocaleId) {
    locales.push({
      cmsLocaleId: primary.cmsLocaleId,
      subdirectory: primary.subdirectory || '',
      tag: primary.tag || '',
      primary: true,
    });
  }

  for (const locale of site?.locales?.secondary || []) {
    if (!locale?.cmsLocaleId) continue;
    locales.push({
      cmsLocaleId: locale.cmsLocaleId,
      subdirectory: locale.subdirectory || '',
      tag: locale.tag || '',
      primary: false,
    });
  }

  return locales;
}

function missingCmsLocaleIds(existingByLocale, cmsLocaleIds) {
  const have = existingByLocale instanceof Map ? existingByLocale : new Map();
  return cmsLocaleIds.filter((id) => id && !have.has(id));
}

function replacedSlug(itemId) {
  return `replaced-${itemId}`;
}

function isReplacedSlug(slug) {
  return String(slug || '').startsWith('replaced-');
}

function eventIdFromSlug(slug) {
  const match = String(slug || '').match(/-(\d{10,})(?:-[a-z0-9]+)?$/i);
  return match ? match[1] : null;
}

function eventIdFromItem(item) {
  const fieldId = item?.fieldData?.['event-id'];
  if (fieldId != null && String(fieldId).trim() !== '') {
    return String(fieldId);
  }
  return eventIdFromSlug(item?.fieldData?.slug);
}

function publishPayload(itemIds, cmsLocaleIds) {
  if (!itemIds.length) return null;
  if (cmsLocaleIds?.length) {
    return {
      items: itemIds.map((id) => ({ id, cmsLocaleIds })),
    };
  }
  return { itemIds };
}

function fieldDataFromExisting(item) {
  const fd = item?.fieldData || {};
  const fieldData = {};
  if (fd.name) fieldData.name = fd.name;
  if (fd.slug && !isReplacedSlug(fd.slug)) fieldData.slug = fd.slug;
  if (fd['start-date-time-2']) fieldData['start-date-time-2'] = fd['start-date-time-2'];
  if (fd['end-date-time-2']) fieldData['end-date-time-2'] = fd['end-date-time-2'];
  if (fd.summary) fieldData.summary = fd.summary;
  if (fd['eventbrite-url']) fieldData['eventbrite-url'] = fd['eventbrite-url'];
  if (fd['event-id'] != null && fd['event-id'] !== '') {
    fieldData['event-id'] = fd['event-id'];
  }
  const imageUrl = fd['image-url']?.url || (typeof fd['image-url'] === 'string' ? fd['image-url'] : '');
  if (imageUrl) fieldData['image-url'] = { url: imageUrl };
  return fieldData;
}

module.exports = {
  cmsLocalesFromSite,
  missingCmsLocaleIds,
  replacedSlug,
  isReplacedSlug,
  eventIdFromSlug,
  eventIdFromItem,
  publishPayload,
  fieldDataFromExisting,
};
