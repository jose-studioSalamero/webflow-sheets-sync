module.exports = async (req, res) => {
  res.status(200).json({
    hasSheetId: !!process.env.GOOGLE_SHEET_ID,
    hasEmail: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    hasPrivateKey: !!process.env.GOOGLE_PRIVATE_KEY,
    hasWebflowToken: !!process.env.WEBFLOW_API_TOKEN,
    hasCollectionId: !!process.env.WEBFLOW_COLLECTION_ID,
    emailValue: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    sheetIdValue: process.env.GOOGLE_SHEET_ID,
    privateKeyLength: process.env.GOOGLE_PRIVATE_KEY?.length,
    privateKeyStart: process.env.GOOGLE_PRIVATE_KEY?.substring(0, 50)
  });
};