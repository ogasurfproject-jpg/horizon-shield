// strict_json.mjs : the parse and input rules that make a content hash portable across runtimes.
// Pure JS (no Node built-ins) so both the offline reference impl (bind.mjs) and the Workers ledger face
// (task_ledger_v0.mjs) share one copy. Rule text lives in SPEC.md ("Canonical form, pinned").
//
// parseStrict(text): JSON parse that REFUSES, before anything is hashed,
//   duplicate_key            an object with the same key twice at any depth (no first-wins, no last-wins)
//   non_integer_number       a number with a fraction or exponent
//   unsafe_number            an integer outside plus or minus 2^53 - 1
//   key_not_printable_ascii  an object key with any character outside U+0020..U+007E
//   bad_json                 anything else that is not one JSON value with nothing after it
// checkCanonicalInput(v): the same number and key rules over an already-parsed value (objects handed in by code).
// Both throw an Error whose .code is one of the names above.

const MAX_SAFE = 9007199254740991;

function err(code, at) { const e = new Error(code + (at != null ? " at " + at : "")); e.code = code; e.at = at; return e; }

export function keyOk(k) {
  if (typeof k !== "string") return false;
  for (let i = 0; i < k.length; i++) { const c = k.charCodeAt(i); if (c < 0x20 || c > 0x7e) return false; }
  return true;
}

export function checkCanonicalInput(v, path) {
  const p = path || "$";
  if (v === null || typeof v === "string" || typeof v === "boolean") return;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || !Number.isInteger(v)) throw err("non_integer_number", p);
    if (v > MAX_SAFE || v < -MAX_SAFE) throw err("unsafe_number", p);
    return;
  }
  if (Array.isArray(v)) { v.forEach((x, i) => checkCanonicalInput(x, p + "[" + i + "]")); return; }
  if (typeof v === "object") {
    for (const k of Object.keys(v)) {
      if (!keyOk(k)) throw err("key_not_printable_ascii", p + "." + k);
      checkCanonicalInput(v[k], p + "." + k);
    }
    return;
  }
  throw err("bad_json", p);
}

export function parseStrict(text) {
  if (typeof text !== "string") throw err("bad_json", 0);
  let i = 0; const n = text.length;
  const ws = () => { while (i < n) { const c = text.charCodeAt(i); if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++; else break; } };
  const value = (path) => {
    ws();
    if (i >= n) throw err("bad_json", i);
    const c = text[i];
    if (c === "{") return object(path);
    if (c === "[") return array(path);
    if (c === '"') return string();
    if (c === "t") { if (text.startsWith("true", i)) { i += 4; return true; } throw err("bad_json", i); }
    if (c === "f") { if (text.startsWith("false", i)) { i += 5; return false; } throw err("bad_json", i); }
    if (c === "n") { if (text.startsWith("null", i)) { i += 4; return null; } throw err("bad_json", i); }
    return number(path);
  };
  const number = (path) => {
    const start = i;
    if (text[i] === "-") i++;
    if (i >= n) throw err("bad_json", i);
    if (text[i] === "0") i++;
    else if (text[i] >= "1" && text[i] <= "9") { while (i < n && text[i] >= "0" && text[i] <= "9") i++; }
    else throw err("bad_json", i);
    if (i < n && (text[i] === "." || text[i] === "e" || text[i] === "E")) throw err("non_integer_number", path);
    const s = text.slice(start, i);
    if (s.replace("-", "").length > 16) throw err("unsafe_number", path);
    const v = Number(s);
    if (!Number.isSafeInteger(v)) throw err("unsafe_number", path);
    return v;
  };
  const string = () => {
    i++; let out = "";
    while (i < n) {
      const c = text[i];
      if (c === '"') { i++; return out; }
      if (c === "\\") {
        i++; if (i >= n) throw err("bad_json", i);
        const e = text[i];
        if (e === '"' || e === "\\" || e === "/") { out += e; i++; }
        else if (e === "b") { out += "\b"; i++; } else if (e === "f") { out += "\f"; i++; }
        else if (e === "n") { out += "\n"; i++; } else if (e === "r") { out += "\r"; i++; } else if (e === "t") { out += "\t"; i++; }
        else if (e === "u") {
          const h = text.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(h)) throw err("bad_json", i);
          out += String.fromCharCode(parseInt(h, 16)); i += 5;
        } else throw err("bad_json", i);
      } else {
        if (c.charCodeAt(0) < 0x20) throw err("bad_json", i);
        out += c; i++;
      }
    }
    throw err("bad_json", i);
  };
  const array = (path) => {
    i++; const out = []; ws();
    if (text[i] === "]") { i++; return out; }
    for (;;) {
      out.push(value(path + "[" + out.length + "]")); ws();
      if (text[i] === ",") { i++; continue; }
      if (text[i] === "]") { i++; return out; }
      throw err("bad_json", i);
    }
  };
  const object = (path) => {
    i++; const out = {}; const seen = new Set(); ws();
    if (text[i] === "}") { i++; return out; }
    for (;;) {
      ws();
      if (text[i] !== '"') throw err("bad_json", i);
      const k = string();
      if (!keyOk(k)) throw err("key_not_printable_ascii", path + "." + k);
      if (seen.has(k)) throw err("duplicate_key", path + "." + k);
      seen.add(k);
      ws(); if (text[i] !== ":") throw err("bad_json", i); i++;
      out[k] = value(path + "." + k); ws();
      if (text[i] === ",") { i++; continue; }
      if (text[i] === "}") { i++; return out; }
      throw err("bad_json", i);
    }
  };
  const v = value("$"); ws();
  if (i !== n) throw err("bad_json", i);
  return v;
}
