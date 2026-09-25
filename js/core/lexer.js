/* Valence's tokenizer, ported from src/editor/cpp_highlighter.cpp.
 *
 * One pass, left to right, no regex, no backtracking -- the same branches in
 * the same order as the C++. tests/ports.test.mjs checks this against the
 * output of the real cpp_highlighter.cpp, compiled and run on every line of
 * Valence's own source, so the two cannot drift apart silently.
 *
 * Character classes follow the C library in the "C" locale, which is what the
 * editor runs under: only ASCII letters and digits are alphanumeric.
 */

export const TOKEN = Object.freeze({
  Plain: 0,
  Keyword: 1,
  Type: 2,
  String: 3,
  Comment: 4,
  Number: 5,
  Preprocessor: 6,
  Function: 7,
  Punctuation: 8,
});

export const TOKEN_NAMES = ["plain", "keyword", "type", "string", "comment", "number", "preprocessor", "function", "punctuation"];

const KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "break",
  "continue", "return", "class", "struct", "enum", "namespace",
  "template", "typename", "public", "private", "protected",
  "virtual", "override", "final", "const", "constexpr", "static",
  "inline", "extern", "volatile", "mutable", "explicit",
  "void", "new", "delete", "try", "catch", "throw", "noexcept",
  "using", "typedef", "auto", "nullptr", "true", "false",
  "this", "operator", "sizeof", "alignof", "decltype",
  "static_cast", "dynamic_cast", "reinterpret_cast", "const_cast",
  "include", "define", "pragma", "ifdef", "ifndef", "endif", "elif",
  "default", "goto", "register", "friend", "concept", "requires",
  "co_await", "co_return", "co_yield", "consteval", "constinit",
]);

const TYPES = new Set([
  "int", "char", "float", "double", "bool", "long", "short",
  "unsigned", "signed", "wchar_t", "char8_t", "char16_t", "char32_t",
  "string", "vector", "map", "unordered_map", "set", "unordered_set",
  "array", "list", "deque", "stack", "queue", "pair", "tuple",
  "shared_ptr", "unique_ptr", "weak_ptr", "optional", "variant",
  "size_t", "ptrdiff_t", "int8_t", "int16_t", "int32_t", "int64_t",
  "uint8_t", "uint16_t", "uint32_t", "uint64_t",
  "QString", "QWidget", "QMainWindow", "QApplication",
  "QColor", "QFont", "QPainter", "QTimer", "QEvent",
  "std", "cout", "cin", "endl", "cerr",
  "ifstream", "ofstream", "fstream", "stringstream", "istringstream", "ostringstream",
]);

const code = (s, i) => s.charCodeAt(i);
const isSpace = (c) => c === 32 || (c >= 9 && c <= 13); // ' ' \t \n \v \f \r
const isDigit = (c) => c >= 48 && c <= 57;
const isAlpha = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isAlnum = (c) => isAlpha(c) || isDigit(c);
const isXDigit = (c) => isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
const isIdentStart = (c) => isAlpha(c) || c === 95;
const isIdentChar = (c) => isAlnum(c) || c === 95;

const SLASH = 47, STAR = 42, HASH = 35, DQUOTE = 34, SQUOTE = 39, BACKSLASH = 92, DOT = 46, PAREN = 40;

/**
 * Tokenize one line. `state.inBlockComment` is read and updated, exactly like
 * the C++ `bool& inBlockComment`. Returns [{type, start, length}].
 */
export function tokenize(line, state = { inBlockComment: false }) {
  const tokens = [];
  const len = line.length;
  let i = 0;

  const closeBlock = () => {
    while (i < len) {
      if (i + 1 < len && code(line, i) === STAR && code(line, i + 1) === SLASH) {
        i += 2;
        state.inBlockComment = false;
        return;
      }
      i += 1;
    }
  };

  while (i < len) {
    if (state.inBlockComment) {
      const start = i;
      closeBlock();
      tokens.push({ type: TOKEN.Comment, start, length: i - start });
      continue;
    }

    const c = code(line, i);

    if (isSpace(c)) {
      const start = i;
      while (i < len && isSpace(code(line, i))) i += 1;
      tokens.push({ type: TOKEN.Plain, start, length: i - start });
      continue;
    }

    if (c === SLASH && i + 1 < len && code(line, i + 1) === SLASH) {
      tokens.push({ type: TOKEN.Comment, start: i, length: len - i });
      i = len;
      continue;
    }

    if (c === SLASH && i + 1 < len && code(line, i + 1) === STAR) {
      const start = i;
      i += 2;
      state.inBlockComment = true;
      closeBlock();
      tokens.push({ type: TOKEN.Comment, start, length: i - start });
      continue;
    }

    if (c === HASH) {
      tokens.push({ type: TOKEN.Preprocessor, start: i, length: len - i });
      i = len;
      continue;
    }

    if (c === DQUOTE || c === SQUOTE) {
      const quote = c;
      const start = i;
      i += 1;
      while (i < len && code(line, i) !== quote) {
        if (code(line, i) === BACKSLASH && i + 1 < len) i += 1; // skip escape
        i += 1;
      }
      if (i < len) i += 1; // closing quote
      tokens.push({ type: TOKEN.String, start, length: i - start });
      continue;
    }

    if (isDigit(c) || (c === DOT && i + 1 < len && isDigit(code(line, i + 1)))) {
      const start = i;
      // 1'000'000'007: an apostrophe followed by an alphanumeric is a digit separator.
      const isSeparator = (at) => code(line, at) === SQUOTE && at + 1 < len && isAlnum(code(line, at + 1));
      const next = i + 1 < len ? line[i + 1] : "";
      if (c === 48 && (next === "x" || next === "X")) {
        i += 2;
        while (i < len && (isXDigit(code(line, i)) || isSeparator(i))) i += 1;
      } else if (c === 48 && (next === "b" || next === "B")) {
        i += 2;
        while (i < len && (line[i] === "0" || line[i] === "1" || isSeparator(i))) i += 1;
      } else {
        while (i < len && (isDigit(code(line, i)) || code(line, i) === DOT || isSeparator(i))) i += 1;
        if (i < len && (line[i] === "e" || line[i] === "E")) {
          i += 1;
          if (i < len && (line[i] === "+" || line[i] === "-")) i += 1;
          while (i < len && isDigit(code(line, i))) i += 1;
        }
      }
      while (i < len && "fFlLuU".includes(line[i])) i += 1;
      tokens.push({ type: TOKEN.Number, start, length: i - start });
      continue;
    }

    if (isIdentStart(c)) {
      const start = i;
      while (i < len && isIdentChar(code(line, i))) i += 1;
      const word = line.slice(start, i);
      let peek = i;
      while (peek < len && isSpace(code(line, peek))) peek += 1;
      const isFunc = peek < len && code(line, peek) === PAREN;
      let type = TOKEN.Plain;
      if (KEYWORDS.has(word)) type = TOKEN.Keyword;
      else if (TYPES.has(word)) type = TOKEN.Type;
      else if (isFunc) type = TOKEN.Function;
      tokens.push({ type, start, length: i - start });
      continue;
    }

    // Punctuation, emitted as a run: "}));" is one token, not four.
    const start = i;
    while (i < len) {
      const p = code(line, i);
      if (isSpace(p) || isIdentStart(p) || isDigit(p) || p === DQUOTE || p === SQUOTE || p === HASH) break;
      if (p === SLASH && i + 1 < len && (code(line, i + 1) === SLASH || code(line, i + 1) === STAR)) break;
      i += 1;
    }
    if (i === start) i += 1; // always make progress
    tokens.push({ type: TOKEN.Punctuation, start, length: i - start });
  }

  return tokens;
}

/**
 * Block-comment state at the start of every line, as the editor's
 * rebuildCommentState computes it. states[i] is true if line i begins inside
 * a block comment.
 */
export function commentStates(lines) {
  const states = new Array(lines.length);
  const state = { inBlockComment: false };
  for (let i = 0; i < lines.length; i += 1) {
    states[i] = state.inBlockComment;
    tokenize(lines[i], state);
  }
  return states;
}
