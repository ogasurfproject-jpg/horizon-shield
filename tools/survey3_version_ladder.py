# -*- coding: utf-8 -*-
"""
当て直しで not_modern だったものに、2025年代の版で initialize を当てる。

なぜ要る (2026-08-24):
  走行2は initialize の protocolVersion に "2024-11-05" と書いて送っていた。
  registry が公開している版の中では、いちばん古い部類である。

  当て直しの途中で分かった。現行(2026-07-28)の作法で答えた20件のうち、
  2024-11-05 を支持しているのは2件しかない。18件は走行2に HTTP 400 を返している。
  仕様が「支持しない版」に対して定める応答そのものである。
  走行2は、相手が落としてしまった版を名乗り、その正しい拒否を
  「MCP を話していない」と数えていた。

  そして当て直しにも、同じ形の穴がある。
  server/discover は 2026-07-28 で入った。2025年代の版しか話さないサーバは、
  ・走行2の 2024-11-05 を拒み          -> initialize_rejected
  ・server/discover を持たない          -> not_modern
  どちらの走行でも「MCPではない」側に落ちる。not_modern は相手を無罪にしない。

  だからもう一段いる。相手が実際に支持していそうな版で、もう一度だけ当てる。

版のはしご:
  2025-11-25 -> 2025-06-18 -> 2025-03-26 の順に initialize を試す。
  どれかが通れば、その相手は MCP を話している。
  走行2の判定も、当て直しの判定も、両方こちらの誤りだったことになる。

  版を変えるたびに1回ずつ増える。相手のサーバに当てる回数が増えるので、
  通った時点で止める。全部落ちたときだけ3回になる。

読むだけ。ツールは呼ばない。robots は読み直す。対照アドレスを持つ。

  python3 tools/survey3_version_ladder.py \
      verify-directory/survey/data/survey2_recheck_2026-08-24.jsonl \
      --out verify-directory/survey/data/survey3_ladder_2026-08-24.jsonl
"""

import argparse, io, json, os, sys, time, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import survey1_walk as W  # noqa: E402

LADDER = ["2025-11-25", "2025-06-18", "2025-03-26"]


def try_initialize(url, version):
    """走行2と同じ形の initialize を、版だけ変えて送る。

    2026-08-24: ここで取り違えた。
      W.rpc は urlopen をそのまま使っており、HTTP エラーを捕まえない。
      「その版は支持しない」を意味する HTTP 400 は HTTPError として飛んでくる。
      それを except Exception で受けて held(届かなかった) にしていた。

      版が合わないという返事は、届いた返事である。届かなかったのではない。
      この調査がいちばん避けようとしている取り違えを、道具の中に作っていた。
      250件走った時点で held が212件。85%である。
      対照アドレスの門が中止させたので、間違った数字は publish されずに済んだ。

      HTTP の返事は返事として扱う。届かなかったのは、通信そのものが立たなかったときだけ。
    """
    payload = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
               "params": {"protocolVersion": version, "capabilities": {},
                          "clientInfo": {"name": "horizon-shield-survey", "version": "2.0"}}}
    try:
        st, sid, res = W.rpc(url, payload)
        return st, sid, res, None
    except urllib.error.HTTPError as e:
        # 返事は返ってきている。中身も読む(版の一覧が入っていることがある)。
        body = None
        try:
            body = json.loads(e.read(200000).decode("utf-8", "replace"))
        except Exception:
            body = None
        return e.code, None, (body if isinstance(body, dict) and "result" in body else None), None
    except Exception as e:
        return None, None, None, W.describe_exc(e)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("recheck_jsonl")
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--sleep", type=float, default=0.6)
    a = ap.parse_args()

    targets = []
    for line in io.open(a.recheck_jsonl, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get("verdict") == "not_modern":
            targets.append(d)
    if a.limit:
        targets = targets[:a.limit]

    print("当て直しで not_modern だったもの: %d 件" % len(targets))
    print("版のはしご: %s\n" % " -> ".join(LADDER))
    if not W.control_ok():
        sys.exit("対照アドレスに届きません。こちら側が先に壊れています。中止します。")

    counts, unreached, out = {}, 0, io.open(a.out, "w", encoding="utf-8")
    for i, t in enumerate(targets, 1):
        url = t["url"]
        rec = {"url": url, "run2_outcome": t.get("run2_outcome"),
               "recheck_verdict": t.get("verdict"), "tried": []}
        try:
            if not W.robots_allows(url):
                rec["verdict"], rec["note"] = "skipped", "robots disallowed"
            else:
                rec["verdict"] = "still_not_mcp"
                rec["note"] = "no version in the ladder was accepted"
                for v in LADDER:
                    st, sid, res, err = try_initialize(url, v)
                    rec["tried"].append({"version": v, "http": st,
                                         "ok": bool(res), "error": err})
                    if err:
                        # 通信そのものが立たなかったときだけ held。
                        rec["verdict"], rec["note"] = "held", "not reached: %s" % err
                        break
                    if res:
                        # 相手は MCP を話している。走行2も当て直しも間違っていた。
                        rec["verdict"] = "speaks_older_era"
                        rec["note"] = "initialize accepted at %s" % v
                        rec["accepted_version"] = v
                        si = (res.get("serverInfo") or {}) if isinstance(res, dict) else {}
                        rec["server_name"] = si.get("name")
                        rec["server_version_field"] = res.get("protocolVersion") if isinstance(res, dict) else None
                        rec["session_required"] = bool(sid)
                        break
                    time.sleep(0.2)
        except Exception as ex:
            rec["verdict"] = "probe_error"
            rec["note"] = "our probe raised: %s: %s" % (type(ex).__name__, str(ex)[:160])

        if rec["verdict"] == "held":
            unreached += 1
            if unreached >= W.UNREACHED_TRIP:
                print("\n連続で届きません(%d件)。自分を疑います。" % unreached)
                if not W.wait_healthy():
                    out.close()
                    sys.exit("対照が回復しませんでした。中止します。報告には使いません。")
                unreached = 0
        else:
            unreached = 0

        out.write(json.dumps(rec, ensure_ascii=False) + "\n"); out.flush()
        counts[rec["verdict"]] = counts.get(rec["verdict"], 0) + 1
        if i % 25 == 0 or i == len(targets):
            print("  %5d / %d   %s" % (i, len(targets),
                  "  ".join("%s=%d" % kv for kv in sorted(counts.items()))))
        time.sleep(a.sleep)
    out.close()

    print("\n結果:")
    for k in sorted(counts):
        print("  %-20s %5d" % (k, counts[k]))
    older = counts.get("speaks_older_era", 0)
    n = sum(counts.values()) or 1
    held_pct = 100.0 * counts.get("held", 0) / n
    if held_pct > 20:
        print("\n★ 届かなかったものが %.0f%% あります。" % held_pct)
        print("  数分前の当て直しでは 918件中3件でした。この差は相手ではなく、")
        print("  こちら側の見込み違いを疑うべき大きさです。この結果は報告に使わないでください。")
    print("\n%d 件は、2025年代の版を名乗れば MCP を話した。" % older)
    print("走行2の判定も、当て直しの判定も、どちらもこちらの誤りだった。")
    print("\n書いた: %s" % a.out)


if __name__ == "__main__":
    main()
