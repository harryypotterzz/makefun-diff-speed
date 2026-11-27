# Fast diff — a faster drop-in for makefun-diff 1.0.0

[![make.fun](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/harryypotterzz/makefun-diff-speed/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/harryypotterzz/makefun-diff-speed/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)

`run({ old, new })` returns exactly the patch makefun-diff 1.0.0 returns for
the same two texts, as one JSON string — only faster.

## How it works

1. **Lines become integers.** Each line (cut after every `\n`; a last line
   with no `\n` is a line too) is interned to a small integer id, so the
   search compares integers instead of strings. A line's id is twice its
   part's id plus one when the line ends in `\n`.
2. **Trim first.** The common prefix of lines is kept, then the common suffix
   of what is left — exactly as makefun-diff does.
3. **Greedy Myers, same script.** Between the trimmed ends, the same greedy
   Myers search makefun-diff specifies: for `d = 0, 1, 2, ...` and each
   diagonal `k = x - y` from `-d` to `d` in steps of 2, the furthest point a
   path of `d` edits reaches is one old line past the furthest `(d-1)`-point
   on diagonal `k-1` (a deletion) or one new line past the furthest
   `(d-1)`-point on diagonal `k+1` (an insertion), whichever lies further
   into the old text, the deletion when both reach the same point; a move
   past the end of either text is no candidate, no edge diagonal is pruned,
   and from that point the path follows every run of lines equal in both as
   far as it goes; the first path to reach both ends is the script.
   Instead of keeping a linked list of components per path (an object per
   step), the search keeps, for every `d`, the furthest `x` reached on every
   diagonal in one flat `Int32Array` (`-1` = no path) and recovers the script
   by walking back down the same choices. Same search, same tie-break, same
   script — with no allocation in the inner loop. The id arrays are padded
   with two distinct sentinel ids past their ends, so a snake needs no bounds
   checks, and the inner loop handles two diagonals at a time. The table is
   reused from one case to the next (every entry it holds is written by the
   forward search of the case that reads it, so no answer leaks across
   cases).
4. **Same patch.** The patch is formatted exactly as makefun-diff formats
   it: one header line (`makefun-diff/1 old=N new=M hunks=H deleted=D
   inserted=I`), hunks with 3 kept lines of context, change runs listing
   their deletions before their insertions, runs at most 6 kept lines apart
   sharing a hunk, and a `%` line after a line that ends its text with no
   newline. Identical texts are the header line alone.

`main.ts` is the driver the harness runs: it reads every case from
`/input/cases.json`, answers each one alone with `run`, and writes
`/output/answers.json`. It turns V8's incremental marking off before
importing `solve.js`, as the house baseline does. No dependencies, no
network, no I/O besides the input and output files. Two runs on the same
set produce byte-identical `/output/answers.json`.

## How to run

```sh
node main.ts   # reads /input/cases.json, writes /output/answers.json
```

Outside a container, `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` stand in
for `/input` and `/output`:

```sh
MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=./out node main.ts
```

Node 22 or later.

## Measured on the practice set (4 cases, ~20k–32k lines each)

| | CPU time, whole entry (trimmed mean of 7 runs) |
| --- | --- |
| This entry | ~0.71 s |
| makefun-diff 1.0.0 (house baseline) | ~1.69 s |

About **2.4x faster** than the house baseline (~2.6x net of the do-nothing
control). The kit's scorer on the practice set: `passed: 1`,
`cases_passed: 4/4`. Answers are byte-identical to makefun-diff 1.0.0 on the
practice set, on 12 further cases drawn by the kit's own generator from
fresh seeds, and on 13,000+ fuzzed small cases.

## Files

- `solve.js` — the entry: `run(input)` returns makefun-diff's patch.
- `main.ts` — the driver: reads `/input/cases.json`, writes
  `/output/answers.json`.
- `LICENSE` — MIT.
