// test_do.mjs: a stand-in for the Durable Object runtime in the door's tests, over node:sqlite (Node 22.13 and later).
// It gives what RefundDoorDO uses: state.storage.sql.exec(query, ...bindings) with toArray(), BLOBs bound and read as
// ArrayBuffer, state.storage.transactionSync(fn) (all of fn or nothing), blockConcurrencyWhile (one at a time), and a
// namespace with idFromName/get whose stubs call fetch on one instance per name.
//
// Faults for the tests: failTransaction(n) makes the n-th transactionSync from now run its function and then fail
// before the commit, so that everything it wrote is rolled back.
export async function stand_in() {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  const bind = (b) => b.map((v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v));
  const rowOut = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Uint8Array ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v]));
  const sql = {
    exec(q, ...b) {
      const st = db.prepare(q);
      if (/^\s*SELECT/i.test(q)) { const rows = st.all(...bind(b)).map(rowOut); return { toArray: () => rows }; }
      st.run(...bind(b));
      return { toArray: () => [] };
    },
  };
  let txCount = 0, failAt = 0;
  const storage = {
    sql,
    transactionSync(fn) {
      txCount++;
      db.exec("BEGIN");
      try {
        const v = fn();
        if (failAt && txCount === failAt) { failAt = 0; throw new Error("stand-in: this transaction fails before its commit"); }
        db.exec("COMMIT");
        return v;
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
  let chain = Promise.resolve();
  const state = {
    storage,
    blockConcurrencyWhile(fn) { const p = chain.then(fn); chain = p.catch(() => {}); return p; },
  };
  return {
    state, db,
    failTransaction(n) { failAt = txCount + n; },
    count: (table) => Number(db.prepare("SELECT COUNT(*) AS n FROM " + table).get().n),
    namespace(DOClass, env) {
      let inst = null;
      return {
        idFromName: (n) => n,
        get: () => ({ fetch: async (u, init) => { inst ||= new DOClass(state, env); return inst.fetch(new Request(u, init)); } }),
      };
    },
  };
}
