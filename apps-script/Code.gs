// Install in the Google Sheet: Extensions → Apps Script.
// 1. File → Project properties → Script properties → add SYNC_SECRET
// 2. Run installTrigger() once to watch the spreadsheet
// 3. Enable Apps Script → Services if prompted for UrlFetch

const SYNC_URL = 'https://webflow-sheets-sync.vercel.app/api/sync';

function syncToWebflow() {
  const secret = PropertiesService.getScriptProperties().getProperty('SYNC_SECRET');
  if (!secret) {
    throw new Error('Set SYNC_SECRET in Script Properties');
  }

  UrlFetchApp.fetch(SYNC_URL, {
    method: 'post',
    headers: { Authorization: 'Bearer ' + secret },
    muteHttpExceptions: true,
  });
}

function onChange() {
  syncToWebflow();
}

function installTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('onChange')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onChange()
    .create();

  ScriptApp.newTrigger('syncToWebflow')
    .timeBased()
    .everyMinutes(1)
    .create();
}
