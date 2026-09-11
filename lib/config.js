function env(name) {
  const value = process.env[name];
  return value && String(value).trim() ? value : undefined;
}

function webflowToken() {
  return env('WEBFLOW_API_TOKEN') || env('WEBFLOW_TOKEN');
}

function googlePrivateKey() {
  return env('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');
}

function getConfig() {
  return {
    webflowToken: webflowToken(),
    webflowSiteId: env('WEBFLOW_SITE_ID'),
    webflowCollectionId: env('WEBFLOW_COLLECTION_ID'),
    googleSheetId: env('GOOGLE_SHEET_ID'),
    googleServiceAccountEmail: env('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    googlePrivateKey: googlePrivateKey(),
    syncSecret: env('SYNC_SECRET') || env('CRON_SECRET'),
    appUrl: env('APP_URL') ||
      (env('VERCEL_PROJECT_PRODUCTION_URL') ? `https://${env('VERCEL_PROJECT_PRODUCTION_URL')}` : undefined) ||
      'https://webflow-sheets-sync.vercel.app',
  };
}

function missingConfig(keys) {
  const config = getConfig();
  return keys.filter((key) => !config[key]);
}

module.exports = {
  getConfig,
  missingConfig,
};
