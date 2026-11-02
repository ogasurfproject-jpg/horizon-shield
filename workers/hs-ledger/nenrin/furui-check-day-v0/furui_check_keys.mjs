// The keys of the content check runner (use "furui-check"), served by the ledger at /.well-known/furui-check-keys.json.
// A key is listed with its key_id, its public half (Ed25519, 32 bytes in base64), the height it starts at and, once
// revoked, the height it ends at. runner-1 is hs-furui-runner's key; it starts at height 0 because the runner's
// heartbeat carries height 0 until the door has sent it a check with a height.
export const FURUI_CHECK_KEYS = { schema: "furui-check-keys-v0", use: "furui-check", keys: [
  { key_id: "runner-1", public_key_ed25519_b64: "OwaxB47EcLw8lxVBl3BeSjUKUbEAsdXuVW1wFOWHzYc=", from_height: 0, revoked_height: null },
] };
