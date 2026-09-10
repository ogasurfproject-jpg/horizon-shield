// dispatch_do.js
// 生成の合図を出す関所の Durable Object。
//
// なぜ KV では閉じられんかったか (2026-09-10)。
//
// 元の関所は KV に「店 + 時刻 + 回答の指紋」を書いて、次の合図で読み直しとった。
// KV は結果整合や。書いた値が他の拠点から即座に読めるとは限らんし、同じ拠点でも
// 読みに 60 秒までの cache が挟まる。せやから「読む → 無い → 書く」の間に窓が開く。
// 数秒差で届いた二本は、両方とも印を見んまま通る。窓の幅は code の書き方では
// 縮まらん。KV がそういう物やからや。
//
// hearing.js の元の注釈は、その事を自分で認めとった:
//   「これが防げないもの: 数秒差で同時に届いた二本。KV の反映は即時ではないので、
//     両方とも印を見ずに通ることがある。」
//
// 認めたまま置いといたら、いつまでも開いとる。DO なら閉じる。
//
// Durable Object は id ごとに 1 本の実行しか持たん。同じ店に来た二本は、必ず順番に
// 実行される。しかも storage は強整合や。せやから「読む → 決める → 書く」が
// 原子的になる。競合そのものが起きん。二重使用を DO で塞いだ hs-gateway の
// TicketLedgerDO と同じ手で、生態系を揃える。
//
// blockConcurrencyWhile を使うんは、念のためやのうて、そこが要るからや。DO は
// await の間に別の要求を差し込むことがある (storage の await は入口が閉まるが、
// 他の await では開く)。この関所は指紋の計算を挟むから、計算を外へ出した上で、
// 読み書きを 1 つの塊に閉じる。塊の中では、この DO は他の何も受け取らん。
//
// 判断そのものは decideClaim という純関数に出してある。DO の runtime を持ち出さんと
// 試験でけへん規則は、試験されん規則になる。

export const DEFAULT_WINDOW_MS = 600000;   // 10 分。hearing.js の既定と同じ

// 窓の幅を読む。0 を渡したら仕掛けごと切れる。数にならん値は既定に戻す。
// 関所は開ける方に倒さん。
export function windowFrom(raw) {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_WINDOW_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_WINDOW_MS;
  return n;
}

// prev は { ts, fp } か null。fp が無い古い印は、止める側に倒す。
// 返す物は hearing.js が報告に載せる形そのまま。
export function decideClaim(prev, now, fpNow, windowMs) {
  if (!(windowMs > 0)) {
    return { granted: true, reason: "window-off", since_ms: null, window_ms: windowMs };
  }
  if (!prev || typeof prev !== "object") {
    return { granted: true, reason: "first", since_ms: null, window_ms: windowMs };
  }
  const age = now - Number(prev.ts);
  if (!Number.isFinite(age) || age < 0 || age >= windowMs) {
    return { granted: true, reason: age < 0 ? "mark-in-future" : "window-passed",
             since_ms: Number.isFinite(age) ? age : null, window_ms: windowMs };
  }
  // 窓の内。指紋が同じなら二度押し。違えば中身の違う本物の 2 通目やから通す。
  const pfp = prev.fp === undefined ? null : prev.fp;
  if (pfp !== null && pfp !== fpNow) {
    return { granted: true, reason: "content-changed", since_ms: age, window_ms: windowMs };
  }
  return { granted: false, reason: "debounced", since_ms: age, window_ms: windowMs };
}

// 予約と取り消しの二段にする理由 (2026-09-10)。
//
// KV の版は「合図が成功した時だけ印を置く」やった。失敗した合図で次の合図を塞がん
// ためで、それは正しい性質や。せやが競合を閉じるには、合図を出す **前** に印を
// 置かなあかん。後に置いたら、二本目は一本目の印を見んまま走る。
//
// 二つとも立てる。claim で先に印を置いて札 (token) を返す。合図が失敗したら
// release にその札を渡して印を消す。消すんは、置いた印が自分の札の物やった時だけや。
// 間に別の本物が印を置き直しとったら、消したらあかん。
export class DispatchGateDO {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST") return this._json({ error: "not_found" }, 404);
    let body;
    try {
      body = await request.json();
    } catch {
      return this._json({ error: "bad_json" }, 400);
    }

    if (url.pathname === "/claim") {
      const fpNow = typeof body.fingerprint === "string" ? body.fingerprint : null;
      const windowMs = windowFrom(body.window_ms);
      const now = Number.isFinite(Number(body.now)) ? Number(body.now) : Date.now();
      // 読む・決める・書く を 1 つの塊にする。この間、この DO は他の要求を受け取らん。
      // ここが「数秒差の二本」を閉じる場所や。
      return this._json(await this.state.blockConcurrencyWhile(async () => {
        const prev = await this.state.storage.get("mark");
        const d = decideClaim(prev || null, now, fpNow, windowMs);
        if (!d.granted) return d;
        const token = (globalThis.crypto && globalThis.crypto.randomUUID)
          ? globalThis.crypto.randomUUID() : String(now) + ":" + Math.random();
        await this.state.storage.put("mark", { ts: now, fp: fpNow, token });
        return { ...d, token };
      }));
    }

    if (url.pathname === "/release") {
      const token = typeof body.token === "string" ? body.token : null;
      return this._json(await this.state.blockConcurrencyWhile(async () => {
        if (!token) return { released: false, reason: "no-token" };
        const mark = await this.state.storage.get("mark");
        // 自分が置いた印だけ消す。間に別の本物が置き直しとったら触らん。
        if (!mark || mark.token !== token) return { released: false, reason: "not-mine" };
        await this.state.storage.delete("mark");
        return { released: true };
      }));
    }

    return this._json({ error: "not_found" }, 404);
  }

  _json(o, status = 200) {
    return new Response(JSON.stringify(o), {
      status, headers: { "content-type": "application/json" },
    });
  }
}

// worker 側から呼ぶ口。関所が繋がっとらんかったら **通さん**。
// 開ける方に倒したら、設定の抜けが黙って穴になる。抜けは止まって見える方がええ。
export async function claimDispatch(env, storeId, fingerprint, windowMs, now) {
  if (!env.DISPATCH_DO) {
    return { granted: false, reason: "dispatch-gate-unbound",
             note: "DISPATCH_DO が繋がっとらん。関所が無いまま合図は出さん。wrangler.jsonc の durable_objects と migrations を確かめること。" };
  }
  const stub = env.DISPATCH_DO.get(env.DISPATCH_DO.idFromName("dispatch:" + storeId));
  const r = await stub.fetch("https://dispatch-gate/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fingerprint, window_ms: windowMs, now }),
  });
  return await r.json();
}

export async function releaseDispatch(env, storeId, token) {
  if (!env.DISPATCH_DO || !token) return { released: false, reason: "no-gate-or-token" };
  const stub = env.DISPATCH_DO.get(env.DISPATCH_DO.idFromName("dispatch:" + storeId));
  const r = await stub.fetch("https://dispatch-gate/release", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return await r.json();
}
