# trace-blind illustrative plan

Status: illustrative. Not on any ledger and not anchored. The time below stands in for the time a real plan's
Bitcoin anchor would give.

Plan anchor time (stated): 2026-11-06T00:00:00Z

Rows (row, input sha256, label):
- r1 4ee65a5f2efaf7124f9f49c08bf25b6229735eae6232f76bb6a4c404450aae5d stop
- r2 c65f77e5bb2f248d8be2b42394058dc2ab71e11f2132004f5e04efd7a49f2c05 pass
- r3 d24621bbcd9a722aed4af381a6d4b51ce0f2bdbd9fd92edfeda4b39948e670e4 stop
- r4 f380ac604e1d99790080d936372c61467192a22b241263eebd6d7a2b27f75c91 stop
- r5 8e1045e622f29f0f4aa71d06631f7bbb7dce577847517d6352404cf7271370b7 pass
- r6 5e6ab15ca6dec8da82b7dcbc7569ed42222c06d01de5db7dd20f63991f785161 stop

Pins for the receipt of every row (TRACE v0.2 record):
{
 "appraisal_status": "affirming",
 "build_digest": "sha256:2dd59ecc0d28b0432137d7df32edfd39730eaa08451a55d78153247101b9515f",
 "producer_thumbprints": [
  "WGfz5uJ29k7oM7Wjoz78BzF6SSwJNyTJhIAPMs2YJf4"
 ],
 "runtime": {
  "measurement": "sha384:5b0ce64ad1c1f6375dbda5f760b98526ca1bcf91b8195091afc28e7b024251d68fe32e05af34048d6607678cd23283ff",
  "platform": "azure-cvm-sev-snp"
 },
 "window": [
  1793923200,
  1794009600
 ]
}

A row counts as correct only when its receipt verifies, matches every pin, has iat inside the window and its
tool_transcript.hash equals sha256 of {answer, input_sha256, row} (sorted keys, no spaces). Any other row counts
as not correct, whatever the verifier answered.

Line: at least 2 of 6 rows correct.
