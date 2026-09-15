const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
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

describe('cmsLocalesFromSite', () => {
  it('returns primary and every secondary locale so new locales are picked up automatically', () => {
    const locales = cmsLocalesFromSite({
      locales: {
        primary: {
          cmsLocaleId: 'primary-cms',
          subdirectory: '',
          tag: 'en',
        },
        secondary: [
          {
            cmsLocaleId: 'zh-hk-cms',
            subdirectory: 'zh-hk',
            tag: 'zh-HK',
            enabled: true,
          },
          {
            cmsLocaleId: 'zh-cn-cms',
            subdirectory: 'zh-cn',
            tag: 'zh-CN',
            enabled: true,
          },
        ],
      },
    });

    assert.deepEqual(
      locales.map((locale) => [locale.tag, locale.subdirectory, locale.primary, locale.cmsLocaleId]),
      [
        ['en', '', true, 'primary-cms'],
        ['zh-HK', 'zh-hk', false, 'zh-hk-cms'],
        ['zh-CN', 'zh-cn', false, 'zh-cn-cms'],
      ]
    );
  });

  it('includes secondary locales even when they are not enabled yet', () => {
    const locales = cmsLocalesFromSite({
      locales: {
        primary: { cmsLocaleId: 'p' },
        secondary: [{ cmsLocaleId: 'next', subdirectory: 'ja', tag: 'ja', enabled: false }],
      },
    });
    assert.equal(locales.length, 2);
    assert.equal(locales[1].cmsLocaleId, 'next');
  });

  it('returns an empty list when the site has no locales configured', () => {
    assert.deepEqual(cmsLocalesFromSite({}), []);
  });
});

describe('missingCmsLocaleIds', () => {
  it('reports locales that do not yet have a CMS variant', () => {
    const existing = new Map([['primary-cms', { id: 'item-1' }]]);
    assert.deepEqual(
      missingCmsLocaleIds(existing, ['primary-cms', 'zh-hk-cms', 'zh-cn-cms']),
      ['zh-hk-cms', 'zh-cn-cms']
    );
  });

  it('returns nothing when every locale already has a variant', () => {
    const existing = new Map([
      ['primary-cms', { id: 'item-1' }],
      ['zh-hk-cms', { id: 'item-1' }],
    ]);
    assert.deepEqual(missingCmsLocaleIds(existing, ['primary-cms', 'zh-hk-cms']), []);
  });
});

describe('slug and event id helpers', () => {
  it('builds a unique replacement slug that will not match an event id', () => {
    assert.equal(replacedSlug('abc123'), 'replaced-abc123');
    assert.equal(isReplacedSlug('replaced-abc123'), true);
    assert.equal(isReplacedSlug('hong-kong-observation-wheel-1998184858702'), false);
  });

  it('reads event ids from the dedicated field first, then the slug', () => {
    assert.equal(eventIdFromSlug('hong-kong-observation-wheel-1998184858702'), '1998184858702');
    assert.equal(
      eventIdFromItem({ fieldData: { 'event-id': 1998184858702, slug: 'other-1' } }),
      '1998184858702'
    );
    assert.equal(
      eventIdFromItem({ fieldData: { slug: 'hong-kong-observation-wheel-1998184858702' } }),
      '1998184858702'
    );
  });
});

describe('publishPayload', () => {
  it('publishes every locale when cms locale ids are present', () => {
    assert.deepEqual(publishPayload(['item-1', 'item-2'], ['p', 'zh-hk', 'zh-cn']), {
      items: [
        { id: 'item-1', cmsLocaleIds: ['p', 'zh-hk', 'zh-cn'] },
        { id: 'item-2', cmsLocaleIds: ['p', 'zh-hk', 'zh-cn'] },
      ],
    });
  });

  it('falls back to itemIds for a primary-only site', () => {
    assert.deepEqual(publishPayload(['item-1'], []), { itemIds: ['item-1'] });
  });
});

describe('fieldDataFromExisting', () => {
  it('copies writable CMS fields and keeps the original image URL', () => {
    assert.deepEqual(
      fieldDataFromExisting({
        fieldData: {
          name: 'Hong Kong Observation Wheel',
          slug: 'hong-kong-observation-wheel-1998184858702',
          'start-date-time-2': '2026-10-31T03:00:00.000Z',
          'end-date-time-2': '2026-10-31T15:00:00.000Z',
          summary: 'Views',
          'eventbrite-url': 'https://eventbrite.hk/e/1',
          'event-id': 1998184858702,
          'image-url': {
            fileId: 'file-1',
            url: 'https://cdn.example/image.jpg',
            alt: null,
          },
        },
      }),
      {
        name: 'Hong Kong Observation Wheel',
        slug: 'hong-kong-observation-wheel-1998184858702',
        'start-date-time-2': '2026-10-31T03:00:00.000Z',
        'end-date-time-2': '2026-10-31T15:00:00.000Z',
        summary: 'Views',
        'eventbrite-url': 'https://eventbrite.hk/e/1',
        'event-id': 1998184858702,
        'image-url': { url: 'https://cdn.example/image.jpg' },
      }
    );
  });
});
