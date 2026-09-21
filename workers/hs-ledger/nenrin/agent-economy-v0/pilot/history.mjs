// history.mjs  過去の成立 RDA から G4 の prior_count と G6 の aggregate governor を出す。
// G6 の pilot 版: principal の connect 累計は (execute 累計 + 猶予 1 プール) を超えられん。純関数の索引。
import { RECIPE } from "./recipe.mjs";
const GRACE_BPS = RECIPE.connect_pool_bps; // 初回の connector を潰さんための猶予 (1 タスク分のプール)

export function makeHistory(settled = []) {
  const rdas = settled.slice();
  const hasRole = (r, role, id) => (r.splits || []).some((s) => s.role === role && s.agent_id === id);
  // G4: この connector -> executor の組で過去に成立した RDA の数。
  const priorCount = (connector, executor) => rdas.filter((r) => hasRole(r, "connect", connector) && hasRole(r, "execute", executor)).length;
  const totals = (principal) => {
    let connect = 0, execute = 0;
    for (const r of rdas) for (const s of (r.splits || [])) {
      if (s.agent_id !== principal) continue;
      if (s.role === "connect") connect += s.share_bps;
      if (s.role === "execute") execute += s.share_bps;
    }
    return { connect, execute };
  };
  // G6: この connect を足すと connect 累計が execute 累計 + 猶予 を超えるか。
  const wouldExceedConnectCap = (principal, addBps) => { const t = totals(principal); return (t.connect + addBps) > (t.execute + GRACE_BPS); };
  return { priorCount, totals, wouldExceedConnectCap, record: (rda) => rdas.push(rda), size: () => rdas.length };
}
