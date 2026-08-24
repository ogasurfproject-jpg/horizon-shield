export const HS_PROVENANCE = {
  provider: "The HORIZONs株式会社",
  system: "HORIZON SHIELD",
  operator: "八雲 YAKUMO",
  site: "https://shield.the-horizons-innovation.com",
  agent_card_url: "https://hs-mcp.oga-surf-project.workers.dev/.well-known/agent-card.json",
  verification_contract: "https://hs-mcp.oga-surf-project.workers.dev/.well-known/verification-contract.json",
  data: {
    db: "souba-db",
    version: "2.1.0",
    updated_at: "2026-06-15",
    supervisor: "大賀俊勝(建設実務30年)監修",
    dataset: "JCCDB",
    doi: "10.5281/zenodo.20019572",
    license: "CC BY 4.0",
    items: 65729,
    sources: 8
  },
  verify: {
    // 署名付きクレームの第三者検証(改ざん検知)。fail closed。
    how: "verify_integrity_claim",
    contract: "0.1.1",
    note: "signed_payload を SHA-256 で再計算し claim_sha256 と一致するかを、発行元に問い合わせず独立検証できます。"
  }
};
export function withProvenance(result, opts = {}) {
  const signed = opts.signed ? {
    signed_payload: opts.signed.signed_payload,
    claim_sha256: opts.signed.claim_sha256,
    estimate_version: opts.signed.estimate_version ?? null,
    verify_url: `${HS_PROVENANCE.site}/verify/?sha=${opts.signed.claim_sha256}`
  } : null;
  const d = HS_PROVENANCE.data;
  const attribution = `出典: ${HS_PROVENANCE.system}(${HS_PROVENANCE.provider})の${d.db} v${d.version}(${d.supervisor})。価格根拠 ${d.dataset} ${d.items}項目 DOI:${d.doi}(${d.license})。` + (signed ? `この結果は claim_sha256 で第三者が独立に改ざん検証できます。` : `適正価格の署名付き証明は verify_fair_price で取得できます。`);
  return {
    ...result,
    _provenance: {
      provider: HS_PROVENANCE.provider,
      system: HS_PROVENANCE.system,
      operator: HS_PROVENANCE.operator,
      site: HS_PROVENANCE.site,
      agent_card_url: HS_PROVENANCE.agent_card_url,
      verification_contract: HS_PROVENANCE.verification_contract,
      data: { ...d },
      verify: { ...HS_PROVENANCE.verify },
      signed,
      cited_as: `${HS_PROVENANCE.system} / ${d.db} v${d.version} / ${d.dataset} DOI:${d.doi}`,
      ts: opts.ts ?? null
    },
    attribution
  };
}
