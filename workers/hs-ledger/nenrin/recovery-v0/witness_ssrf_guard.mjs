// RUN_ALL: library  証人の fetch の足元 (SSRF の穴塞ぎ): 名前を引いて、内側の番地なら断り、引いた番地に釘を打つ。採点は witness_ssrf_guard_test.mjs
//
// なぜ要るか (2026-09-21、外部の証人候補からの review で出た穴)。witness_reply.targetAllowed は host 名の見た目しか見ん。
// 公開の DNS 名が 10.0.0.5 や 169.254.169.254 (cloud の metadata) や 127.0.0.1 を指しとったら、証人は自分の内側を測って、
// 見た物 (challenge の値、metadata の中身) に署名して外に返す。見た目の篩では塞がらん。塞ぐには三つ要る:
//   resolve  名前を引く (番地を全部)
//   refuse   一つでも内側の番地 (下の表) なら断る。読めん物も断る (fail closed)
//   pin      socket が繋ぐ番地は篩を通った番地だけ。node:https の lookup option に差し込むと繋ぐ瞬間に引き直して篩うので、
//            事前確認と接続の間で DNS が付け替わる (rebinding) 隙も無い
// Cloudflare Worker の fetch は RFC1918 / link-local に route せん。あれは platform の性質で、code の保証やない (hs-verify-gate/src/witness.js)。
// Node で serve する証人はこれを使う。自前の fetch を持ち込む証人は、同じ三つを自分でやる (BECOME_A_WITNESS.md)。
//
// 断る番地 (v4): 0/8 10/8 100.64/10 (CGNAT) 127/8 169.254/16 (link-local、metadata) 172.16/12 192.0.0/24 192.0.2/24 (doc)
//               192.168/16 198.18/15 (bench) 198.51.100/24 (doc) 203.0.113/24 (doc) 224/4 (multicast) 240/4 (reserved、broadcast)
// 断る番地 (v6): :: ::1 fe80::/10 fc00::/7 ff00::/8 2001:db8::/32。::ffff:a.b.c.d (mapped) と 64:ff9b::a.b.c.d (NAT64) は中の v4 を篩う
import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns";
import { request as httpsRequest } from "node:https";

function ip4ToInt(s) {
  const p = String(s).split(".");
  if (p.length !== 4) return null;
  let n = 0;
  for (const o of p) { if (!/^\d{1,3}$/.test(o)) return null; const v = Number(o); if (v > 255) return null; n = (n * 256) + v; }
  return n >>> 0;
}
function v4Blocked(s) {
  const n = ip4ToInt(s);
  if (n === null) return true;
  const inR = (base, bits) => { const b = ip4ToInt(base); const shift = 32 - bits; return (n >>> shift) === (b >>> shift); };
  return (
    inR("0.0.0.0", 8) || inR("10.0.0.0", 8) || inR("100.64.0.0", 10) || inR("127.0.0.0", 8) ||
    inR("169.254.0.0", 16) || inR("172.16.0.0", 12) || inR("192.0.0.0", 24) || inR("192.0.2.0", 24) ||
    inR("192.168.0.0", 16) || inR("198.18.0.0", 15) || inR("198.51.100.0", 24) || inR("203.0.113.0", 24) ||
    inR("224.0.0.0", 4) || inR("240.0.0.0", 4)
  );
}
// v6 の文字列を 16 byte に。zone (%eth0) は落とす。末尾の dotted quad は 2 hextet に畳む。:: は展開。読めんかったら null (= 断る)。
function v6ToBytes(s) {
  s = String(s).toLowerCase().split("%")[0];
  const dm = s.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dm) {
    const o = [dm[2], dm[3], dm[4], dm[5]].map(Number);
    if (o.some((x) => x > 255)) return null;
    s = dm[1] + (((o[0] << 8) | o[1]).toString(16)) + ":" + (((o[2] << 8) | o[3]).toString(16));
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups;
  if (halves.length === 2) { const fill = 8 - head.length - tail.length; if (fill < 0) return null; groups = [...head, ...Array(fill).fill("0"), ...tail]; }
  else groups = head;
  if (groups.length !== 8) return null;
  const bytes = [];
  for (const g of groups) { if (!/^[0-9a-f]{1,4}$/.test(g)) return null; const v = parseInt(g, 16); bytes.push((v >> 8) & 0xff, v & 0xff); }
  return bytes;
}
function v6Blocked(s) {
  const b = v6ToBytes(s);
  if (!b) return true;
  const mapped = b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff;
  const nat64 = b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0);
  if (mapped || nat64) return v4Blocked(b.slice(12).join("."));
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return true;              // ::1 loopback
  if (b.every((x) => x === 0)) return true;                                           // :: unspecified
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;                           // fe80::/10 link-local
  if ((b[0] & 0xfe) === 0xfc) return true;                                            // fc00::/7 unique local
  if (b[0] === 0xff) return true;                                                     // ff00::/8 multicast
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true;  // 2001:db8::/32 documentation
  return false;
}
// 番地 1 つを篩う。IP として読めん物は true (断る)。
export function isBlockedIp(ip) {
  const v = isIP(ip);
  if (v === 4) return v4Blocked(ip);
  if (v === 6) return v6Blocked(ip);
  return true;
}

// node:https の lookup option に差す関数を作る。名前を引いて、番地が一つでも内側なら EBLOCKED で断り、通った番地だけ socket に渡す。
// node:https は繋ぐ瞬間にこれを呼ぶので、事前確認の後で名前が付け替わっても、ここでもう一度引き直して篩う (rebinding 対策)。
// resolver は差し替え可 (試験は DNS 無しで回す)。既定は node:dns の lookup。
export function makeSafeLookup(resolver = dnsLookup) {
  return function safeLookup(hostname, options, callback) {
    if (typeof options === "function") { callback = options; options = {}; }
    const opts = options && typeof options === "object" ? options : {};
    resolver(hostname, { ...opts, all: true }, (err, addrs) => {
      if (err) return callback(err);
      const list = Array.isArray(addrs) ? addrs : (addrs ? [{ address: addrs, family: opts.family || 4 }] : []);
      if (!list.length) return callback(Object.assign(new Error("no address for " + hostname), { code: "ENOTFOUND" }));
      const bad = list.find((a) => isBlockedIp(a.address));
      if (bad) return callback(Object.assign(new Error("refused: " + hostname + " resolves to a blocked address " + bad.address), { code: "EBLOCKED" }));
      if (opts.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}
export const safeLookup = makeSafeLookup();

// 測る前の事前確認。socket を開く前に、理由付きで綺麗に断るため。保証は pin の側にある (これだけでは rebinding は塞がらん)。
export function resolveAllowed(hostname, resolver = dnsLookup) {
  return new Promise((resolve) => {
    resolver(hostname, { all: true }, (err, addrs) => {
      if (err) return resolve({ ok: false, why: "does not resolve: " + (err.code || err.message) });
      const list = Array.isArray(addrs) ? addrs : [];
      if (!list.length) return resolve({ ok: false, why: "no address" });
      const bad = list.find((a) => isBlockedIp(a.address));
      if (bad) return resolve({ ok: false, why: "resolves to a blocked address " + bad.address });
      resolve({ ok: true, addresses: list.map((a) => a.address) });
    });
  });
}

// 釘を打つ fetch。node:https に safeLookup を差した物で、依存は無い。measureSurfaces が使う分の Response (status, ok, headers.get, text, json) を返す。
// https だけ (EPROTO)。port は 443 だけ (EPORT、公開 origin は 443 で答える)。redirect は追わん (追うと別の host が第二の的になる。測定も manual を頼む)。
// signal (AbortSignal) と timeout を見る。card の署名の jku など、測定の途中で出てくる二つ目の URL も同じ fetch を通るので、同じ篩に掛かる。
export function makeSafeFetch({ resolver = dnsLookup, timeoutMs = 15000 } = {}) {
  const lookup = makeSafeLookup(resolver);
  return function safeFetch(url, init = {}) {
    return new Promise((resolve, reject) => {
      let u; try { u = new URL(String(url)); } catch (e) { return reject(e); }
      if (u.protocol !== "https:") return reject(Object.assign(new Error("only https is fetched"), { code: "EPROTO" }));
      if (u.port && u.port !== "443") return reject(Object.assign(new Error("only port 443 is fetched"), { code: "EPORT" }));
      const headers = {};
      const h = init.headers || {};
      if (typeof h.forEach === "function") h.forEach((v, k) => { headers[k] = v; }); else Object.assign(headers, h);
      const req = httpsRequest({ protocol: "https:", hostname: u.hostname, port: 443, path: u.pathname + u.search, method: init.method || "GET", headers, lookup, timeout: timeoutMs }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const hd = res.headers || {};
          resolve({
            status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, url: u.href,
            headers: { get: (k) => { const v = hd[String(k).toLowerCase()]; return v == null ? null : Array.isArray(v) ? v.join(", ") : String(v); } },
            text: async () => buf.toString("utf8"), json: async () => JSON.parse(buf.toString("utf8")),
            arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          });
        });
        res.on("error", reject);
      });
      req.on("timeout", () => req.destroy(Object.assign(new Error("timeout after " + timeoutMs + "ms"), { code: "ETIMEDOUT" })));
      req.on("error", reject);
      if (init.signal) { if (init.signal.aborted) req.destroy(new Error("aborted")); else init.signal.addEventListener("abort", () => req.destroy(new Error("aborted")), { once: true }); }
      if (init.body) req.write(init.body);
      req.end();
    });
  };
}
