// hs-hearing: 同じ店への二度押しで、生成の合図が二度飛ばんことを確かめる。
//
// なぜ在るか (2026-09-10 朝)。
// 07:49:22Z と 07:52:19Z、3分差で同じ店(No.001)の生成が二度走った。二度目は頁を
// 一バイトも変えず、manifest の generated_at だけ動かし、
// 「auto-publish 11 verified pages (門を通過)」と名乗る commit を台帳に残し、
// 同じ11本の URL を IndexNow に再送した。公開しとらんものを公開したと名乗る記録が、
// バイトが記録の単位やと言うとる repo に残った。
//
// なぜ書き直したか (2026-09-10 夜)。
// 最初の関所は KV に置いてあった。KV は結果整合やから「読む → 無い → 書く」の間に
// 窓が開く。数秒差で届いた二本は両方とも印を見んまま通る。当時の注釈はそれを自分で
// 認めた上で置いてあった。認めたまま置いといたら、いつまでも開いとる。
// Durable Object に移した。この試験は、移した物が本当に閉じとるかを見る。
//
// 一番大事なんは「同時に来た二本」や。純関数を何本試しても、そこは測れん。
// せやから偽の DO を組んで、本物の DispatchGateDO をその上で回す。
// そして **入口を閉じる仕掛けを外した偽物** も同じ手順で回して、そっちでは二本とも
// 通ることを見せる。閉じとることの証拠は、外したら開くことや。
//
// 走らせ方: node dispatch_debounce_test.mjs
import { fileURLToPath } from "node:url";
import path from "node:path";
import { decideClaim, windowFrom, DispatchGateDO, claimDispatch, releaseDispatch, DEFAULT_WINDOW_MS }
  from "./src/dispatch_do.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
void HERE;

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log("ok   " + name); }
  else { fail++; console.log("NG   " + name + (detail !== undefined ? "  " + detail : "")); }
};

const W = 600000;

/* ---------------------------------------------- 1. 判断そのもの (純関数) */
t("初回は通す", decideClaim(null, 1000, "aa", W).granted);
t("窓の内で同じ中身は止める", decideClaim({ ts: 1000, fp: "aa" }, 1500, "aa", W).granted === false);
t("止めた時の理由は debounced", decideClaim({ ts: 1000, fp: "aa" }, 1500, "aa", W).reason === "debounced");
t("止めた時は経過を返す", decideClaim({ ts: 1000, fp: "aa" }, 1500, "aa", W).since_ms === 500);
t("窓の内でも中身が違えば通す", decideClaim({ ts: 1000, fp: "aa" }, 1500, "bb", W).granted);
t("窓を出たら通す", decideClaim({ ts: 1000, fp: "aa" }, 1000 + W, "aa", W).granted);
t("窓のちょうど手前は止める", decideClaim({ ts: 1000, fp: "aa" }, 1000 + W - 1, "aa", W).granted === false);
// 指紋の無い古い印は、止める側に倒す。関所は開ける方に倒さん。
t("指紋の無い古い印は止める", decideClaim({ ts: 1000 }, 1500, "aa", W).granted === false);
t("印の時刻が未来なら通す (時計が戻った時に永久に止まらんように)",
  decideClaim({ ts: 5000, fp: "aa" }, 1000, "aa", W).granted);
t("窓が 0 なら仕掛けごと切れる", decideClaim({ ts: 1000, fp: "aa" }, 1001, "aa", 0).granted);
t("壊れた印は通す (止める理由にならん)", decideClaim("ごみ", 1500, "aa", W).granted);

/* ---------------------------------------------- 2. 窓の幅の読み方 */
t("未設定は既定", windowFrom(undefined) === DEFAULT_WINDOW_MS && windowFrom(null) === DEFAULT_WINDOW_MS
  && windowFrom("") === DEFAULT_WINDOW_MS);
// `env.X || 600000` やと 0 が既定に化ける。切ったつもりが切れとらん状態になる。
t("0 は 0 のまま。既定に化けん", windowFrom(0) === 0 && windowFrom("0") === 0);
t("数にならん値は既定に戻す", windowFrom("あ") === DEFAULT_WINDOW_MS && windowFrom(-5) === DEFAULT_WINDOW_MS
  && windowFrom(NaN) === DEFAULT_WINDOW_MS);
t("数字の字は数として読む", windowFrom("1500") === 1500);

/* ---------------------------------------------- 3. 偽の DO の上で本物を回す */
// serialize: true なら blockConcurrencyWhile が本物と同じに直列化する。
// false なら、入口を閉じる仕掛けが無い DO を真似る。そっちは開いとるはずや。
function fakeState(serialize) {
  const map = new Map();
  let chain = Promise.resolve();
  const storage = {
    get: async (k) => { await tick(); return map.has(k) ? map.get(k) : undefined; },
    put: async (k, v) => { await tick(); map.set(k, v); },
    delete: async (k) => { await tick(); map.delete(k); },
  };
  // await を 1 つ挟む。挟まんと、単一スレッドの JS では偶然に直列化してまう。
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return {
    storage,
    blockConcurrencyWhile: (fn) => {
      if (!serialize) return fn();                 // 仕掛けを外した版
      const next = chain.then(() => fn());
      chain = next.then(() => {}, () => {});
      return next;
    },
    _map: map,
  };
}

const post = (doObj, p, body) =>
  doObj.fetch(new Request("https://dispatch-gate" + p, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  })).then((r) => r.json());

{
  const st = fakeState(true);
  const g = new DispatchGateDO(st);
  const now = 1000;
  const [a, b] = await Promise.all([
    post(g, "/claim", { fingerprint: "aa", window_ms: W, now }),
    post(g, "/claim", { fingerprint: "aa", window_ms: W, now }),
  ]);
  const granted = [a, b].filter((x) => x.granted).length;
  t("同時に来た二本で、通るのは 1 本だけ", granted === 1, JSON.stringify([a.granted, b.granted]));
  t("通った方だけが札を持つ", (a.granted ? a.token : b.token) && !(a.granted ? b.token : a.token));
  t("止まった方は debounced と言う", (a.granted ? b.reason : a.reason) === "debounced");
}
{
  // 仕掛けを外したら開く。これが「閉じとる」の証拠や。
  const st = fakeState(false);
  const g = new DispatchGateDO(st);
  const [a, b] = await Promise.all([
    post(g, "/claim", { fingerprint: "aa", window_ms: W, now: 1000 }),
    post(g, "/claim", { fingerprint: "aa", window_ms: W, now: 1000 }),
  ]);
  t("入口を閉じる仕掛けを外すと、二本とも通ってまう (KV の版がこれやった)",
    [a, b].filter((x) => x.granted).length === 2, JSON.stringify([a.granted, b.granted]));
}
{
  const st = fakeState(true);
  const g = new DispatchGateDO(st);
  const first = await post(g, "/claim", { fingerprint: "aa", window_ms: W, now: 1000 });
  const blocked = await post(g, "/claim", { fingerprint: "aa", window_ms: W, now: 1100 });
  t("続けて叩いたら二本目は止まる", first.granted && !blocked.granted);

  const rel = await post(g, "/release", { token: first.token });
  t("自分の札なら印を消せる", rel.released === true, JSON.stringify(rel));
  const after = await post(g, "/claim", { fingerprint: "aa", window_ms: W, now: 1200 });
  t("消した後は通る (失敗した合図で次を塞がん)", after.granted);

  const stale = await post(g, "/release", { token: first.token });
  t("古い札では消せん", stale.released === false && stale.reason === "not-mine", JSON.stringify(stale));
  t("古い札で叩いた後も、今の印は残っとる", (await st.storage.get("mark")) !== undefined);
  t("札が無ければ消せん", (await post(g, "/release", {})).released === false);
}
{
  const st = fakeState(true);
  const g = new DispatchGateDO(st);
  t("知らん道は 404", (await g.fetch(new Request("https://x/other", { method: "POST", body: "{}" }))).status === 404);
  t("GET は 404", (await g.fetch(new Request("https://x/claim"))).status === 404);
  const r = await g.fetch(new Request("https://x/claim", { method: "POST", body: "{" }));
  t("壊れた JSON は 400", r.status === 400);
}

/* ---------------------------------------------- 4. worker 側の口 */
{
  const c = await claimDispatch({}, "s1", "aa", W, 1000);
  t("関所が繋がっとらんかったら通さん", c.granted === false && c.reason === "dispatch-gate-unbound",
    JSON.stringify(c));
  t("その時は理由を書いて返す", typeof c.note === "string" && c.note.includes("DISPATCH_DO"));
  t("繋がっとらん時に取り消しを呼んでも何も起きん",
    (await releaseDispatch({}, "s1", "tok")).released === false);
}
{
  // env.DISPATCH_DO を偽物で立てて、店ごとに別の DO に行くことを見る。
  const made = new Map();
  const env = {
    DISPATCH_DO: {
      idFromName: (n) => n,
      get: (id) => {
        if (!made.has(id)) made.set(id, new DispatchGateDO(fakeState(true)));
        return { fetch: (u, init) => made.get(id).fetch(new Request(u, init)) };
      },
    },
  };
  const a = await claimDispatch(env, "s1", "aa", W, 1000);
  const b = await claimDispatch(env, "s2", "aa", W, 1000);
  const c = await claimDispatch(env, "s1", "aa", W, 1100);
  t("別の店は互いに邪魔せん", a.granted && b.granted, JSON.stringify([a.granted, b.granted]));
  t("同じ店の二本目は止まる", c.granted === false);
  t("店ごとに別の DO を引いとる", made.size === 2 && [...made.keys()].every((k) => k.startsWith("dispatch:")),
    [...made.keys()].join(","));
}

console.log("");
console.log("覆っとらんもの: 本物の Cloudflare の DO そのもの。ここで回しとるんは偽の state や。");
console.log("               本物が blockConcurrencyWhile を約束どおりに動かすことは、ここでは測れん。");
console.log("               測れるんは「その約束の上で、この規則が閉じとるか」だけや。");
console.log("");
console.log("=== " + pass + " / " + (pass + fail) + (fail ? " 不合格あり" : " 合格")
  + " (生成の合図の関所) ===");
process.exit(fail ? 1 : 0);
