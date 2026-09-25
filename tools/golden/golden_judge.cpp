// Golden output for the website's judge comparator port.
//
// Links Valence's real src/cph/judge.cpp (with Qt6 Core) and prints
// Judge::outputsMatch and Judge::firstDifferingLine for each pair of
// hex-encoded (actual, expected) lines in the input file.
#include "judge.h"
#include <QCoreApplication>
#include <fstream>
#include <iostream>
#include <string>

static QString unhex(const std::string& h) {
    std::string out;
    for (size_t i = 0; i + 1 < h.size(); i += 2) out.push_back((char)std::stoi(h.substr(i, 2), nullptr, 16));
    return QString::fromUtf8(out.data(), (int)out.size());
}

int main(int argc, char** argv) {
    QCoreApplication app(argc, argv);
    std::ifstream in(argv[1]);
    std::string a, e;
    bool first = true;
    std::cout << "[";
    while (std::getline(in, a) && std::getline(in, e)) {
        if (!a.empty() && a.back() == '\r') a.pop_back();
        if (!e.empty() && e.back() == '\r') e.pop_back();
        const QString actual = unhex(a == "-" ? "" : a), expected = unhex(e == "-" ? "" : e);
        std::cout << (first ? "" : ",") << "[" << (Judge::outputsMatch(actual, expected) ? "true" : "false")
                  << "," << Judge::firstDifferingLine(actual, expected) << "]";
        first = false;
    }
    std::cout << "]\n";
    return 0;
}
