package dev.horizonshield.nenrin;

import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * nenrin-verify (Java): the same commands, checks and verdicts as npm, PyPI and Go nenrin-verify.
 *
 * <pre>
 *   java -jar nenrin-verify.jar furui-day &lt;YYYY-MM-DD&gt; --leaf &lt;i&gt; [--bitcoin-header]
 *   java -jar nenrin-verify.jar resume-admission &lt;https endpoint&gt; &lt;record_sha256&gt; [--bitcoin-header]
 *   java -jar nenrin-verify.jar furui-vectors &lt;verify_vectors.json | bitcoin_header_vectors.json&gt;
 * </pre>
 *
 * Exit 0 ok, 1 fail, 3 not_yet, 2 usage or network error. The network is GET only, only https://ledger.horizonshield.dev
 * and https://furui.horizonshield.dev, with no redirects; with --bitcoin-header also https://mempool.space and
 * https://blockstream.info (four GETs, sending only the block height and the block hash).
 */
public final class Main {
    private Main() {}

    public static final String VERSION = "0.2.0";
    static final String USAGE = "usage: nenrin-verify furui-day <YYYY-MM-DD> --leaf <i> [--bitcoin-header]\n       nenrin-verify resume-admission <https endpoint> <record_sha256> [--bitcoin-header]\n       nenrin-verify furui-vectors <vectors.json>";
    static final Pattern LEAF = Pattern.compile("^(0|[1-9][0-9]{0,8})$");
    static final Pattern HTTPS = Pattern.compile("^https://\\S+$");

    public static void main(String[] a) {
        System.setOut(new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8));
        System.exit(run(a));
    }

    public static int run(String[] a) {
        Map<String, Object> res;
        boolean bh = false;
        if (a.length > 0 && (a[0].equals("furui-day") || a[0].equals("resume-admission"))) {
            int n = 0, at = 0;
            for (int i = 1; i < a.length; i++) if (a[i].equals("--bitcoin-header")) { n++; at = i; }
            if (n == 1) {
                List<String> l = new ArrayList<>(Arrays.asList(a));
                l.remove(at);
                a = l.toArray(new String[0]);
                bh = true;
            }
        }
        try {
            if (a.length == 1 && (a[0].equals("--version") || a[0].equals("-V"))) {
                System.out.println("nenrin-verify (java) " + VERSION);
                return 0;
            } else if (a.length == 4 && a[0].equals("furui-day") && a[2].equals("--leaf") && Furui.realDay(a[1]) && LEAF.matcher(a[3]).matches()) {
                res = Furui.furuiDay(a[1], Long.parseLong(a[3]), Furui.HTTP, bh, Furui.HTTP_EXPLORER);
            } else if (a.length == 3 && a[0].equals("resume-admission") && HTTPS.matcher(a[1]).matches() && Furui.H64.matcher(a[2]).matches() && Furui.host(a[1]) != null) {
                res = Furui.resumeAdmission(a[1], a[2], Furui.HTTP, bh, Furui.HTTP_EXPLORER);
            } else if (a.length == 2 && a[0].equals("furui-vectors")) {
                return vectors(a[1]);
            } else {
                System.err.println(USAGE);
                return 2;
            }
        } catch (Furui.NetError e) {
            System.err.println("nenrin-verify: network: " + e.getMessage());
            return 2;
        }
        System.out.println(Json.pretty(res, ""));
        String v = (String) res.get("verdict");
        return v.equals("ok") ? 0 : v.equals("fail") ? 1 : 3;
    }

    static int vectors(String path) {
        try {
            Object doc = Json.parse(Files.readAllBytes(Paths.get(path)));
            List<Object> cases = Furui.arr(Furui.get(doc, "cases"));
            int ok = 0;
            for (Object c : cases) {
                Object got = Furui.runCase(c);
                String g = Json.canonical(got);
                String e = Furui.canonOrNull(Furui.get(c, "expect"));
                boolean same = g.equals(e);
                if (same) ok++;
                System.out.println("{\"got\":" + g + ",\"name\":" + Json.canonical(Furui.get(c, "name")) + ",\"same\":" + same + "}");
            }
            System.out.println(ok + "/" + cases.size() + " furui vectors give the expected verdict (java)");
            return ok == cases.size() ? 0 : 1;
        } catch (Exception e) {
            System.err.println("nenrin-verify: " + e);
            return 2;
        }
    }
}
