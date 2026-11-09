// The keys of the content check runner (use "furui-check"), served by the ledger at /.well-known/furui-check-keys.json.
// A key is listed with its key_id, its public half (Ed25519, 32 bytes in base64), the height it starts at and, once
// revoked, the height it ends at. runner-1 is hs-furui-runner's key; it starts at height 0 because the runner's
// heartbeat carries height 0 until the door has sent it a check with a height.
// runner-2 is hs-furui-runner-2's key, a second runner with its own model. Its entry names the runner with runner_id, and
// a day record signed with it must carry runner_id "runner-2". An entry without runner_id is runner-1's. It starts at
// height 0 for the same reason as runner-1.
export const FURUI_CHECK_KEYS = { schema: "furui-check-keys-v0", use: "furui-check", keys: [
  { key_id: "runner-1", public_key_ed25519_b64: "OwaxB47EcLw8lxVBl3BeSjUKUbEAsdXuVW1wFOWHzYc=", from_height: 0, revoked_height: null },
  { key_id: "runner-2", runner_id: "runner-2", public_key_ed25519_b64: "fSH0+C7ZS8G4FJLlqxjkK2p5YZkEaR9u+EoEini3nck=", from_height: 0, revoked_height: null },
] };
