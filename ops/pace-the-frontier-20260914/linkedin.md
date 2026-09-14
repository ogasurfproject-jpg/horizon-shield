LinkedIn (English)

This week the heads of the biggest AI companies said the same thing out loud. AI is moving too fast, and we need to slow the pace so safety can catch up. Their worry is not science fiction. It is swarms of AI agents acting on the internet faster than anyone can check them.

Here is the part almost no one is adding. Slowing down is not the missing piece. Even at a slower pace, you still have to answer one question: what did this AI agent actually do, and when, without trusting the company that built it.

That is the boring, unglamorous layer. It is also the one I have been building from a small office in Hiratsuka, Japan, while the giants argued about speed. And this week I shipped its sharpest part.

Take any verified record my system has produced. Name a date. The system tells you, provably, whether that record existed before or after your date. Not "we say so." The answer comes from a clock I do not control: the Bitcoin block that timestamps the record. You cannot backdate a finding to before an incident, because the block time is not mine to move.

Here is a live one. This verification record: did it exist before August 1, 2026? Ask the endpoint, not me:

https://ledger.horizonshield.dev/precedence/jidec:entry:6?before=2026-08-01T00:00:00Z

It answers "precedes," and hands you the block number and the exact one line command to recompute the bytes yourself. A signature could never do this. A signature only proves the time the signer claims to have written. A Bitcoin block proves the time the world already saw.

I am not a frontier lab. I do not need to be. The industry just named the piece that is missing, and it is the one I already ship.

The people racing to build powerful AI finally agree it has to be checkable. I have been quietly making it checkable this whole time.
