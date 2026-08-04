// router.js
// 業種横断の上位ルーティング。設計図第2章の「Gateway がどの業種ディレクトリに向けるか」を決める層。
// hs-webmcp の askRoute の「一段上」。役割分担を厳守する:
//   - この router: 「どの業種か」だけ決める(construction / realestate / ...)。業種内の中身は判定しない。
//   - hs-webmcp の askRoute: 建設業種の"中"で emergency/dispute/audit/... へ振り分ける(既に完成)。
// 二重管理しない。Gateway は「建設宛て」と決めたら hs-webmcp に丸投げし、中の7方向判定は任せる。
//
// 検証可能性の前提: LLM を使わず決定的キーワードで判定する。同じ入力は必ず同じ業種に行く。
// hs-webmcp が「Routing is a deterministic keyword table, not an LLM」を貫いているのと同じ思想で揃える。

import { liveDirectories } from "./registry.js";

// 判定結果:
//   { vertical: "construction", matched: [...ヒットした語] }        振り分け成功
//   { vertical: null, reason: "ambiguous", candidates: [...] }      複数業種にヒット(=聞き直す)
//   { vertical: null, reason: "no_match" }                          どの業種にも当たらない(=業種一覧を返す)
//
// 番人の設計判断: 複数業種にまたがったら、勝手にどちらかへ倒さない。ambiguous を返して人に選ばせる。
// hs-webmcp が工事名の曖昧一致で ambiguous を返して判定を保留するのと同じ慎重さで揃える。
// 「当てずっぽうで業種を決めた振り分け」は検証可能性の毒。

function normalize(s) {
  return String(s == null ? "" : s);
}

function routeVertical(ask) {
  var a = normalize(ask);
  if (!a.trim()) return { vertical: null, reason: "empty" };

  var dirs = liveDirectories();
  var hits = [];

  for (var i = 0; i < dirs.length; i++) {
    var d = dirs[i];
    var matched = [];
    var hints = d.route_hints || [];
    for (var j = 0; j < hints.length; j++) {
      if (a.indexOf(hints[j]) > -1) matched.push(hints[j]);
    }
    if (matched.length > 0) hits.push({ vertical: d.id, matched: matched });
  }

  if (hits.length === 0) {
    return { vertical: null, reason: "no_match" };
  }
  if (hits.length === 1) {
    return { vertical: hits[0].vertical, matched: hits[0].matched };
  }

  // 複数業種にヒット。件数が最多の業種が単独で突出しているなら、それを採る。
  // 同数で並んだら ambiguous(人に選ばせる)。当てずっぽうで倒さない。
  hits.sort(function (x, y) { return y.matched.length - x.matched.length; });
  if (hits[0].matched.length > hits[1].matched.length) {
    return { vertical: hits[0].vertical, matched: hits[0].matched };
  }
  return {
    vertical: null,
    reason: "ambiguous",
    candidates: hits.map(function (h) { return h.vertical; })
  };
}

export { routeVertical };
