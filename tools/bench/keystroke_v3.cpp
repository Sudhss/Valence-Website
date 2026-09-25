// Keystroke cost with V3's incremental comment-state rebuild.
//
// benchmark/benchmark.cpp models the pre-V3 editor, which re-tokenized every
// line on every keystroke. V3's EditorWidget::rebuildCommentState(fromRow)
// starts at the edited row and stops as soon as the block-comment state
// converges with the cached one. That function lives in a QWidget and cannot
// run headless, so its body is reproduced below line for line, driving the
// real TextBuffer, UndoManager and CppHighlighter.
//
// Two cases per document size:
//   typical -- insert a character mid-document on ordinary code
//   worst   -- insert "/*" on the first line of a file with no block comment
//              to close it, so every later line changes state
//
// Build: g++ -O2 -std=c++17 -I<src>/core -I<src>/editor keystroke_v3.cpp
//        <src>/core/text_buffer.cpp <src>/core/undo_manager.cpp
//        <src>/editor/cpp_highlighter.cpp

#include "text_buffer.h"
#include "undo_manager.h"
#include "cpp_highlighter.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

using Clock = std::chrono::high_resolution_clock;

static std::vector<bool> blockCommentState_;
static CppHighlighter highlighter_;

// ---- verbatim from src/editor/editor_widget.cpp (V3) ------------------------
static void rebuildCommentStateFull(const TextBuffer& buffer_) {
    const int lines = buffer_.lineCount();
    blockCommentState_.assign(lines, false);
    bool inComment = false;
    for (int i = 0; i < lines; i++) {
        blockCommentState_[i] = inComment;
        highlighter_.tokenize(buffer_.line(i), inComment);
    }
}

static void rebuildCommentState(const TextBuffer& buffer_, int fromRow) {
    const int lines = buffer_.lineCount();
    if (lines == 0) { blockCommentState_.clear(); return; }
    const int oldSize = static_cast<int>(blockCommentState_.size());
    const int delta = lines - oldSize;
    fromRow = std::clamp(fromRow, 0, lines - 1);
    if (delta > 0) {
        blockCommentState_.insert(blockCommentState_.begin() + std::min(fromRow, oldSize), delta, false);
    } else if (delta < 0) {
        const int at = std::min(fromRow, lines);
        blockCommentState_.erase(blockCommentState_.begin() + at, blockCommentState_.begin() + at - delta);
    }
    bool inComment = blockCommentState_[fromRow];
    const int settled = fromRow + std::abs(delta);
    for (int i = fromRow; i < lines; i++) {
        if (i > settled && blockCommentState_[i] == inComment) return;
        blockCommentState_[i] = inComment;
        highlighter_.tokenize(buffer_.line(i), inComment);
    }
}
// -----------------------------------------------------------------------------

static void writeDoc(const std::string& path, int n, bool blockComments) {
    // The same line mix as benchmark/benchmark.cpp's generator.
    std::ofstream f(path);
    f << "#include <iostream>\n#include <vector>\n#include <string>\n\n";
    f << "// Auto-generated test file with " << n << " lines\n\n";
    for (int i = 6; i < n; i++) {
        switch (i % 10) {
            case 0: f << "    int value_" << i << " = " << i * 17 << ";\n"; break;
            case 1: f << "    std::string name_" << i << " = \"test_string_" << i << "\";\n"; break;
            case 2: f << "    // This is a comment on line " << i << "\n"; break;
            case 3: f << "    if (value_" << i << " > 0) { process(value_" << i << "); }\n"; break;
            case 4: f << "    for (int j = 0; j < " << i << "; j++) { sum += j; }\n"; break;
            case 5: f << "    std::vector<int> vec_" << i << " = {1, 2, 3, 4, 5};\n"; break;
            case 6: f << "    auto result_" << i << " = compute(" << i << ", " << i * 2 << ");\n"; break;
            case 7:
                if (blockComments) f << "    /* block comment */ double d_" << i << " = 3.14;\n";
                else f << "    double d_" << i << " = 3.14;\n";
                break;
            case 8: f << "    return static_cast<int>(value_" << i << ");\n"; break;
            default: f << "    }\n"; break;
        }
    }
}

static double median(std::vector<double> v) {
    std::sort(v.begin(), v.end());
    return v[v.size() / 2];
}

int main() {
    const int sizes[] = {100, 500, 1000, 5000, 10000, 50000};
    std::printf("{\"rows\":[");
    bool first = true;
    for (int n : sizes) {
        const std::string path = "kv3_" + std::to_string(n) + ".cpp";
        const std::string plainPath = "kv3_plain_" + std::to_string(n) + ".cpp";
        writeDoc(path, n, true);
        writeDoc(plainPath, n, false);
        const int reps = n >= 10000 ? 200 : 2000;
        std::vector<double> typical, worst;
        {
            TextBuffer buf;
            buf.loadFromFile(path);
            UndoManager um;
            rebuildCommentStateFull(buf);
            const int mid = buf.lineCount() / 2 + 3;  // an ordinary code line
            for (int r = 0; r < reps; r++) {
                auto t0 = Clock::now();
                buf.insertChar(mid, 4, 'x');
                um.recordInsert({mid, 4}, "x");
                rebuildCommentState(buf, mid);
                const int top = std::max(0, mid - 25);
                for (int row = top; row < std::min(buf.lineCount(), top + 50); row++) {
                    bool c = blockCommentState_[row];
                    highlighter_.tokenize(buf.line(row), c);
                }
                auto t1 = Clock::now();
                typical.push_back(std::chrono::duration<double, std::micro>(t1 - t0).count());
                buf.deleteChar(mid, 5);
                rebuildCommentState(buf, mid);
            }
        }
        {
            TextBuffer buf;
            buf.loadFromFile(plainPath);
            UndoManager um;
            rebuildCommentStateFull(buf);
            const int wreps = n >= 10000 ? 30 : 200;
            for (int r = 0; r < wreps; r++) {
                auto w0 = Clock::now();
                buf.insertChar(0, 0, '/');
                buf.insertChar(0, 1, '*');
                um.recordInsert({0, 0}, "/*");
                rebuildCommentState(buf, 0);
                for (int row = 0; row < std::min(buf.lineCount(), 50); row++) {
                    bool c = blockCommentState_[row];
                    highlighter_.tokenize(buf.line(row), c);
                }
                auto w1 = Clock::now();
                worst.push_back(std::chrono::duration<double, std::micro>(w1 - w0).count());
                buf.deleteChar(0, 2);
                buf.deleteChar(0, 1);
                rebuildCommentState(buf, 0);
            }
        }
        std::remove(plainPath.c_str());
        std::remove(path.c_str());
        std::printf("%s{\"lines\":%d,\"typicalUs\":%.2f,\"worstUs\":%.2f}", first ? "" : ",", n, median(typical), median(worst));
        first = false;
    }
    std::printf("]}\n");
    return 0;
}
