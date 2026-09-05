// test/load.mjs
//
// なぜこんな回りくどいことをするのか（消す前に読め）:
//
// Worker のソースは `src/worker.js` という拡張子 .js で、このリポジトリには
// package.json が無い。Node は package.json が無い .js を CommonJS として読むので、
// `export default` を含む Worker を直接 import すると構文エラーで落ちる。
//
// 逃げ道は2つあった。
//   (a) リポジトリ直下に {"type":"module"} の package.json を置く
//   (b) テスト実行時にソースを .mjs としてコピーして読む
//
// (b) を選んだ。理由は「何も殺すな」。(a) は wrangler のビルド解決に影響しうる
// 本番側の変更であって、テストのために本番の形を変えるのは順序が逆である。
// (b) なら本番ファイルには指一本触れずに、**本物のソースそのもの**を読める。
//
// 重要：ここでコピーしているのは本物の src/worker.js である。テスト用の写しを
// 別に持たない。写しを持った瞬間、テストは本番と静かにズレて嘘をつき始める。

import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/**
 * リポジトリ相対パスの Worker ソースを ES モジュールとして読み込む。
 * @param {string} rel 例: "src/worker.js"
 * @returns {Promise<object>} Worker の default export（{ fetch } を持つ）
 */
export async function loadWorker(rel) {
  const src = await readFile(join(ROOT, rel), "utf8");
  const dir = await mkdtemp(join(tmpdir(), "jidec-test-"));
  const f = join(dir, rel.replace(/[/\\]/g, "_") + ".mjs");
  await writeFile(f, src);
  const m = await import(pathToFileURL(f).href);
  return m.default;
}

/** SHA-256 を16進で返す（台帳と同じ計算を、台帳のコードを使わずに行う）。 */
export async function sha256Hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * KV のモック。実物の KV は使わない。
 * 本番の KV を読むテストは「テストが本番を壊しうる」ので書かない。
 */
export function mockKV(entries) {
  const store = new Map(entries);
  return {
    store,
    binding: {
      get: async (k) => store.get(k) ?? null,
      put: async (k, v) => {
        store.set(k, v);
      },
      list: async (opt) => {
        const pre = (opt && opt.prefix) || "";
        return { keys: [...store.keys()].filter((k) => k.startsWith(pre)).map((name) => ({ name })), list_complete: true };
      },
      delete: async (k) => {
        store.delete(k);
      },
    },
  };
}

/** 判定つきの小さなテストランナー。失敗数を数えて返すだけ。 */
export function checker(label) {
  let fail = 0;
  const chk = (name, cond, extra = "") => {
    console.log((cond ? "PASS" : "FAIL") + "  " + name + (cond ? "" : "  <<< " + extra));
    if (!cond) fail++;
  };
  chk.done = () => {
    console.log(fail ? `\n${label}: ${fail} FAILURES` : `\n${label}: ALL PASS`);
    return fail;
  };
  return chk;
}
