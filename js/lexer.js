/* Valence — C++ lexer
 *
 * A faithful JavaScript port of src/editor/cpp_highlighter.cpp from the Valence
 * repository, down to the edge cases: single pass, left to right, no regex, no
 * backtracking. The site claims the editor tokenizes without regex overhead;
 * running a regex here to draw that claim would be a lie told in public.
 *
 * The token names match TokenType in the C++ enum exactly, because the physics
 * field sorts characters into bins labelled with them.
 */

const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
  'continue', 'return', 'class', 'struct', 'enum', 'namespace',
  'template', 'typename', 'public', 'private', 'protected',
  'virtual', 'override', 'final', 'const', 'constexpr', 'static',
  'inline', 'extern', 'volatile', 'mutable', 'explicit',
  'void', 'new', 'delete', 'try', 'catch', 'throw', 'noexcept',
  'using', 'typedef', 'auto', 'nullptr', 'true', 'false',
  'this', 'operator', 'sizeof', 'alignof', 'decltype',
  'static_cast', 'dynamic_cast', 'reinterpret_cast', 'const_cast',
  'include', 'define', 'pragma', 'ifdef', 'ifndef', 'endif', 'elif',
  'default', 'goto', 'register', 'friend', 'concept', 'requires',
  'co_await', 'co_return', 'co_yield', 'consteval', 'constinit',
]);

const TYPES = new Set([
  'int', 'char', 'float', 'double', 'bool', 'long', 'short',
  'unsigned', 'signed', 'wchar_t', 'char8_t', 'char16_t', 'char32_t',
  'string', 'vector', 'map', 'unordered_map', 'set', 'unordered_set',
  'array', 'list', 'deque', 'stack', 'queue', 'pair', 'tuple',
  'shared_ptr', 'unique_ptr', 'weak_ptr', 'optional', 'variant',
  'size_t', 'ptrdiff_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
  'std', 'cout', 'cin', 'endl', 'cerr',
  'ifstream', 'ofstream', 'fstream', 'stringstream',
]);

const isDigit      = (c) => c >= '0' && c <= '9';
const isHexDigit   = (c) => isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
const isIdentStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isIdentChar  = (c) => isIdentStart(c) || isDigit(c);
const isSpace      = (c) => c === ' ' || c === '\t';

/** The six bins the physics field sorts into, in display order. */
export const TOKEN_KINDS = ['keyword', 'type', 'function', 'string', 'number', 'comment', 'punctuation'];

/**
 * Tokenize one line.
 * @param {string} line
 * @param {boolean} inBlockComment  state carried in from the previous line
 * @returns {{tokens: Array<{kind:string,start:number,length:number,text:string}>, inBlockComment: boolean}}
 */
export function tokenizeLine(line, inBlockComment = false) {
  const tokens = [];
  const len = line.length;
  let i = 0;
  let inComment = inBlockComment;

  const push = (kind, start, end) => {
    if (end > start) tokens.push({ kind, start, length: end - start, text: line.slice(start, end) });
  };

  while (i < len) {
    // Continuation of a block comment opened on an earlier line.
    if (inComment) {
      const start = i;
      while (i < len) {
        if (line[i] === '*' && line[i + 1] === '/') { i += 2; inComment = false; break; }
        i++;
      }
      push('comment', start, i);
      continue;
    }

    const c = line[i];

    if (isSpace(c)) {
      const start = i;
      while (i < len && isSpace(line[i])) i++;
      push('plain', start, i);
      continue;
    }

    // Line comment — runs to end of line.
    if (c === '/' && line[i + 1] === '/') { push('comment', i, len); i = len; continue; }

    // Block comment, possibly closing on this same line.
    if (c === '/' && line[i + 1] === '*') {
      const start = i;
      i += 2;
      inComment = true;
      while (i < len) {
        if (line[i] === '*' && line[i + 1] === '/') { i += 2; inComment = false; break; }
        i++;
      }
      push('comment', start, i);
      continue;
    }

    // Preprocessor directive — the whole line belongs to it.
    if (c === '#') { push('keyword', i, len); i = len; continue; }

    // String and character literals, honouring backslash escapes so that
    // "he said \"hi\"" does not terminate early.
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i++;
      while (i < len && line[i] !== quote) {
        if (line[i] === '\\' && i + 1 < len) i++;
        i++;
      }
      if (i < len) i++;
      push('string', start, i);
      continue;
    }

    // Numeric literals. The apostrophe is a digit separator here, not the start
    // of a character literal — 1'000'000'007 is ordinary competitive-programming
    // code, and reading it as a quote paints the rest of the line as a string.
    if (isDigit(c) || (c === '.' && isDigit(line[i + 1]))) {
      const start = i;
      const sep = (at) => line[at] === "'" && at + 1 < len && isIdentChar(line[at + 1]);

      if (c === '0' && (line[i + 1] === 'x' || line[i + 1] === 'X')) {
        i += 2;
        while (i < len && (isHexDigit(line[i]) || sep(i))) i++;
      } else if (c === '0' && (line[i + 1] === 'b' || line[i + 1] === 'B')) {
        i += 2;
        while (i < len && (line[i] === '0' || line[i] === '1' || sep(i))) i++;
      } else {
        while (i < len && (isDigit(line[i]) || line[i] === '.' || sep(i))) i++;
        if (i < len && (line[i] === 'e' || line[i] === 'E')) {
          i++;
          if (i < len && (line[i] === '+' || line[i] === '-')) i++;
          while (i < len && isDigit(line[i])) i++;
        }
      }
      while (i < len && 'fFlLuU'.includes(line[i])) i++;   // suffixes: 10ULL, 1e9L
      push('number', start, i);
      continue;
    }

    // Identifier, then classified by lookup.
    if (isIdentStart(c)) {
      const start = i;
      while (i < len && isIdentChar(line[i])) i++;
      const word = line.slice(start, i);

      // A name immediately followed by '(' is a call site.
      let peek = i;
      while (peek < len && isSpace(line[peek])) peek++;
      const isCall = line[peek] === '(';

      if (KEYWORDS.has(word))      push('keyword', start, i);
      else if (TYPES.has(word))    push('type', start, i);
      else if (isCall)             push('function', start, i);
      else                         push('plain', start, i);
      continue;
    }

    // Runs of punctuation collapse into one token, so "}));" is one unit.
    const start = i;
    while (i < len) {
      const p = line[i];
      if (isSpace(p) || isIdentStart(p) || isDigit(p) || p === '"' || p === "'" || p === '#') break;
      if (p === '/' && (line[i + 1] === '/' || line[i + 1] === '*')) break;
      i++;
    }
    if (i === start) i++;              // always make progress
    push('punctuation', start, i);
  }

  return { tokens, inBlockComment: inComment };
}
