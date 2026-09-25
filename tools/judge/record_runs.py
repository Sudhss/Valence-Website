"""Record real judge runs for the page's judge panel.

    python tools/judge/record_runs.py

Compiles each solution in tools/judge/solutions/ exactly as Valence's Judge
does (g++ -O2 -std=gnu++17), runs every test case through the binary with the
judge's 3,000 ms limit, and writes what actually happened -- stdout, stderr,
exit code, wall time, the compiler's own diagnostics -- to js/data/judge-runs.js.

The browser cannot compile C++, so the page replays these recordings. The
verdicts on the page are NOT read from here: they are recomputed in the browser
from the recorded output with js/core/judge.js, the port of Judge::outputsMatch.
"""
from __future__ import annotations

import json
import os
import random
import subprocess
import tempfile
import time
from datetime import date
from pathlib import Path

SITE = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
MINGW_BIN = Path(os.environ.get("MINGW_BIN", r"C:\Qt\Tools\mingw1310_64\bin"))
GXX = str(MINGW_BIN / "g++.exe")
ENV = {**os.environ, "PATH": f"{MINGW_BIN};{os.environ['PATH']}"}
TIME_LIMIT_MS = 3000  # Judge::Impl::timeLimitMs

SOLUTIONS = [
    ("kadane.cpp", "Kadane, 64-bit"),
    ("zero_start.cpp", "Kadane, best starts at 0"),
    ("brute.cpp", "Every subarray, O(n\u00b2)"),
    ("off_by_one.cpp", "Loop runs to i <= n"),
    ("typo.cpp", "Missing semicolon"),
]


def max_subarray(values):
    best, run = None, 0
    for v in values:
        run = v if best is None else max(v, run + v)
        best = run if best is None else max(best, run)
    return best


def big_case():
    rng = random.Random(20260926)
    values = [rng.randint(-1_000_000_000, 1_000_000_000) for _ in range(200_000)]
    return f"{len(values)}\n{' '.join(map(str, values))}\n", values


def cases():
    small = [
        ("Sample", [-2, 1, -3, 4, -1, 2, 1, -5, 4]),
        ("All negative", [-3, -1, -7, -2]),
        ("Single element", [7]),
    ]
    out = []
    for name, values in small:
        out.append({"name": name, "input": f"{len(values)}\n{' '.join(map(str, values))}",
                    "expected": f"{max_subarray(values)}\n", "display": None})
    text, values = big_case()
    out.append({"name": "n = 200,000", "input": text, "expected": f"{max_subarray(values)}\n",
                "display": f"200000\n{' '.join(map(str, values[:6]))} \u2026 ({len(text):,} bytes, seeded random)"})
    return out


def clip(s: str, n: int = 4000) -> str:
    return s if len(s) <= n else s[:n] + "\n\u2026"


def main():
    work = Path(tempfile.mkdtemp(prefix="valence-judge-"))
    tests = cases()
    records = []
    for file, title in SOLUTIONS:
        src = HERE / "solutions" / file
        exe = work / (src.stem + ".exe")
        t0 = time.perf_counter()
        build = subprocess.run([GXX, "-O2", "-std=gnu++17", "-o", str(exe), str(src)],
                               env=ENV, capture_output=True, text=True)
        compile_ms = round((time.perf_counter() - t0) * 1000)
        compiler_output = (build.stdout + build.stderr).replace(str(src), file).replace(str(HERE), "")
        record = {"file": file, "title": title, "source": src.read_text(encoding="utf-8"),
                  "compileMs": compile_ms, "compileOk": build.returncode == 0,
                  "compilerOutput": clip(compiler_output), "runs": []}
        if build.returncode == 0:
            for case in tests:
                stdin = case["input"] if case["input"].endswith("\n") else case["input"] + "\n"
                t0 = time.perf_counter()
                try:
                    proc = subprocess.run([str(exe)], input=stdin, capture_output=True, text=True,
                                          timeout=TIME_LIMIT_MS / 1000, cwd=work)
                    elapsed = round((time.perf_counter() - t0) * 1000)
                    record["runs"].append({"stdout": clip(proc.stdout), "stderr": clip(proc.stderr),
                                           "exitCode": proc.returncode, "elapsedMs": elapsed, "timedOut": False})
                except subprocess.TimeoutExpired as e:
                    out = e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or "")
                    record["runs"].append({"stdout": clip(out), "stderr": "", "exitCode": -1,
                                           "elapsedMs": TIME_LIMIT_MS, "timedOut": True})
        records.append(record)
        print(file, "compiled" if build.returncode == 0 else "CE", [
            ("TLE" if r["timedOut"] else r["exitCode"], r["elapsedMs"]) for r in record["runs"]])

    version = subprocess.run([GXX, "--version"], env=ENV, capture_output=True, text=True).stdout.splitlines()[0]
    payload = {
        "recorded": date.today().isoformat(),
        "compiler": version,
        "flags": "-O2 -std=gnu++17",
        "timeLimitMs": TIME_LIMIT_MS,
        "problem": {
            "title": "Maximum subarray sum",
            "statement": "Given n integers, print the largest sum of a non-empty contiguous subarray.",
            "limits": "1 \u2264 n \u2264 200,000 \u00b7 |a\u1d62| \u2264 10\u2079",
        },
        "cases": [{"name": c["name"], "input": c["display"] or c["input"], "expected": c["expected"]} for c in tests],
        "solutions": records,
    }
    (SITE / "js" / "data" / "judge-runs.js").write_text(
        "/* Real runs, recorded by tools/judge/record_runs.py -- not written by hand.\n"
        " * Verdicts are recomputed in the browser from this output with the ported\n"
        " * Judge::outputsMatch rule; nothing here says AC or WA. */\n"
        f"export const JUDGE_RUNS = {json.dumps(payload, indent=1)};\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
