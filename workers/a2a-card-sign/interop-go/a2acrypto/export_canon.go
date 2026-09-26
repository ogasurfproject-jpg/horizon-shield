// HORIZON SHIELD addition (not upstream): expose the v2.6.0 canonicalization so the
// fixture can print the canonical bytes' SHA-256 next to the JS SDK's.
package a2acrypto

// CanonicalJSON returns canonicalizeJSON(raw): RFC 8785 of the card, top-level signatures dropped.
func CanonicalJSON(raw []byte) ([]byte, error) { return canonicalizeJSON(raw) }
