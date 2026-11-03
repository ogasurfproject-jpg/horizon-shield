package nenrinverify

// furui.go: nenrin-verify furui-day and resume-admission, the Go twin of the Python nenrin_verify.furui_day and the
// JavaScript sdk/furui_day.mjs. All three, and the Java port, run ../furui-check-day-v0/verify_vectors.json and give
// the same verdicts.
//
// furui-day <day> --leaf <i>: six checks on leaf i of the content check runner's day.
//   1 envelope_shape   the envelope the runner serves has the closed shape (furui-check-signed-v1, no text field)
//   2 leaf_sha256      sha256(0x00 || musubi-canonical-v0(envelope)) is the leaf the runner names
//   3 audit_path       the RFC 6962 audit path rebuilds the root of the day record the ledger serves
//   4 signature        runner-1's Ed25519 signature on the day record, and on the envelope
//   5 runner_key       runner-1's key is in the ledger's /.well-known/furui-check-keys.json, inside from_height (and
//                      before revoked_height) for the heights of the record and of the envelope
//   6 bitcoin_anchor   the day record is listed in a ledger batch entry whose OpenTimestamps proof commits the entry's
//                      sha256 to a Bitcoin block header (not_yet before the batch or before the anchor)
// resume-admission <endpoint> <record_sha256>: 1 resume, 2 admission_line, 3 admission_record, 4 ledger_batch,
// 5 bitcoin_anchor.

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// FuruiLedger and FuruiRunner are the only hosts the furui commands read.
const (
	FuruiLedger      = "https://ledger.horizonshield.dev"
	FuruiRunner      = "https://furui.horizonshield.dev"
	FuruiKeysURL     = FuruiLedger + "/.well-known/furui-check-keys.json"
	FuruiCheckSchema = "nenrin-furui-check-v1"
	furuiDayLeaf     = "sha256(0x00 || musubi-canonical-v0(envelope))"
)

var (
	fH64    = regexp.MustCompile(`^[0-9a-f]{64}$`)
	fDay    = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})$`)
	fISOms  = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`)
	fNonce  = regexp.MustCompile(`^(?:[0-9a-f]{32}|heartbeat-\d{4}-\d{2}-\d{2})$`)
	fSig88  = regexp.MustCompile(`^[A-Za-z0-9+/]{86}==$`)
	fB64    = regexp.MustCompile(`^[A-Za-z0-9+/]*={0,2}$`)
	fUnres  = regexp.MustCompile(`^[A-Za-z0-9\-_.~]$`)
	fPrintK = regexp.MustCompile(`^[\x20-\x7e]*$`)

	fCheckKeys  = []string{"action_binding_digest", "answered", "checked_at_height", "contract_sha256", "decision", "input_commit", "marks", "nonce", "rules_sha256", "schema", "scope_sha256", "signed_at", "stage_reached", "trace_sha256", "unread"}
	fDayKeys    = []string{"clock_skew", "day", "first_height", "last_height", "late", "leaf", "n", "publication", "root", "schema", "signatures", "signer", "tree"}
	fResumeEnv  = map[string]bool{"evaluated_at": true, "subject_responses": true, "not_counted": true, "scan": true, "recompute": true, "resume_sha256": true}
	fMarksOK    = map[string]bool{`[]`: true, `["off_topic"]`: true, `["rule_conflict"]`: true, `["off_topic","rule_conflict"]`: true}
	fDaySteps   = []string{"envelope_shape", "leaf_sha256", "audit_path", "signature", "runner_key", "bitcoin_anchor"}
	fResSteps   = []string{"resume", "admission_line", "admission_record", "ledger_batch", "bitcoin_anchor"}
	fAllowHosts = map[string]bool{"ledger.horizonshield.dev": true, "furui.horizonshield.dev": true}
	otsMagic, _ = hex.DecodeString("004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294")
)

// ErrNet is a network failure or a URL outside the two hosts (exit 2).
var ErrNet = errors.New("network")

type fBad struct{ code string }

func (e *fBad) Error() string { return e.code }

// FuruiGet answers a GET: the status and the body.
type FuruiGet func(url string) (int, []byte, error)

// ---- values ----

func fObj(v Value) (*Object, bool) { o, ok := v.(*Object); return o, ok }
func fGet(v Value, k string) Value {
	if o, ok := v.(*Object); ok {
		return Get(o, k)
	}
	return Undefined
}
func fStr(v Value) (string, bool)     { s, ok := v.(string); return s, ok }
func fIsStrEq(v Value, s string) bool { x, ok := v.(string); return ok && x == s }
func fInt(v Value, lo int64) (int64, bool) {
	f, ok := v.(float64)
	if !ok || math.IsInf(f, 0) || math.IsNaN(f) || f != math.Trunc(f) || math.Abs(f) > maxSafe || f < float64(lo) {
		return 0, false
	}
	return int64(f), true
}
func fIsNull(v Value) bool { return v == nil }
func fIsBool(v Value) bool { _, ok := v.(bool); return ok }
func fArr(v Value) []Value {
	if a, ok := v.(*Array); ok {
		return a.Items
	}
	return nil
}
func fIsArr(v Value) bool { _, ok := v.(*Array); return ok }
func fHex64(v Value) bool { s, ok := v.(string); return ok && fH64.MatchString(s) }
func fKeysAre(v Value, ks []string) bool {
	o, ok := v.(*Object)
	if !ok {
		return false
	}
	a := append([]string{}, o.Keys()...)
	b := append([]string{}, ks...)
	sort.Strings(a)
	sort.Strings(b)
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
func fMarksOk(v Value) bool {
	if !fIsArr(v) {
		return false
	}
	for _, x := range fArr(v) {
		if !isStr(x) {
			return false
		}
	}
	c, err := FuruiCanonical(v)
	return err == nil && fMarksOK[c]
}

func fSha(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

// FuruiParse reads JSON as the Python and JavaScript ports do: UTF-8 must be valid, every number a double, duplicate
// keys last-wins.
func FuruiParse(b []byte) (Value, error) {
	if !utf8.Valid(b) {
		return nil, &fBad{"utf8"}
	}
	return ParseJSON(b)
}

// FuruiCanonical is musubi-canonical-v0: keys sorted, no whitespace, non-ASCII raw; non-integers, unsafe integers, keys
// that are not printable ASCII and lone surrogates are refused.
func FuruiCanonical(v Value) (string, error) {
	var b strings.Builder
	if err := fCanon(&b, v); err != nil {
		return "", err
	}
	return b.String(), nil
}

func fCanon(b *strings.Builder, v Value) error {
	switch x := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if x {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case float64:
		i, ok := fInt(x, -maxSafe)
		if !ok {
			return &fBad{"number"}
		}
		b.WriteString(strconv.FormatInt(i, 10))
	case string:
		if hasSurrogate(x) {
			return &fBad{"lone surrogate"}
		}
		b.WriteString(quote(x))
	case *Array:
		b.WriteByte('[')
		for i, it := range x.Items {
			if i > 0 {
				b.WriteByte(',')
			}
			if err := fCanon(b, it); err != nil {
				return err
			}
		}
		b.WriteByte(']')
	case *Object:
		ks := append([]string{}, x.Keys()...)
		for _, k := range ks {
			if !fPrintK.MatchString(k) {
				return &fBad{"key"}
			}
		}
		sort.Strings(ks)
		b.WriteByte('{')
		for i, k := range ks {
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteString(quote(k))
			b.WriteByte(':')
			if err := fCanon(b, Get(x, k)); err != nil {
				return err
			}
		}
		b.WriteByte('}')
	default:
		return &fBad{"type"}
	}
	return nil
}

func fMustCanon(v Value) string { s, _ := FuruiCanonical(v); return s }

func fRealDay(v Value) bool {
	s, ok := v.(string)
	if !ok {
		return false
	}
	m := fDay.FindStringSubmatch(s)
	if m == nil {
		return false
	}
	y, _ := strconv.Atoi(m[1])
	mo, _ := strconv.Atoi(m[2])
	d, _ := strconv.Atoi(m[3])
	if y < 1 {
		return false
	}
	t := time.Date(y, time.Month(mo), d, 0, 0, 0, 0, time.UTC)
	return t.Year() == y && int(t.Month()) == mo && t.Day() == d
}

func fB64Exact(v Value, n int) []byte {
	s, ok := v.(string)
	if !ok || !fB64.MatchString(s) || len(s)%4 != 0 {
		return nil
	}
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil || len(b) != n || base64.StdEncoding.EncodeToString(b) != s {
		return nil
	}
	return b
}

func fVerify(pub, msg, sig []byte) bool {
	if len(pub) != ed25519.PublicKeySize || len(sig) != ed25519.SignatureSize {
		return false
	}
	return ed25519.Verify(ed25519.PublicKey(pub), msg, sig)
}

func fSignerIs(v Value) bool {
	return fKeysAre(v, []string{"domain", "key_url"}) && fIsStrEq(fGet(v, "domain"), "horizonshield.dev") && fIsStrEq(fGet(v, "key_url"), FuruiKeysURL)
}

// FuruiEnvelopeProblem is runner 0.3.0's keepProblems: "" when the envelope has the closed shape.
func FuruiEnvelopeProblem(e Value) string {
	if !fKeysAre(e, []string{"check", "schema", "signatures", "signer"}) || !fIsStrEq(fGet(e, "schema"), "furui-check-signed-v1") {
		return "envelope_keys"
	}
	c := fGet(e, "check")
	if !fKeysAre(c, fCheckKeys) || !fIsStrEq(fGet(c, "schema"), "furui-check-v1") {
		return "check_keys"
	}
	for _, k := range []string{"input_commit", "action_binding_digest", "contract_sha256", "trace_sha256"} {
		if !fHex64(fGet(c, k)) {
			return "check_" + k
		}
	}
	for _, k := range []string{"rules_sha256", "scope_sha256"} {
		if !fIsNull(fGet(c, k)) && !fHex64(fGet(c, k)) {
			return "check_" + k
		}
	}
	d := fGet(c, "decision")
	if !(fIsNull(d) || fIsStrEq(d, "stop") || fIsStrEq(d, "pass")) {
		return "check_decision"
	}
	if !fMarksOk(fGet(c, "marks")) {
		return "check_marks"
	}
	if !fIsBool(fGet(c, "unread")) || !fIsBool(fGet(c, "answered")) {
		return "check_flags"
	}
	if st, ok := fInt(fGet(c, "stage_reached"), 0); !ok || st > 4 {
		return "check_stage_reached"
	}
	if _, ok := fInt(fGet(c, "checked_at_height"), 0); !ok {
		return "check_height"
	}
	if s, ok := fStr(fGet(c, "nonce")); !ok || !fNonce.MatchString(s) {
		return "check_nonce"
	}
	if s, ok := fStr(fGet(c, "signed_at")); !ok || !fISOms.MatchString(s) {
		return "check_signed_at"
	}
	if !fSignerIs(fGet(e, "signer")) {
		return "signer"
	}
	sg := fArr(fGet(e, "signatures"))
	if !fIsArr(fGet(e, "signatures")) || len(sg) != 1 {
		return "signatures"
	}
	g := sg[0]
	if s, ok := fStr(fGet(g, "sig")); !fKeysAre(g, []string{"alg", "domain", "key_id", "sig"}) || !fIsStrEq(fGet(g, "alg"), "ed25519") || !fIsStrEq(fGet(g, "domain"), "horizonshield.dev") || !fIsStrEq(fGet(g, "key_id"), "runner-1") || !ok || !fSig88.MatchString(s) {
		return "signature"
	}
	return ""
}

func fEnvelopeMessage(e Value) []byte {
	o := newObject()
	o.set("schema", fGet(e, "schema"))
	o.set("check", fGet(e, "check"))
	o.set("signer", fGet(e, "signer"))
	return []byte("furui-check-signed-v1\n" + fMustCanon(o))
}

func fDayMessage(r *Object) []byte {
	o := newObject()
	for _, k := range r.Keys() {
		if k != "signatures" {
			o.set(k, Get(r, k))
		}
	}
	return []byte("furui-check-day-v0\n" + fMustCanon(o))
}

func fDayRecordProblem(r Value) string {
	if !fKeysAre(r, fDayKeys) || !fIsStrEq(fGet(r, "schema"), "furui-check-day-v0") {
		return "day_record_shape"
	}
	s := fGet(r, "signer")
	dom, dok := fStr(fGet(s, "domain"))
	_, kok := fStr(fGet(s, "key_url"))
	_, nok := fInt(fGet(r, "n"), 1)
	fh, fok := fInt(fGet(r, "first_height"), 0)
	lh, lok := fInt(fGet(r, "last_height"), 0)
	_, lateok := fInt(fGet(r, "late"), 0)
	_, skok := fInt(fGet(r, "clock_skew"), 0)
	sigs := fArr(fGet(r, "signatures"))
	ok := fRealDay(fGet(r, "day")) && fKeysAre(s, []string{"domain", "key_url"}) && dok && dom != "" && kok && nok &&
		fIsStrEq(fGet(r, "tree"), "rfc6962-sha256") && fIsStrEq(fGet(r, "leaf"), furuiDayLeaf) && fHex64(fGet(r, "root")) &&
		fok && lok && fh <= lh && lateok && skok && fIsStrEq(fGet(r, "publication"), "public") && fIsArr(fGet(r, "signatures")) && len(sigs) == 1
	if !ok {
		return "day_record_shape"
	}
	g := sigs[0]
	_, kidok := fStr(fGet(g, "key_id"))
	_, sigok := fStr(fGet(g, "sig"))
	if !(fKeysAre(g, []string{"alg", "domain", "key_id", "sig"}) && fIsStrEq(fGet(g, "alg"), "ed25519") && fIsStrEq(fGet(g, "domain"), dom) && kidok && sigok) {
		return "day_record_shape"
	}
	return ""
}

// ---- RFC 6962 ----

func fNode(a, b string) string {
	x, _ := hex.DecodeString(a)
	y, _ := hex.DecodeString(b)
	return fSha(append(append([]byte{1}, x...), y...))
}

func fSplit(n int64) int64 {
	k := int64(1)
	for k*2 < n {
		k *= 2
	}
	return k
}

func fRootFromPath(leaf string, m, n int64, path []string) (string, bool) {
	if n == 1 {
		return leaf, len(path) == 0
	}
	if len(path) == 0 {
		return "", false
	}
	k, top, rest := fSplit(n), path[len(path)-1], path[:len(path)-1]
	if m < k {
		l, ok := fRootFromPath(leaf, m, k, rest)
		if !ok {
			return "", false
		}
		return fNode(l, top), true
	}
	r, ok := fRootFromPath(leaf, m-k, n-k, rest)
	if !ok {
		return "", false
	}
	return fNode(top, r), true
}

// ---- OpenTimestamps ----

// OtsResult is what OtsParse reads from a proof.
type OtsResult struct {
	Digest  string
	Bitcoin [][2]interface{} // [height int64, merkle root in block explorer order]
	Pending int
}

// OtsParse follows sha256, append and prepend from the file digest to the attestations.
func OtsParse(b []byte) (res *OtsResult, err error) {
	defer func() {
		if r := recover(); r != nil {
			if fb, ok := r.(*fBad); ok {
				res, err = nil, fb
				return
			}
			panic(r)
		}
	}()
	pos, steps := 0, 0
	out := &OtsResult{Bitcoin: [][2]interface{}{}}
	rd := func(n int) []byte {
		if n < 0 || pos+n > len(b) {
			panic(&fBad{"ots_truncated"})
		}
		v := b[pos : pos+n]
		pos += n
		return v
	}
	varuint := func() int64 {
		var v int64
		for i := 0; i < 8; i++ {
			c := rd(1)[0]
			v |= int64(c&0x7f) << (7 * uint(i))
			if c&0x80 == 0 {
				if v > maxSafe {
					panic(&fBad{"ots_varuint"})
				}
				return v
			}
		}
		panic(&fBad{"ots_varuint"})
	}
	varbytes := func(mx int64) []byte {
		n := varuint()
		if n > mx {
			panic(&fBad{"ots_too_long"})
		}
		return rd(int(n))
	}
	if !bytes.Equal(rd(len(otsMagic)), otsMagic) || varuint() != 1 || rd(1)[0] != 0x08 {
		panic(&fBad{"ots_header"})
	}
	digest := append([]byte{}, rd(32)...)
	var stamp func(msg []byte, depth int)
	item := func(tag byte, msg []byte, depth int) {
		if tag == 0 {
			t := hex.EncodeToString(rd(8))
			payload := varbytes(8192)
			if t == "0588960d73d71901" {
				var v int64
				i, done := 0, false
				for i < len(payload) && i < 8 {
					c := payload[i]
					v |= int64(c&0x7f) << (7 * uint(i))
					i++
					if c&0x80 == 0 {
						done = true
						break
					}
				}
				if !done || i != len(payload) || v > maxSafe || len(msg) != 32 {
					panic(&fBad{"ots_attestation"})
				}
				r := make([]byte, 32)
				for j := range msg {
					r[31-j] = msg[j]
				}
				out.Bitcoin = append(out.Bitcoin, [2]interface{}{v, hex.EncodeToString(r)})
			} else if t == "83dfe30d2ef90c8e" {
				out.Pending++
			}
			return
		}
		steps++
		if steps > 10000 || depth > 256 {
			panic(&fBad{"ots_too_deep"})
		}
		var nxt []byte
		switch tag {
		case 0x08:
			h := sha256.Sum256(msg)
			nxt = h[:]
		case 0xf0:
			nxt = append(append([]byte{}, msg...), varbytes(4096)...)
		case 0xf1:
			p := varbytes(4096)
			nxt = append(append([]byte{}, p...), msg...)
		default:
			panic(&fBad{"ots_unsupported_op"})
		}
		if len(nxt) > 4096 {
			panic(&fBad{"ots_too_long"})
		}
		stamp(nxt, depth+1)
	}
	stamp = func(msg []byte, depth int) {
		tag := rd(1)[0]
		for tag == 0xff {
			item(rd(1)[0], msg, depth)
			tag = rd(1)[0]
		}
		item(tag, msg, depth)
	}
	stamp(digest, 0)
	if pos != len(b) {
		panic(&fBad{"ots_trailing"})
	}
	out.Digest = hex.EncodeToString(digest)
	return out, nil
}

// ---- fetching ----

// FuruiEncComponent percent-encodes every byte except A-Z a-z 0-9 - _ . ~ (the same in every port).
func FuruiEncComponent(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		if fUnres.MatchString(string([]byte{c})) {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

// FuruiHTTPGet is the network: GET only, only the two hosts, no redirects, 30 s.
func FuruiHTTPGet(raw string) (int, []byte, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || !fAllowHosts[u.Hostname()] || (u.Port() != "" && u.Port() != "443") {
		return 0, nil, fmt.Errorf("%w: not an allowed URL: %s", ErrNet, raw)
	}
	cl := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	req, _ := http.NewRequest("GET", raw, nil)
	req.Header.Set("user-agent", "nenrin-verify-furui/1")
	req.Header.Set("accept", "application/json")
	r, err := cl.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("%w: %s: %v", ErrNet, raw, err)
	}
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, 4*1024*1024))
	if err != nil {
		return 0, nil, fmt.Errorf("%w: %s: %v", ErrNet, raw, err)
	}
	return r.StatusCode, body, nil
}

// ---- the run ----

// FuruiStep is one check's state: ok, fail, not_yet or skipped, and its code.
type FuruiStep struct {
	Step  int
	Name  string
	State string
	Code  Value // string or nil
}

// FuruiResult is a command's answer.
type FuruiResult struct {
	Command    string
	Args       *Object
	Verdict    string
	FirstNotOk Value
	Steps      []FuruiStep
	Facts      *Object
}

type fRun struct {
	get   FuruiGet
	names []string
	steps []FuruiStep
	facts *Object
}

type fNotJSON struct{}

func (r *fRun) getj(u string) (int, Value, error) {
	s, b, err := r.get(u)
	if err != nil {
		return 0, nil, err
	}
	v, perr := FuruiParse(b)
	if perr != nil {
		return s, fNotJSON{}, nil
	}
	return s, v, nil
}

func (r *fRun) put(state string, code Value) {
	r.steps = append(r.steps, FuruiStep{len(r.steps) + 1, r.names[len(r.steps)], state, code})
}

func (r *fRun) result(cmd string, args *Object) *FuruiResult {
	for len(r.steps) < len(r.names) {
		r.put("skipped", nil)
	}
	verdict := "ok"
	var first Value
	for _, s := range r.steps {
		if s.State == "fail" {
			verdict = "fail"
		} else if s.State == "not_yet" && verdict == "ok" {
			verdict = "not_yet"
		}
		if first == nil && (s.State == "fail" || s.State == "not_yet") {
			first = float64(s.Step)
		}
	}
	return &FuruiResult{Command: cmd, Args: args, Verdict: verdict, FirstNotOk: first, Steps: r.steps, Facts: r.facts}
}

func fFacts(kv ...interface{}) *Object {
	o := newObject()
	for i := 0; i < len(kv); i += 2 {
		o.set(kv[i].(string), kv[i+1])
	}
	return o
}

func fTruthy(v Value) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case float64:
		return x != 0
	case string:
		return x != ""
	case *Array:
		return len(x.Items) > 0
	case *Object:
		return len(x.Keys()) > 0
	}
	return v != Undefined
}

func fAnchor(r *fRun, n int64, recordSha, recordSchema string, needBlockTime bool) (string, string, Value, error) {
	s, e, err := r.getj(fmt.Sprintf("%s/ledger/%d?format=json", FuruiLedger, n))
	if err != nil {
		return "", "", nil, err
	}
	if s != 200 {
		return "batch", "fail", fmt.Sprintf("entry_http_%d", s), nil
	}
	if _, ok := fObj(e); !ok {
		return "batch", "fail", "entry_not_json", nil
	}
	rc, ok := fStr(fGet(e, "record_canonical"))
	if !ok || !fIsStrEq(fGet(e, "claim_sha256"), fSha([]byte(rc))) {
		return "batch", "fail", "entry_bytes_do_not_hash_to_claim", nil
	}
	bt, perr := FuruiParse([]byte(rc))
	listed := false
	if perr == nil && fIsStrEq(fGet(bt, "schema"), "nenrin-agreement-batch-v1") && fIsArr(fGet(bt, "records")) {
		for _, x := range fArr(fGet(bt, "records")) {
			if fIsStrEq(fGet(x, "canonical_sha256"), recordSha) && fIsStrEq(fGet(x, "record_schema"), recordSchema) {
				listed = true
			}
		}
	}
	if !listed {
		return "batch", "fail", "record_not_in_entry", nil
	}
	r.facts.set("ledger_entry", float64(n))
	bb, bok := fInt(fGet(e, "bitcoin_block"), 1)
	if !fIsStrEq(fGet(e, "ots_status"), "confirmed") || !bok || (needBlockTime && !fTruthy(fGet(e, "block_time"))) {
		return "anchor", "not_yet", "ots_not_confirmed", nil
	}
	os, ob, err := r.get(fmt.Sprintf("%s/ledger/%d/ots", FuruiLedger, n))
	if err != nil {
		return "", "", nil, err
	}
	if os != 200 {
		return "anchor", "fail", fmt.Sprintf("ots_http_%d", os), nil
	}
	p, perr := OtsParse(ob)
	if perr != nil {
		return "anchor", "fail", "ots_parse", nil
	}
	if !fIsStrEq(fGet(e, "claim_sha256"), p.Digest) {
		return "anchor", "fail", "ots_digest_is_not_the_entry", nil
	}
	if len(p.Bitcoin) == 0 {
		return "anchor", "fail", "ots_no_bitcoin_attestation", nil
	}
	for _, x := range p.Bitcoin {
		if x[0].(int64) == bb {
			r.facts.set("bitcoin_block", float64(bb))
			r.facts.set("merkle_root", x[1].(string))
			return "anchor", "ok", nil, nil
		}
	}
	return "anchor", "fail", "ots_height_is_not_the_entry_block", nil
}

// FuruiDay runs the six checks on leaf i of day.
func FuruiDay(day string, leaf int64, get FuruiGet) (*FuruiResult, error) {
	r := &fRun{get: get, names: fDaySteps}
	r.facts = fFacts("day", day, "leaf", float64(leaf), "record_sha256", nil, "n", nil, "root", nil, "ledger_entry", nil, "bitcoin_block", nil, "merkle_root", nil)
	args := fFacts("day", day, "leaf", float64(leaf))
	done := func() (*FuruiResult, error) { return r.result("furui-day", args), nil }
	// 1 envelope_shape
	s, a, err := r.getj(fmt.Sprintf("%s/furui/day/%s/leaf/%d", FuruiRunner, day, leaf))
	if err != nil {
		return nil, err
	}
	if s == 404 && fIsStrEq(fGet(a, "error"), "day_open") {
		ss, st, err := r.getj(fmt.Sprintf("%s/furui/day/%s/status", FuruiRunner, day))
		if err != nil {
			return nil, err
		}
		var v Value = Undefined
		if ss == 200 && fIsStrEq(fGet(st, "day"), day) {
			v = fGet(st, "status")
		}
		if fIsStrEq(fGet(v, "state"), "empty") {
			r.put("fail", "day_closed_empty")
		} else {
			r.put("not_yet", "day_open")
		}
		return done()
	}
	if s != 200 {
		r.put("fail", fmt.Sprintf("leaf_http_%d", s))
		return done()
	}
	if _, ok := fObj(a); !ok {
		r.put("fail", "leaf_not_json")
		return done()
	}
	if idx, ok := fInt(fGet(a, "index"), 0); !fIsStrEq(fGet(a, "day"), day) || !ok || idx != leaf {
		r.put("fail", "leaf_is_another_day_or_index")
		return done()
	}
	env := fGet(a, "envelope")
	if p := FuruiEnvelopeProblem(env); p != "" {
		r.put("fail", "envelope_shape:"+p)
		return done()
	}
	envc, cerr := FuruiCanonical(env)
	if cerr != nil {
		r.put("fail", "envelope_shape:not_canonical")
		return done()
	}
	r.put("ok", nil)
	// 2 leaf_sha256
	lh := fSha(append([]byte{0}, []byte(envc)...))
	if !fIsStrEq(fGet(a, "leaf_sha256"), lh) {
		r.put("fail", "leaf_sha256_is_not_the_envelope")
		return done()
	}
	if !fIsStrEq(fGet(a, "envelope_sha256"), fSha([]byte(envc))) {
		r.put("fail", "envelope_sha256_is_not_the_envelope")
		return done()
	}
	r.put("ok", nil)
	// 3 audit_path
	dr := fGet(a, "day_record")
	state, sok := fStr(fGet(dr, "state"))
	if _, ok := fObj(dr); !ok || !sok {
		r.put("fail", "no_day_record")
		return done()
	}
	if state != "accepted" {
		r.put("not_yet", "day_record_not_accepted")
		return done()
	}
	rs, _ := fStr(fGet(dr, "ledger_canonical_sha256"))
	if !fHex64(fGet(dr, "ledger_canonical_sha256")) {
		r.put("fail", "no_day_record")
		return done()
	}
	ls, lr, err := r.getj(FuruiLedger + "/furui-check-day/" + rs)
	if err != nil {
		return nil, err
	}
	if ls != 200 {
		r.put("fail", fmt.Sprintf("day_record_http_%d", ls))
		return done()
	}
	if _, ok := fObj(lr); !ok {
		r.put("fail", "day_record_not_json")
		return done()
	}
	rc, ok := fStr(fGet(lr, "record_canonical"))
	if !ok || fSha([]byte(rc)) != rs {
		r.put("fail", "day_record_bytes_do_not_hash_to_sha")
		return done()
	}
	recv, perr := FuruiParse([]byte(rc))
	if perr == nil {
		if c, cerr := FuruiCanonical(recv); cerr != nil || c != rc {
			perr = &fBad{"not canonical"}
		}
	}
	if perr != nil {
		r.put("fail", "day_record_not_canonical")
		return done()
	}
	if p := fDayRecordProblem(recv); p != "" {
		r.put("fail", p)
		return done()
	}
	rec := recv.(*Object)
	if !fIsStrEq(Get(rec, "day"), day) {
		r.put("fail", "day_record_is_another_day")
		return done()
	}
	rn, _ := fInt(Get(rec, "n"), 1)
	root, _ := fStr(Get(rec, "root"))
	r.facts.set("record_sha256", rs)
	r.facts.set("n", float64(rn))
	r.facts.set("root", root)
	if an, ok := fInt(fGet(a, "n"), 0); !ok || an != rn || !fIsStrEq(fGet(a, "root"), root) {
		r.put("fail", "n_or_root_differs_from_the_ledger_record")
		return done()
	}
	prv := fGet(a, "proof")
	var proof []string
	pok := fIsStrEq(fGet(a, "proof_kind"), "rfc6962-audit-path") && fIsArr(prv) && len(fArr(prv)) <= 64
	for _, x := range fArr(prv) {
		if !fHex64(x) {
			pok = false
			break
		}
		proof = append(proof, x.(string))
	}
	if !pok {
		r.put("fail", "proof_shape")
		return done()
	}
	if got, ok := fRootFromPath(lh, leaf, rn, proof); !(leaf < rn) || !ok || got != root {
		r.put("fail", "proof_does_not_rebuild_the_root")
		return done()
	}
	r.put("ok", nil)
	// 4 signature
	ks, kd, err := r.getj(FuruiKeysURL)
	if err != nil {
		return nil, err
	}
	rsg := fArr(Get(rec, "signatures"))[0]
	kid, _ := fStr(fGet(rsg, "key_id"))
	var klist []Value
	kListed := ks == 200 && fIsStrEq(fGet(kd, "use"), "furui-check") && fIsArr(fGet(kd, "keys"))
	if kListed {
		klist = fArr(fGet(kd, "keys"))
	}
	var k Value = Undefined
	for _, x := range klist {
		if _, ok := fObj(x); ok && fIsStrEq(fGet(x, "key_id"), kid) {
			k = x
			break
		}
	}
	var pub []byte
	if k != Undefined {
		pub = fB64Exact(fGet(k, "public_key_ed25519_b64"), 32)
	}
	if pub == nil {
		r.put("skipped", "no_listed_key")
	} else {
		rsig := fB64Exact(fGet(rsg, "sig"), 64)
		if rsig == nil || !fVerify(pub, fDayMessage(rec), rsig) {
			r.put("fail", "day_record_signature")
			return done()
		}
		es, _ := fStr(fGet(fArr(fGet(env, "signatures"))[0], "sig"))
		esig, _ := base64.StdEncoding.DecodeString(es)
		if !fVerify(pub, fEnvelopeMessage(env), esig) {
			r.put("fail", "envelope_signature")
			return done()
		}
		r.put("ok", nil)
	}
	// 5 runner_key
	if ks != 200 {
		r.put("fail", fmt.Sprintf("keys_http_%d", ks))
		return done()
	}
	if _, ok := fObj(kd); !ok {
		r.put("fail", "keys_not_json")
		return done()
	}
	if !kListed {
		r.put("fail", "keys_not_furui_check")
		return done()
	}
	if !fSignerIs(Get(rec, "signer")) {
		r.put("fail", "signer_is_not_the_ledger_keys")
		return done()
	}
	if kid != "runner-1" {
		r.put("fail", "key_id_is_not_runner_1")
		return done()
	}
	if k == Undefined {
		r.put("fail", "key_not_listed")
		return done()
	}
	if pub == nil {
		r.put("fail", "key_not_32_bytes")
		return done()
	}
	fh, fok := fInt(fGet(k, "from_height"), 0)
	rhv := fGet(k, "revoked_height")
	rh, rok := fInt(rhv, 0)
	revNone := rhv == nil || rhv == Undefined
	if !fok || !(revNone || rok) {
		r.put("fail", "key_heights_shape")
		return done()
	}
	hh, _ := fInt(fGet(fGet(env, "check"), "checked_at_height"), 0)
	first, _ := fInt(Get(rec, "first_height"), 0)
	last, _ := fInt(Get(rec, "last_height"), 0)
	if first < fh || hh < fh {
		r.put("fail", "key_not_yet_valid")
		return done()
	}
	if !revNone && (last >= rh || hh >= rh) {
		r.put("fail", "key_revoked")
		return done()
	}
	r.put("ok", nil)
	// 6 bitcoin_anchor
	le, leok := fInt(fGet(lr, "ledger_entry"), 1)
	if !fIsStrEq(fGet(lr, "status"), "anchored") || !leok {
		r.put("not_yet", "not_in_an_anchored_batch_yet")
		return done()
	}
	_, st, code, err := fAnchor(r, le, rs, "furui-check-day-v0", false)
	if err != nil {
		return nil, err
	}
	r.put(st, code)
	return done()
}

func fHostOf(endpoint string) string {
	u, err := url.Parse(endpoint)
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Hostname())
}

func fLineClosed(ln Value) bool {
	c := fGet(ln, "content")
	d := fGet(ln, "decision")
	_, nok := fInt(fGet(ln, "ledger_n"), 1)
	if !(fKeysAre(ln, []string{"content", "decision", "ledger_n", "record_sha256", "revoked"}) && nok &&
		(fIsStrEq(d, "admit") || fIsStrEq(d, "escalate") || fIsStrEq(d, "refuse")) && fIsBool(fGet(ln, "revoked"))) {
		return false
	}
	if fIsNull(c) {
		return true
	}
	cd := fGet(c, "decision")
	rs := fGet(c, "rules_sha256")
	return fKeysAre(c, []string{"checked", "decision", "marks", "rules_sha256"}) && fIsBool(fGet(c, "checked")) &&
		(fIsNull(cd) || fIsStrEq(cd, "stop") || fIsStrEq(cd, "pass")) && fMarksOk(fGet(c, "marks")) && (fIsNull(rs) || fHex64(rs))
}

// ResumeAdmission checks one admissions[] line of the Resume of endpoint against the ledger.
func ResumeAdmission(endpoint, recordSha string, get FuruiGet) (*FuruiResult, error) {
	r := &fRun{get: get, names: fResSteps}
	r.facts = fFacts("endpoint", endpoint, "record_sha256", recordSha, "resume_sha256", nil, "ledger_entry", nil, "bitcoin_block", nil, "merkle_root", nil)
	args := fFacts("endpoint", endpoint, "record_sha256", recordSha)
	done := func() (*FuruiResult, error) { return r.result("resume-admission", args), nil }
	// 1 resume
	s, rv, err := r.getj(FuruiLedger + "/resume?endpoint=" + FuruiEncComponent(endpoint))
	if err != nil {
		return nil, err
	}
	if s != 200 {
		r.put("fail", fmt.Sprintf("resume_http_%d", s))
		return done()
	}
	ro, ok := fObj(rv)
	if !ok {
		r.put("fail", "resume_not_json")
		return done()
	}
	if !fIsStrEq(Get(ro, "schema"), "nenrin-resume-v1") {
		r.put("fail", "resume_schema")
		return done()
	}
	if !fIsStrEq(Get(ro, "measured_endpoint"), endpoint) {
		r.put("fail", "resume_is_another_endpoint")
		return done()
	}
	body := newObject()
	for _, k := range ro.Keys() {
		if !fResumeEnv[k] {
			body.set(k, Get(ro, k))
		}
	}
	bc, cerr := FuruiCanonical(body)
	if cerr != nil || !fIsStrEq(Get(ro, "resume_sha256"), fSha([]byte(bc))) {
		r.put("fail", "resume_sha256_does_not_recompute")
		return done()
	}
	r.facts.set("resume_sha256", Get(ro, "resume_sha256"))
	r.put("ok", nil)
	// 2 admission_line
	if !fIsArr(Get(ro, "admissions")) {
		r.put("fail", "no_admissions_list")
		return done()
	}
	var lines []Value
	for _, x := range fArr(Get(ro, "admissions")) {
		if _, ok := fObj(x); ok && fIsStrEq(fGet(x, "record_sha256"), recordSha) {
			lines = append(lines, x)
		}
	}
	if len(lines) == 0 {
		held := false
		for _, x := range fArr(Get(ro, "not_counted")) {
			if _, ok := fObj(x); ok && fIsStrEq(fGet(x, "record_sha256"), recordSha) && fIsStrEq(fGet(x, "kind"), "admission") &&
				(fIsStrEq(fGet(x, "why"), "not_yet_anchored") || fIsStrEq(fGet(x, "why"), "confirmed_without_block_time")) {
				held = true
			}
		}
		if held {
			r.put("not_yet", "not_anchored_yet")
		} else {
			r.put("fail", "not_listed")
		}
		return done()
	}
	if len(lines) > 1 {
		r.put("fail", "listed_twice")
		return done()
	}
	ln := lines[0]
	if !fLineClosed(ln) {
		r.put("fail", "line_not_closed")
		return done()
	}
	r.put("ok", nil)
	// 3 admission_record
	as, st, err := r.getj(FuruiLedger + "/admission/" + recordSha)
	if err != nil {
		return nil, err
	}
	if as != 200 {
		r.put("fail", fmt.Sprintf("admission_http_%d", as))
		return done()
	}
	if _, ok := fObj(st); !ok {
		r.put("fail", "admission_not_json")
		return done()
	}
	rc, ok := fStr(fGet(st, "record_canonical"))
	if !ok || fSha([]byte(rc)) != recordSha {
		r.put("fail", "admission_bytes_do_not_hash_to_sha")
		return done()
	}
	rec, perr := FuruiParse([]byte(rc))
	if _, ok := fObj(rec); perr != nil || !ok || !fIsStrEq(fGet(rec, "schema"), "a2a-admission-v0") {
		r.put("fail", "admission_schema")
		return done()
	}
	rpd := ""
	if d, ok := fStr(fGet(fGet(rec, "relying_party"), "domain")); ok {
		if _, isO := fObj(fGet(rec, "relying_party")); isO {
			rpd = strings.ToLower(d)
		}
	}
	h := fHostOf(endpoint)
	if rpd == "" || h == "" || !(h == rpd || strings.HasSuffix(h, "."+rpd)) {
		r.put("fail", "relying_party_is_not_the_endpoint_host")
		return done()
	}
	if !seqStrict(fGet(rec, "decision"), fGet(ln, "decision")) {
		r.put("fail", "decision_differs")
		return done()
	}
	var want Value
	rules := fGet(rec, "rules")
	if _, ok := fObj(rules); ok && fIsStrEq(fGet(rules, "version"), "0.4") {
		if cb, ok := fObj(fGet(rec, "content")); ok {
			nz := func(v Value) Value {
				if v == Undefined {
					return nil
				}
				return v
			}
			want = fFacts("checked", nz(Get(cb, "checked")), "decision", nz(Get(cb, "decision")), "marks", nz(Get(cb, "marks")), "rules_sha256", nz(Get(cb, "rules_sha256")))
		}
	}
	lc := fGet(ln, "content")
	same := false
	if want == nil {
		same = fIsNull(lc)
	} else if !fIsNull(lc) {
		a, e1 := FuruiCanonical(want)
		b, e2 := FuruiCanonical(lc)
		same = e1 == nil && e2 == nil && a == b
	}
	if !same {
		r.put("fail", "content_differs")
		return done()
	}
	r.put("ok", nil)
	// 4 ledger_batch, 5 bitcoin_anchor
	n, _ := fInt(fGet(ln, "ledger_n"), 1)
	part, state, code, err := fAnchor(r, n, recordSha, "a2a-admission-v0", true)
	if err != nil {
		return nil, err
	}
	if part == "batch" {
		r.put(state, code)
		return done()
	}
	r.put("ok", nil)
	if state == "not_yet" {
		state, code = "fail", "entry_listed_by_the_resume_is_not_anchored"
	}
	r.put(state, code)
	return done()
}

// seqStrict is === for the JSON values the record and the line can hold here (strings, and anything else unequal
// unless both are the same primitive).
func seqStrict(a, b Value) bool {
	switch x := a.(type) {
	case string:
		y, ok := b.(string)
		return ok && x == y
	case float64:
		y, ok := b.(float64)
		return ok && x == y
	case bool:
		y, ok := b.(bool)
		return ok && x == y
	case nil:
		return b == nil
	}
	return false
}

// ---- output ----

// Summary is the form the vectors compare: {verdict, steps: [[step, state, code]], facts}.
func (res *FuruiResult) Summary() *Object {
	steps := &Array{}
	for _, s := range res.Steps {
		steps.Items = append(steps.Items, &Array{Items: []Value{float64(s.Step), s.State, s.Code}})
	}
	return fFacts("verdict", res.Verdict, "steps", steps, "facts", res.Facts)
}

// Full is the CLI's object.
func (res *FuruiResult) Full() *Object {
	steps := &Array{}
	for _, s := range res.Steps {
		steps.Items = append(steps.Items, fFacts("step", float64(s.Step), "name", s.Name, "state", s.State, "code", s.Code))
	}
	return fFacts("schema", FuruiCheckSchema, "command", res.Command, "args", res.Args, "verdict", res.Verdict, "first_not_ok", res.FirstNotOk, "steps", steps, "facts", res.Facts)
}

// FuruiWorldGet answers from a vectors world (URL -> {status, body | body_b64}); a URL not in it is a 404.
func FuruiWorldGet(world *Object) FuruiGet {
	return func(u string) (int, []byte, error) {
		w := Get(world, u)
		if w == Undefined {
			return 404, []byte(`{"error":"not_found"}`), nil
		}
		st, _ := fInt(fGet(w, "status"), 0)
		if b64, ok := fStr(fGet(w, "body_b64")); ok {
			b, _ := base64.StdEncoding.DecodeString(b64)
			return int(st), b, nil
		}
		body, _ := fStr(fGet(w, "body"))
		return int(st), []byte(body), nil
	}
}

// FuruiRunCase answers one case of a vectors file in the summary form.
func FuruiRunCase(c Value) (Value, error) {
	cmd, _ := fStr(fGet(c, "command"))
	a := fGet(c, "args")
	if cmd == "ots-parse" {
		s, _ := fStr(fGet(a, "body_b64"))
		b, _ := base64.StdEncoding.DecodeString(s)
		p, err := OtsParse(b)
		if err != nil {
			return fFacts("error", err.Error()), nil
		}
		bt := &Array{}
		for _, x := range p.Bitcoin {
			bt.Items = append(bt.Items, &Array{Items: []Value{float64(x[0].(int64)), x[1].(string)}})
		}
		return fFacts("digest", p.Digest, "bitcoin", bt, "pending", float64(p.Pending)), nil
	}
	w, _ := fObj(fGet(c, "world"))
	g := FuruiWorldGet(w)
	var res *FuruiResult
	var err error
	if cmd == "furui-day" {
		d, _ := fStr(fGet(a, "day"))
		l, _ := fInt(fGet(a, "leaf"), 0)
		res, err = FuruiDay(d, l, g)
	} else {
		e, _ := fStr(fGet(a, "endpoint"))
		s, _ := fStr(fGet(a, "record_sha256"))
		res, err = ResumeAdmission(e, s, g)
	}
	if err != nil {
		return nil, err
	}
	return res.Summary(), nil
}

// FuruiRealDay says whether s is a real calendar day YYYY-MM-DD.
func FuruiRealDay(s string) bool { return fRealDay(s) }

// FuruiHex64 says whether s is 64 lowercase hex.
func FuruiHex64(s string) bool { return fH64.MatchString(s) }

// FuruiHost is the lower-cased host of an endpoint URL ("" if none).
func FuruiHost(endpoint string) string { return fHostOf(endpoint) }

// FuruiPretty writes v as JSON with keys sorted and two spaces of indent.
func FuruiPretty(v Value) string {
	var b strings.Builder
	fPretty(&b, v, "")
	return b.String()
}

func fPretty(b *strings.Builder, v Value, ind string) {
	switch x := v.(type) {
	case *Array:
		if len(x.Items) == 0 {
			b.WriteString("[]")
			return
		}
		b.WriteString("[\n")
		for i, it := range x.Items {
			b.WriteString(ind + "  ")
			fPretty(b, it, ind+"  ")
			if i < len(x.Items)-1 {
				b.WriteByte(',')
			}
			b.WriteByte('\n')
		}
		b.WriteString(ind + "]")
	case *Object:
		ks := append([]string{}, x.Keys()...)
		sort.Strings(ks)
		if len(ks) == 0 {
			b.WriteString("{}")
			return
		}
		b.WriteString("{\n")
		for i, k := range ks {
			b.WriteString(ind + "  " + quote(k) + ": ")
			fPretty(b, Get(x, k), ind+"  ")
			if i < len(ks)-1 {
				b.WriteByte(',')
			}
			b.WriteByte('\n')
		}
		b.WriteString(ind + "}")
	default:
		s, err := FuruiCanonical(v)
		if err != nil {
			s = "null"
		}
		b.WriteString(s)
	}
}
