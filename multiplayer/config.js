// PUBLIC configuration only. Never put service-role/secret keys here.
// Leave empty until the reviewed database guard, repository and deployment exist.
globalThis.MATH24_ONLINE_CONFIG ??= Object.freeze({
  gatewayUrl: '',
  supabaseUrl: '',
  publishableKey: '',
  turnstileSiteKey: '',
});
