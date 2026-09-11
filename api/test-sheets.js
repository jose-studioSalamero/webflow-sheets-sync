const { GoogleAuth } = require('google-auth-library');
const { getConfig, missingConfig } = require('../lib/config');

export default async function handler(req, res) {
  try {
    const missing = missingConfig([
      'googleSheetId',
      'googleServiceAccountEmail',
      'googlePrivateKey',
    ]);
    if (missing.length) {
      return res.status(500).json({ error: `Missing environment variables: ${missing.join(', ')}` });
    }

    const { googleSheetId, googleServiceAccountEmail, googlePrivateKey } = getConfig();

    const auth = new GoogleAuth({
      credentials: {
        client_email: googleServiceAccountEmail,
        private_key: googlePrivateKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${googleSheetId}/values/Events!A1:I10`;
    
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
      },
    });

    const data = await response.json();

    res.status(200).json({
      success: response.ok,
      status: response.status,
      url: url,
      data: data
    });

  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
    });
  }
}
