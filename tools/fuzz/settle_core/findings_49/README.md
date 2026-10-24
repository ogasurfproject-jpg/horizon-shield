# settle core v0: six fuzzer inputs for horizon-shield#49

Inputs only, with no expected outputs, from the differential fuzzer run of 2026-10-23 (`tools/fuzz/settle_core/`), for the findings B, D, E, F, G and H in https://github.com/ogasurfproject-jpg/horizon-shield/issues/49#issuecomment-6356576599 .

Each folder name is the letter and the input's name: the sha256 over the lines `<sha256 of file> <relative path>` of its files, sorted by path (`tree_sha256` in `settle_core_fuzz.py`). Each folder's `SHA256SUMS` lists its files and is not part of the name. Signatures in these inputs use the fuzzer's fixed test keys.

| finding | folder | files | fuzzer seed |
|---|---|---|---|
| B | `B_2e40ee46012394500a7288d33247eca31a38816cdcffd0ef69c2236cbec4bb91` | 4 | `fuzz20261023-d` |
| D | `D_4252602cf7ed4b190596fc9dbc60fee3354a9b9ed13f2f0c4f75c4f73dfa39cf` | 4 | `fuzz20261023-d` |
| E | `E_4ea7e909e484570de29b5bdcc3a663baa97b729065552d94b6aa6fce802fca84` | 10 | `fuzz20261023-a` |
| F | `F_3284dbbea972dba3c6d549a6624cd991200ffcb413ecb4532525ecd2d76e6bf4` | 11 | `fuzz20261023-a` |
| G | `G_6de469b9884ad629c1a7613ee3542b212332b2c0bd9028f5104865961e64ec21` | 5 | `fuzz20261023-c` |
| H | `H_00cd1b6e904883405eb7d7e644af09576832d633b973328638cf6a2e6870da7e` | 3 | `fuzz20261023-b` |
