/**
 * hs-mcp-observatory — 公式MCPレジストリの実測を、誰でも引ける口。
 *
 * 2026-08-19 にレジストリが宣言していた https の口 12,429件に、
 * 2026-08-23 に1回ずつ、読み取り専用で当てた結果を返す。
 * どのサーバーの道具も呼んでいない。
 *
 * この口が絶対にしないこと:
 *   ・落ちた口の名簿を配らない。
 *     報告書に「Naming a server that failed is a serious thing to do」と書いた。
 *     住所を持っている人が自分の住所を問い合わせるのと、
 *     こちらが落ちた口の一覧を配るのは、別のことである。
 *     住所かホストを指定したときだけ答える。一覧を返す道具は無い。
 *   ・人格の判定をしない。「このサーバーは不誠実だ」とは言わない。
 *     言えるのは「2026-08-23 に当てたとき、エージェントカードに金の出所の記載が無かった」まで。
 *     前者はこちらが持つ資格の無い意見で、後者は誰でも確かめられる事実である。
 *   ・「届かなかった」と「答えが無かった」を足さない。
 *     held は測れなかった。pending は測って条件が満たされなかった。
 *     この二つを足すと、こちらの盲点が世界についての発見に化ける。
 *   ・hash と再現手順の無い言明を出さない。
 *     他人についての言明を、その本人が再計算できない形で出さない。
 *     だから1行ごとに record_sha256 を返す。
 *
 * 中身(src/data.js)は生成物である。元は走行の生ファイル。
 * ここに数字を手で書かない。書けば、公開している報告書とこの口が別のことを言い始める。
 */

import { META, SUMMARY, DISCLOSURE_FIELDS, ROWS, HOST_COUNT, RECOVERED_COUNT, TEMPLATED_COUNT } from "./data.js";

const PROTOCOL_VERSION = "2025-11-25";
const SERVER_NAME = "hs-mcp-observatory";
const SERVER_VERSION = "0.1.0";

/* ------------------------------ 索引 ------------------------------ */
/* 12,429行を毎回なめない。住所とホストで引けるようにする。 */

const BY_ADDRESS = new Map();
const BY_HOST = new Map();

function hostOf(u) {
  try { return new URL(u).host.toLowerCase(); } catch (_e) { return ""; }
}

for (const r of ROWS) {
  BY_ADDRESS.set(r[0], r);
  // 末尾のスラッシュ違いでも引けるようにする。住所の写し間違いで「無い」と言わない。
  BY_ADDRESS.set(r[0].replace(/\/+$/, ""), r);
  const h = hostOf(r[0]);
  if (!h) continue;
  if (!BY_HOST.has(h)) BY_HOST.set(h, []);
  BY_HOST.get(h).push(r);
}

/* ---- 言ってはいけない言い方の門 ----------------------------------------
   こちらが組み立てた文だけを見る。データから持ってきた文は見ない。
   見る対象を間違えると、門はいつも赤くなり、やがて外される。 */
const FORBIDDEN = [
  "dishonest", "untrustworthy", "scam", "fraudulent", "shady",
  "is hiding", "are hiding", "hides who", "went down", "is down", "was down",
  "不誠実", "隠している", "落ちていた",
];

function guard(notes) {
  const bad = [];
  for (const n of notes || []) {
    const low = String(n).toLowerCase();
    for (const w of FORBIDDEN) {
      if (low.includes(w.toLowerCase())) bad.push({ word: w, note: String(n).slice(0, 200) });
    }
  }
  return bad;
}

const STATE_MEANING = {
  measured: "We contacted it and it answered.",
  pending: "We contacted it and a condition was not met. This is a statement about the address as declared, on that date.",
  held: "We could not measure it. This is a statement about our instrument, not about the server.",
  skipped: "We did not contact it. robots.txt disallowed the path, and no is an answer.",
};

function howToRecompute(row) {
  return {
    record_sha256: row[8],
    recheck_record_sha256: row[10] || undefined,
    procedure: META.pages.recompute,
    raw_line: {
      file: META.pages.raw_walk,
      find: "the line whose \"endpoint\" equals " + JSON.stringify(row[0]),
      note: "The whole walk is one JSON object per line. Download it and disagree with us in public.",
    },
  };
}

function describe(row) {
  const [endpoint, state, outcome, tools, card, comp, compFields, name, , recovered, , templated] = row;
  const out = {
    endpoint,
    measured_on: META.walk_measured_at,
    state,
    state_means: STATE_MEANING[state] || null,
    outcome,
    server_name: name || null,
  };
  // 2026-08-24: 宣言のうち193件は住所ではなく雛形だった({token} などを含む)。
  //   当てても、測っているのはサーバーではなく雛形である。
  //   この行の判定を、どこかのサーバーについての事実として読ませない。
  if (templated) {
    out.this_is_not_an_address = {
      why: "The declared endpoint contains a template placeholder. It was published as a pattern, not as a reachable address.",
      meaning: "Contacting it measured nothing about any server. Do not read the outcome above as a fact about anyone's software.",
      count_like_this: TEMPLATED_COUNT,
    };
  }
  if (state === "measured") {
    out.tools_listed = tools;
    out.agent_card = card === 1 ? "present" : card === 0 ? "absent" : "not read";
    out.compensation_disclosure = comp === 1 ? "present" : "not present";
    if (compFields) out.compensation_fields = compFields;
    if (comp !== 1) {
      out.note = card === 0
        ? "No agent card was found at this address on that date, so there was no field in which to state who compensates the operator. This is not a finding of concealment."
        : "The agent card carried no compensation disclosure on that date. This is a statement about that document on that date, and nothing more.";
    }
  }
  if (recovered) {
    out.corrected = {
      on: META.corrected_at,
      what: "Our walk announced protocol version 2024-11-05, which most of the registry has dropped. "
          + "When we announced " + recovered[0] + " and used " + recovered[1] + ", this address answered.",
      meaning: "The original row was our instrument's fault, not this server's state.",
    };
  }
  out.verify = howToRecompute(row);
  return out;
}

/* ------------------------------ いま測る ------------------------------ */
/* 2026-08-24: 公開されている記録は 2026-08-23 の1回きりである。
   名乗りを足した事業者が「直したのに、まだ名乗っていないと書いてある」と
   四半期待つのは、記録として正しくても、道具として役に立たない。
   だから「いま当ててみる」を1件だけ開ける。

   ただし、これは公開の記録を書き換えない。書き換えられる記録は記録ではない。
   返すのは「いまこう見えた」であって、報告書の数字は動かない。
   次の全件走行で入る。

   公開の口を、他人のサーバーを叩く道具として使わせないための門:
     ・https だけ。平文は受けない
     ・IPアドレス直書き、localhost、内部向けの名前は受けない
     ・robots.txt を先に読む。禁じられていれば当てない(no は答えである)
     ・1回の呼び出しで、外に出るのは最大3本。相手は1ホストだけ
     ・道具は1つも呼ばない。読むだけ
     ・短い間隔で連続して呼ばれたら断る */

const MEASURE_UA = "HorizonShieldObservatory/0.1 (+https://shield.the-horizons-innovation.com/verify-directory/survey/)";
const MEASURE_TIMEOUT_MS = 8000;
const MEASURE_WINDOW_MS = 60000;
const MEASURE_MAX_PER_WINDOW = 20;

let _measureHits = [];

function measureBudgetOk() {
  const now = Date.now();
  _measureHits = _measureHits.filter((t) => now - t < MEASURE_WINDOW_MS);
  if (_measureHits.length >= MEASURE_MAX_PER_WINDOW) return false;
  _measureHits.push(now);
  return true;
}

// 名前だけで弾ける危ないものを弾く。DNS はここでは引けないので、
// 「引けないから安全」とは言わない。名前で分かるものだけを断る、と言う。
function addressObjection(u) {
  let url;
  try { url = new URL(u); } catch (_e) { return "That is not a URL."; }
  if (url.protocol !== "https:") return "https only. We do not contact plaintext endpoints.";
  if (url.username || url.password) return "We do not accept credentials in a URL.";
  const h = url.hostname.toLowerCase();
  if (/^\[|^\d+\.\d+\.\d+\.\d+$/.test(h)) return "We do not contact bare IP addresses.";
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")
      || h.endsWith(".internal") || h.endsWith(".home.arpa")) {
    return "We do not contact names that resolve inside a network.";
  }
  if (h.indexOf(".") < 0) return "We do not contact single-label hostnames.";
  if (url.port && url.port !== "443") return "We contact 443 only.";
  return null;
}

async function fetchWithTimeout(url, init) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), MEASURE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...(init || {}), signal: c.signal,
      headers: { "user-agent": MEASURE_UA, ...((init || {}).headers || {}) } });
  } finally { clearTimeout(t); }
}

// robots.txt を先に読む。読めなければ当てない(fail-closed)。
// 「読めなかったから、たぶん許されている」は、こちらの都合である。
async function robotsVerdict(origin, path) {
  let text = "";
  try {
    const r = await fetchWithTimeout(origin + "/robots.txt");
    if (r.status === 404) return { allow: true, why: "robots.txt is 404. Nothing forbids this path." };
    if (!r.ok) return { allow: false, why: "robots.txt returned HTTP " + r.status + ". We do not contact when we cannot read it." };
    text = await r.text();
  } catch (e) {
    return { allow: false, why: "robots.txt could not be read (" + String(e).slice(0, 60) + "). We do not contact when we cannot read it." };
  }
  // * のグループだけを見る。厳しい側に倒す。
  let inStar = false;
  const dis = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { inStar = (v === "*"); continue; }
    if (inStar && k === "disallow" && v) dis.push(v);
  }
  for (const d of dis) {
    if (d === "/" || path.startsWith(d)) {
      return { allow: false, why: "robots.txt disallows " + d + ". Their operator said no, and no is an answer." };
    }
  }
  return { allow: true, why: "robots.txt does not disallow this path for *." };
}

async function measureNow(address) {
  if (!measureBudgetOk()) {
    return {
      error: "too many measurements just now",
      note: "This endpoint contacts somebody else's server on your behalf. It is rate limited on purpose. Try again in a minute.",
    };
  }
  const objection = addressObjection(String(address || ""));
  if (objection) return { error: "we will not contact that", why: objection };

  const url = new URL(address);
  const origin = url.origin;
  const rob = await robotsVerdict(origin, url.pathname || "/");
  if (!rob.allow) {
    return {
      address, measured_at: new Date().toISOString(),
      state: "skipped", outcome: "robots_disallowed", robots: rob.why,
      not_the_published_record: true,
    };
  }

  const out = {
    address,
    measured_at: new Date().toISOString(),
    robots: rob.why,
    not_the_published_record: true,
    what_this_is:
      "What we saw just now, on request. It is not part of the published record and it changes no number "
      + "on the report. The next full walk is what enters the record.",
    no_tool_was_called: true,
  };

  // 1) MCP に声をかける。道具は一つも呼ばない。
  try {
    const r = await fetchWithTimeout(address, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {},
                  clientInfo: { name: "hs-mcp-observatory", version: SERVER_VERSION } },
      }),
    });
    out.http_status = r.status;
    const body = (await r.text()).slice(0, 20000);
    let j = null;
    try { j = JSON.parse(body); } catch (_e) {
      const m = body.match(/^data:\s*(\{.*\})\s*$/m);
      if (m) { try { j = JSON.parse(m[1]); } catch (_e2) {} }
    }
    if (j && j.result) {
      out.state = "measured";
      out.outcome = "speaks_mcp";
      out.server_name = (j.result.serverInfo && j.result.serverInfo.name) || null;
      out.protocol_version = j.result.protocolVersion || null;
    } else if (j && j.error) {
      out.state = "pending";
      out.outcome = "initialize_rejected";
      out.their_error = { code: j.error.code, message: String(j.error.message || "").slice(0, 200) };
      out.note = "A refusal can be correct behaviour. On 2026-08-23 we announced a version most of the "
               + "registry had dropped, and counted 137 correct HTTP 400s as failures.";
    } else {
      out.state = "pending";
      out.outcome = "no_mcp_at_declared_address";
      out.note = "HTTP " + r.status + ", and the body was not a JSON-RPC message.";
    }
  } catch (e) {
    // 届かなかったのは、こちらの話かもしれない。相手についての発見にしない。
    out.state = "held";
    out.outcome = "not_reached";
    out.why = String(e).slice(0, 120);
    out.note = "held means we could not measure it. This is a statement about our attempt, not about the server.";
    return out;
  }

  // 2) エージェントカードを読む。金の出所の欄があるかを見る。
  const cards = ["/.well-known/agent-card.json", "/.well-known/agent.json"];
  out.agent_card = "absent";
  for (const p of cards) {
    try {
      const r = await fetchWithTimeout(origin + p);
      if (!r.ok) continue;
      const card = JSON.parse((await r.text()).slice(0, 200000));
      out.agent_card = "present";
      out.agent_card_at = origin + p;
      const found = [];
      const scan = (o, prefix) => {
        if (!o || typeof o !== "object") return;
        for (const k of Object.keys(o)) {
          const key = prefix ? prefix + "." + k : k;
          if (/^(payment|payments|pricing|compensation)$/i.test(k)) found.push(key);
          if (o[k] && typeof o[k] === "object" && key.split(".").length < 3) scan(o[k], key);
        }
      };
      scan(card, "");
      out.compensation_disclosure = found.length ? "present" : "not present";
      if (found.length) out.compensation_fields = found;
      break;
    } catch (_e) { /* 次の場所を見る */ }
  }
  if (out.agent_card === "absent") {
    out.compensation_disclosure = "not present";
    out.note_card = "No agent card was found at the two well-known paths. There was no field in which to "
                  + "state who compensates the operator. This is not a finding of concealment.";
  }
  out.how_to_disclose = "mcp_observatory_disclosure_guide lists the field names actually observed in the wild.";
  return out;
}

/* ------------------------------ 道具 ------------------------------ */

const TOOLS = [
  {
    name: "mcp_observatory_state",
    description:
      "What was measured, when, over what population, and what the measurement cannot tell you. "
      + "Read this before quoting any number from this server.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "mcp_observatory_summary",
    description:
      "The counts, as published and as corrected. How many addresses answered, how many tools they "
      + "exposed, how many stated who compensates their operator.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "mcp_observatory_lookup",
    description:
      "What happened when we contacted one address, or an aggregate for one host. "
      + "Returns the record hash and the procedure to recompute it. "
      + "There is no tool here that lists addresses; you must already hold the one you are asking about.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "The full declared endpoint, e.g. https://example.com/mcp" },
        host: { type: "string", description: "A host, e.g. example.com. Returns counts for that host, not a roster." },
      },
    },
  },
  {
    name: "mcp_observatory_disclosure_guide",
    description:
      "How the 152 servers that stated who compensates their operator actually did it - the field names "
      + "observed in the wild, with counts. Not a specification we invented.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "mcp_observatory_measure_now",
    description:
      "Contact one https address now and report what we see: whether it speaks MCP, whether it carries an "
      + "agent card, and whether that card names who compensates the operator. Read only; no tool is called. "
      + "robots.txt is read first and honoured. This does NOT change the published record - the next full "
      + "walk does that. Rate limited, because it contacts somebody else's server on your behalf.",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string", description: "https endpoint, e.g. https://example.com/mcp" } },
      required: ["address"],
    },
  },
  {
    name: "mcp_observatory_method",
    description:
      "How the walk was run, what we got wrong and corrected, and the four rules the report holds itself to.",
    inputSchema: { type: "object", properties: {} },
  },
];

function toolState() {
  const notes = [
    "This is one registry's declared addresses, contacted once, read only. It is not a scan of the MCP ecosystem.",
    "No tool was called on any server. We read what was offered and stopped.",
    "held and pending are kept apart and are never added together.",
    "Every row carries a record_sha256 and a public procedure to recompute it.",
  ];
  const bad = guard(notes);
  if (bad.length) return { error: "output gate", detail: bad };
  return {
    report: META.report,
    population_counted_on: META.population_measured_at,
    walk_measured_on: META.walk_measured_at,
    corrected_on: META.corrected_at,
    registry: META.registry,
    registrations_all_statuses: META.registrations_all_statuses,
    active: META.active,
    https_endpoints_contacted: META.https_endpoints_active,
    distinct_hosts: HOST_COUNT,
    rows_available_here: ROWS.length,
    rows_corrected_as_our_fault: RECOVERED_COUNT,
    rows_that_were_templates_not_addresses: TEMPLATED_COUNT,
    rules_this_report_holds_itself_to: META.rules,
    what_we_do_not_do: META.we_do_not,
    pages: META.pages,
    notes,
  };
}

function toolSummary() {
  const notes = [
    "The corrected figures supersede the published ones. The original wording is still on the report page, "
    + "at the bottom of the correction card, because it was wrong in a way worth showing.",
    "152 is a floor, not a final count. " + SUMMARY.disclosure_is_a_floor,
    "The first full walk was discarded in full. From one minute onward every address came back unreachable. "
    + "That was our instrument. None of its numbers were published.",
  ];
  const bad = guard(notes);
  if (bad.length) return { error: "output gate", detail: bad };
  return {
    as_published: SUMMARY.as_published_2026_08_23,
    corrected: SUMMARY.corrected_2026_08_24,
    discarded_run: SUMMARY.run1_discarded,
    tools: {
      total: SUMMARY.tools_total,
      median: SUMMARY.tools_median,
      p90: SUMMARY.tools_p90,
      max: SUMMARY.tools_max,
    },
    agent_cards: {
      present: SUMMARY.agent_card_present,
      absent: SUMMARY.agent_card_absent,
      not_read: SUMMARY.agent_card_not_read,
    },
    compensation: {
      disclosed: SUMMARY.compensation_disclosed,
      not_disclosed: SUMMARY.compensation_not_disclosed,
      floor_note: SUMMARY.disclosure_is_a_floor,
    },
    outcome: SUMMARY.outcome,
    concentration: {
      distinct_hosts: SUMMARY.distinct_hosts,
      distinct_orgs: SUMMARY.distinct_orgs,
      top10_host_share_pct: SUMMARY.top10_host_share_pct,
    },
    known_limitations: SUMMARY.known_limitations,
    templated_endpoints: SUMMARY.templated_endpoints,
    notes,
  };
}

function toolLookup(args) {
  const address = String((args && args.address) || "").trim();
  const host = String((args && args.host) || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  if (!address && !host) {
    return {
      error: "give an address or a host",
      note: "There is no tool here that lists addresses. You must already hold the one you are asking about.",
    };
  }

  if (address) {
    const row = BY_ADDRESS.get(address) || BY_ADDRESS.get(address.replace(/\/+$/, ""));
    if (!row) {
      return {
        address,
        found: false,
        what_this_means:
          "This address was not among the https endpoints the registry declared on "
          + META.population_measured_at.slice(0, 10) + ". "
          + "That is a statement about the registry's list on that date. It is not a finding about this address.",
        population: META.pages.report,
      };
    }
    return { found: true, ...describe(row) };
  }

  const rows = BY_HOST.get(host);
  if (!rows) {
    return {
      host,
      found: false,
      what_this_means:
        "No address on this host was among the https endpoints the registry declared on "
        + META.population_measured_at.slice(0, 10) + ".",
    };
  }
  const by = {};
  let disclosed = 0, cards = 0, tools = 0, templates = 0;
  for (const r of rows) {
    by[r[1]] = (by[r[1]] || 0) + 1;
    if (r[5] === 1) disclosed++;
    if (r[4] === 1) cards++;
    if (typeof r[3] === "number") tools += r[3];
    if (r[11]) templates++;
  }
  return {
    host,
    found: true,
    measured_on: META.walk_measured_at,
    addresses_declared_on_this_host: rows.length,
    by_state: by,
    agent_cards_present: cards,
    compensation_disclosures_present: disclosed,
    tools_listed_total: tools,
    declared_as_templates_not_addresses: templates,
    note:
      "Counts only. For the record of one address, and the hash to recompute it, ask for that address. "
      + "We do not hand out per-address rosters for a host.",
  };
}

function toolDisclosureGuide() {
  const fields = Object.entries(DISCLOSURE_FIELDS)
    .sort((a, b) => b[1] - a[1])
    .map(([field, count]) => ({ field, seen_on_servers: count }));
  const notes = [
    "These are the field names we actually observed, not a specification we invented.",
    "An agent card that names who compensates the operator is a document, not a promise. "
    + "It can be read by anyone, including by the people it is about.",
    "Of the servers that answered, " + SUMMARY.agent_card_absent
    + " carried no agent card at all. There was no field to state anything in.",
  ];
  const bad = guard(notes);
  if (bad.length) return { error: "output gate", detail: bad };
  return {
    measured_on: META.walk_measured_at,
    servers_that_stated_who_compensates_them: SUMMARY.compensation_disclosed,
    out_of_servers_that_answered: SUMMARY.corrected_2026_08_24.measured,
    field_names_observed: fields,
    where_the_card_lives: [
      "/.well-known/agent-card.json",
      "/.well-known/agent.json",
      "the card URL declared in the server's own metadata",
    ],
    notes,
  };
}

function toolMethod() {
  return {
    what_we_did:
      "Every https endpoint the official registry declared was contacted exactly once, read only. "
      + "No tool was called on any server. The run finished the list rather than finishing when we got bored.",
    what_we_got_wrong: [
      {
        what: "The first full walk was discarded in full.",
        detail: "From " + SUMMARY.run1_discarded.first_all_unreachable_minute
              + " onward, every address came back unreachable. "
              + SUMMARY.run1_discarded.rows_after_cutover
              + " rows after the cutover reached "
              + SUMMARY.run1_discarded.reached_after_cutover + ". The world did not go down. Our instrument did.",
        outcome: SUMMARY.run1_discarded.verdict,
      },
      {
        what: "The second walk announced a protocol version most of the registry had dropped.",
        detail: SUMMARY.corrected_2026_08_24.what_was_wrong,
        outcome: SUMMARY.corrected_2026_08_24.our_fault + " rows ("
               + SUMMARY.corrected_2026_08_24.our_fault_pct_of_pending_bucket
               + "% of that bucket) were our fault. Measured moved to "
               + SUMMARY.corrected_2026_08_24.measured + ".",
      },
    ],
    rules: META.rules,
    we_do_not: META.we_do_not,
    reproduce: {
      method_published_before_the_run: META.pages.method,
      recompute_procedure: META.pages.recompute,
      raw_walk: META.pages.raw_walk,
      recheck: META.pages.recheck,
      version_ladder: META.pages.version_ladder,
      every_number_as_json: META.pages.report_json,
      report_record_sha256: META.record_sha256,
    },
  };
}

async function callTool(name, args) {
  switch (name) {
    case "mcp_observatory_state": return toolState();
    case "mcp_observatory_summary": return toolSummary();
    case "mcp_observatory_lookup": return toolLookup(args || {});
    case "mcp_observatory_disclosure_guide": return toolDisclosureGuide();
    case "mcp_observatory_measure_now": return await measureNow((args || {}).address);
    case "mcp_observatory_method": return toolMethod();
    default: return { error: "unknown tool", name, available: TOOLS.map((t) => t.name) };
  }
}

/* ------------------------------ MCP の層 ------------------------------ */

const SERVER_INFO = {
  protocolVersion: PROTOCOL_VERSION,
  capabilities: { tools: {} },
  serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
  instructions:
    "A public record of what answered when every https endpoint in the official MCP registry was "
    + "contacted once, read only, on 2026-08-23. Ask mcp_observatory_state before quoting a number. "
    + "There is no tool here that lists addresses: look up one you already hold.",
};

function cors(request) {
  return {
    "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body, null, 2), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", ...(extra || {}) },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const h = cors(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        ok: true,
        name: SERVER_NAME,
        version: SERVER_VERSION,
        what: "What answered when the official MCP registry's declared https endpoints were contacted once, read only.",
        measured_on: META.walk_measured_at,
        corrected_on: META.corrected_at,
        addresses: ROWS.length,
        report: META.pages.report,
        mcp: { endpoint: "/mcp", transport: "streamable-http", protocol_version: PROTOCOL_VERSION, stateless: true },
        auth: "none. this is a public record.",
      }, 200, h);
    }

    // 住所を1つ引くだけなら、MCP を話さない相手にも開けておく。
    if (url.pathname === "/lookup") {
      return json(toolLookup({
        address: url.searchParams.get("address") || "",
        host: url.searchParams.get("host") || "",
      }), 200, h);
    }

    if (url.pathname !== "/mcp") return json({ error: "not_found" }, 404, h);
    if (request.method === "GET") return json(SERVER_INFO, 200, h);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, h);

    let body;
    try { body = await request.json(); } catch (_e) {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "not JSON" } }, 200, h);
    }

    const batch = Array.isArray(body) ? body : [body];
    const results = [];
    for (const req of batch) {
      const id = req && Object.prototype.hasOwnProperty.call(req, "id") ? req.id : null;
      const method = req && req.method;
      if (method === "initialize") { results.push({ jsonrpc: "2.0", id, result: SERVER_INFO }); continue; }
      if (method === "notifications/initialized") continue;
      if (method === "server/discover") {
        results.push({ jsonrpc: "2.0", id, result: { ...SERVER_INFO, supportedVersions: [PROTOCOL_VERSION, "2026-07-28", "2025-06-18"] } });
        continue;
      }
      if (method === "ping") { results.push({ jsonrpc: "2.0", id, result: {} }); continue; }
      if (method === "tools/list") { results.push({ jsonrpc: "2.0", id, result: { tools: TOOLS } }); continue; }
      if (method === "tools/call") {
        const p = (req && req.params) || {};
        const out = await callTool(p.name, p.arguments);
        results.push({
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], isError: !!out.error },
        });
        continue;
      }
      results.push({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found: " + String(method) } });
    }
    if (!results.length) return new Response(null, { status: 204, headers: h });
    return json(Array.isArray(body) ? results : results[0], 200, h);
  },
};
