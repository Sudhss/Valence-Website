"""Build golden outputs from Valence's real C++, and the source data the site draws.

    python tools/golden/make_golden.py

Needs Qt 6 (MinGW) for the judge harness; paths below match the Qt installer's
defaults and can be overridden with QT_DIR / MINGW_BIN.

Writes:
    js/data/source.js      every line of Valence's src/, in architecture order
    tests/golden/*.json    what the real tokenizer, undo manager and judge
                           comparator return for the inputs in this file
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path

SITE = Path(__file__).resolve().parents[2]
VALENCE = SITE.parent
SRC = VALENCE / "src"
QT_DIR = Path(os.environ.get("QT_DIR", r"C:\Qt\6.10.2\mingw_64"))
MINGW_BIN = Path(os.environ.get("MINGW_BIN", r"C:\Qt\Tools\mingw1310_64\bin"))
GXX = str(MINGW_BIN / "g++.exe")
ENV = {**os.environ, "PATH": f"{MINGW_BIN};{QT_DIR / 'bin'};{os.environ['PATH']}"}

# Architecture order: each layer only depends on the ones before it.
LAYERS = [
    ("theme", ["theme/theme.h"]),
    ("core", ["core/selection.h", "core/text_buffer.h", "core/text_buffer.cpp",
              "core/undo_manager.h", "core/undo_manager.cpp"]),
    ("editor", ["editor/cpp_highlighter.h", "editor/cpp_highlighter.cpp", "editor/snippets.h",
                "editor/snippet_popup.h", "editor/snippet_popup.cpp",
                "editor/editor_widget.h", "editor/editor_widget.cpp"]),
    ("cph", ["cph/test_case.h", "cph/judge.h", "cph/judge.cpp"]),
    ("ui", ["ui/status_bar.h", "ui/status_bar.cpp", "ui/tab_widget.h", "ui/tab_widget.cpp",
            "ui/file_explorer.h", "ui/file_explorer.cpp", "ui/terminal_widget.h",
            "ui/terminal_widget.cpp", "ui/test_case_card.h", "ui/test_case_card.cpp",
            "ui/cph_panel.h", "ui/cph_panel.cpp", "ui/main_window.h", "ui/main_window.cpp"]),
    ("app", ["main.cpp"]),
]


def sanitize(line: str) -> str:
    """One column per character, as Valence draws it: tabs to four spaces,
    anything outside printable ASCII to '?'."""
    line = line.rstrip("\r\n").replace("\t", "    ").rstrip()
    return "".join(c if 32 <= ord(c) < 127 else "?" for c in line)


def source_files():
    for layer, names in LAYERS:
        for name in names:
            path = SRC / name
            text = path.read_text(encoding="utf-8", errors="replace")
            lines = text.split("\n")
            if lines and lines[-1] == "":
                lines.pop()  # a final newline ends the last line; it does not start another
            yield layer, "src/" + name, [sanitize(l) for l in lines]


def hexs(s: str) -> str:
    return s.encode("latin-1").hex()


def run(args, **kw):
    result = subprocess.run(args, env=ENV, capture_output=True, text=True, **kw)
    if result.returncode != 0:
        raise SystemExit(f"failed: {' '.join(map(str, args))}\n{result.stdout}\n{result.stderr}")
    return result.stdout


LEXER_CASES = [
    "int value = 42;",
    "for (int i = 0; i < n; i++) cout << a[i] << \" \";",
    "const long long MOD = 1'000'000'007;",
    "auto x = 0x1F'FF, y = 0b1010'0101, z = 3.14e-10f, w = .5L;",
    "char c = '\\'', q = '\"'; std::string s = \"a \\\" b\";",
    "#include <bits/stdc++.h>",
    "  #define FAST ios::sync_with_stdio(false)",
    "x = a/b; // divide",
    "y = a /* inline */ + b;",
    "z = a/*b*/c/**/d;",
    "/* opens here",
    "   still inside the comment",
    "closes */ int after = 1;",
    "}));",
    "std::vector<std::pair<int,int>> edges;",
    "if(x){return foo (bar) ;}",
    "template<typename T> T max_of(const T& a) { return a; }",
    "string unterminated = \"no closing quote",
    "  \t  ",
    "",
    "don't",
    "a->b.c->d(e)::f",
    "operator<<(ostream& os)",
    "while (lo<=hi) { int mid = lo + (hi-lo)/2; }",
    "1e5 1E+9 42u 7ll 0xffUL",
    "QString text = QStringLiteral(\"x\");",
    "~Judge() override;",
    "int a[] = {1, 2, 3}; // trailing",
    "?? non-ascii replaced ??",
    "__attribute__((unused)) int _x9;",
]

# (actual, expected) pairs for Judge::outputsMatch / firstDifferingLine.
JUDGE_CASES = [
    ("3\n", "3"),
    ("3   \n\n\n", "3"),
    ("1 2 3\r\n4 5 6\r\n", "1 2 3\n4 5 6"),
    ("1 2 3\n4 5 7\n", "1 2 3\n4 5 6\n"),
    ("YES\n", "yes\n"),
    ("", ""),
    ("", "0\n"),
    ("0\n", ""),
    ("a\n\nb\n", "a\nb\n"),
    ("a\t\t\nb", "a\nb"),
    ("  lead\n", "lead\n"),
    ("1\n2\n3\n4\n", "1\n2\n3\n"),
    ("1\n2\n", "1\n2\n3\n"),
    ("x \t \r\n", "x"),
    ("\n\n", ""),
]

# Undo scripts: (name, lines). dt is milliseconds since the previous edit.
def type_word(row, col, word, dt=80, first_dt=80):
    out = []
    for i, ch in enumerate(word):
        out.append(f"I {row} {col + i} {hexs(ch)} {first_dt if i == 0 else dt}")
    return out


UNDO_SCRIPTS = {
    "typing a word groups": type_word(0, 0, "hello") + ["U", "R"],
    "a pause over 400ms splits": type_word(0, 0, "abc") + [f"I 0 3 {hexs('d')} 401"] + [f"I 0 4 {hexs('e')} 400"],
    "space breaks a word": type_word(0, 0, "int") + [f"I 0 3 {hexs(' ')} 50", f"I 0 4 {hexs(' ')} 50"] + type_word(0, 5, "x", first_dt=50),
    "non-adjacent insert splits": [f"I 0 0 {hexs('a')} 10", f"I 0 1 {hexs('b')} 10", f"I 0 5 {hexs('c')} 10"],
    "insert then delete splits": [f"I 0 0 {hexs('a')} 10", f"D 0 0 {hexs('a')} 10", f"D 0 0 {hexs('b')} 10"],
    "deletes on same row group": [f"D 0 4 {hexs('d')} 30", f"D 0 3 {hexs('c')} 30", f"D 0 2 {hexs('b')} 30", f"D 1 0 {hexs('x')} 30"],
    "multi-char never groups": [f"I 0 0 {hexs('ab')} 10", f"I 0 2 {hexs('c')} 10", f"I 0 3 {hexs('d')} 10"],
    "force new group": type_word(0, 0, "ab") + ["F"] + [f"I 0 2 {hexs('c')} 10"],
    "compound collects everything": ["B", f"I 0 0 {hexs('    ')} 10", f"I 1 0 {hexs('    ')} 900", f"D 2 0 {hexs('x')} 10", "E", f"I 3 0 {hexs('z')} 10"],
    "nested compound": ["B", f"I 0 0 {hexs('a')} 10", "B", f"I 0 1 {hexs('bc')} 10", "E", f"I 0 3 {hexs('d')} 10", "E", f"I 0 4 {hexs('e')} 10"],
    "redo cleared by new edit": type_word(0, 0, "ab") + ["U", f"I 0 0 {hexs('z')} 500", "R"],
    "newline breaks": [f"I 0 0 {hexs('a')} 10", f"I 0 1 {hexs(chr(10))} 10", f"I 1 0 {hexs('b')} 10"],
    "undo past empty": ["U", "R", f"I 0 0 {hexs('q')} 10", "U", "U", "R", "R"],
    "tab char counts as space": [f"I 0 0 {hexs(chr(9))} 10", f"I 0 1 {hexs(' ')} 10", f"I 0 2 {hexs('k')} 10"],
    "exactly 400ms still groups": [f"I 0 0 {hexs('a')} 10", f"I 0 1 {hexs('b')} 400", f"I 0 2 {hexs('c')} 401"],
}


def main():
    work = Path(tempfile.mkdtemp(prefix="valence-golden-"))
    here = Path(__file__).resolve().parent

    # ---- source data ---------------------------------------------------------
    files = list(source_files())
    total = sum(len(lines) for _, _, lines in files)
    data = {
        "files": [{"layer": layer, "path": path, "start": 0, "lines": len(lines)} for layer, path, lines in files],
        "lines": [l for _, _, lines in files for l in lines],
    }
    start = 0
    for entry in data["files"]:
        entry["start"] = start
        start += entry["lines"]
    out = SITE / "js" / "data"
    out.mkdir(parents=True, exist_ok=True)
    (out / "source.js").write_text(
        "/* Valence's own source, every line of src/, generated by\n"
        " * tools/golden/make_golden.py -- not written by hand. Tabs expanded, trailing\n"
        " * whitespace stripped, non-ASCII shown as '?' so each character is one column,\n"
        " * as the editor itself draws it. */\n"
        f"export const SOURCE_FILES = {json.dumps(data['files'])};\n"
        f"export const SOURCE_LINES = {json.dumps(data['lines'])};\n",
        encoding="utf-8",
    )
    print(f"source: {len(files)} files, {total} lines")

    # ---- tokenizer -------------------------------------------------------------
    lexer_exe = work / "golden_lexer.exe"
    run([GXX, "-O2", "-std=c++17", f"-I{SRC / 'editor'}", str(here / "golden_lexer.cpp"),
         str(SRC / "editor" / "cpp_highlighter.cpp"), "-o", str(lexer_exe)])
    docs = [("cases", LEXER_CASES)] + [(path, lines) for _, path, lines in files]
    doc_files = []
    for i, (_, lines) in enumerate(docs):
        p = work / f"doc{i}.hex"
        p.write_text("\n".join(hexs(l) for l in lines) + "\n", encoding="ascii")
        doc_files.append(str(p))
    results = json.loads(run([str(lexer_exe), *doc_files]))
    golden = [{"name": name, "lines": lines, "out": res} for (name, lines), res in zip(docs, results)]
    (SITE / "tests" / "golden" / "lexer.json").write_text(json.dumps(golden), encoding="utf-8")
    print(f"lexer: {sum(len(d['lines']) for d in golden)} lines")

    # ---- undo ----------------------------------------------------------------
    undo_exe = work / "golden_undo.exe"
    run([GXX, "-O2", "-std=c++17", "-include", str(here / "fakeclock.h"), f"-I{SRC / 'core'}",
         str(here / "golden_undo.cpp"), str(SRC / "core" / "undo_manager.cpp"), "-o", str(undo_exe)])
    script_files = []
    for i, lines in enumerate(UNDO_SCRIPTS.values()):
        p = work / f"undo{i}.txt"
        p.write_text("\n".join(lines) + "\n", encoding="ascii")
        script_files.append(str(p))
    results = json.loads(run([str(undo_exe), *script_files]))
    golden = [{"name": n, "script": s, "out": r} for (n, s), r in zip(UNDO_SCRIPTS.items(), results)]
    (SITE / "tests" / "golden" / "undo.json").write_text(json.dumps(golden, indent=1), encoding="utf-8")
    print(f"undo: {len(golden)} scripts")

    # ---- judge comparator ------------------------------------------------------
    moc = work / "moc_judge.cpp"
    run([str(QT_DIR / "bin" / "moc.exe"), str(SRC / "cph" / "judge.h"), "-o", str(moc)])
    inc = QT_DIR / "include"
    judge_exe = work / "golden_judge.exe"
    run([GXX, "-O2", "-std=c++17", f"-I{inc}", f"-I{inc / 'QtCore'}", f"-I{SRC / 'cph'}",
         str(here / "golden_judge.cpp"), str(SRC / "cph" / "judge.cpp"), str(moc),
         f"-L{QT_DIR / 'lib'}", "-lQt6Core", "-o", str(judge_exe)])
    pairs = work / "judge.txt"
    pairs.write_text("".join(f"{a.encode().hex() or '-'}\n{e.encode().hex() or '-'}\n" for a, e in JUDGE_CASES),
                     encoding="ascii")
    results = json.loads(run([str(judge_exe), str(pairs)]))
    golden = [{"actual": a, "expected": e, "match": r[0], "first": r[1]} for (a, e), r in zip(JUDGE_CASES, results)]
    (SITE / "tests" / "golden" / "judge.json").write_text(json.dumps(golden, indent=1), encoding="utf-8")
    print(f"judge: {len(golden)} pairs")


if __name__ == "__main__":
    main()
