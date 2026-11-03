package dev.horizonshield.nenrin;

import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** OpenTimestamps: enough of the format to follow sha256, append and prepend from the file digest to the attestations. */
public final class Ots {
    private Ots() {}

    static final byte[] MAGIC = Furui.unhex("004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294");
    static final String BITCOIN = "0588960d73d71901";
    static final String PENDING = "83dfe30d2ef90c8e";

    /** What a proof commits to: the file digest, each Bitcoin attestation as (height, merkle root in block explorer order), and the pending count. */
    public static final class Result {
        public String digest;
        public final List<Object[]> bitcoin = new ArrayList<>();
        public int pending;
    }

    private static final class R {
        final byte[] b;
        int pos;
        int steps;
        final Result out = new Result();

        R(byte[] b) { this.b = b; }

        byte[] rd(int n) throws Json.Bad {
            if (n < 0 || pos + n > b.length) throw new Json.Bad("ots_truncated");
            byte[] v = Arrays.copyOfRange(b, pos, pos + n);
            pos += n;
            return v;
        }

        long varuint() throws Json.Bad {
            long v = 0;
            for (int i = 0; i < 8; i++) {
                int c = rd(1)[0] & 0xff;
                v |= ((long) (c & 0x7f)) << (7 * i);
                if ((c & 0x80) == 0) {
                    if (v > Json.SAFE) throw new Json.Bad("ots_varuint");
                    return v;
                }
            }
            throw new Json.Bad("ots_varuint");
        }

        byte[] varbytes(long mx) throws Json.Bad {
            long n = varuint();
            if (n > mx) throw new Json.Bad("ots_too_long");
            return rd((int) n);
        }

        void item(int tag, byte[] msg, int depth) throws Json.Bad {
            if (tag == 0) {
                String t = Furui.hex(rd(8));
                byte[] payload = varbytes(8192);
                if (t.equals(BITCOIN)) {
                    long v = 0;
                    int i = 0;
                    boolean done = false;
                    while (i < payload.length && i < 8) {
                        int c = payload[i] & 0xff;
                        v |= ((long) (c & 0x7f)) << (7 * i);
                        i++;
                        if ((c & 0x80) == 0) { done = true; break; }
                    }
                    if (!done || i != payload.length || v > Json.SAFE || msg.length != 32) throw new Json.Bad("ots_attestation");
                    byte[] r = new byte[32];
                    for (int j = 0; j < 32; j++) r[31 - j] = msg[j];
                    out.bitcoin.add(new Object[] {v, Furui.hex(r)});
                } else if (t.equals(PENDING)) {
                    out.pending++;
                }
                return;
            }
            steps++;
            if (steps > 10000 || depth > 256) throw new Json.Bad("ots_too_deep");
            byte[] nxt;
            if (tag == 0x08) nxt = Furui.sha256(msg);
            else if (tag == 0xf0) nxt = concat(msg, varbytes(4096));
            else if (tag == 0xf1) { byte[] p = varbytes(4096); nxt = concat(p, msg); }
            else throw new Json.Bad("ots_unsupported_op");
            if (nxt.length > 4096) throw new Json.Bad("ots_too_long");
            stamp(nxt, depth + 1);
        }

        void stamp(byte[] msg, int depth) throws Json.Bad {
            int tag = rd(1)[0] & 0xff;
            while (tag == 0xff) {
                item(rd(1)[0] & 0xff, msg, depth);
                tag = rd(1)[0] & 0xff;
            }
            item(tag, msg, depth);
        }
    }

    static byte[] concat(byte[] a, byte[] b) {
        byte[] r = Arrays.copyOf(a, a.length + b.length);
        System.arraycopy(b, 0, r, a.length, b.length);
        return r;
    }

    public static Result parse(byte[] b) throws Json.Bad {
        R r = new R(b);
        if (!MessageDigest.isEqual(r.rd(MAGIC.length), MAGIC) || r.varuint() != 1 || (r.rd(1)[0] & 0xff) != 0x08) throw new Json.Bad("ots_header");
        byte[] digest = r.rd(32);
        r.stamp(digest, 0);
        if (r.pos != b.length) throw new Json.Bad("ots_trailing");
        r.out.digest = Furui.hex(digest);
        return r.out;
    }
}
