package dev.horizonshield.nenrin;

import java.io.InputStream;
import java.math.BigInteger;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.time.DateTimeException;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * nenrin-verify furui-day and resume-admission, the Java twin of the Python, JavaScript and Go ports; all four run
 * furui-check-day-v0/verify_vectors.json and give the same verdicts.
 *
 * <p>furui-day: 1 envelope_shape, 2 leaf_sha256, 3 audit_path (RFC 6962, to the root of the day record the ledger
 * serves), 4 signature (the runner's Ed25519 signature on the day record and on the envelope), 5 runner_key (the key is
 * in the ledger's /.well-known/furui-check-keys.json, inside from_height), 6 bitcoin_anchor (the record is in a ledger
 * batch entry whose OpenTimestamps proof reaches a Bitcoin block header; not_yet before). resume-admission: 1 resume,
 * 2 admission_line, 3 admission_record, 4 ledger_batch, 5 bitcoin_anchor.
 *
 * <p>furui-day --runner 1|2: runner-1 (the default) or runner-2, whose day tree is /furui2/day/, whose day record and
 * envelopes carry key_id runner-2 and whose day record names runner_id runner-2 (a runner-1 record may leave it out).
 *
 * <p>--bitcoin-header (either command, optional) adds one step after bitcoin_anchor (7 for furui-day, 6 for
 * resume-admission), bitcoin_header: two block explorers (mempool.space and blockstream.info) name the same block hash
 * at the proof's height and serve the same 80 byte header; the header hashes (sha256d) to that block hash and meets the
 * target its own bits encode; its merkle root is the one the OpenTimestamps proof commits to. Without the flag nothing
 * changes: no explorer is asked. All four ports run furui-check-day-v0/bitcoin_header_vectors.json and give the same
 * answers.
 */
public final class Furui {
    private Furui() {}

    public static final String LEDGER = "https://ledger.horizonshield.dev";
    public static final String RUNNER = "https://furui.horizonshield.dev";
    public static final String KEYS_URL = LEDGER + "/.well-known/furui-check-keys.json";
    public static final String CHECK_SCHEMA = "nenrin-furui-check-v1";
    static final String DAY_LEAF = "sha256(0x00 || musubi-canonical-v0(envelope))";
    static final Pattern H64 = Pattern.compile("^[0-9a-f]{64}$");
    static final Pattern DAY = Pattern.compile("^(\\d{4})-(\\d{2})-(\\d{2})$");
    static final Pattern ISO_MS = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$");
    static final Pattern NONCE = Pattern.compile("^(?:[0-9a-f]{32}|heartbeat-\\d{4}-\\d{2}-\\d{2})$");
    static final Pattern SIG88 = Pattern.compile("^[A-Za-z0-9+/]{86}==$");
    static final Pattern B64 = Pattern.compile("^[A-Za-z0-9+/]*={0,2}$");
    static final List<String> CHECK_KEYS = Arrays.asList("action_binding_digest", "answered", "checked_at_height", "contract_sha256", "decision", "input_commit", "marks", "nonce", "rules_sha256", "schema", "scope_sha256", "signed_at", "stage_reached", "trace_sha256", "unread");
    static final List<String> DAY_KEYS = Arrays.asList("clock_skew", "day", "first_height", "last_height", "late", "leaf", "n", "publication", "root", "schema", "signatures", "signer", "tree");
    /** a day record may name its runner (runner_id; none is runner-1) */
    static final List<String> DAY_KEYS_RUNNER = Arrays.asList("clock_skew", "day", "first_height", "last_height", "late", "leaf", "n", "publication", "root", "runner_id", "schema", "signatures", "signer", "tree");
    static final Pattern RUNNER_ID = Pattern.compile("^runner-[0-9]{1,3}$");
    static final Set<String> RESUME_ENV = new HashSet<>(Arrays.asList("evaluated_at", "subject_responses", "not_counted", "scan", "recompute", "resume_sha256"));
    static final Set<String> MARKS_OK = new HashSet<>(Arrays.asList("[]", "[\"off_topic\"]", "[\"rule_conflict\"]", "[\"off_topic\",\"rule_conflict\"]"));
    static final List<String> DAY_STEPS = Arrays.asList("envelope_shape", "leaf_sha256", "audit_path", "signature", "runner_key", "bitcoin_anchor");
    static final List<String> RES_STEPS = Arrays.asList("resume", "admission_line", "admission_record", "ledger_batch", "bitcoin_anchor");
    static final Set<String> HOSTS = new HashSet<>(Arrays.asList("ledger.horizonshield.dev", "furui.horizonshield.dev"));
    static final String HEADER_STEP = "bitcoin_header";
    /** --bitcoin-header: two Esplora APIs, asked in this order; GET /block-height/&lt;h&gt; and GET /block/&lt;hash&gt;/header */
    static final List<String[]> EXPLORERS = Arrays.asList(new String[] {"mempool", "https://mempool.space/api"}, new String[] {"blockstream", "https://blockstream.info/api"});
    static final List<String> EXPLORER_HOSTS = Arrays.asList("mempool.space", "blockstream.info");
    static final Pattern HEX160 = Pattern.compile("^[0-9a-f]{160}$");

    /** A network failure, or a URL outside the two hosts (exit 2). */
    public static final class NetError extends Exception {
        private static final long serialVersionUID = 1L;

        public NetError(String m) { super(m); }
    }

    /** A GET: the status and the body. */
    public interface Getter {
        Object[] get(String url) throws NetError;
    }

    // ---- small helpers ----

    static String hex(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x & 0xff));
        return s.toString();
    }

    static byte[] unhex(String h) {
        byte[] b = new byte[h.length() / 2];
        for (int i = 0; i < b.length; i++) b[i] = (byte) Integer.parseInt(h.substring(2 * i, 2 * i + 2), 16);
        return b;
    }

    static byte[] sha256(byte[] b) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(b);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static String sha(byte[] b) { return hex(sha256(b)); }

    static String sha(String s) { return sha(s.getBytes(StandardCharsets.UTF_8)); }

    static byte[] utf8(String s) { return s.getBytes(StandardCharsets.UTF_8); }

    static boolean isObj(Object v) { return v instanceof Map; }

    static boolean isArr(Object v) { return v instanceof List; }

    static boolean isStr(Object v) { return v instanceof String; }

    static boolean isBool(Object v) { return v instanceof Boolean; }

    static boolean isNull(Object v) { return v == Json.NULL; }

    static boolean strEq(Object v, String s) { return v instanceof String && v.equals(s); }

    static boolean hex64(Object v) { return v instanceof String && H64.matcher((String) v).matches(); }

    @SuppressWarnings("unchecked")
    static Object get(Object v, String k) {
        if (v instanceof Map) {
            Map<String, Object> m = (Map<String, Object>) v;
            return m.containsKey(k) ? m.get(k) : null;
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    static List<Object> arr(Object v) { return v instanceof List ? (List<Object>) v : Collections.emptyList(); }

    static Long integer(Object v, long lo) {
        Long n = Json.asInt(v);
        return n != null && n >= lo ? n : null;
    }

    @SuppressWarnings("unchecked")
    static boolean keysAre(Object v, List<String> ks) {
        if (!(v instanceof Map)) return false;
        List<String> a = new ArrayList<>(((Map<String, Object>) v).keySet());
        List<String> b = new ArrayList<>(ks);
        Collections.sort(a);
        Collections.sort(b);
        return a.equals(b);
    }

    static boolean marksOk(Object v) {
        if (!isArr(v)) return false;
        for (Object x : arr(v)) if (!isStr(x)) return false;
        try {
            return MARKS_OK.contains(Json.canonical(v));
        } catch (Json.Bad e) {
            return false;
        }
    }

    static boolean realDay(Object v) {
        if (!(v instanceof String)) return false;
        Matcher m = DAY.matcher((String) v);
        if (!m.matches()) return false;
        int y = Integer.parseInt(m.group(1));
        if (y < 1) return false;
        try {
            LocalDate.of(y, Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)));
            return true;
        } catch (DateTimeException e) {
            return false;
        }
    }

    static byte[] b64(Object v, int n) {
        if (!(v instanceof String)) return null;
        String s = (String) v;
        if (!B64.matcher(s).matches() || s.length() % 4 != 0) return null;
        byte[] b;
        try {
            b = Base64.getDecoder().decode(s);
        } catch (IllegalArgumentException e) {
            return null;
        }
        return b.length == n && Base64.getEncoder().encodeToString(b).equals(s) ? b : null;
    }

    static boolean verify(byte[] pub, byte[] msg, byte[] sig) {
        if (pub == null || sig == null || pub.length != 32 || sig.length != 64) return false;
        try {
            byte[] spki = Json_concat(unhex("302a300506032b6570032100"), pub);
            PublicKey k = KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(spki));
            Signature s = Signature.getInstance("Ed25519");
            s.initVerify(k);
            s.update(msg);
            return s.verify(sig);
        } catch (Exception e) {
            return false;
        }
    }

    static byte[] Json_concat(byte[] a, byte[] b) { return Ots.concat(a, b); }

    static boolean truthy(Object v) {
        if (v == null || v == Json.NULL) return false;
        if (v instanceof Boolean) return (Boolean) v;
        if (v instanceof Double) return (Double) v != 0.0;
        if (v instanceof String) return !((String) v).isEmpty();
        if (v instanceof List) return !((List<?>) v).isEmpty();
        if (v instanceof Map) return !((Map<?, ?>) v).isEmpty();
        return true;
    }

    static String canonOrNull(Object v) {
        try {
            return Json.canonical(v);
        } catch (Json.Bad e) {
            return null;
        }
    }

    static Map<String, Object> obj(Object... kv) {
        Map<String, Object> o = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) o.put((String) kv[i], kv[i + 1]);
        return o;
    }

    static boolean signerIs(Object v) {
        return keysAre(v, Arrays.asList("domain", "key_url")) && strEq(get(v, "domain"), "horizonshield.dev") && strEq(get(v, "key_url"), KEYS_URL);
    }

    // ---- shapes ----

    public static String envelopeProblem(Object e) { return envelopeProblem(e, "runner-1"); }

    /** envelopeProblem for the runner whose key_id is rid. */
    public static String envelopeProblem(Object e, String rid) {
        if (!keysAre(e, Arrays.asList("check", "schema", "signatures", "signer")) || !strEq(get(e, "schema"), "furui-check-signed-v1")) return "envelope_keys";
        Object c = get(e, "check");
        if (!keysAre(c, CHECK_KEYS) || !strEq(get(c, "schema"), "furui-check-v1")) return "check_keys";
        for (String k : new String[] {"input_commit", "action_binding_digest", "contract_sha256", "trace_sha256"}) if (!hex64(get(c, k))) return "check_" + k;
        for (String k : new String[] {"rules_sha256", "scope_sha256"}) if (!isNull(get(c, k)) && !hex64(get(c, k))) return "check_" + k;
        Object d = get(c, "decision");
        if (!(isNull(d) || strEq(d, "stop") || strEq(d, "pass"))) return "check_decision";
        if (!marksOk(get(c, "marks"))) return "check_marks";
        if (!isBool(get(c, "unread")) || !isBool(get(c, "answered"))) return "check_flags";
        Long st = integer(get(c, "stage_reached"), 0);
        if (st == null || st > 4) return "check_stage_reached";
        if (integer(get(c, "checked_at_height"), 0) == null) return "check_height";
        if (!(isStr(get(c, "nonce")) && NONCE.matcher((String) get(c, "nonce")).matches())) return "check_nonce";
        if (!(isStr(get(c, "signed_at")) && ISO_MS.matcher((String) get(c, "signed_at")).matches())) return "check_signed_at";
        if (!signerIs(get(e, "signer"))) return "signer";
        if (!isArr(get(e, "signatures")) || arr(get(e, "signatures")).size() != 1) return "signatures";
        Object g = arr(get(e, "signatures")).get(0);
        if (!keysAre(g, Arrays.asList("alg", "domain", "key_id", "sig")) || !strEq(get(g, "alg"), "ed25519") || !strEq(get(g, "domain"), "horizonshield.dev")
            || !strEq(get(g, "key_id"), rid) || !(isStr(get(g, "sig")) && SIG88.matcher((String) get(g, "sig")).matches())) return "signature";
        return null;
    }

    static byte[] envelopeMessage(Object e) throws Json.Bad {
        return utf8("furui-check-signed-v1\n" + Json.canonical(obj("schema", get(e, "schema"), "check", get(e, "check"), "signer", get(e, "signer"))));
    }

    @SuppressWarnings("unchecked")
    static byte[] dayMessage(Object r) throws Json.Bad {
        Map<String, Object> o = new LinkedHashMap<>((Map<String, Object>) r);
        o.remove("signatures");
        return utf8("furui-check-day-v0\n" + Json.canonical(o));
    }

    static String dayRecordProblem(Object r) {
        Object rv = get(r, "runner_id");
        boolean runnerOk = keysAre(r, DAY_KEYS) || (keysAre(r, DAY_KEYS_RUNNER) && isStr(rv) && RUNNER_ID.matcher((String) rv).matches());
        if (!runnerOk || !strEq(get(r, "schema"), "furui-check-day-v0")) return "day_record_shape";
        Object s = get(r, "signer");
        Long fh = integer(get(r, "first_height"), 0), lh = integer(get(r, "last_height"), 0);
        boolean ok = realDay(get(r, "day")) && keysAre(s, Arrays.asList("domain", "key_url")) && isStr(get(s, "domain")) && !((String) get(s, "domain")).isEmpty()
            && isStr(get(s, "key_url")) && integer(get(r, "n"), 1) != null && strEq(get(r, "tree"), "rfc6962-sha256") && strEq(get(r, "leaf"), DAY_LEAF)
            && hex64(get(r, "root")) && fh != null && lh != null && fh <= lh && integer(get(r, "late"), 0) != null && integer(get(r, "clock_skew"), 0) != null
            && strEq(get(r, "publication"), "public") && isArr(get(r, "signatures")) && arr(get(r, "signatures")).size() == 1;
        if (!ok) return "day_record_shape";
        Object g = arr(get(r, "signatures")).get(0);
        if (!(keysAre(g, Arrays.asList("alg", "domain", "key_id", "sig")) && strEq(get(g, "alg"), "ed25519") && strEq(get(g, "domain"), (String) get(s, "domain"))
            && isStr(get(g, "key_id")) && isStr(get(g, "sig")))) return "day_record_shape";
        return null;
    }

    // ---- RFC 6962 ----

    static String node(String a, String b) {
        byte[] x = new byte[65];
        x[0] = 1;
        System.arraycopy(unhex(a), 0, x, 1, 32);
        System.arraycopy(unhex(b), 0, x, 33, 32);
        return sha(x);
    }

    static long split(long n) {
        long k = 1;
        while (k * 2 < n) k *= 2;
        return k;
    }

    static String rootFromPath(String leaf, long m, long n, List<String> path) {
        if (n == 1) return path.isEmpty() ? leaf : null;
        if (path.isEmpty()) return null;
        long k = split(n);
        String top = path.get(path.size() - 1);
        List<String> rest = path.subList(0, path.size() - 1);
        if (m < k) {
            String l = rootFromPath(leaf, m, k, rest);
            return l == null ? null : node(l, top);
        }
        String r = rootFromPath(leaf, m - k, n - k, rest);
        return r == null ? null : node(top, r);
    }

    // ---- fetching ----

    public static String encComponent(String s) {
        StringBuilder b = new StringBuilder();
        for (byte x : utf8(s)) {
            int c = x & 0xff;
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~') b.append((char) c);
            else b.append(String.format("%%%02X", c));
        }
        return b.toString();
    }

    public static final Getter HTTP = url -> {
        URI u;
        try {
            u = new URI(url);
        } catch (Exception e) {
            throw new NetError("not an allowed URL: " + url);
        }
        if (!"https".equals(u.getScheme()) || u.getHost() == null || !HOSTS.contains(u.getHost()) || (u.getPort() != -1 && u.getPort() != 443)) throw new NetError("not an allowed URL: " + url);
        try {
            HttpClient c = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).connectTimeout(Duration.ofSeconds(30)).build();
            HttpRequest r = HttpRequest.newBuilder(u).GET().timeout(Duration.ofSeconds(30)).header("user-agent", "nenrin-verify-furui/1").header("accept", "application/json").build();
            HttpResponse<byte[]> res = c.send(r, HttpResponse.BodyHandlers.ofByteArray());
            return new Object[] {res.statusCode(), res.body()};
        } catch (Exception e) {
            throw new NetError(url + ": " + e);
        }
    };

    /** One of the two block explorers (--bitcoin-header only): GET only, no redirects, at most 4096 bytes read. */
    public static final Getter HTTP_EXPLORER = url -> {
        URI u;
        try {
            u = new URI(url);
        } catch (Exception e) {
            throw new NetError("not an allowed URL: " + url);
        }
        if (!"https".equals(u.getScheme()) || u.getHost() == null || !EXPLORER_HOSTS.contains(u.getHost()) || (u.getPort() != -1 && u.getPort() != 443)) throw new NetError("not an allowed URL: " + url);
        try {
            HttpClient c = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).connectTimeout(Duration.ofSeconds(30)).build();
            HttpRequest r = HttpRequest.newBuilder(u).GET().timeout(Duration.ofSeconds(30)).header("user-agent", "nenrin-verify-furui/1").header("accept", "text/plain").build();
            HttpResponse<InputStream> res = c.send(r, HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream in = res.body()) {
                return new Object[] {res.statusCode(), in.readNBytes(4096)};
            }
        } catch (Exception e) {
            throw new NetError(url + ": " + e);
        }
    };

    // ---- the run ----

    static final Object NOT_JSON = new Object();

    static final class Run {
        final Getter g;
        final List<String> names;
        final List<Object[]> steps = new ArrayList<>();
        Map<String, Object> facts;

        Run(Getter g, List<String> names) { this.g = g; this.names = names; }

        Object[] getj(String url) throws NetError {
            Object[] r = g.get(url);
            Object v;
            try {
                v = Json.parse((byte[]) r[1]);
            } catch (Json.Bad e) {
                v = NOT_JSON;
            }
            return new Object[] {r[0], v};
        }

        void put(String state, String code) { steps.add(new Object[] {steps.size() + 1, names.get(steps.size()), state, code}); }

        Map<String, Object> result(String cmd, Map<String, Object> args) {
            while (steps.size() < names.size()) put("skipped", null);
            String verdict = "ok";
            Object first = Json.NULL;
            List<Object> st = new ArrayList<>();
            for (Object[] s : steps) {
                if (s[2].equals("fail")) verdict = "fail";
                else if (s[2].equals("not_yet") && verdict.equals("ok")) verdict = "not_yet";
                if (first == Json.NULL && (s[2].equals("fail") || s[2].equals("not_yet"))) first = (double) (Integer) s[0];
                st.add(obj("step", (double) (Integer) s[0], "name", s[1], "state", s[2], "code", s[3] == null ? Json.NULL : s[3]));
            }
            return obj("schema", CHECK_SCHEMA, "command", cmd, "args", args, "verdict", verdict, "first_not_ok", first, "steps", st, "facts", facts);
        }
    }

    static int status(Object[] r) { return (Integer) r[0]; }

    /** [part, state, code] */
    static String[] anchor(Run run, long n, String recordSha, String recordSchema, boolean needBlockTime) throws NetError {
        Object[] r = run.getj(LEDGER + "/ledger/" + n + "?format=json");
        int s = status(r);
        Object e = r[1];
        if (s != 200) return new String[] {"batch", "fail", "entry_http_" + s};
        if (!isObj(e)) return new String[] {"batch", "fail", "entry_not_json"};
        Object rc = get(e, "record_canonical");
        if (!isStr(rc) || !strEq(get(e, "claim_sha256"), sha((String) rc))) return new String[] {"batch", "fail", "entry_bytes_do_not_hash_to_claim"};
        Object bt;
        try {
            bt = Json.parse((String) rc);
        } catch (Json.Bad x) {
            bt = null;
        }
        boolean listed = false;
        if (strEq(get(bt, "schema"), "nenrin-agreement-batch-v1") && isArr(get(bt, "records"))) {
            for (Object x : arr(get(bt, "records"))) if (strEq(get(x, "canonical_sha256"), recordSha) && strEq(get(x, "record_schema"), recordSchema)) listed = true;
        }
        if (!listed) return new String[] {"batch", "fail", "record_not_in_entry"};
        run.facts.put("ledger_entry", (double) n);
        Long bb = integer(get(e, "bitcoin_block"), 1);
        if (!strEq(get(e, "ots_status"), "confirmed") || bb == null || (needBlockTime && !truthy(get(e, "block_time")))) return new String[] {"anchor", "not_yet", "ots_not_confirmed"};
        Object[] o = run.g.get(LEDGER + "/ledger/" + n + "/ots");
        if (status(o) != 200) return new String[] {"anchor", "fail", "ots_http_" + status(o)};
        Ots.Result p;
        try {
            p = Ots.parse((byte[]) o[1]);
        } catch (Json.Bad x) {
            return new String[] {"anchor", "fail", "ots_parse"};
        }
        if (!strEq(get(e, "claim_sha256"), p.digest)) return new String[] {"anchor", "fail", "ots_digest_is_not_the_entry"};
        if (p.bitcoin.isEmpty()) return new String[] {"anchor", "fail", "ots_no_bitcoin_attestation"};
        for (Object[] x : p.bitcoin) {
            if (((Long) x[0]).longValue() == bb.longValue()) {
                run.facts.put("bitcoin_block", (double) bb);
                run.facts.put("merkle_root", x[1]);
                return new String[] {"anchor", "ok", null};
            }
        }
        return new String[] {"anchor", "fail", "ots_height_is_not_the_entry_block"};
    }

    // ---- --bitcoin-header: the block header at the proof's height, from two explorers ----

    static byte[] sha256d(byte[] b) { return sha256(sha256(b)); }

    static String reversedHex(byte[] b, int from, int to) {
        byte[] r = new byte[to - from];
        for (int i = 0; i < r.length; i++) r[i] = b[to - 1 - i];
        return hex(r);
    }

    /** The target a header's compact bits encode, or null when the bits are negative, zero or wider than 256 bits. */
    public static BigInteger bitsTarget(long bits) {
        long exp = bits >>> 24, mant = bits & 0x007fffffL;
        if ((bits & 0x00800000L) != 0 || mant == 0 || exp > 32) return null;
        return exp >= 3 ? BigInteger.valueOf(mant).shiftLeft((int) (8 * (exp - 3))) : BigInteger.valueOf(mant).shiftRight((int) (8 * (3 - exp)));
    }

    /** [state, code or null, facts or null]. The explorers are asked in EXPLORERS order; the first difference is the code. */
    public static Object[] bitcoinHeader(long height, String merkleRoot, Getter g) throws NetError {
        List<String> hashes = new ArrayList<>(), headers = new ArrayList<>();
        for (String[] ex : EXPLORERS) {
            String name = ex[0], base = ex[1];
            Object[] r = g.get(base + "/block-height/" + height);
            if (status(r) != 200) return new Object[] {"fail", name + "_height_http_" + status(r), null};
            String t = new String((byte[]) r[1], StandardCharsets.ISO_8859_1);
            if (!H64.matcher(t).matches()) return new Object[] {"fail", name + "_hash_shape", null};
            r = g.get(base + "/block/" + t + "/header");
            if (status(r) != 200) return new Object[] {"fail", name + "_header_http_" + status(r), null};
            String x = new String((byte[]) r[1], StandardCharsets.ISO_8859_1);
            if (!HEX160.matcher(x).matches()) return new Object[] {"fail", name + "_header_shape", null};
            hashes.add(t);
            headers.add(x);
        }
        if (!hashes.get(0).equals(hashes.get(1))) return new Object[] {"fail", "explorers_name_different_blocks", null};
        if (!headers.get(0).equals(headers.get(1))) return new Object[] {"fail", "explorers_serve_different_headers", null};
        byte[] hb = unhex(headers.get(0));
        byte[] d = sha256d(hb);
        String bh = reversedHex(d, 0, d.length);
        if (!bh.equals(hashes.get(0))) return new Object[] {"fail", "header_hash_is_not_the_named_block", null};
        long bits = (hb[72] & 0xffL) | (hb[73] & 0xffL) << 8 | (hb[74] & 0xffL) << 16 | (hb[75] & 0xffL) << 24;
        BigInteger target = bitsTarget(bits);
        if (target == null) return new Object[] {"fail", "header_bits_shape", null};
        if (new BigInteger(bh, 16).compareTo(target) > 0) return new Object[] {"fail", "header_hash_above_its_target", null};
        if (!reversedHex(hb, 36, 68).equals(merkleRoot)) return new Object[] {"fail", "header_merkle_root_is_not_the_proof", null};
        return new Object[] {"ok", null, obj("block_hash", bh, "header", headers.get(0), "explorers", new ArrayList<Object>(EXPLORER_HOSTS))};
    }

    /** the step after bitcoin_anchor, when the flag is given: skipped unless the anchor step is ok */
    static void headerStep(Run run, Getter hg) throws NetError {
        if (run.steps.isEmpty()) return;
        Object[] last = run.steps.get(run.steps.size() - 1);
        if (!"bitcoin_anchor".equals(last[1]) || !"ok".equals(last[2])) return;
        Object[] h = bitcoinHeader(Json.asInt(run.facts.get("bitcoin_block")), (String) run.facts.get("merkle_root"), hg);
        run.facts.put("bitcoin_header", nz(h[2]));
        run.put((String) h[0], (String) h[1]);
    }

    static List<String> steps(List<String> base, boolean bitcoinHeader) {
        List<String> s = new ArrayList<>(base);
        if (bitcoinHeader) s.add(HEADER_STEP);
        return s;
    }

    public static Map<String, Object> furuiDay(String day, long leaf, Getter g) throws NetError { return furuiDay(day, leaf, g, false, HTTP_EXPLORER); }

    /** furuiDay with --bitcoin-header (step 7) when bitcoinHeader; headerGet reads the explorers. */
    public static Map<String, Object> furuiDay(String day, long leaf, Getter g, boolean bitcoinHeader, Getter headerGet) throws NetError {
        return furuiDay(day, leaf, g, bitcoinHeader, headerGet, 1);
    }

    /** furuiDay of runner 1 or 2 (--runner); runner 2 reads /furui2/day/ and wants key_id and runner_id runner-2. */
    public static Map<String, Object> furuiDay(String day, long leaf, Getter g, boolean bitcoinHeader, Getter headerGet, int runner) throws NetError {
        Run run = new Run(g, steps(DAY_STEPS, bitcoinHeader));
        run.facts = obj("day", day, "leaf", (double) leaf, "record_sha256", Json.NULL, "n", Json.NULL, "root", Json.NULL, "ledger_entry", Json.NULL, "bitcoin_block", Json.NULL, "merkle_root", Json.NULL);
        Map<String, Object> args = obj("day", day, "leaf", (double) leaf);
        if (bitcoinHeader) {
            run.facts.put("bitcoin_header", Json.NULL);
            args.put("bitcoin_header", true);
        }
        if (runner != 1) args.put("runner", (double) runner);
        String rid = "runner-" + runner, path = RUNNER + (runner == 2 ? "/furui2/day/" : "/furui/day/");
        String cmd = "furui-day";
        // 1 envelope_shape
        Object[] r = run.getj(path + day + "/leaf/" + leaf);
        int s = status(r);
        Object a = r[1];
        if (s == 404 && strEq(get(a, "error"), "day_open")) {
            Object[] t = run.getj(path + day + "/status");
            Object v = status(t) == 200 && strEq(get(t[1], "day"), day) ? get(t[1], "status") : null;
            if (strEq(get(v, "state"), "empty")) run.put("fail", "day_closed_empty");
            else run.put("not_yet", "day_open");
            return run.result(cmd, args);
        }
        if (s != 200) { run.put("fail", "leaf_http_" + s); return run.result(cmd, args); }
        if (!isObj(a)) { run.put("fail", "leaf_not_json"); return run.result(cmd, args); }
        Long idx = integer(get(a, "index"), 0);
        if (!strEq(get(a, "day"), day) || idx == null || idx != leaf) { run.put("fail", "leaf_is_another_day_or_index"); return run.result(cmd, args); }
        Object env = get(a, "envelope");
        String p = envelopeProblem(env, rid);
        if (p != null) { run.put("fail", "envelope_shape:" + p); return run.result(cmd, args); }
        String envc = canonOrNull(env);
        if (envc == null) { run.put("fail", "envelope_shape:not_canonical"); return run.result(cmd, args); }
        run.put("ok", null);
        // 2 leaf_sha256
        String lh = sha(Ots.concat(new byte[] {0}, utf8(envc)));
        if (!strEq(get(a, "leaf_sha256"), lh)) { run.put("fail", "leaf_sha256_is_not_the_envelope"); return run.result(cmd, args); }
        if (!strEq(get(a, "envelope_sha256"), sha(envc))) { run.put("fail", "envelope_sha256_is_not_the_envelope"); return run.result(cmd, args); }
        run.put("ok", null);
        // 3 audit_path
        Object dr = get(a, "day_record");
        if (!isObj(dr) || !isStr(get(dr, "state"))) { run.put("fail", "no_day_record"); return run.result(cmd, args); }
        if (!strEq(get(dr, "state"), "accepted")) { run.put("not_yet", "day_record_not_accepted"); return run.result(cmd, args); }
        if (!hex64(get(dr, "ledger_canonical_sha256"))) { run.put("fail", "no_day_record"); return run.result(cmd, args); }
        String rs = (String) get(dr, "ledger_canonical_sha256");
        Object[] l = run.getj(LEDGER + "/furui-check-day/" + rs);
        Object lr = l[1];
        if (status(l) != 200) { run.put("fail", "day_record_http_" + status(l)); return run.result(cmd, args); }
        if (!isObj(lr)) { run.put("fail", "day_record_not_json"); return run.result(cmd, args); }
        Object rcv = get(lr, "record_canonical");
        if (!isStr(rcv) || !sha((String) rcv).equals(rs)) { run.put("fail", "day_record_bytes_do_not_hash_to_sha"); return run.result(cmd, args); }
        Object rec;
        try {
            rec = Json.parse((String) rcv);
            if (!Json.canonical(rec).equals(rcv)) throw new Json.Bad("not canonical");
        } catch (Json.Bad x) {
            run.put("fail", "day_record_not_canonical");
            return run.result(cmd, args);
        }
        p = dayRecordProblem(rec);
        if (p != null) { run.put("fail", p); return run.result(cmd, args); }
        if (!strEq(get(rec, "day"), day)) { run.put("fail", "day_record_is_another_day"); return run.result(cmd, args); }
        long rn = integer(get(rec, "n"), 1);
        String root = (String) get(rec, "root");
        run.facts.put("record_sha256", rs);
        run.facts.put("n", (double) rn);
        run.facts.put("root", root);
        Long an = integer(get(a, "n"), 0);
        if (an == null || an != rn || !strEq(get(a, "root"), root)) { run.put("fail", "n_or_root_differs_from_the_ledger_record"); return run.result(cmd, args); }
        Object prv = get(a, "proof");
        boolean pok = strEq(get(a, "proof_kind"), "rfc6962-audit-path") && isArr(prv) && arr(prv).size() <= 64;
        List<String> proof = new ArrayList<>();
        for (Object x : arr(prv)) {
            if (!hex64(x)) { pok = false; break; }
            proof.add((String) x);
        }
        if (!pok) { run.put("fail", "proof_shape"); return run.result(cmd, args); }
        String got = leaf < rn ? rootFromPath(lh, leaf, rn, proof) : null;
        if (got == null || !got.equals(root)) { run.put("fail", "proof_does_not_rebuild_the_root"); return run.result(cmd, args); }
        run.put("ok", null);
        // 4 signature
        Object[] k = run.getj(KEYS_URL);
        int ks = status(k);
        Object kd = k[1];
        Object rsg = arr(get(rec, "signatures")).get(0);
        String kid = (String) get(rsg, "key_id");
        boolean kListed = ks == 200 && strEq(get(kd, "use"), "furui-check") && isArr(get(kd, "keys"));
        Object key = null;
        if (kListed) for (Object x : arr(get(kd, "keys"))) if (isObj(x) && strEq(get(x, "key_id"), kid)) { key = x; break; }
        byte[] pub = key != null ? b64(get(key, "public_key_ed25519_b64"), 32) : null;
        try {
            if (pub == null) run.put("skipped", "no_listed_key");
            else {
                byte[] rsig = b64(get(rsg, "sig"), 64);
                if (rsig == null || !verify(pub, dayMessage(rec), rsig)) { run.put("fail", "day_record_signature"); return run.result(cmd, args); }
                byte[] esig = Base64.getDecoder().decode((String) get(arr(get(env, "signatures")).get(0), "sig"));
                if (!verify(pub, envelopeMessage(env), esig)) { run.put("fail", "envelope_signature"); return run.result(cmd, args); }
                run.put("ok", null);
            }
        } catch (Json.Bad | IllegalArgumentException x) {
            run.put("fail", "day_record_signature");
            return run.result(cmd, args);
        }
        // 5 runner_key
        if (ks != 200) { run.put("fail", "keys_http_" + ks); return run.result(cmd, args); }
        if (!isObj(kd)) { run.put("fail", "keys_not_json"); return run.result(cmd, args); }
        if (!kListed) { run.put("fail", "keys_not_furui_check"); return run.result(cmd, args); }
        if (!signerIs(get(rec, "signer"))) { run.put("fail", "signer_is_not_the_ledger_keys"); return run.result(cmd, args); }
        if (!rid.equals(kid)) { run.put("fail", "key_id_is_not_" + rid.replace("-", "_")); return run.result(cmd, args); }
        Object recRid = get(rec, "runner_id");
        if (!(recRid == null && rid.equals("runner-1")) && !strEq(recRid, rid)) { run.put("fail", "runner_id_is_not_" + rid.replace("-", "_")); return run.result(cmd, args); }
        if (key == null) { run.put("fail", "key_not_listed"); return run.result(cmd, args); }
        if (pub == null) { run.put("fail", "key_not_32_bytes"); return run.result(cmd, args); }
        Long fh = integer(get(key, "from_height"), 0);
        Object rhv = get(key, "revoked_height");
        Long rh = integer(rhv, 0);
        boolean revNone = rhv == null || rhv == Json.NULL;
        if (fh == null || !(revNone || rh != null)) { run.put("fail", "key_heights_shape"); return run.result(cmd, args); }
        long hh = integer(get(get(env, "check"), "checked_at_height"), 0);
        long first = integer(get(rec, "first_height"), 0), last = integer(get(rec, "last_height"), 0);
        if (first < fh || hh < fh) { run.put("fail", "key_not_yet_valid"); return run.result(cmd, args); }
        if (!revNone && (last >= rh || hh >= rh)) { run.put("fail", "key_revoked"); return run.result(cmd, args); }
        run.put("ok", null);
        // 6 bitcoin_anchor
        Long le = integer(get(lr, "ledger_entry"), 1);
        if (!strEq(get(lr, "status"), "anchored") || le == null) { run.put("not_yet", "not_in_an_anchored_batch_yet"); return run.result(cmd, args); }
        String[] an6 = anchor(run, le, rs, "furui-check-day-v0", false);
        run.put(an6[1], an6[2]);
        if (bitcoinHeader) headerStep(run, headerGet);
        return run.result(cmd, args);
    }

    public static String host(String endpoint) {
        try {
            String h = new URI(endpoint).getHost();
            return h == null ? null : h.toLowerCase(Locale.ROOT);
        } catch (Exception e) {
            return null;
        }
    }

    static boolean lineClosed(Object ln) {
        Object c = get(ln, "content");
        Object d = get(ln, "decision");
        if (!(keysAre(ln, Arrays.asList("content", "decision", "ledger_n", "record_sha256", "revoked")) && integer(get(ln, "ledger_n"), 1) != null
            && (strEq(d, "admit") || strEq(d, "escalate") || strEq(d, "refuse")) && isBool(get(ln, "revoked")))) return false;
        if (isNull(c)) return true;
        Object cd = get(c, "decision"), rs = get(c, "rules_sha256");
        return keysAre(c, Arrays.asList("checked", "decision", "marks", "rules_sha256")) && isBool(get(c, "checked"))
            && (isNull(cd) || strEq(cd, "stop") || strEq(cd, "pass")) && marksOk(get(c, "marks")) && (isNull(rs) || hex64(rs));
    }

    static boolean strictEq(Object a, Object b) {
        if (a instanceof String || a instanceof Double || a instanceof Boolean) return a.equals(b);
        if (a == Json.NULL) return b == Json.NULL;
        return false;
    }

    public static Map<String, Object> resumeAdmission(String endpoint, String recordSha, Getter g) throws NetError { return resumeAdmission(endpoint, recordSha, g, false, HTTP_EXPLORER); }

    /** resumeAdmission with --bitcoin-header (step 6) when bitcoinHeader; headerGet reads the explorers. */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> resumeAdmission(String endpoint, String recordSha, Getter g, boolean bitcoinHeader, Getter headerGet) throws NetError {
        Run run = new Run(g, steps(RES_STEPS, bitcoinHeader));
        run.facts = obj("endpoint", endpoint, "record_sha256", recordSha, "resume_sha256", Json.NULL, "ledger_entry", Json.NULL, "bitcoin_block", Json.NULL, "merkle_root", Json.NULL);
        Map<String, Object> args = obj("endpoint", endpoint, "record_sha256", recordSha);
        if (bitcoinHeader) {
            run.facts.put("bitcoin_header", Json.NULL);
            args.put("bitcoin_header", true);
        }
        String cmd = "resume-admission";
        // 1 resume
        Object[] r = run.getj(LEDGER + "/resume?endpoint=" + encComponent(endpoint));
        Object rv = r[1];
        if (status(r) != 200) { run.put("fail", "resume_http_" + status(r)); return run.result(cmd, args); }
        if (!isObj(rv)) { run.put("fail", "resume_not_json"); return run.result(cmd, args); }
        if (!strEq(get(rv, "schema"), "nenrin-resume-v1")) { run.put("fail", "resume_schema"); return run.result(cmd, args); }
        if (!strEq(get(rv, "measured_endpoint"), endpoint)) { run.put("fail", "resume_is_another_endpoint"); return run.result(cmd, args); }
        Map<String, Object> body = new LinkedHashMap<>();
        for (Map.Entry<String, Object> en : ((Map<String, Object>) rv).entrySet()) if (!RESUME_ENV.contains(en.getKey())) body.put(en.getKey(), en.getValue());
        String bc = canonOrNull(body);
        if (bc == null || !strEq(get(rv, "resume_sha256"), sha(bc))) { run.put("fail", "resume_sha256_does_not_recompute"); return run.result(cmd, args); }
        run.facts.put("resume_sha256", get(rv, "resume_sha256"));
        run.put("ok", null);
        // 2 admission_line
        if (!isArr(get(rv, "admissions"))) { run.put("fail", "no_admissions_list"); return run.result(cmd, args); }
        List<Object> lines = new ArrayList<>();
        for (Object x : arr(get(rv, "admissions"))) if (isObj(x) && strEq(get(x, "record_sha256"), recordSha)) lines.add(x);
        if (lines.isEmpty()) {
            boolean held = false;
            for (Object x : arr(get(rv, "not_counted"))) {
                if (isObj(x) && strEq(get(x, "record_sha256"), recordSha) && strEq(get(x, "kind"), "admission")
                    && (strEq(get(x, "why"), "not_yet_anchored") || strEq(get(x, "why"), "confirmed_without_block_time"))) held = true;
            }
            if (held) run.put("not_yet", "not_anchored_yet");
            else run.put("fail", "not_listed");
            return run.result(cmd, args);
        }
        if (lines.size() > 1) { run.put("fail", "listed_twice"); return run.result(cmd, args); }
        Object ln = lines.get(0);
        if (!lineClosed(ln)) { run.put("fail", "line_not_closed"); return run.result(cmd, args); }
        run.put("ok", null);
        // 3 admission_record
        Object[] a = run.getj(LEDGER + "/admission/" + recordSha);
        Object st = a[1];
        if (status(a) != 200) { run.put("fail", "admission_http_" + status(a)); return run.result(cmd, args); }
        if (!isObj(st)) { run.put("fail", "admission_not_json"); return run.result(cmd, args); }
        Object rc = get(st, "record_canonical");
        if (!isStr(rc) || !sha((String) rc).equals(recordSha)) { run.put("fail", "admission_bytes_do_not_hash_to_sha"); return run.result(cmd, args); }
        Object rec;
        try {
            rec = Json.parse((String) rc);
        } catch (Json.Bad x) {
            rec = null;
        }
        if (!isObj(rec) || !strEq(get(rec, "schema"), "a2a-admission-v0")) { run.put("fail", "admission_schema"); return run.result(cmd, args); }
        Object rp = get(rec, "relying_party");
        String rpd = isObj(rp) && isStr(get(rp, "domain")) ? ((String) get(rp, "domain")).toLowerCase(Locale.ROOT) : null;
        String h = host(endpoint);
        if (rpd == null || rpd.isEmpty() || h == null || h.isEmpty() || !(h.equals(rpd) || h.endsWith("." + rpd))) { run.put("fail", "relying_party_is_not_the_endpoint_host"); return run.result(cmd, args); }
        if (!strictEq(get(rec, "decision"), get(ln, "decision"))) { run.put("fail", "decision_differs"); return run.result(cmd, args); }
        Object rules = get(rec, "rules");
        Object want = null;
        if (isObj(rules) && strEq(get(rules, "version"), "0.4") && isObj(get(rec, "content"))) {
            Object cb = get(rec, "content");
            want = obj("checked", nz(get(cb, "checked")), "decision", nz(get(cb, "decision")), "marks", nz(get(cb, "marks")), "rules_sha256", nz(get(cb, "rules_sha256")));
        }
        Object lc = get(ln, "content");
        boolean same;
        if (want == null) same = isNull(lc);
        else if (isNull(lc)) same = false;
        else {
            String x = canonOrNull(want), y = canonOrNull(lc);
            same = x != null && x.equals(y);
        }
        if (!same) { run.put("fail", "content_differs"); return run.result(cmd, args); }
        run.put("ok", null);
        // 4 ledger_batch, 5 bitcoin_anchor
        String[] an = anchor(run, integer(get(ln, "ledger_n"), 1), recordSha, "a2a-admission-v0", true);
        if (an[0].equals("batch")) { run.put(an[1], an[2]); return run.result(cmd, args); }
        run.put("ok", null);
        if (an[1].equals("not_yet")) run.put("fail", "entry_listed_by_the_resume_is_not_anchored");
        else run.put(an[1], an[2]);
        if (bitcoinHeader) headerStep(run, headerGet);
        return run.result(cmd, args);
    }

    static Object nz(Object v) { return v == null ? Json.NULL : v; }

    // ---- vectors ----

    public static Getter worldGetter(Object world) {
        return url -> {
            Object w = get(world, url);
            if (w == null) return new Object[] {404, utf8("{\"error\":\"not_found\"}")};
            int st = integer(get(w, "status"), 0).intValue();
            if (isStr(get(w, "body_b64"))) return new Object[] {st, Base64.getDecoder().decode((String) get(w, "body_b64"))};
            return new Object[] {st, utf8((String) get(w, "body"))};
        };
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> summary(Map<String, Object> res) {
        List<Object> steps = new ArrayList<>();
        for (Object s : (List<Object>) res.get("steps")) steps.add(Arrays.asList(get(s, "step"), get(s, "state"), get(s, "code")));
        return obj("verdict", res.get("verdict"), "steps", steps, "facts", res.get("facts"));
    }

    public static Object runCase(Object c) throws NetError {
        String cmd = (String) get(c, "command");
        Object a = get(c, "args");
        if (cmd.equals("ots-parse")) {
            try {
                Ots.Result p = Ots.parse(Base64.getDecoder().decode((String) get(a, "body_b64")));
                List<Object> bt = new ArrayList<>();
                for (Object[] x : p.bitcoin) bt.add(Arrays.asList((double) (Long) x[0], x[1]));
                return obj("digest", p.digest, "bitcoin", bt, "pending", (double) p.pending);
            } catch (Json.Bad e) {
                return obj("error", e.getMessage());
            }
        }
        Getter g = worldGetter(get(c, "world"));
        if (cmd.equals("bitcoin-header")) {
            Object[] h = bitcoinHeader(integer(get(a, "height"), 0), (String) get(a, "merkle_root"), g);
            return obj("state", h[0], "code", nz(h[1]), "facts", nz(h[2]));
        }
        boolean bh = Boolean.TRUE.equals(get(a, "bitcoin_header"));
        Long rn = integer(get(a, "runner"), 1);
        if (cmd.equals("furui-day")) return summary(furuiDay((String) get(a, "day"), integer(get(a, "leaf"), 0), g, bh, g, rn != null && rn == 2 ? 2 : 1));
        return summary(resumeAdmission((String) get(a, "endpoint"), (String) get(a, "record_sha256"), g, bh, g));
    }
}
