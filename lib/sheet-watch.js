const { randomUUID } = require('crypto');
const { getConfig } = require('./config');
const { getGoogleAccessToken } = require('./google');

async function startSheetWatch() {
  const { googleSheetId, syncSecret, appUrl } = getConfig();
  if (!syncSecret) {
    throw new Error('SYNC_SECRET is required to watch the Google Sheet');
  }

  const token = await getGoogleAccessToken([
    'https://www.googleapis.com/auth/drive.readonly',
  ]);

  const expiration = Date.now() + 20 * 60 * 60 * 1000;
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${googleSheetId}/watch?supportsAllDrives=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: randomUUID(),
        type: 'web_hook',
        address: `${appUrl.replace(/\/$/, '')}/api/sheets-webhook`,
        token: syncSecret,
        expiration: String(expiration),
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || data.message || `Drive watch failed (${response.status})`);
  }

  return {
    channelId: data.id,
    resourceId: data.resourceId,
    expiration: data.expiration,
    address: `${appUrl.replace(/\/$/, '')}/api/sheets-webhook`,
  };
}

module.exports = {
  startSheetWatch,
};
