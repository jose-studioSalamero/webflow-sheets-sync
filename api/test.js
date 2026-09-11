const { missingConfig } = require('../lib/config');

module.exports = async (req, res) => {
  const missing = missingConfig([
    'googleSheetId',
    'googleServiceAccountEmail',
    'googlePrivateKey',
    'webflowToken',
    'webflowCollectionId',
  ]);

  res.status(200).json({
    hasSheetId: !missing.includes('googleSheetId'),
    hasEmail: !missing.includes('googleServiceAccountEmail'),
    hasPrivateKey: !missing.includes('googlePrivateKey'),
    hasWebflowToken: !missing.includes('webflowToken'),
    hasCollectionId: !missing.includes('webflowCollectionId'),
  });
};
