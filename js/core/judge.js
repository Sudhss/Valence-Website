/* The judge's verdict rule, ported from src/cph/judge.cpp.
 *
 * Trailing whitespace on each line is ignored, as are trailing blank lines;
 * everything else must match exactly, including case. tests/ports.test.mjs
 * checks these against the real Judge::outputsMatch / firstDifferingLine,
 * compiled with Qt and run on the same pairs.
 */

export function normalizeOutput(text) {
  const lines = String(text).split("\n").map((line) => {
    let end = line.length;
    while (end > 0) {
      const c = line[end - 1];
      if (c === "\r" || c === " " || c === "\t") end -= 1;
      else break;
    }
    return line.slice(0, end);
  });
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function outputsMatch(actual, expected) {
  const a = normalizeOutput(actual);
  const e = normalizeOutput(expected);
  return a.length === e.length && a.every((line, i) => line === e[i]);
}

export function firstDifferingLine(actual, expected) {
  const a = normalizeOutput(actual);
  const e = normalizeOutput(expected);
  const n = Math.min(a.length, e.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== e[i]) return i;
  return a.length !== e.length ? n : -1;
}

/**
 * The order the judge decides in (Judge::startNextCase): a crash or non-zero
 * exit is a runtime error before any comparison; a run past the limit is a
 * TLE; only a clean exit is compared.
 */
export function verdictFor(run, expected) {
  if (run.compileError) return "CE";
  if (run.timedOut) return "TLE";
  if (run.exitCode !== 0) return "RE";
  return outputsMatch(run.stdout, expected) ? "AC" : "WA";
}
