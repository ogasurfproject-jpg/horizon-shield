// ssh_ed25519.mjs : a witness key_url may serve the key as one OpenSSH public key line (2026-11-07), the file
// ssh-keygen writes for an Ed25519 key: "ssh-ed25519 <base64> [comment]". The base64 is the SSH wire form (RFC 4253
// 6.6, RFC 8709 4): string "ssh-ed25519" (4-byte length 11, then the name), string key (4-byte length 32, then the 32
// bytes), nothing after. Those 32 bytes are the key {public_key_ed25519_b64} serves; the key_id rule is unchanged
// ("ed25519:" + the first 16 hex of sha256 of the 32 bytes). Anything else is null: another key type, options before
// the type, a second line, lengths other than 11 and 32, bytes after the key, base64 that is not the one spelling of
// its bytes, a comment with characters outside printable ASCII. The Python twin is ssh_ed25519_key in
// nenrin/witness-enroll-v0/witness_enroll_v0.py; test/ssh_ed25519.test.mjs holds the two to the same answers.
const SSH_LINE = /^ssh-ed25519[ \t]+([A-Za-z0-9+/]+={0,2})(?:[ \t]+[\x20-\x7e\t]*)?$/;
const SSH_NAME = "ssh-ed25519";

function b64Exact(s) {
  let bin;
  try { bin = atob(s); } catch (_e) { return null; }
  if (btoa(bin) !== s) return null;
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// text: the body as served. One line, with at most one final "\n" or "\r\n". -> Uint8Array(32) or null.
export function sshEd25519Key(text) {
  if (typeof text !== "string") return null;
  const m = SSH_LINE.exec(text.replace(/\r?\n$/, ""));
  if (!m) return null;
  const b = b64Exact(m[1]);
  if (!b || b.length !== 4 + 11 + 4 + 32) return null;
  const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  if (u32(0) !== 11 || String.fromCharCode(...b.subarray(4, 15)) !== SSH_NAME || u32(15) !== 32) return null;
  return b.slice(19, 51);
}

// The key a key_url serves, as the base64 string the intake compares: {public_key_ed25519_b64} as before, or (unless
// ssh is false) the 32 bytes of one ssh-ed25519 line in canonical base64. -> string or null.
export function servedKeyB64(text, { ssh = true } = {}) {
  let j = null, parsed = false;
  try { j = JSON.parse(text); parsed = true; } catch (_e) { /* not JSON: an ssh-ed25519 line? */ }
  if (parsed) return j && typeof j.public_key_ed25519_b64 === "string" ? j.public_key_ed25519_b64 : null;
  const k = ssh ? sshEd25519Key(text) : null;
  return k ? btoa(String.fromCharCode(...k)) : null;
}
