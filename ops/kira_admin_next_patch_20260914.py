#!/usr/bin/env python3
"""
ops/kira_admin_next_patch_20260914.py  hs-kira-proxy: 管理ダッシュボードをスマホからも開けるように(門は外さん)

9/13 の門(adminGateOk)で /admin/funnel-stats が cookie 無しでは 401 になった。Mac ではログイン済みで見えるが、
cookie はブラウザごとやからスマホでは 401 の JSON が出るだけで、どこで入ればええかも分からん。

  N1 cookie の Max-Age を 12 時間 -> 30 日(値はパスワードから作る固定値で、期限は client 側の目安でしかない。
     サーバ側の危険度は変わらん。減るのは入力の回数だけ)
  N2 /admin が next(戻り先)を受ける。/admin 配下の path だけ許す(open redirect 禁止)。ログインしたら next へ戻す。
     cookie 有りで /admin?next=... を開いた時も next へ。
  N3 /admin/funnel-stats を cookie 無しのブラウザ(GET で Accept に text/html)で開いたら、401 の JSON やなく
     /admin?next=/admin/funnel-stats へ 302。API 呼び出し(Accept 無し/JSON)は今までどおり 401。

既定は dry-run。--apply で書く(.bak を先に残す)。各 anchor は count==1 を assert。
"""
import sys, os, re, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "workers", "hs-kira-proxy", "src", "kira-proxy-v2.js")
APPLY = "--apply" in sys.argv
src = open(TARGET, encoding="utf-8").read(); orig = src

def rep(anchor, new, label):
    global src
    n = src.count(anchor)
    assert n == 1, "%s: anchor count %d != 1" % (label, n)
    src = src.replace(anchor, new)
    print("ok   " + label)

rep("'Set-Cookie': 'hs_admin=' + v + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200',",
    "'Set-Cookie': 'hs_admin=' + v + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000',",
    "N1 cookie Max-Age 12h -> 30d")

rep("""    if (path === '/admin') {
      try {
        // ===== admin-auth-gate（2026-05-23追加・サーバ側パスワード判定）=====
        const _pw = url.searchParams.get('key') || '';
        const _correct = env.ADMIN_PASSWORD || '';""",
    """    if (path === '/admin') {
      try {
        // ===== admin-auth-gate（2026-05-23追加・サーバ側パスワード判定）=====
        const _pw = url.searchParams.get('key') || '';
        const _correct = env.ADMIN_PASSWORD || '';
        // 2026-09-14: 戻り先(next)。/admin 配下の path だけ。外の URL や // は捨てる(open redirect 禁止)。
        const _nextRaw = url.searchParams.get('next') || '';
        const _next = /^\\/admin(?:\\/[A-Za-z0-9_-]+)*$/.test(_nextRaw) ? _nextRaw : '';""",
    "N2 /admin が next を読む(検証付き)")

rep("""function go(){var p=document.getElementById('pw').value;if(!p){return;}location.href='/admin?key='+encodeURIComponent(p);}""",
    """function go(){var p=document.getElementById('pw').value;if(!p){return;}location.href='/admin?key='+encodeURIComponent(p)${_next ? "+'&next=" + encodeURIComponent(_next) + "'" : ""};}""",
    "N2 ログイン画面の go() が next を運ぶ")

rep("""        if (!_viaCookie) return await adminCookieRedirect(env, '/admin');""",
    """        if (!_viaCookie) return await adminCookieRedirect(env, _next || '/admin');
        if (_next && _next !== '/admin') return new Response(null, { status: 302, headers: { 'Location': _next, 'Cache-Control': 'no-store' } });""",
    "N2 ログイン後は next へ戻す")

rep("""    if (path === '/admin/funnel-stats') {
      if (!(await adminGateOk(request, env))) return json({ error: 'unauthorized' }, 401, origin);""",
    """    if (path === '/admin/funnel-stats') {
      if (!(await adminGateOk(request, env))) {
        // 2026-09-14: ブラウザで直に開いた(cookie 無し)なら 401 の JSON やなくログイン画面へ回し、入ったらここへ戻す。API は 401 のまま。
        const _wantsHtml = request.method === 'GET' && /text\\/html/.test(request.headers.get('Accept') || '');
        if (_wantsHtml) return new Response(null, { status: 302, headers: { 'Location': '/admin?next=' + encodeURIComponent('/admin/funnel-stats'), 'Cache-Control': 'no-store' } });
        return json({ error: 'unauthorized' }, 401, origin);
      }""",
    "N3 funnel-stats: ブラウザは login へ 302、API は 401")

DASH = re.compile("[" + "".join(chr(c) for c in (0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D)) + "]")
new_lines = [l for l in src.splitlines() if l not in set(orig.splitlines())]
bad = [l for l in new_lines if DASH.search(l)]
assert not bad, "追加行にダッシュ: " + "\n".join(bad[:3])
print("ok   追加行 %d 本、ダッシュ無し" % len(new_lines))

if not APPLY:
    print("\nDRY RUN。書いてへん。--apply で書く。"); sys.exit(0)
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
open(TARGET + "." + stamp + "-adminnext.bak", "w", encoding="utf-8").write(orig)
open(TARGET, "w", encoding="utf-8").write(src)
print("\nAPPLIED  " + TARGET + "  (bak " + stamp + ")")
