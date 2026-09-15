const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildFieldData, buildColMap, cmsWriteFieldData, fieldsChanged } = require('./sync-events');

const headers = [
  'event_id',
  'title',
  'status',
  'listed',
  'start_datetime',
  'end_datetime',
  'venue_name',
  'summary',
  'image_url',
  'eventbrite_url',
  'description',
];

describe('buildFieldData', () => {
  it('includes the numeric event id used by the CMS schema', () => {
    const colMap = buildColMap(headers);
    const row = [
      '1998184858702',
      'Hong Kong Observation Wheel',
      'live',
      'TRUE',
      '2026-10-31T03:00:00.000Z',
      '2026-10-31T15:00:00.000Z',
      'Central',
      'Enjoy the skyline',
      'https://cdn.example/image.jpg',
      'https://www.eventbrite.hk/e/1',
      'Longer description',
    ];
    const { eventId, fieldData } = buildFieldData(row, colMap);
    assert.equal(eventId, '1998184858702');
    assert.equal(fieldData['event-id'], 1998184858702);
    assert.equal(fieldData.slug, 'hong-kong-observation-wheel-1998184858702');
  });
});

describe('cmsWriteFieldData', () => {
  it('only sends fields the Events collection can store', () => {
    const written = cmsWriteFieldData({
      name: 'Event',
      slug: 'event-1',
      location: 'Central',
      description: '<p>Hi</p>',
      summary: 'Short',
      'event-id': 12,
      'image-url': { url: 'https://cdn.example/a.jpg' },
    });
    assert.deepEqual(written, {
      slug: 'event-1',
      name: 'Event',
      summary: 'Short',
      'image-url': { url: 'https://cdn.example/a.jpg' },
      'event-id': 12,
    });
  });
});

describe('fieldsChanged', () => {
  it('treats matching locale content as unchanged', () => {
    const desired = {
      name: 'Event',
      'start-date-time-2': '2026-10-31T03:00:00.000Z',
      summary: 'Short',
      'eventbrite-url': 'https://www.eventbrite.hk/e/1',
      'event-id': 12,
    };
    const existing = {
      name: 'Event',
      'start-date-time-2': '2026-10-31T03:00:00.000Z',
      summary: 'Short',
      'eventbrite-url': 'https://www.eventbrite.hk/e/1',
      'event-id': '12',
    };
    assert.equal(fieldsChanged(desired, existing), false);
  });

  it('detects locale content that still needs to be copied', () => {
    assert.equal(
      fieldsChanged({ name: 'Event', summary: 'New' }, { name: 'Event', summary: '' }),
      true
    );
  });
});
