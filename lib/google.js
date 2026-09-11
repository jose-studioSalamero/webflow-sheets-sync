const { GoogleAuth } = require('google-auth-library');
const { getConfig } = require('./config');

async function getGoogleAccessToken(scopes) {
  const { googleServiceAccountEmail, googlePrivateKey } = getConfig();
  const auth = new GoogleAuth({
    credentials: {
      client_email: googleServiceAccountEmail,
      private_key: googlePrivateKey,
    },
    scopes,
  });
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  return accessToken.token;
}

module.exports = {
  getGoogleAccessToken,
};
