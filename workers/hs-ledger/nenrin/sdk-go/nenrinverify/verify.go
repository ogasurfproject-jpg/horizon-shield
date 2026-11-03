package nenrinverify

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"math/big"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// VerifierVersion is the reference verifier_version this port reproduces.
const VerifierVersion = "0.1.7"

// PortVersion is the version of this Go port.
const PortVersion = "0.4.0"

const (
	linkPrefix           = "nenrin-exec://"
	canonicalizationName = "musubi-canonical-v0"
	actionPreimageProf   = "task-execution-bind-v0/action"
)

func sha256hex(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }

// ---- Ed25519 key rule (ed25519_key.mjs, nenrin-verify 0.4.2) ----

var (
	edP    = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 255), big.NewInt(19))
	edL, _ = new(big.Int).SetString("7237005577332262213973186563042994240857116359379907606001950938285454250989", 10)
	edD    = func() *big.Int {
		d := new(big.Int).Mul(big.NewInt(-121665), new(big.Int).ModInverse(big.NewInt(121666), edP))
		return d.Mod(d, edP)
	}()
	edD2     = new(big.Int).Mod(new(big.Int).Mul(big.NewInt(2), edD), edP)
	edSqrtM1 = new(big.Int).Exp(big.NewInt(2), new(big.Int).Div(new(big.Int).Sub(edP, big.NewInt(1)), big.NewInt(4)), edP)
)

type edPoint [4]*big.Int

func mod(a *big.Int) *big.Int { return a.Mod(a, edP) }

func mul(a, b *big.Int) *big.Int { return mod(new(big.Int).Mul(a, b)) }

func edAdd(P, Q edPoint) edPoint {
	A := mul(new(big.Int).Sub(P[1], P[0]), new(big.Int).Sub(Q[1], Q[0]))
	B := mul(new(big.Int).Add(P[1], P[0]), new(big.Int).Add(Q[1], Q[0]))
	C := mul(mul(P[3], edD2), Q[3])
	D := mul(new(big.Int).Lsh(P[2], 1), Q[2])
	E := mod(new(big.Int).Sub(B, A))
	F := mod(new(big.Int).Sub(D, C))
	G := mod(new(big.Int).Add(D, C))
	H := mod(new(big.Int).Add(B, A))
	return edPoint{mul(E, F), mul(G, H), mul(F, G), mul(E, H)}
}

func edMul(P edPoint, n *big.Int) edPoint {
	R := edPoint{big.NewInt(0), big.NewInt(1), big.NewInt(1), big.NewInt(0)}
	Q := P
	k := new(big.Int).Set(n)
	for k.Sign() > 0 {
		if k.Bit(0) == 1 {
			R = edAdd(R, Q)
		}
		Q = edAdd(Q, Q)
		k.Rsh(k, 1)
	}
	return R
}

func edIsIdentity(P edPoint) bool {
	return new(big.Int).Mod(P[0], edP).Sign() == 0 && mod(new(big.Int).Sub(P[1], P[2])).Sign() == 0
}

func ed25519KeyCheck(raw []byte) bool {
	le := make([]byte, 32)
	for i := 0; i < 32; i++ {
		le[31-i] = raw[i]
	}
	le[0] &= 0x7f
	y := new(big.Int).SetBytes(le)
	sign := uint(raw[31] >> 7)
	if y.Cmp(edP) >= 0 {
		return false
	}
	yy := mul(y, y)
	u := mod(new(big.Int).Sub(yy, big.NewInt(1)))
	v := mod(new(big.Int).Add(mul(edD, yy), big.NewInt(1)))
	x2 := mul(u, new(big.Int).Exp(v, new(big.Int).Sub(edP, big.NewInt(2)), edP))
	x := new(big.Int).Exp(x2, new(big.Int).Div(new(big.Int).Add(edP, big.NewInt(3)), big.NewInt(8)), edP)
	if mul(x, x).Cmp(x2) != 0 {
		x = mul(x, edSqrtM1)
	}
	if mul(x, x).Cmp(x2) != 0 {
		return false
	}
	if x.Sign() == 0 && sign == 1 {
		return false
	}
	if x.Bit(0) != sign {
		x = new(big.Int).Sub(edP, x)
	}
	P := edPoint{x, y, big.NewInt(1), mul(x, y)}
	if edIsIdentity(P) {
		return false
	}
	return edIsIdentity(edMul(P, edL))
}

var keyCache sync.Map

// Ed25519KeyOK is true only for the canonical encoding of a point of the prime-order subgroup.
func Ed25519KeyOK(raw []byte) bool {
	if len(raw) != 32 {
		return false
	}
	k := string(raw)
	if v, ok := keyCache.Load(k); ok {
		return v.(bool)
	}
	ok := ed25519KeyCheck(raw)
	keyCache.Store(k, ok)
	return ok
}

// ---- base64, did:key ----

var b64Std = regexp.MustCompile(`^[A-Za-z0-9+/]*={0,2}$`)

// b64Exact returns the n bytes of canonical standard base64, else nil.
func b64Exact(v Value, n int) []byte {
	s, ok := v.(string)
	if !ok || len(s) == 0 || len(s)%4 != 0 || !b64Std.MatchString(s) {
		return nil
	}
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil || len(b) != n || base64.StdEncoding.EncodeToString(b) != s {
		return nil
	}
	return b
}

const b58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

func b58decode(s string) ([]byte, error) {
	b := []int{0}
	for i := 0; i < len(s); i++ {
		carry := strings.IndexByte(b58Alphabet, s[i])
		if carry < 0 {
			return nil, errors.New("bad base58 char")
		}
		for j := range b {
			carry += b[j] * 58
			b[j] = carry & 0xff
			carry >>= 8
		}
		for carry > 0 {
			b = append(b, carry&0xff)
			carry >>= 8
		}
	}
	zeros := 0
	for zeros < len(s) && s[zeros] == '1' {
		zeros++
	}
	out := make([]byte, zeros, zeros+len(b))
	for k := len(b) - 1; k >= 0; k-- {
		out = append(out, byte(b[k]))
	}
	return out, nil
}

// PublicKeyFromDidKey returns the 32-byte Ed25519 key a did:key names, refusing anything the key rule refuses.
func PublicKeyFromDidKey(did string) (ed25519.PublicKey, error) {
	if !strings.HasPrefix(did, "did:key:z") {
		return nil, errors.New("not a did:key")
	}
	payload, err := b58decode(did[len("did:key:z"):])
	if err != nil {
		return nil, err
	}
	if len(payload) < 2 || payload[0] != 0xed || payload[1] != 0x01 {
		return nil, errors.New("not an ed25519-pub did:key")
	}
	raw := payload[2:]
	if len(raw) != 32 || !Ed25519KeyOK(raw) {
		return nil, errors.New("not a usable Ed25519 key (it must be the canonical encoding of a point in the prime-order subgroup)")
	}
	return ed25519.PublicKey(raw), nil
}

// Resolver maps a signer identity to its public key, or nil when it does not resolve.
type Resolver func(id Value) ed25519.PublicKey

// DidKeyResolver resolves did:key identities offline and nothing else.
func DidKeyResolver(id Value) ed25519.PublicKey {
	s, ok := id.(string)
	if !ok {
		return nil
	}
	k, err := PublicKeyFromDidKey(s)
	if err != nil {
		return nil
	}
	return k
}

// verifyDetached is sigBytes + nodeVerify over canonical(preimage) inside try/catch.
func verifyDetached(sig Value, pub ed25519.PublicKey, pre func() Value) (ok bool) {
	if !isStr(sig) || pub == nil {
		return false
	}
	var msg string
	if err := func() (err error) { defer catch(&err); msg = canonical(pre()); return nil }(); err != nil {
		return false
	}
	sb := b64Exact(sig, 64)
	if sb == nil {
		return false
	}
	return ed25519.Verify(pub, []byte(msg), sb)
}

// ---- records ----

// without is the record's own keys minus the derived ones; every other own key stays, "__proto__" included. The
// reference used Object.assign({}, rec), which does not copy an own "__proto__" key, so a record carrying that field
// as an own wire key hashed without it (pipavlo82, #29, 2026-10-15); bind.mjs withoutDerived and this port keep it.
func without(rec Value, derived ...string) *Object {
	src, ok := rec.(*Object)
	if !ok {
		return assign(rec)
	}
	o := newObject()
	for _, k := range src.Keys() {
		skip := false
		for _, d := range derived {
			if k == d {
				skip = true
				break
			}
		}
		if !skip {
			o.set(k, src.vals[k])
		}
	}
	return o
}

func preimageObs(o Value) Value {
	return without(o, "evidence_id", "witness_sig", "edge_sig", "consent")
}
func preimageGrant(g Value) Value { return without(g, "grant_ref", "caller_sig", "action_binding") }
func preimageReceipt(r Value) Value {
	return without(r, "receipt_id", "provider_sig", "action_binding")
}
func preimageIntent(i Value) Value { return without(i, "intent_id", "intent_sig", "action_binding") }

func evidenceID(o Value) string { return sha256hex(canonical(preimageObs(o))) }
func grantRef(g Value) string   { return sha256hex(canonical(preimageGrant(g))) }
func receiptID(r Value) string  { return sha256hex(canonical(preimageReceipt(r))) }
func intentID(i Value) string   { return sha256hex(canonical(preimageIntent(i))) }

func strEq(v Value, s func() string) bool {
	x, ok := v.(string)
	return ok && x == s()
}

func edgeOf(o Value) Value {
	e := newObject()
	e.set("task_id", prop(o, "task_id"))
	e.set("hop", prop(o, "hop"))
	return e
}

type result struct {
	ok     bool
	reason string
	record string
}

func verifyObservation(o Value) result {
	hop := prop(o, "hop")
	if seq(prop(o, "witness_id"), prop(hop, "from")) || seq(prop(o, "witness_id"), prop(hop, "to")) {
		return result{reason: "witness_not_independent"}
	}
	if !strEq(prop(o, "evidence_id"), func() string { return evidenceID(o) }) {
		return result{reason: "recompute_mismatch"}
	}
	return result{ok: true}
}

func verifySignedObservation(o Value, resolve Resolver) result {
	if !verifyDetached(prop(o, "witness_sig"), resolve(prop(o, "witness_id")), func() Value { return preimageObs(o) }) {
		return result{reason: "witness_sig_invalid"}
	}
	if !verifyDetached(prop(o, "edge_sig"), resolve(prop(prop(o, "hop"), "from")), func() Value { return edgeOf(o) }) {
		return result{reason: "edge_sig_invalid"}
	}
	return result{ok: true}
}

func aggregateVerdict(obs []*Object) Value {
	vs := make([]Value, len(obs))
	for i, o := range obs {
		vs[i] = prop(prop(o, "conduct"), "verdict")
	}
	u := uniq(vs)
	switch {
	case len(u) == 0:
		return "no_evidence"
	case len(u) > 1:
		return "disagreement"
	}
	return u[0]
}

func actionsEqual(a, b Value) bool { return truthy(a) && truthy(b) && canonical(a) == canonical(b) }

func selfAuthorized(g Value) bool {
	return !nullish(prop(g, "provider_id")) && seq(prop(g, "caller_id"), prop(g, "provider_id"))
}

func providerAuthorized(g, r Value) bool {
	return nullish(prop(g, "provider_id")) || seq(prop(r, "provider_id"), prop(g, "provider_id"))
}

var rfc3339 = regexp.MustCompile(`^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]+)?Z$`)

func daysInMonth(y, m int) int {
	feb := 28
	if (y%4 == 0 && y%100 != 0) || y%400 == 0 {
		feb = 29
	}
	return [12]int{31, feb, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31}[m-1]
}

func daysFromCivil(y, m, d int) int {
	if m <= 2 {
		y--
	}
	era := y
	if y < 0 {
		era = y - 399
	}
	era /= 400
	yoe := y - era*400
	mp := m + 9
	if m > 2 {
		mp = m - 3
	}
	doy := (153*mp+2)/5 + d - 1
	doe := yoe*365 + yoe/4 - yoe/100 + doy
	return era*146097 + doe - 719468
}

// dateParse is Date.parse(s) as V8 reads the strings the timestamp pattern admits; ok false stands for NaN.
func dateParse(v Value) (int64, bool) {
	s, ok := v.(string)
	if !ok {
		return 0, false
	}
	m := rfc3339.FindStringSubmatch(s)
	if m == nil {
		return 0, false
	}
	n := make([]int, 7)
	for i := 1; i <= 6; i++ {
		n[i], _ = strconv.Atoi(m[i])
	}
	y, mo, d, h, mi, se := n[1], n[2], n[3], n[4], n[5], n[6]
	frac := m[7]
	msDigits := "000"
	if frac != "" {
		msDigits = (frac[1:] + "000")[:3]
	}
	ms, _ := strconv.Atoi(msDigits)
	if mo < 1 || mo > 12 || d < 1 || d > 31 || mi > 59 || se > 59 {
		return 0, false
	}
	if h > 24 || (h == 24 && (mi != 0 || se != 0 || strings.Trim(frac, ".0") != "")) {
		return 0, false
	}
	days := int64(daysFromCivil(y, mo, 1) + d - 1)
	return days*86400000 + int64(h)*3600000 + int64(mi)*60000 + int64(se)*1000 + int64(ms), true
}

func isRFC3339UTC(v Value) bool {
	s, ok := v.(string)
	if !ok {
		return false
	}
	m := rfc3339.FindStringSubmatch(s)
	if m == nil {
		return false
	}
	n := make([]int, 7)
	for i := 1; i <= 6; i++ {
		n[i], _ = strconv.Atoi(m[i])
	}
	y, mo, d, h, mi, se := n[1], n[2], n[3], n[4], n[5], n[6]
	if y < 1 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || se > 59 {
		return false
	}
	_, ok = dateParse(s)
	return ok
}

func inWindow(g, t Value) bool {
	tt, ok := dateParse(t)
	if !ok {
		return false
	}
	if nb := prop(g, "not_before"); !nullish(nb) {
		v, ok := dateParse(nb)
		if !ok || tt < v {
			return false
		}
	}
	if na := prop(g, "not_after"); !nullish(na) {
		v, ok := dateParse(na)
		if !ok || tt > v {
			return false
		}
	}
	return true
}

func timestampsOK(g, t Value) bool {
	if !isRFC3339UTC(t) {
		return false
	}
	if nb := prop(g, "not_before"); !nullish(nb) && !isRFC3339UTC(nb) {
		return false
	}
	if na := prop(g, "not_after"); !nullish(na) && !isRFC3339UTC(na) {
		return false
	}
	return true
}

func checkActionBinding(rec Value, key string) string {
	b := prop(rec, "action_binding")
	if b == Undefined {
		return "absent"
	}
	if !truthy(b) || !isObj(b) || !seq(prop(b, "type"), "canonical_request_digest") {
		return "malformed"
	}
	d := prop(b, "digest")
	if !truthy(d) || !isObj(d) || !seq(prop(d, "alg"), "sha-256") || !isStr(prop(d, "value")) {
		return "malformed"
	}
	if !seq(prop(b, "canonicalization"), canonicalizationName) || !seq(prop(b, "preimage_profile"), actionPreimageProf) {
		return "unknown_profile"
	}
	if nullish(prop(rec, key)) || prop(d, "value").(string) != sha256hex(canonical(prop(rec, key))) {
		return "mismatch"
	}
	return "recomputed"
}

func bindingOK(st string) bool { return st == "absent" || st == "recomputed" }

type pairResult struct {
	result
	findings []string
}

func verifyExecution(g, r Value) pairResult {
	if !strEq(prop(g, "grant_ref"), func() string { return grantRef(g) }) {
		return pairResult{result: result{reason: "grant_recompute_mismatch"}}
	}
	if !strEq(prop(r, "receipt_id"), func() string { return receiptID(r) }) {
		return pairResult{result: result{reason: "receipt_recompute_mismatch"}}
	}
	gb, rb := checkActionBinding(g, "action"), checkActionBinding(r, "executed_action")
	if !bindingOK(gb) {
		return pairResult{result: result{reason: "action_binding_" + gb, record: "grant"}}
	}
	if !bindingOK(rb) {
		return pairResult{result: result{reason: "action_binding_" + rb, record: "receipt"}}
	}
	if !strEq(prop(r, "grant_ref"), func() string { return grantRef(g) }) {
		return pairResult{result: result{reason: "receipt_unbound"}}
	}
	if !timestampsOK(g, prop(r, "executed_at")) {
		return pairResult{result: result{reason: "invalid_timestamp"}}
	}
	if !providerAuthorized(g, r) {
		return pairResult{result: result{reason: "provider_not_authorized"}}
	}
	if !inWindow(g, prop(r, "executed_at")) {
		return pairResult{result: result{reason: "outside_authorization_window"}}
	}
	var f []string
	if nullish(prop(g, "provider_id")) {
		f = append(f, "open_grant")
	}
	if selfAuthorized(g) {
		f = append(f, "self_authorized")
	}
	if !actionsEqual(prop(g, "action"), prop(r, "executed_action")) {
		return pairResult{result: result{reason: "action_diverged"}, findings: f}
	}
	return pairResult{result: result{ok: true, reason: "action_bound"}, findings: f}
}

func verifyPreflight(g, i Value) pairResult {
	if !strEq(prop(g, "grant_ref"), func() string { return grantRef(g) }) {
		return pairResult{result: result{reason: "grant_recompute_mismatch"}}
	}
	if !strEq(prop(i, "intent_id"), func() string { return intentID(i) }) {
		return pairResult{result: result{reason: "intent_recompute_mismatch"}}
	}
	if ib := checkActionBinding(i, "proposed_action"); !bindingOK(ib) {
		return pairResult{result: result{reason: "action_binding_" + ib, record: "intent"}}
	}
	if !strEq(prop(i, "grant_ref"), func() string { return grantRef(g) }) {
		return pairResult{result: result{reason: "intent_unbound"}}
	}
	if !timestampsOK(g, prop(i, "declared_at")) {
		return pairResult{result: result{reason: "invalid_timestamp"}}
	}
	if !providerAuthorized(g, i) {
		return pairResult{result: result{reason: "provider_not_authorized"}}
	}
	if !inWindow(g, prop(i, "declared_at")) {
		return pairResult{result: result{reason: "outside_authorization_window"}}
	}
	var f []string
	if nullish(prop(g, "provider_id")) {
		f = append(f, "open_grant")
	}
	if selfAuthorized(g) {
		f = append(f, "self_authorized")
	}
	if !actionsEqual(prop(g, "action"), prop(i, "proposed_action")) {
		return pairResult{result: result{reason: "action_diverged"}, findings: f}
	}
	return pairResult{result: result{ok: true, reason: "preauthorized"}, findings: f}
}

func verifySignedExecution(g, r Value, resolve Resolver) result {
	if !verifyDetached(prop(g, "caller_sig"), resolve(prop(g, "caller_id")), func() Value { return preimageGrant(g) }) {
		return result{reason: "caller_sig_invalid"}
	}
	if !verifyDetached(prop(r, "provider_sig"), resolve(prop(r, "provider_id")), func() Value { return preimageReceipt(r) }) {
		return result{reason: "provider_sig_invalid"}
	}
	return result{ok: true}
}

type reconciliation struct {
	status    string
	receiptID Value
}

func reconcile(receipts []*Object, gref, provider Value, resolve Resolver, requireSigs bool) reconciliation {
	var ok []*Object
	if requireSigs {
		if nullish(provider) {
			return reconciliation{status: "no_authorized_provider"}
		}
		for _, r := range receipts {
			if seq(prop(r, "grant_ref"), gref) && seq(prop(r, "provider_id"), provider) && seq(prop(r, "receipt_id"), receiptID(r)) &&
				verifyDetached(prop(r, "provider_sig"), resolve(provider), func() Value { return preimageReceipt(r) }) {
				ok = append(ok, r)
			}
		}
	} else {
		for _, r := range receipts {
			if seq(prop(r, "grant_ref"), gref) && strEq(prop(r, "receipt_id"), func() string { return receiptID(r) }) {
				ok = append(ok, r)
			}
		}
	}
	ids := make([]Value, len(ok))
	for i, r := range ok {
		ids[i] = prop(r, "receipt_id")
	}
	ids = uniq(ids)
	switch {
	case len(ids) == 0:
		if requireSigs {
			return reconciliation{status: "no_authentic_receipt"}
		}
		return reconciliation{status: "no_receipt"}
	case len(ids) > 1:
		return reconciliation{status: "equivocation"}
	}
	return reconciliation{status: "reconciled", receiptID: ids[0]}
}

var hex64 = regexp.MustCompile(`^[0-9a-f]{64}$`)

var evidenceKinds = map[string]bool{"bitcoin_tx": true, "ledger_record": true, "document_sha256": true, "url_sha256": true}

// Object.prototype names: EVIDENCE_KINDS[k] is an inherited member there, truthy and with no .ref.
var objectProtoKeys = map[string]bool{
	"constructor": true, "hasOwnProperty": true, "isPrototypeOf": true, "propertyIsEnumerable": true,
	"toLocaleString": true, "toString": true, "valueOf": true, "__proto__": true, "__defineGetter__": true,
	"__defineSetter__": true, "__lookupGetter__": true, "__lookupSetter__": true,
}

func propertyKey(v Value) string {
	if s, ok := v.(string); ok {
		return s
	}
	return primStr(v)
}

func evidenceWellFormed(ev Value) string {
	_, isA := ev.(*Array)
	if !truthy(ev) || !(isObj(ev) || isA) {
		return "evidence_not_object"
	}
	key := propertyKey(prop(ev, "kind"))
	ref := prop(ev, "ref")
	if objectProtoKeys[key] {
		if !isStr(ref) {
			return "evidence_ref_malformed"
		}
		raise(&JSTypeError{"Cannot read properties of undefined (reading 'test')"})
	}
	if !evidenceKinds[key] {
		return "evidence_kind_unknown"
	}
	if s, ok := ref.(string); !ok || !hex64.MatchString(s) {
		return "evidence_ref_malformed"
	}
	if s, ok := prop(ev, "system").(string); !ok || len(s) == 0 {
		return "evidence_system_missing"
	}
	return ""
}

// ---- the report ----

// Code is one refusal or finding. Reason is reported for readers and is not part of the verdict signature.
type Code struct {
	Code   string `json:"code"`
	Reason string `json:"reason,omitempty"`
}

// Report is the provenance report this port produces: the verdict signature with reasons. The reference report
// also carries layers, establishes and does_not_establish; this port reproduces the verdict signature only.
type Report struct {
	Schema          string `json:"schema"`
	VerifierVersion string `json:"verifier_version"`
	Port            string `json:"port"`
	TaskID          Value  `json:"-"`
	Verdict         string `json:"verdict"`
	Refusals        []Code `json:"refusals"`
	Findings        []Code `json:"findings"`
}

// Signature is the verdict signature: verdict, sorted set of refusal codes, sorted set of finding codes.
type Signature struct {
	Verdict  string   `json:"verdict"`
	Refusals []string `json:"refusals"`
	Findings []string `json:"findings"`
}

func codeSet(cs []Code) []string {
	m := map[string]bool{}
	out := []string{}
	for _, c := range cs {
		if !m[c.Code] {
			m[c.Code] = true
			out = append(out, c.Code)
		}
	}
	sort.Strings(out)
	return out
}

// Signature returns the report's verdict signature.
func (r *Report) Signature() Signature {
	return Signature{Verdict: r.Verdict, Refusals: codeSet(r.Refusals), Findings: codeSet(r.Findings)}
}

// VerifyBundle verifies a parsed bundle the way the reference CLI does (Object.assign({}, bundle, {resolve:
// didKeyResolver}); verifyProvenance(input)). An error stands for an input on which the reference throws.
func VerifyBundle(bundle Value) (*Report, error) {
	return Verify(assign(bundle), DidKeyResolver)
}

// Verify is verifyProvenance over an input object, with signer keys from resolve.
func Verify(input *Object, resolve Resolver) (rep *Report, err error) {
	defer catch(&err)
	if resolve == nil {
		resolve = func(Value) ed25519.PublicKey { return nil }
	}
	rep = &Report{Schema: "nenrin-provenance-verify-v0", VerifierVersion: VerifierVersion, Port: "go " + PortVersion, Refusals: []Code{}, Findings: []Code{}}
	refuse := func(code, reason string) { rep.Refusals = append(rep.Refusals, Code{code, reason}) }
	note := func(code string) { rep.Findings = append(rep.Findings, Code{Code: code}) }

	taskID := andProp(input, "task_id")
	rep.TaskID = taskID
	var rawObs []Value
	if a, ok := prop(input, "observations").(*Array); ok {
		rawObs = a.Items
	}
	var malformedObs []int
	var observations []*Object
	for i, o := range rawObs {
		if ob, ok := o.(*Object); ok {
			observations = append(observations, ob)
		} else {
			malformedObs = append(malformedObs, i)
		}
	}
	var malformedRecords []string
	slot := func(name string) *Object {
		v := prop(input, name)
		if v == Undefined || v == nil || v == false {
			return nil
		}
		if o, ok := v.(*Object); ok {
			return o
		}
		malformedRecords = append(malformedRecords, name)
		return nil
	}
	grant := slot("grant")
	primaryReceipt := slot("receipt")
	var receipts []*Object
	{
		var extra []*Object
		if a, ok := prop(input, "receipts").(*Array); ok {
			for i, r := range a.Items {
				if ro, ok := r.(*Object); ok {
					extra = append(extra, ro)
				} else {
					malformedRecords = append(malformedRecords, "receipts["+strconv.Itoa(i)+"]")
				}
			}
		}
		seen := map[string]bool{}
		all := extra
		if primaryReceipt != nil {
			all = append([]*Object{primaryReceipt}, extra...)
		}
		for _, r := range all {
			key, cerr := Canonical(r)
			if cerr != nil {
				key = strconv.Itoa(len(receipts))
			}
			if !seen[key] {
				seen[key] = true
				receipts = append(receipts, r)
			}
		}
	}
	requireSigs := !seq(prop(input, "require_signatures"), false)
	intent := slot("intent")

	for range malformedObs {
		refuse("delegation_observation_invalid", "record_not_object")
	}
	for _, name := range malformedRecords {
		if name == "intent" {
			refuse("preflight_invalid", "record_not_object")
		} else {
			refuse("execution_invalid", "record_not_object")
		}
	}

	// ---- 0. task identity ----
	if s, ok := taskID.(string); !ok || len(s) == 0 {
		refuse("task_id_missing", "")
	}
	var ids []Value
	for _, o := range observations {
		ids = append(ids, andProp(o, "task_id"))
	}
	if grant != nil {
		ids = append(ids, prop(grant, "task_id"))
	}
	if intent != nil {
		ids = append(ids, prop(intent, "task_id"))
	}
	for _, r := range receipts {
		ids = append(ids, andProp(r, "task_id"))
	}
	for _, id := range ids {
		if !seq(id, taskID) {
			refuse("task_id_mismatch", "")
			break
		}
	}

	// ---- 1. delegation ----
	if len(rawObs) == 0 {
		note("no_delegation_observations")
	} else {
		for _, o := range observations {
			v := verifyObservation(o)
			s := result{ok: true}
			if requireSigs {
				s = verifySignedObservation(o, resolve)
			}
			if !(v.ok && s.ok) {
				reason := v.reason
				if v.ok {
					reason = s.reason
				}
				refuse("delegation_observation_invalid", reason)
			}
		}
		if ok, reason := chainContinuousSet(observations); !ok {
			refuse("delegation_chain_broken", reason)
		}
		bySeq := &jsMap{}
		for _, o := range observations {
			bySeq.push(andProp(prop(o, "hop"), "seq"), o)
		}
		for _, s := range sortNumeric(bySeq.keys) {
			if seq(aggregateVerdict(bySeq.get(s)), "disagreement") {
				note("witness_disagreement")
			}
		}
	}

	// ---- 2. execution ----
	var reconciled *Object
	switch {
	case grant == nil && len(receipts) == 0:
		note("no_execution_records")
	case grant == nil || len(receipts) == 0:
		refuse("execution_incomplete_pair", "")
	default:
		primary := primaryReceipt
		if primary == nil {
			primary = receipts[0]
		}
		ve := verifyExecution(grant, primary)
		for _, f := range ve.findings {
			note(f)
		}
		if !ve.ok {
			refuse("execution_invalid", ve.reason)
		}
		if requireSigs {
			if s := verifySignedExecution(grant, primary, resolve); !s.ok {
				refuse("execution_signature_invalid", s.reason)
			}
		}
		for _, r := range receipts {
			if r == primary {
				continue
			}
			if requireSigs && !verifySignedExecution(grant, r, resolve).ok {
				continue
			}
			if vr := verifyExecution(grant, r); !vr.ok {
				refuse("execution_invalid", vr.reason)
			}
		}
		rec := reconcile(receipts, prop(grant, "grant_ref"), prop(grant, "provider_id"), resolve, requireSigs)
		switch rec.status {
		case "equivocation":
			refuse("execution_equivocation", "")
		case "reconciled":
			for _, r := range receipts {
				if seq(prop(r, "receipt_id"), rec.receiptID) {
					reconciled = r
					break
				}
			}
			if reconciled == nil {
				reconciled = primary
			}
		default:
			refuse("execution_unreconciled", rec.status)
		}
	}

	// ---- 2b. preflight ----
	if intent != nil {
		if grant == nil {
			refuse("preflight_without_grant", "")
		} else {
			pf := verifyPreflight(grant, intent)
			for _, f := range pf.findings {
				note(f)
			}
			if !pf.ok {
				refuse("preflight_invalid", pf.reason)
			}
			if requireSigs && !verifyDetached(prop(intent, "intent_sig"), resolve(prop(intent, "provider_id")), func() Value { return preimageIntent(intent) }) {
				refuse("preflight_signature_invalid", "intent_sig_invalid")
			}
			if reconciled != nil && !actionsEqual(prop(intent, "proposed_action"), prop(reconciled, "executed_action")) {
				note("declared_executed_divergence")
			}
		}
	}

	// ---- 3. evidence ----
	var evReceipt *Object
	switch {
	case reconciled != nil:
		evReceipt = reconciled
	case primaryReceipt != nil:
		evReceipt = primaryReceipt
	case len(receipts) > 0:
		evReceipt = receipts[0]
	}
	if evReceipt != nil {
		var ev Value
		if out := prop(evReceipt, "outcome"); truthy(out) {
			if e := prop(out, "evidence"); truthy(e) {
				ev = e
			}
		}
		if !truthy(ev) {
			note("no_evidence_bound")
		} else if why := evidenceWellFormed(ev); why != "" {
			refuse("evidence_invalid", why)
		} else {
			note("evidence_bound_unchecked")
		}
	}

	// ---- 4. linkage ----
	if len(rawObs) > 0 && reconciled != nil {
		rid := receiptID(reconciled)
		links, bad := 0, 0
		for _, o := range observations {
			var ref Value
			if c := andProp(o, "conduct"); truthy(c) {
				ref = prop(c, "detail_ref")
			}
			if s, ok := ref.(string); ok && strings.HasPrefix(s, linkPrefix) {
				links++
				if s[len(linkPrefix):] != rid {
					bad++
				}
			}
		}
		if bad > 0 {
			refuse("linkage_receipt_mismatch", "")
		}
		if links == 0 {
			note("no_digest_link")
		}
	}

	rep.Verdict = "accepted"
	if len(rep.Refusals) > 0 {
		rep.Verdict = "refused"
	}
	return rep, nil
}

// chainContinuousSet is R3 over a set of observations with possibly several witnesses per hop.
func chainContinuousSet(observations []*Object) (bool, string) {
	bySeq := &jsMap{}
	for _, o := range observations {
		var s Value = Undefined
		if h := prop(o, "hop"); truthy(h) {
			s = prop(h, "seq")
		}
		bySeq.push(s, o)
	}
	seqs := sortNumeric(bySeq.keys)
	for i, s := range seqs {
		if !seq(s, float64(i)) {
			return false, "seq_gap"
		}
	}
	for _, s := range seqs {
		for _, o := range bySeq.get(s) {
			if seq(s, float64(0)) {
				if !seq(prop(o, "prev_evidence_id"), nil) {
					return false, "root_prev_not_null"
				}
				continue
			}
			prior := bySeq.get(s.(float64) - 1)
			found := false
			prev := prop(o, "prev_evidence_id")
			for _, p := range prior {
				if seq(evidenceID(p), prev) {
					found = true
				}
			}
			if !found {
				return false, "broken_link"
			}
		}
	}
	return true, ""
}
