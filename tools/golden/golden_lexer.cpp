// Golden output for the website's tokenizer port.
//
// Compiles against Valence's real src/editor/cpp_highlighter.cpp and prints the
// exact tokens it produces, so tests/ports.test.mjs can hold js/core/lexer.js
// to byte-for-byte agreement.
//
// Input: one "document" per argument file. Each file's lines are tokenized in
// order with the block-comment state carried from line to line, exactly as
// EditorWidget::rebuildCommentState does. Lines are hex-encoded, one per line,
// so any byte survives the trip.
//
// Output (stdout): a JSON array, one entry per document, each an array of
// {"t":[[type,start,length],...],"b":inBlockCommentAfter} per line.

#include "cpp_highlighter.h"

#include <fstream>
#include <iostream>
#include <string>
#include <vector>

static std::string unhex(const std::string& h) {
    std::string out;
    for (size_t i = 0; i + 1 < h.size(); i += 2) {
        out.push_back(static_cast<char>(std::stoi(h.substr(i, 2), nullptr, 16)));
    }
    return out;
}

int main(int argc, char** argv) {
    CppHighlighter hl;
    std::cout << "[";
    for (int a = 1; a < argc; a++) {
        std::ifstream in(argv[a]);
        std::string hex;
        bool block = false;
        bool first = true;
        std::cout << (a > 1 ? "," : "") << "[";
        while (std::getline(in, hex)) {
            if (!hex.empty() && hex.back() == '\r') hex.pop_back();
            const std::string line = unhex(hex);
            const auto tokens = hl.tokenize(line, block);
            std::cout << (first ? "" : ",") << "{\"t\":[";
            for (size_t i = 0; i < tokens.size(); i++) {
                std::cout << (i ? "," : "") << "[" << static_cast<int>(tokens[i].type) << ","
                          << tokens[i].start << "," << tokens[i].length << "]";
            }
            std::cout << "],\"b\":" << (block ? "true" : "false") << "}";
            first = false;
        }
        std::cout << "]";
    }
    std::cout << "]\n";
    return 0;
}
