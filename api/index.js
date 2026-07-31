let cachedApp;

module.exports = async function handler(req, res) {
  if (!cachedApp) {
    const { createApp } = await import("../apps/api/dist/app.js");
    cachedApp = createApp();
  }

  return cachedApp(req, res);
};
