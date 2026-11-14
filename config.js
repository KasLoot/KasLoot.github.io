// Site settings for the RoboBrain "Try now" demo.
// workerUrl: the URL printed by `npx wrangler deploy` (e.g. https://robobrain-demo.<you>.workers.dev).
//            Leave empty until the Worker is deployed; visitors can still use their own OpenAI key.
// turnstileSiteKey: optional Cloudflare Turnstile site key (only if TURNSTILE_SECRET is set on the Worker).
window.SITE_CONFIG = {
  workerUrl: "",
  turnstileSiteKey: "",
  model: "gpt-6.1-terra",
  openaiBase: "https://api.openai.com/v1",
};
