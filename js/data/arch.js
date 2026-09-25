/* What each of Valence's source files is for, in one line, written from the
 * source and the technical deep-dive. Line counts are not here -- they come
 * from js/data/source.js, which is generated from the files themselves. */

export const LAYERS = [
  { id: "theme", name: "theme", role: "Colours, type and metrics. Header-only; everything else reads from it." },
  { id: "core", name: "core", role: "The document model: positions, the line array, undo history." },
  { id: "editor", name: "editor", role: "The editing surface: rendering, input, tokenizer, snippets." },
  { id: "cph", name: "cph", role: "The judge: compile once, run every case, decide a verdict." },
  { id: "ui", name: "ui", role: "The IDE shell around the editor." },
  { id: "app", name: "app", role: "The entry point." },
];

export const ROLES = {
  "src/theme/theme.h": "The elevation ramp, the teal accent, the syntax palette, fonts and spacing, as inline constants: one source of truth for the whole UI.",
  "src/core/selection.h": "Position {row, col} with ordering, and a Selection that is just an anchor. Pixels are never stored; they are derived at paint time.",
  "src/core/text_buffer.h": "The TextBuffer interface: std::vector<std::string>, one string per line, never empty.",
  "src/core/text_buffer.cpp": "Insert, delete, split and merge lines; ranged get/delete; multi-line insert; word boundaries; load and save with a round trip that keeps the final newline.",
  "src/core/undo_manager.h": "EditAction and the ActionGroup stacks, the 400 ms grouping window and a 4,000-group cap.",
  "src/core/undo_manager.cpp": "Command-pattern undo and redo. shouldGroup() merges single-character edits of the same kind, adjacent, within 400 ms; compounds force one step.",
  "src/editor/cpp_highlighter.h": "Token types and the tokenizer interface; keyword and type sets with transparent comparators so lookups never allocate.",
  "src/editor/cpp_highlighter.cpp": "The single-pass C++ tokenizer: comments carried across lines, strings with escapes, digit separators, hex and binary literals, functions by lookahead.",
  "src/editor/snippets.h": "The snippet table. cppmain expands to a full competitive-programming template with the caret placed inside main.",
  "src/editor/snippet_popup.h": "The suggestion popup's interface.",
  "src/editor/snippet_popup.cpp": "The popup that offers a snippet as you type its trigger, drawn in the theme's overlay style.",
  "src/editor/editor_widget.h": "EditorWidget: the heart of the editor, a QWidget that owns a buffer, an undo manager and a highlighter.",
  "src/editor/editor_widget.cpp": "Custom QPainter rendering with viewport culling, keyboard routing, auto-close pairs, smart indent, brace re-indent, selection, clipboard, zoom and eased scrolling.",
  "src/cph/test_case.h": "TestCase and Verdict (AC, WA, TLE, RE, CE) as plain values, with one spelling of each label.",
  "src/cph/judge.h": "The judge's public surface: asynchronous by design, results arrive on signals, nothing blocks the GUI thread.",
  "src/cph/judge.cpp": "Compiles with g++ -O2 -std=gnu++17 into a temp dir, pipes each case's input, times it, kills a runaway at the limit, and compares output ignoring trailing whitespace.",
  "src/ui/status_bar.h": "The status bar's interface.",
  "src/ui/status_bar.cpp": "Cursor position, file name, language and encoding along the bottom edge.",
  "src/ui/tab_widget.h": "The tab strip's interface.",
  "src/ui/tab_widget.cpp": "Multiple files open at once, with an accent underline on the active tab and a modified marker.",
  "src/ui/file_explorer.h": "The sidebar's interface.",
  "src/ui/file_explorer.cpp": "The workspace tree: inline new file and folder, F2 rename with validation, delete to the Recycle Bin, a context menu.",
  "src/ui/terminal_widget.h": "The terminal's interface.",
  "src/ui/terminal_widget.cpp": "A persistent PowerShell session over QProcess that survives the shell dying, guards its input region and handles real keys.",
  "src/ui/test_case_card.h": "The test-case card's interface.",
  "src/ui/test_case_card.cpp": "One test case: input, expected and actual output, a verdict badge; collapses to one row and scrolls a failure to its first differing line.",
  "src/ui/cph_panel.h": "The judge panel's interface.",
  "src/ui/cph_panel.cpp": "The judge panel (Ctrl+J): the list of cards, Ctrl+Enter to run them all, and the tests saved beside the source as JSON.",
  "src/ui/main_window.h": "The main window's interface.",
  "src/ui/main_window.cpp": "The IDE shell: menus and shortcuts, the layout it persists, file operations, and the F5 save-compile-run pipeline.",
  "src/main.cpp": "Creates the application and the main window.",
};

/* The calls one keystroke makes, in order (EditorWidget::keyPressEvent ->
 * handleChar -> TextBuffer::insertChar -> UndoManager::recordInsert ->
 * rebuildCommentState -> CppHighlighter::tokenize -> update() -> paintEvent). */
export const KEYSTROKE = [
  "src/editor/editor_widget.cpp",
  "src/core/text_buffer.cpp",
  "src/core/undo_manager.cpp",
  "src/editor/cpp_highlighter.cpp",
  "src/editor/editor_widget.cpp",
];
