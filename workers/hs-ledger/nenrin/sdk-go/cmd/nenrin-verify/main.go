// Command nenrin-verify checks one day of the content check runner, or one admissions[] line of a Resume, against the
// public ledger: the same commands, checks and verdicts as npm and PyPI nenrin-verify.
//
//	go install github.com/ogasurfproject-jpg/horizon-shield/workers/hs-ledger/nenrin/sdk-go/cmd/nenrin-verify@latest
//
//	nenrin-verify furui-day <YYYY-MM-DD> --leaf <i>
//	nenrin-verify resume-admission <https endpoint> <record_sha256>
//	nenrin-verify furui-vectors <verify_vectors.json>
//
// Exit 0 ok, 1 fail, 3 not_yet, 2 usage or network error. The network is GET only, only https://ledger.horizonshield.dev
// and https://furui.horizonshield.dev, with no redirects.
package main

import (
	"errors"
	"fmt"
	"os"
	"regexp"
	"strconv"

	nv "github.com/ogasurfproject-jpg/horizon-shield/workers/hs-ledger/nenrin/sdk-go/nenrinverify"
)

const usage = "usage: nenrin-verify furui-day <YYYY-MM-DD> --leaf <i>\n       nenrin-verify resume-admission <https endpoint> <record_sha256>\n       nenrin-verify furui-vectors <vectors.json>"

var (
	leafRe = regexp.MustCompile(`^(0|[1-9][0-9]{0,8})$`)
	httpRe = regexp.MustCompile(`^https://\S+$`)
)

func main() { os.Exit(run(os.Args[1:])) }

func run(a []string) int {
	var res *nv.FuruiResult
	var err error
	switch {
	case len(a) == 1 && (a[0] == "--version" || a[0] == "-V"):
		fmt.Printf("nenrin-verify (go) %s\n", nv.PortVersion)
		return 0
	case len(a) == 4 && a[0] == "furui-day" && a[2] == "--leaf" && nv.FuruiRealDay(a[1]) && leafRe.MatchString(a[3]):
		leaf, _ := strconv.ParseInt(a[3], 10, 64)
		res, err = nv.FuruiDay(a[1], leaf, nv.FuruiHTTPGet)
	case len(a) == 3 && a[0] == "resume-admission" && httpRe.MatchString(a[1]) && nv.FuruiHex64(a[2]) && nv.FuruiHost(a[1]) != "":
		res, err = nv.ResumeAdmission(a[1], a[2], nv.FuruiHTTPGet)
	case len(a) == 2 && a[0] == "furui-vectors":
		return vectors(a[1])
	default:
		fmt.Fprintln(os.Stderr, usage)
		return 2
	}
	if err != nil {
		if errors.Is(err, nv.ErrNet) {
			fmt.Fprintln(os.Stderr, "nenrin-verify: "+err.Error())
			return 2
		}
		fmt.Fprintln(os.Stderr, "nenrin-verify: "+err.Error())
		return 2
	}
	fmt.Println(nv.FuruiPretty(res.Full()))
	return map[string]int{"ok": 0, "fail": 1, "not_yet": 3}[res.Verdict]
}

func vectors(path string) int {
	b, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	doc, err := nv.FuruiParse(b)
	if err != nil {
		fmt.Fprintln(os.Stderr, "not JSON: "+err.Error())
		return 2
	}
	cases := nv.Get(doc.(*nv.Object), "cases").(*nv.Array).Items
	ok := 0
	for _, c := range cases {
		got, err := nv.FuruiRunCase(c)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 2
		}
		g, _ := nv.FuruiCanonical(got)
		e, _ := nv.FuruiCanonical(nv.Get(c.(*nv.Object), "expect"))
		same := g == e
		if same {
			ok++
		}
		name, _ := nv.FuruiCanonical(nv.Get(c.(*nv.Object), "name"))
		fmt.Printf("{\"got\":%s,\"name\":%s,\"same\":%t}\n", g, name, same)
	}
	fmt.Printf("%d/%d furui vectors give the expected verdict (go)\n", ok, len(cases))
	if ok == len(cases) {
		return 0
	}
	return 1
}
