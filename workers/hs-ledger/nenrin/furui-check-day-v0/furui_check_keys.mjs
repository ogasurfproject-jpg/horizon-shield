// The keys of the content check runner (use "furui-check"), served by the ledger at /.well-known/furui-check-keys.json.
// Empty until the runner's key is made: then every furui-check-day-v0 record is refused (no key), which fails closed.
// A key is added here with its key_id, its public half, the height it starts at and, once revoked, the height it ends at.
export const FURUI_CHECK_KEYS = { schema: "furui-check-keys-v0", use: "furui-check", keys: [] };
