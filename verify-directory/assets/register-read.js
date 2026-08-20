// 2026-08-20 register-read-shape
//
// なぜ一箇所にまとめるのか:
//   登録簿の読み方を5枚のページに書き写していた。だから5枚とも同じ穴を持っていた。
//   直し方まで5枚に書き写せば、次に直すときも5枚を探すことになる。それも同じ鋳型。
//
// この関数が守る規則は一つだけ:
//   「0行だった」と「読めなかった」を、呼び出し側が取り違えられない形で返す。
//   読めなかったときに rows を返さない。空配列も返さない。ok:false だけを返す。
//   空配列を返せば、呼び出し側は必ずそれを「0行」として扱う。実際そうなっていた。
//   2026-08-20 まで /verify-directory/failures/ は、gate が 500 を返した場合に
//   「登録簿の 0 行すべてが verified」と書くコードだった。ガードは在って、正しくて、
//   食わされる値だけが壊れていた。指摘: Federico Blanco Sanchez-Llanos。
//
// 呼び出し側の義務:
//   ok が false のときに、行数についての主張を一切書かないこと。
//   HS_registerUnreadable(why) がその文言を返す。

window.HS_readRegister = async function (gate) {
  let res;
  try {
    res = await fetch(gate + "/register", { cache: "no-store" });
  } catch (e) {
    return { ok: false, why: "this page could not reach the gate (" + (e && e.message) + ")" };
  }
  if (!res.ok) return { ok: false, why: "the gate answered " + res.status };
  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { ok: false, why: "the gate's answer was not JSON" };
  }
  if (!data || !Array.isArray(data.rows)) {
    return { ok: false, why: "the gate's answer carried no rows list" };
  }
  return { ok: true, rows: data.rows };
};

window.HS_registerUnreadable = function (why) {
  return "This page could not read the register: " + why +
    ". That is a statement about this page, not a verdict about anyone on the register, " +
    "and not a claim that nothing is failing. The gate answers at /register directly.";
};

window.HS_registerUnreadableJa = function (why) {
  return "このページは登録簿を読めなかった（" + why + "）。" +
    "これはこのページについての記述であって、登録簿に載っている誰かへの判定ではなく、" +
    "「何も落ちていない」という主張でもない。登録簿は gate の /register が直接答える。";
};
