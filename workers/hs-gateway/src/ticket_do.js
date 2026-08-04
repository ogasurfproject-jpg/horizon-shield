// ticket_do.js
// チケット台帳の Durable Object。金勘定は強整合でしか正しく扱えない。
// KV(結果整合)だと「読む→引く→書く」の間に別リクエストが割り込み、二重使用が起きる。
// DO は単一スレッドで直列化されるので、減算がアトミックになる。二重使用が原理的に起きない。
// hs-webmcp が StatsDO で使っているのと同じ手法。生態系と揃える。
//
// この1個の DO(idFromName("v1"))が全店の残高台帳を持つ。SQLite で:
//   bal(store TEXT PK, tickets INTEGER)                     店ごとの残高
//   seen(kind TEXT, ref TEXT, store TEXT, delta INTEGER,    冪等ログ(grant/spend/refundを一意keyで記録)
//        at TEXT, PK(kind, ref))
// 総額(前払式モニタリング用)は SUM(tickets) を都度算出。台帳が単一の真実源。
//
// 4つの穴を塞ぐ:
//   (1) レース: DO直列化でアトミック。
//   (2) 二重課金: spend は reqId で冪等。同じ reqId の2回目は「前回の結果」を返すだけで引かない。
//   (3) チャージ入口: grant は evtId で冪等。実決済Webからは署名検証後にのみ呼ぶ(器)。
//   (4) ロールバック: refund で減算を戻す。reqId 単位で、二重返金も冪等に防ぐ。

export class TicketLedgerDO {
  constructor(state, env) {
    this.sql = state.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS bal (store TEXT PRIMARY KEY, tickets INTEGER NOT NULL DEFAULT 0)"
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS seen (kind TEXT NOT NULL, ref TEXT NOT NULL, store TEXT NOT NULL, delta INTEGER NOT NULL, at TEXT NOT NULL, PRIMARY KEY (kind, ref))"
    );
  }

  _bal(store) {
    const r = this.sql.exec("SELECT tickets FROM bal WHERE store = ?", store).toArray();
    return r.length ? Number(r[0].tickets) : 0;
  }

  _setBal(store, n) {
    this.sql.exec(
      "INSERT INTO bal (store, tickets) VALUES (?, ?) ON CONFLICT (store) DO UPDATE SET tickets = ?",
      store, n, n
    );
  }

  _seen(kind, ref) {
    if (!ref) return null;
    const r = this.sql.exec("SELECT store, delta, at FROM seen WHERE kind = ? AND ref = ?", kind, ref).toArray();
    return r.length ? r[0] : null;
  }

  _remember(kind, ref, store, delta) {
    if (!ref) return;
    this.sql.exec(
      "INSERT OR IGNORE INTO seen (kind, ref, store, delta, at) VALUES (?, ?, ?, ?, ?)",
      kind, ref, store, delta, new Date().toISOString()
    );
  }

  _totalYen(yenPerTicket) {
    const r = this.sql.exec("SELECT COALESCE(SUM(tickets),0) AS s FROM bal").toArray();
    const tickets = r.length ? Number(r[0].s) : 0;
    return tickets * yenPerTicket;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    let body = {};
    if (request.method === "POST") { try { body = await request.json(); } catch (e) { body = {}; } }
    const store = String(body.store || url.searchParams.get("store") || "").slice(0, 40);
    const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } });

    try {
      // 残高照会(強整合)
      if (path === "/balance") {
        return J({ ok: true, store, balance: this._bal(store) });
      }

      // チャージ(冪等 by evtId)。実決済からは署名検証後にのみ呼ぶ器。
      if (path === "/grant") {
        const add = Math.floor(Number(body.tickets));
        const evtId = String(body.evt_id || "");
        if (!store || !Number.isFinite(add) || add <= 0) return J({ ok: false, reason: "bad_input" }, 400);
        const prev = this._seen("grant", evtId);
        if (prev) return J({ ok: true, dedup: true, balance: this._bal(store) }); // 二重加算しない
        const before = this._bal(store);
        const after = before + add;
        this._setBal(store, after);
        this._remember("grant", evtId, store, add);
        return J({ ok: true, balance_before: before, balance_after: after, granted: add });
      }

      // 減算(冪等 by reqId)。残高不足はアトミックに拒否。
      if (path === "/spend") {
        const need = Math.max(1, Math.floor(Number(body.price) || 1));
        const reqId = String(body.req_id || "");
        if (!store) return J({ ok: false, reason: "no_store" }, 400);
        const prev = this._seen("spend", reqId);
        if (prev) {
          // 同じ reqId の2回目: 前回引いた事実を返すだけ。二重には引かない。
          return J({ ok: true, dedup: true, spent: -Number(prev.delta), balance: this._bal(store) });
        }
        const before = this._bal(store);
        if (before < need) return J({ ok: false, reason: "insufficient_balance", need, balance: before }, 200);
        const after = before - need;
        this._setBal(store, after);
        this._remember("spend", reqId, store, -need);
        return J({ ok: true, spent: need, balance_before: before, balance_after: after });
      }

      // 返金/ロールバック(冪等 by reqId)。減算した reqId を指定して戻す。
      // 台帳追記が失敗したとき等に「金だけ引かれた」状態を解消する。
      if (path === "/refund") {
        const reqId = String(body.req_id || "");
        if (!store || !reqId) return J({ ok: false, reason: "bad_input" }, 400);
        const sp = this._seen("spend", reqId);
        if (!sp) return J({ ok: false, reason: "no_such_spend" }, 200); // 引いてないものは戻せない
        const already = this._seen("refund", reqId);
        if (already) return J({ ok: true, dedup: true, balance: this._bal(store) }); // 二重返金しない
        const giveBack = -Number(sp.delta); // spend の delta は負。戻す量は正。
        const before = this._bal(store);
        const after = before + giveBack;
        this._setBal(store, after);
        this._remember("refund", reqId, store, giveBack);
        return J({ ok: true, refunded: giveBack, balance_before: before, balance_after: after });
      }

      // 前払式残高モニタリング: 全店未使用残高の総額(円)を台帳から直接集計。
      if (path === "/prepaid") {
        const yenPerTicket = Math.max(1, Math.floor(Number(url.searchParams.get("yen")) || 100));
        const threshold = Math.max(1, Math.floor(Number(url.searchParams.get("threshold")) || 10000000));
        const totalYen = this._totalYen(yenPerTicket);
        const ratio = totalYen / threshold;
        let level = "ok";
        if (totalYen >= threshold) level = "over_threshold";
        else if (ratio >= 0.8) level = "approaching";
        return J({ ok: true, total_unused_balance_yen: totalYen, threshold_yen: threshold, ratio: Number(ratio.toFixed(4)), level });
      }

      return J({ ok: false, reason: "not_found" }, 404);
    } catch (e) {
      return J({ ok: false, reason: "do_error", detail: String(e && e.message || e) }, 500);
    }
  }
}
