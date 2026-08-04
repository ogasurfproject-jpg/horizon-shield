// adapter.js
// 「超絶検証」の実体。ここが2つの役割を果たす:
//   (A) 業種ディレクトリを、呼び方(binding/http)を意識させずに呼ぶ統一アダプタ。
//   (B) 誰が処理したかに関わらず、通った取引を hs-ledger に刻む検証レイヤー。
//
// これにより「自社(建設)でも提携先でも、通る取引はすべて検証可能」を実装で強制する。
// 設計図第3章・第9章の核。ここがブレたら看板倒れになるので、番人として一番きつく締める。
//
// === hs-ledger の実 append 契約(worker.js を現物で読んで確認・2026-08-04) ===
//   POST /ledger/append  (要 x-ledger-key: LEDGER_ADMIN_TOKEN。write系=TOshiがsecret投入)
//   body: { claim_sha256: <record_canonical の SHA-256 hex64>, record_canonical: <string>, work?: <string> }
//   検証: サーバ側が record_canonical を再ハッシュし claim_sha256 と不一致なら 422。
//   スキーマ: record_canonical が {"schema":"jidec-claim-v1",...} なら12項目の厳格検証+参照束pin必須。
//            それ以外(素のJSON文字列)は v0 扱いで、ハッシュ整合だけ見る。
//   => 課金レシートは v0 プレーンJSON で刻む。v1(建設監査意味論)を課金証跡に流用しない。
//      v0 でも「この録が刻時以前に存在し改竄されていない」は完全に証明できる(設計図第3章の要件を満たす)。

import { getDirectory } from "./registry.js";

var LEDGER_URL = "https://hs-ledger.oga-surf-project.workers.dev";

// --- canonical化: キーをソートした決定的JSON。JCS(RFC 8785)の簡易版。 ---
// hs-ledger 側は「受け取ったバイト列をそのまま再ハッシュ」する方式なので、
// こちらが canonical化した"文字列"を record_canonical として送り、その文字列のSHA-256を claim_sha256 にする。
// 再計算する第三者は、同じ canonical関数を通せば同じバイト列 = 同じハッシュに到達できる。
function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  var keys = Object.keys(value).sort();
  var parts = [];
  for (var i = 0; i < keys.length; i++) {
    parts.push(JSON.stringify(keys[i]) + ":" + canonicalize(value[keys[i]]));
  }
  return "{" + parts.join(",") + "}";
}

async function sha256hex(s) {
  var d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}

// --- (A) 業種ディレクトリ呼び出し。binding と http を1本のインターフェースに揃える。 ---
// 戻り: { ok, status, json|text, transport } もしくは { ok:false, error }
// 提携先(http)は信頼境界の外なので、タイムアウトと fail-closed を効かせる。
async function callDirectory(dir, mcpBody, env) {
  var target = (dir.mcp_path || "/mcp");
  var reqInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mcpBody)
  };

  try {
    if (dir.transport === "binding") {
      // 自社・同アカウント。env[binding_name] の service binding 経由。
      var svc = env && env[dir.binding_name];
      if (!svc || typeof svc.fetch !== "function") {
        return { ok: false, error: "binding_unavailable", detail: dir.binding_name };
      }
      // binding は URL のホスト部は無視され得るが、Request の形を保つため self ぽいURLを置く。
      var bres = await svc.fetch(new Request("https://internal.svc" + target, reqInit));
      var btext = await bres.text();
      return packResult(bres.status, btext, "binding");
    }

    if (dir.transport === "http") {
      // 提携先・別アカウント。タイムアウト付き HTTP fetch。信頼境界の外。
      if (!dir.base_url) return { ok: false, error: "no_base_url" };
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, 8000); // 8秒で fail-closed
      try {
        var hres = await fetch(dir.base_url + target, Object.assign({}, reqInit, { signal: ctrl.signal }));
        var htext = await hres.text();
        return packResult(hres.status, htext, "http");
      } finally {
        clearTimeout(timer);
      }
    }

    return { ok: false, error: "unknown_transport", detail: dir.transport };
  } catch (e) {
    // 提携先の落下・タイムアウトは fail-closed。呼び出し自体は失敗として上に返す。
    return { ok: false, error: "directory_call_failed", detail: String(e && e.message || e) };
  }
}

function packResult(status, text, transport) {
  var out = { ok: status >= 200 && status < 300, status: status, transport: transport };
  try { out.json = JSON.parse(text); }
  catch (e) { out.text = String(text).slice(0, 8000); }
  return out;
}

// --- (B) 検証レシートを組み立て、hs-ledger に v0 で刻む。 ---
// 設計図第3章の必須項目を満たす canonical レシートを作る。
// 外部事業者名は載せない(第7章: 原価は見せない)。載せるのは vertical(業種) と処理種別まで。
//
// verifiable=false(提携先)の場合、レシートは「呼び出し・課金の事実」は刻むが、
// limits に「結果の中身の妥当性は弊社が保証しない」と明記する(正直路線)。
//
// ledgered() の実 append は LEDGER_ADMIN_TOKEN を要する write 操作。
// env.LEDGER_ADMIN_TOKEN が無ければ「レシートは組むが台帳追記はスキップ」で返す(fail-safe)。
// トークン投入は TOshi の手(番人は secret を触らない)。
async function buildReceipt(fields) {
  // fields: { request_id, vertical, verifiable, op, input, output, tickets_spent, balance_before, balance_after }
  var input_sha256 = await sha256hex(canonicalize(fields.input == null ? null : fields.input));
  var output_sha256 = await sha256hex(canonicalize(fields.output == null ? null : fields.output));

  // レシート本体(receipt自身のハッシュを載せる前の中身)。決定的順序で組む。
  var core = {
    schema: "hs-gateway-receipt-v0", // v0系。hs-ledger は jidec-claim-v1 以外を厳格検証しない。
    request_id: fields.request_id,
    vertical: fields.vertical,
    verifiable: !!fields.verifiable,
    op: fields.op || "call",
    input_sha256: input_sha256,
    output_sha256: output_sha256,
    tickets_spent: Number(fields.tickets_spent || 0),
    balance_before: Number(fields.balance_before || 0),
    balance_after: Number(fields.balance_after || 0),
    // timestamp は呼び出し側が1回だけ生成して渡す。ここで new Date() を呼ぶと
    // 同じ取引でもハッシュが毎回変わり、第三者の再計算が成立しなくなる(検証可能性の毒)。
    timestamp: fields.timestamp || "1970-01-01T00:00:00.000Z",
    limits: fields.verifiable
      ? "この録は入力・結果・消費が刻時以前に存在し改竄されていないことを証明する。結果の妥当性は該当業種の検証能力に依る。"
      : "この録は呼び出しと課金の事実のみを証明する。提携先が返した結果の中身の妥当性は弊社は保証しない(弊社に当該業種の検証能力が無いため)。"
  };
  // receipt自身のハッシュ = core を canonical化してSHA-256。
  var receipt_sha256 = await sha256hex(canonicalize(core));
  return { core: core, receipt_sha256: receipt_sha256 };
}

// hs-ledger に v0 で刻む。record_canonical は「receipt本体+自ハッシュ」を canonical化した文字列。
async function appendToLedger(receipt, env) {
  var record = { receipt: receipt.core, receipt_sha256: receipt.receipt_sha256 };
  var record_canonical = canonicalize(record);
  var claim_sha256 = await sha256hex(record_canonical);

  if (!env || !env.LEDGER_ADMIN_TOKEN) {
    // 番人モード: トークン未投入なら追記しない。レシートは返すが「未刻」を明示。
    return { anchored: false, reason: "LEDGER_ADMIN_TOKEN unset (append skipped; receipt built but not ledgered)", claim_sha256: claim_sha256 };
  }
  try {
    var _lf = (env && env.LEDGER_SVC && typeof env.LEDGER_SVC.fetch === "function") ? env.LEDGER_SVC.fetch.bind(env.LEDGER_SVC) : fetch;
    var res = await _lf(LEDGER_URL + "/ledger/append", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ledger-key": env.LEDGER_ADMIN_TOKEN },
      body: JSON.stringify({ claim_sha256: claim_sha256, record_canonical: record_canonical, work: "gateway:" + receipt.core.vertical })
    });
    var j = await res.json().catch(function () { return null; });
    if (!res.ok) return { anchored: false, reason: "ledger_append_failed", status: res.status, detail: j, claim_sha256: claim_sha256 };
    return { anchored: true, entry: j && j.n, url: j && j.url, claim_sha256: claim_sha256 };
  } catch (e) {
    return { anchored: false, reason: "ledger_unreachable", detail: String(e && e.message || e), claim_sha256: claim_sha256 };
  }
}

export { canonicalize, sha256hex, callDirectory, buildReceipt, appendToLedger, getDirectory };
