// Static config lives in app.json. This adds only what must not be committed: the
// Android Google Maps key. Without GOOGLE_MAPS_API_KEY the Android map shows no tiles
// (iOS uses Apple Maps and needs none). Never put the key in app.json.
const base = require('./app.json');

module.exports = () => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const expo = { ...base.expo };
  if (key) {
    expo.android = { ...expo.android, config: { ...(expo.android && expo.android.config), googleMaps: { apiKey: key } } };
  }
  return { expo };
};
