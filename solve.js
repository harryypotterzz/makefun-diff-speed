// Fast drop-in for makefun-diff 1.0.0.
//
// Approach (written from the rule stated in the competition description, not
// copied from the reference implementation):
//   * Lines are interned to small integer ids (one Map per case), so the
//     search compares integers instead of strings. A line's id is twice its
//     part's id plus one when the line ends in "\n", so equal lines get equal
//     ids and different lines different ones.
//   * The common prefix / suffix of lines is trimmed first.
//   * Between them, the same greedy Myers search the rule describes: for
//     d = 0, 1, 2, ... and each diagonal k = x - y from -d to d in steps of 2,
//     the furthest point a path of d edits reaches is one old line past the
//     furthest (d-1)-point on diagonal k-1 (a deletion) or one new line past
//     the furthest (d-1)-point on diagonal k+1 (an insertion), whichever lies
//     further into the old text, the deletion when both reach the same point;
//     a move past the end of either text is no candidate, no edge diagonal is
//     pruned, and from that point the path follows every run of lines equal
//     in both as far as it goes; the first path to reach both ends is the
//     script.
//     Instead of keeping a linked list of components per path (an object per
//     step), the search keeps, for every d, the furthest x reached on every
//     diagonal in one flat Int32Array (entry -1 = no path), and the script is
//     recovered by walking back down the same choices. That is the same
//     search, the same tie-break and the same script, with no allocation in
//     the inner loop. The two id arrays are padded with two distinct sentinel
//     ids past their ends, so a snake needs no bounds checks, and the inner
//     loop handles two diagonals at a time.
//   * The patch is then formatted exactly as the rule describes: one header
//     line, hunks with 3 kept lines of context, change runs listing their
//     deletions before their insertions, runs at most 6 kept lines apart
//     sharing a hunk, and a "%" line after a line that ends its text with no
//     newline.

// Scratch space for the furthest-x table, reused from one case to the next:
// every entry it holds is written by the forward search of the case that
// reads it, so reusing it carries no answer from one case to another.
let vsBuf = new Int32Array(0);
let vsCap = 0;

const KEEP = '=';
const DELETE = '-';
const INSERT = '+';
const FORMAT = 'makefun-diff/1';
const CONTEXT = 3;

/**
 * A text's lines as integer ids, each id twice its part's id plus one when
 * the line ends in "\n" (a text is cut after every "\n", the only separator,
 * and a last line with no "\n" is a line too). Parts are interned through
 * `map` (shared by both texts of one case), the part strings landing in
 * `parts`, indexed by part id, so a line's string can be rebuilt for the
 * patch output.
 */
function tokenize(text, map, parts) {
  const split = text.split('\n');
  const last = split.length - 1;
  const ids = new Int32Array(split.length);
  let n = 0;
  for (let i = 0; i < last; i++) {
    const part = split[i];
    let id = map.get(part);
    if (id === undefined) {
      id = parts.length;
      map.set(part, id);
      parts.push(part);
    }
    ids[n++] = id * 2 + 1;
  }
  if (split[last] !== '') {
    const part = split[last];
    let id = map.get(part);
    if (id === undefined) {
      id = parts.length;
      map.set(part, id);
      parts.push(part);
    }
    ids[n++] = id * 2;
  }
  return ids.subarray(0, n);
}

/**
 * The runs of the edit script of oldIds into newIds: [{ kind, count }] in
 * order, kinds '=' (kept), '-' (deleted), '+' (inserted). The search is the
 * greedy Myers search of the rule; the runs are recovered by backtracking
 * over the furthest-x table it filled.
 */
function editRuns(a, b) {
  const n = a.length;
  const m = b.length;
  // The id arrays, padded with two distinct sentinel ids past their ends
  // (real ids are >= 0), so a snake is one comparison with no bounds checks.
  const ap = new Int32Array(n + 1);
  ap.set(a);
  ap[n] = -1;
  const bp = new Int32Array(m + 1);
  bp.set(b);
  bp[m] = -2;
  // Vs is one flat Int32Array: the entries for d sit at off(d) .. off(d)+d,
  // off(d) = d*(d+1)/2, one entry per diagonal k = -d, -d+2, ..., d at index
  // (k + d) / 2; the entry is the furthest x reached on that diagonal after
  // d edits and its snake (-1 = no path). The buffer is shared scratch, grown
  // by doubling as the search needs more of it.
  const off = (d) => (d * (d + 1)) >> 1;
  let Vs = vsBuf;
  const grow = (d) => {
    while (off(d) + d + 1 > vsBuf.length) {
      vsCap = vsCap === 0 ? 4096 : vsCap * 2;
      const next = new Int32Array((vsCap * (vsCap + 1)) / 2 + vsCap + 1);
      next.set(vsBuf);
      vsBuf = next;
      Vs = next;
    }
  };
  let x = 0;
  let y = 0;
  while (ap[x] === bp[y]) {
    x++;
    y++;
  }
  Vs[0] = x;
  if (x === n && y === m) return [];
  let D = -1;
  const kFinal = n - m;
  for (let d = 1; d <= n + m; d++) {
    grow(d);
    const pBase = off(d - 1);
    const cBase = off(d);
    // Two diagonals at a time. pv0 is the (d-1)-value on diagonal k+1 for
    // the first of the pair, pvPrev the (d-1)-value on diagonal k-1, each
    // read once and carried into the next pair.
    let pv0 = Vs[pBase];
    let pvPrev = -1;
    let j = 0;
    let k = -d;
    for (; j + 1 <= d; j += 2, k += 4) {
      let u = -1;
      if (pvPrev !== -1 && pvPrev < n) u = pvPrev + 1;
      if (pv0 !== -1 && pv0 - (k + 1) < m && pv0 > u) u = pv0;
      if (u === -1) {
        Vs[cBase + j] = -1;
      } else {
        let X = u;
        let Y = X - k;
        while (ap[X] === bp[Y]) {
          X++;
          Y++;
        }
        Vs[cBase + j] = X;
        if (X === n && Y === m) {
          D = d;
          break;
        }
      }
      const pv1 = j + 1 < d ? Vs[pBase + j + 1] : -1;
      let u2 = -1;
      if (pv0 !== -1 && pv0 < n) u2 = pv0 + 1;
      if (pv1 !== -1 && pv1 - (k + 3) < m && pv1 > u2) u2 = pv1;
      if (u2 === -1) {
        Vs[cBase + j + 1] = -1;
      } else {
        let X = u2;
        let Y = X - (k + 2);
        while (ap[X] === bp[Y]) {
          X++;
          Y++;
        }
        Vs[cBase + j + 1] = X;
        if (X === n && Y === m) {
          D = d;
          break;
        }
      }
      pvPrev = pv1;
      pv0 = j + 2 < d ? Vs[pBase + j + 2] : -1;
    }
    if (D >= 0) break;
    if (j <= d) {
      // One diagonal left when d is even.
      let u = -1;
      if (pvPrev !== -1 && pvPrev < n) u = pvPrev + 1;
      if (pv0 !== -1 && pv0 - (k + 1) < m && pv0 > u) u = pv0;
      if (u === -1) {
        Vs[cBase + j] = -1;
      } else {
        let X = u;
        let Y = X - k;
        while (ap[X] === bp[Y]) {
          X++;
          Y++;
        }
        Vs[cBase + j] = X;
        if (X === n && Y === m) D = d;
      }
    }
    if (D >= 0) break;
  }
  if (D < 0) throw new Error('diff: the search ended without reaching both ends');

  // Walk back from (D, kFinal): at each step re-derive which move the
  // forward search took, then the snake it followed after that move.
  const rev = [];
  const pushRun = (kind, count) => {
    if (count <= 0) return;
    const last = rev[rev.length - 1];
    if (last !== undefined && last.kind === kind) last.count += count;
    else rev.push({ kind, count });
  };
  let d = D;
  let k = kFinal;
  let X = n;
  let Y = m;
  while (d > 0) {
    const pBase = off(d - 1);
    const j = (k + d) >> 1;
    const pvDel = j > 0 ? Vs[pBase + j - 1] : -1;
    const pvIns = j < d ? Vs[pBase + j] : -1;
    const canDel = pvDel !== -1 && pvDel < n;
    const canIns = pvIns !== -1 && pvIns - (k + 1) < m;
    let isDel;
    if (canDel && canIns) isDel = pvDel + 1 >= pvIns;
    else if (canDel) isDel = true;
    else if (canIns) isDel = false;
    else throw new Error('diff: the backtrack found no move');
    let Xp;
    let Yp;
    let Xe;
    if (isDel) {
      Xp = pvDel;
      Yp = Xp - (k - 1);
      Xe = Xp + 1;
      k = k - 1;
    } else {
      Xp = pvIns;
      Yp = Xp - (k + 1);
      Xe = Xp;
      k = k + 1;
    }
    pushRun(KEEP, X - Xe);
    pushRun(isDel ? DELETE : INSERT, 1);
    X = Xp;
    Y = Yp;
    d--;
  }
  pushRun(KEEP, X);
  rev.reverse();
  return rev;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? `${op}${line}` : `${op}${line}\n%\n`;
}

/** makefun-diff 1.0.0's answer for one case's input: its patch of { old, new }. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('diff: the input is { old, new }, two strings');
  }
  const map = new Map();
  const parts = [];
  const a = tokenize(input.old, map, parts);
  const b = tokenize(input.new, map, parts);
  const n = a.length;
  const m = b.length;
  // A line's string, rebuilt lazily from its part: only lines the patch
  // shows are ever rebuilt.
  const lineCache = [];
  const lineOf = (id) => {
    let s = lineCache[id];
    if (s === undefined) {
      const part = parts[id >> 1];
      s = (id & 1) === 1 ? `${part}\n` : part;
      lineCache[id] = s;
    }
    return s;
  };
  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  runs.push(...editRuns(a.slice(prefix, n - suffix), b.slice(prefix, m - suffix)));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written(KEEP, lineOf(a[at])));
      for (let i = 0; i < c.dels; i++) out.push(written(DELETE, lineOf(a[c.o + i])));
      for (let i = 0; i < c.ins; i++) out.push(written(INSERT, lineOf(b[c.p + i])));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written(KEEP, lineOf(a[at])));
  }
  return out.join('');
}
