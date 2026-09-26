// cardcheck: verify a served A2A AgentCard's JWS signatures with the a2acrypto package of
// a2aproject/a2a-go v2.6.0 (RFC 8785 canonicalization, key resolved from the jku JWKS),
// and print the SHA-256 of the canonical bytes so the JS side can be compared byte for byte.
//
//	go run . card.json [trusted_jwks_url]
//
// Exit 0 when at least one signature verifies, 1 otherwise. Every signature is reported.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"hs.local/cardcheck/a2a"
	"hs.local/cardcheck/a2acrypto"
)

func hexsha(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }

func main() {
	if len(os.Args) < 2 {
		fmt.Println("usage: go run . <card.json> [trusted_jwks_url]")
		os.Exit(2)
	}
	raw, err := os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Println("read:", err)
		os.Exit(2)
	}
	var card struct {
		Name       string                   `json:"name"`
		Version    string                   `json:"version"`
		Signatures []a2a.AgentCardSignature `json:"signatures"`
	}
	if err := json.Unmarshal(raw, &card); err != nil {
		fmt.Println("parse:", err)
		os.Exit(2)
	}
	canon, err := a2acrypto.CanonicalJSON(raw)
	if err != nil {
		fmt.Println("canonicalize:", err)
		os.Exit(2)
	}
	fmt.Printf("card=%q version=%s served_bytes=%d served_sha256=%s\n", card.Name, card.Version, len(raw), hexsha(raw))
	fmt.Printf("go_canonical_bytes=%d go_canonical_sha256=%s\n", len(canon), hexsha(canon))
	trusted := []string{"https://gate.horizonshield.dev/.well-known/jwks.json"}
	if len(os.Args) > 2 {
		trusted = []string{os.Args[2]}
	}
	kr := a2acrypto.NewJWKSKeyResolver(&http.Client{Timeout: 20 * time.Second}, trusted)
	v := a2acrypto.NewVerifier(a2acrypto.VerifierConfig{KeyResolver: kr})
	ctx := context.Background()
	pass := 0
	for i := range card.Signatures {
		if err := v.Verify(ctx, json.RawMessage(raw), &card.Signatures[i]); err != nil {
			fmt.Printf("signature[%d]: FAIL %v\n", i, err)
		} else {
			pass++
			fmt.Printf("signature[%d]: PASS\n", i)
		}
	}
	fmt.Printf("result: %d of %d signatures verify under a2a-go v2.6.0 a2acrypto\n", pass, len(card.Signatures))
	if pass == 0 {
		os.Exit(1)
	}
}
