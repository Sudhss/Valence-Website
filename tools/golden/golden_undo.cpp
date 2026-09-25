// Golden output for the website's UndoManager port.
//
// Runs scripts against Valence's real src/core/undo_manager.cpp (with the clock
// replaced, see fakeclock.h) and prints what undo()/redo() return, then drains
// the undo stack so the grouping it built is fully visible.
//
// Script lines:  I row col hex dtMs | D row col hex dtMs | F | B | E | U | R
// Output: JSON array per script: {"ops":[result...],"drain":[group...]} where a
// result/group is [[type,row,col,hex],...] (type 0 = Insert, 1 = Delete).
#include "undo_manager.h"

#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

long long std::chrono::valence_fake_clock::now_ms = 0;

static std::string unhex(const std::string& h) {
    std::string out;
    for (size_t i = 0; i + 1 < h.size(); i += 2) out.push_back((char)std::stoi(h.substr(i, 2), nullptr, 16));
    return out;
}
static std::string hex(const std::string& s) {
    static const char* d = "0123456789abcdef";
    std::string out;
    for (unsigned char c : s) { out.push_back(d[c >> 4]); out.push_back(d[c & 15]); }
    return out;
}
static void print(const UndoManager::UndoResult& r) {
    std::cout << "[";
    if (r.valid) {
        for (size_t i = 0; i < r.actions.size(); i++) {
            const auto& a = r.actions[i];
            std::cout << (i ? "," : "") << "[" << (a.type == EditAction::Insert ? 0 : 1) << ","
                      << a.pos.row << "," << a.pos.col << ",\"" << hex(a.text) << "\"]";
        }
    } else {
        std::cout << "null";
    }
    std::cout << "]";
}

int main(int argc, char** argv) {
    std::cout << "[";
    for (int f = 1; f < argc; f++) {
        std::ifstream in(argv[f]);
        std::string line;
        UndoManager um;
        std::chrono::valence_fake_clock::now_ms = 1000;
        bool first = true;
        std::cout << (f > 1 ? "," : "") << "{\"ops\":[";
        while (std::getline(in, line)) {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (line.empty()) continue;
            std::istringstream ss(line);
            std::string op;
            ss >> op;
            if (op == "I" || op == "D") {
                int row, col; std::string h; long long dt;
                ss >> row >> col >> h >> dt;
                std::chrono::valence_fake_clock::now_ms += dt;
                const std::string text = h == "-" ? std::string() : unhex(h);
                if (op == "I") um.recordInsert({row, col}, text); else um.recordDelete({row, col}, text);
            } else if (op == "F") um.forceNewGroup();
            else if (op == "B") um.beginCompound();
            else if (op == "E") um.endCompound();
            else if (op == "U" || op == "R") {
                std::cout << (first ? "" : ",");
                print(op == "U" ? um.undo() : um.redo());
                first = false;
            }
        }
        std::cout << "],\"drain\":[";
        bool firstGroup = true;
        for (;;) {
            auto r = um.undo();
            if (!r.valid) break;
            std::cout << (firstGroup ? "" : ",");
            print(r);
            firstGroup = false;
        }
        std::cout << "]}";
    }
    std::cout << "]\n";
    return 0;
}
