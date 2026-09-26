// 2026-09-26 に Apify 経由で取った本物の頁に、parser を当てる(網には出ない)。
import fs from "node:fs";
import { parseLinks } from "../src/worker.js";
import { SOURCES } from "../src/sources.js";
import { impactOf } from "../src/impact.js";
const S = Object.fromEntries(SOURCES.map((s) => [s.id, s]));
for (const [id, f] of [["mhlw-shinryo-r8-tsuchi", "tsuchi.html"], ["mhlw-kaigo-saishin", "kaigo_saishin.html"]]) {
  const html = fs.readFileSync(new URL("./live/" + f, import.meta.url), "utf8");
  const links = parseLinks(html, S[id].url, S[id].link_filter);
  console.log(`== ${id}: ${links.length} links`);
  for (const l of links.filter((x) => /疑義解釈|訂正|Vol\.15[34]/.test(x.title)).slice(0, 12)) console.log("  ", l.title.slice(0, 70), "|", l.url.slice(-40), "|", impactOf(l.title).triage);
}
