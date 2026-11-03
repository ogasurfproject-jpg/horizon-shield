package dev.horizonshield.nenrin;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * JSON as the Python, JavaScript and Go ports read it: UTF-8 must be valid, every number a double, duplicate keys
 * last-wins, a lone surrogate from a \\u escape is kept. JSON null is {@link #NULL}; a missing key reads as Java null.
 * musubi-canonical-v0: keys sorted, no whitespace, non-ASCII raw; non-integers, unsafe integers, keys that are not
 * printable ASCII and lone surrogates are refused.
 */
public final class Json {
    private Json() {}

    /** JSON null. */
    public static final Object NULL = new Object() {
        @Override
        public String toString() { return "null"; }
    };

    public static final long SAFE = 9007199254740991L;

    /** A refusal: bytes that are not JSON, or a value that has no canonical form. */
    public static final class Bad extends Exception {
        private static final long serialVersionUID = 1L;

        public Bad(String m) { super(m); }
    }

    public static Object parse(byte[] b) throws Bad {
        String s;
        try {
            s = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(b)).toString();
        } catch (CharacterCodingException e) {
            throw new Bad("utf8");
        }
        return parse(s);
    }

    public static Object parse(String s) throws Bad {
        P p = new P(s);
        p.ws();
        Object v = p.value(0);
        p.ws();
        if (p.i != s.length()) throw new Bad("trailing");
        return v;
    }

    private static final class P {
        final String s;
        int i;

        P(String s) { this.s = s; }

        void ws() {
            while (i < s.length()) {
                char c = s.charAt(i);
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') i++;
                else break;
            }
        }

        Object value(int depth) throws Bad {
            if (depth > 4000) throw new Bad("deep");
            if (i >= s.length()) throw new Bad("end");
            char c = s.charAt(i);
            if (c == '{') return object(depth);
            if (c == '[') return array(depth);
            if (c == '"') return str();
            if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
            if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
            if (s.startsWith("null", i)) { i += 4; return NULL; }
            if (c == '-' || (c >= '0' && c <= '9')) return number();
            throw new Bad("unexpected");
        }

        Object number() throws Bad {
            int st = i;
            if (s.charAt(i) == '-') i++;
            if (i >= s.length()) throw new Bad("number");
            if (s.charAt(i) == '0') i++;
            else if (s.charAt(i) >= '1' && s.charAt(i) <= '9') { while (i < s.length() && Character.isDigit(s.charAt(i)) && s.charAt(i) < 128) i++; }
            else throw new Bad("number");
            if (i < s.length() && s.charAt(i) == '.') {
                i++;
                int d = i;
                while (i < s.length() && s.charAt(i) >= '0' && s.charAt(i) <= '9') i++;
                if (i == d) throw new Bad("number");
            }
            if (i < s.length() && (s.charAt(i) == 'e' || s.charAt(i) == 'E')) {
                i++;
                if (i < s.length() && (s.charAt(i) == '+' || s.charAt(i) == '-')) i++;
                int d = i;
                while (i < s.length() && s.charAt(i) >= '0' && s.charAt(i) <= '9') i++;
                if (i == d) throw new Bad("number");
            }
            return Double.parseDouble(s.substring(st, i));
        }

        String str() throws Bad {
            i++;
            StringBuilder b = new StringBuilder();
            while (true) {
                if (i >= s.length()) throw new Bad("string");
                char c = s.charAt(i++);
                if (c == '"') return b.toString();
                if (c < 0x20) throw new Bad("control");
                if (c != '\\') { b.append(c); continue; }
                if (i >= s.length()) throw new Bad("escape");
                char e = s.charAt(i++);
                switch (e) {
                    case '"': b.append('"'); break;
                    case '\\': b.append('\\'); break;
                    case '/': b.append('/'); break;
                    case 'b': b.append('\b'); break;
                    case 'f': b.append('\f'); break;
                    case 'n': b.append('\n'); break;
                    case 'r': b.append('\r'); break;
                    case 't': b.append('\t'); break;
                    case 'u':
                        if (i + 4 > s.length()) throw new Bad("escape");
                        int u = 0;
                        for (int k = 0; k < 4; k++) {
                            int h = Character.digit(s.charAt(i + k), 16);
                            if (h < 0 || s.charAt(i + k) > 127) throw new Bad("escape");
                            u = u * 16 + h;
                        }
                        i += 4;
                        b.append((char) u);
                        break;
                    default:
                        throw new Bad("escape");
                }
            }
        }

        List<Object> array(int depth) throws Bad {
            i++;
            List<Object> a = new ArrayList<>();
            ws();
            if (i < s.length() && s.charAt(i) == ']') { i++; return a; }
            while (true) {
                ws();
                a.add(value(depth + 1));
                ws();
                if (i >= s.length()) throw new Bad("array");
                char c = s.charAt(i++);
                if (c == ']') return a;
                if (c != ',') throw new Bad("array");
            }
        }

        Map<String, Object> object(int depth) throws Bad {
            i++;
            Map<String, Object> o = new LinkedHashMap<>();
            ws();
            if (i < s.length() && s.charAt(i) == '}') { i++; return o; }
            while (true) {
                ws();
                if (i >= s.length() || s.charAt(i) != '"') throw new Bad("object");
                String k = str();
                ws();
                if (i >= s.length() || s.charAt(i) != ':') throw new Bad("object");
                i++;
                ws();
                o.put(k, value(depth + 1));
                ws();
                if (i >= s.length()) throw new Bad("object");
                char c = s.charAt(i++);
                if (c == '}') return o;
                if (c != ',') throw new Bad("object");
            }
        }
    }

    // ---- canonical ----

    public static String canonical(Object v) throws Bad {
        StringBuilder b = new StringBuilder();
        canon(b, v);
        return b.toString();
    }

    /** The integer value of a JSON number when it is an integer inside +-(2^53 - 1), else null. */
    public static Long asInt(Object v) {
        if (!(v instanceof Double)) return null;
        double d = (Double) v;
        if (Double.isNaN(d) || Double.isInfinite(d) || d != Math.floor(d) || Math.abs(d) > SAFE) return null;
        return (long) d;
    }

    static boolean loneSurrogate(String s) {
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (Character.isHighSurrogate(c) && i + 1 < s.length() && Character.isLowSurrogate(s.charAt(i + 1))) { i++; continue; }
            if (Character.isSurrogate(c)) return true;
        }
        return false;
    }

    /** JSON.stringify of a string. */
    public static String quote(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\b': b.append("\\b"); break;
                case '\f': b.append("\\f"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    @SuppressWarnings("unchecked")
    private static void canon(StringBuilder b, Object v) throws Bad {
        if (v == NULL) b.append("null");
        else if (v instanceof Boolean) b.append(((Boolean) v) ? "true" : "false");
        else if (v instanceof Double) {
            Long n = asInt(v);
            if (n == null) throw new Bad("number");
            b.append(n.longValue());
        } else if (v instanceof Long || v instanceof Integer) {
            long n = ((Number) v).longValue();
            if (Math.abs(n) > SAFE) throw new Bad("number");
            b.append(n);
        } else if (v instanceof String) {
            if (loneSurrogate((String) v)) throw new Bad("lone surrogate");
            b.append(quote((String) v));
        } else if (v instanceof List) {
            b.append('[');
            boolean first = true;
            for (Object x : (List<Object>) v) {
                if (!first) b.append(',');
                first = false;
                canon(b, x);
            }
            b.append(']');
        } else if (v instanceof Map) {
            Map<String, Object> m = (Map<String, Object>) v;
            List<String> ks = new ArrayList<>(m.keySet());
            for (String k : ks) for (int i = 0; i < k.length(); i++) if (k.charAt(i) < 0x20 || k.charAt(i) > 0x7e) throw new Bad("key");
            Collections.sort(ks);
            b.append('{');
            boolean first = true;
            for (String k : ks) {
                if (!first) b.append(',');
                first = false;
                b.append(quote(k)).append(':');
                canon(b, m.get(k));
            }
            b.append('}');
        } else throw new Bad("type");
    }

    /** JSON with keys sorted and two spaces of indent, as the other ports print a result. */
    @SuppressWarnings("unchecked")
    public static String pretty(Object v, String ind) {
        if (v instanceof List) {
            List<Object> a = (List<Object>) v;
            if (a.isEmpty()) return "[]";
            StringBuilder b = new StringBuilder("[\n");
            for (int i = 0; i < a.size(); i++) {
                b.append(ind).append("  ").append(pretty(a.get(i), ind + "  "));
                if (i < a.size() - 1) b.append(',');
                b.append('\n');
            }
            return b.append(ind).append(']').toString();
        }
        if (v instanceof Map) {
            Map<String, Object> m = (Map<String, Object>) v;
            List<String> ks = new ArrayList<>(m.keySet());
            Collections.sort(ks);
            if (ks.isEmpty()) return "{}";
            StringBuilder b = new StringBuilder("{\n");
            for (int i = 0; i < ks.size(); i++) {
                b.append(ind).append("  ").append(quote(ks.get(i))).append(": ").append(pretty(m.get(ks.get(i)), ind + "  "));
                if (i < ks.size() - 1) b.append(',');
                b.append('\n');
            }
            return b.append(ind).append('}').toString();
        }
        try {
            return canonical(v);
        } catch (Bad e) {
            return "null";
        }
    }
}
