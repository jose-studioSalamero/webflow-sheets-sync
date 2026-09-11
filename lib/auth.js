const { getConfig } = require('./config');

function headerValue(req, name) {
  const headers = req.headers || {};
  return headers[name] || headers[name.toLowerCase()];
}

function isAuthorized(req) {
  const { syncSecret } = getConfig();
  if (!syncSecret) return false;

  const authorization = String(headerValue(req, 'authorization') || '');
  if (authorization === `Bearer ${syncSecret}`) return true;

  const googleToken = String(headerValue(req, 'x-goog-channel-token') || '');
  if (googleToken === syncSecret) return true;

  const querySecret = req.query?.secret;
  if (querySecret && String(querySecret) === syncSecret) return true;

  return false;
}

function requireSecret(req, res) {
  if (isAuthorized(req)) return true;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

module.exports = {
  isAuthorized,
  requireSecret,
};
