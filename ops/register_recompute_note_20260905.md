### Independent recompute (record)

- 2026-09-05: a second party (Federico Blanco Sanchez-Llanos) cloned this repository and ran `scripts/make_ring.py --verify` against all eight August rings using the committed `history/` exports. Result: 8 of 8 match, including the gate's own ring. This tests that the repository is internally consistent and reproducible. A from-scratch reimplementation in another language producing the same bytes is a separate test and has not yet been done.
