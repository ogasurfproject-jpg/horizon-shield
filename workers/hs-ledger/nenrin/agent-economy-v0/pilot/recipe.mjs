// recipe.mjs  agent-economy-v1 の確定レシピ (SPEC_v1)。純関数・決定的。
// 証拠 (すべて beneficial-owner id) から splits を出す。
//   execute = 残余 (10000 - connect - operate)。必ず doer が大半、E10 は残余で自動成立。
//   operate = 300 bps (Yakumo)。operate_to が居る時だけ。
//   connect = プール 500 bps を N=2 スロットに割る。初回接触=満額、繰り返しは半減で 0 へ (G4 anti-downline)。
//     減った分・空きスロット・同一 principal の hop は connector やなく execute に戻る (doer に寄せる、水増し無効)。
// verify は split の外 (job 開始時の escrow、W2)。ここには含めん。
export const RECIPE = { recipe_id: "agent-economy-recipe-v1", operate_bps: 300, connect_pool_bps: 500, connect_max_hops: 2 };

const decayWeight = (priorCount) => 1 / Math.pow(2, Math.max(0, priorCount | 0));

export function computeSplits(evidence, recipe = RECIPE) {
  const { executor, operate_to = null, connect_hops = [] } = evidence || {};
  if (!executor) throw new Error("executor required");
  const slot = Math.floor(recipe.connect_pool_bps / recipe.connect_max_hops);
  const splits = [];
  let connectTotal = 0;
  for (const h of connect_hops.slice(0, recipe.connect_max_hops)) {
    if (!h || !h.connector || h.connector === executor) continue;
    const share = Math.floor(slot * decayWeight(h.prior_count || 0));
    if (share > 0) { splits.push({ agent_id: h.connector, role: "connect", share_bps: share }); connectTotal += share; }
  }
  const operate = operate_to ? recipe.operate_bps : 0;
  if (operate > 0) splits.push({ agent_id: operate_to, role: "operate", share_bps: operate });
  const execute = 10000 - connectTotal - operate;
  splits.unshift({ agent_id: executor, role: "execute", share_bps: execute });
  return { splits, sum_bps: splits.reduce((a, s) => a + s.share_bps, 0), execute_bps: execute, connect_bps: connectTotal, operate_bps: operate };
}
