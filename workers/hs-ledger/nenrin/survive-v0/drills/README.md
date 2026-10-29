Reports written by .github/workflows/survive-drill.yml. latest-*.json is the newest run for each source; history.jsonl has one line per run. Red runs stay.

swh-cook-ahead.json (2026-10-30) is the copy each run asks the Software Heritage vault for at its end. The next run uses that copy when the vault has it ready, and says so in the report (source.cooked_ahead.used). A record older than two days is not used. When the copy is not ready, the run cooks the latest visit and waits, as before.
