// Injected with -include when building golden_undo.cpp against Valence's real
// src/core/undo_manager.cpp. UndoManager stamps every action with
// std::chrono::steady_clock::now(); this swaps in a clock the harness drives,
// so the 400 ms grouping rule can be exercised deterministically.
#pragma once
#include <chrono>
namespace std { namespace chrono {
struct valence_fake_clock {
    using duration = std::chrono::nanoseconds;
    using rep = duration::rep;
    using period = duration::period;
    using time_point = std::chrono::time_point<valence_fake_clock>;
    static constexpr bool is_steady = true;
    static long long now_ms;
    static time_point now() noexcept { return time_point(std::chrono::milliseconds(now_ms)); }
};
}}
#define steady_clock valence_fake_clock
