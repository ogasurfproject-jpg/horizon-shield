package nenrinverify

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The shared vectors of furui-day and resume-admission: the Python, JavaScript and Java ports run the same file.
func TestFuruiVectors(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "furui-check-day-v0", "verify_vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	doc, err := FuruiParse(b)
	if err != nil {
		t.Fatal(err)
	}
	cases := Get(doc.(*Object), "cases").(*Array).Items
	if len(cases) < 50 {
		t.Fatalf("only %d cases", len(cases))
	}
	for _, c := range cases {
		got, err := FuruiRunCase(c)
		if err != nil {
			t.Fatal(err)
		}
		g, _ := FuruiCanonical(got)
		e, _ := FuruiCanonical(Get(c.(*Object), "expect"))
		if g != e {
			t.Errorf("%v\n got  %s\n want %s", Get(c.(*Object), "name"), g, e)
		}
	}
}

// The vectors of --bitcoin-header (furui-day step 7, resume-admission step 6, and the step alone): the same file the
// Python, JavaScript and Java ports run.
func TestFuruiBitcoinHeaderVectors(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "furui-check-day-v0", "bitcoin_header_vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	doc, err := FuruiParse(b)
	if err != nil {
		t.Fatal(err)
	}
	cases := Get(doc.(*Object), "cases").(*Array).Items
	if len(cases) < 20 {
		t.Fatalf("only %d cases", len(cases))
	}
	for _, c := range cases {
		got, err := FuruiRunCase(c)
		if err != nil {
			t.Fatal(err)
		}
		g, _ := FuruiCanonical(got)
		e, _ := FuruiCanonical(Get(c.(*Object), "expect"))
		if g != e {
			t.Errorf("%v\n got  %s\n want %s", Get(c.(*Object), "name"), g, e)
		}
	}
}

func TestFuruiHostGuard(t *testing.T) {
	for _, u := range []string{"https://example.org/furui/day/2026-11-03/leaf/0", "http://ledger.horizonshield.dev/ledger/1", "https://ledger.horizonshield.dev:8443/ledger/1"} {
		if _, _, err := FuruiHTTPGet(u); err == nil || !strings.Contains(err.Error(), "not an allowed URL") {
			t.Errorf("%s: %v", u, err)
		}
	}
	for _, u := range []string{"https://ledger.horizonshield.dev/ledger/1", "http://mempool.space/api/block-height/1", "https://blockstream.info:8443/api/block-height/1"} {
		if _, _, err := FuruiHTTPGetExplorer(u); err == nil || !strings.Contains(err.Error(), "not an allowed URL") {
			t.Errorf("%s: %v", u, err)
		}
	}
}

func TestFuruiEncComponent(t *testing.T) {
	if got := FuruiEncComponent("https://a.example/x y?z=1&w=~!*'()"); got != "https%3A%2F%2Fa.example%2Fx%20y%3Fz%3D1%26w%3D~%21%2A%27%28%29" {
		t.Error(got)
	}
}
