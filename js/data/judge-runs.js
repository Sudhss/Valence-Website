/* Real runs, recorded by tools/judge/record_runs.py -- not written by hand.
 * Verdicts are recomputed in the browser from this output with the ported
 * Judge::outputsMatch rule; nothing here says AC or WA. */
export const JUDGE_RUNS = {
 "recorded": "2026-09-26",
 "compiler": "g++.exe (x86_64-posix-seh-rev1, Built by MinGW-Builds project) 13.1.0",
 "flags": "-O2 -std=gnu++17",
 "timeLimitMs": 3000,
 "problem": {
  "title": "Maximum subarray sum",
  "statement": "Given n integers, print the largest sum of a non-empty contiguous subarray.",
  "limits": "1 \u2264 n \u2264 200,000 \u00b7 |a\u1d62| \u2264 10\u2079"
 },
 "cases": [
  {
   "name": "Sample",
   "input": "9\n-2 1 -3 4 -1 2 1 -5 4",
   "expected": "6\n"
  },
  {
   "name": "All negative",
   "input": "4\n-3 -1 -7 -2",
   "expected": "-1\n"
  },
  {
   "name": "Single element",
   "input": "1\n7",
   "expected": "7\n"
  },
  {
   "name": "n = 200,000",
   "input": "200000\n-843430179 -900403701 -966039414 259043745 -508149859 826235809 \u2026 (2,078,063 bytes, seeded random)",
   "expected": "366443315795\n"
  }
 ],
 "solutions": [
  {
   "file": "kadane.cpp",
   "title": "Kadane, 64-bit",
   "source": "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    int n;\n    cin >> n;\n    long long best = LLONG_MIN, run = 0;\n    for (int i = 0; i < n; i++) {\n        long long x;\n        cin >> x;\n        run = max(x, run + x);\n        best = max(best, run);\n    }\n    cout << best << \"\\n\";\n    return 0;\n}\n",
   "compileMs": 3535,
   "compileOk": true,
   "compilerOutput": "",
   "runs": [
    {
     "stdout": "6\n",
     "stderr": "",
     "exitCode": 0,
     "elapsedMs": 195,
     "timedOut": false
    },
    {
     "stdout": "-1\n",
     "stderr": "",
     "exitCode": 0,
     "elapsedMs": 59,
     "timedOut": false
    },
    {
     "stdout": "7\n",
     "stderr": "",
     "exitCode": 0,
     "elapsedMs": 63,
     "timedOut": false
    },
    {
     "stdout": "366443315795\n",
     "stderr": "",
     "exitCode": 0,
     "elapsedMs": 134,
     "timedOut": false
    }
   ]
  },
  {
   "file": "zero_start.cpp",
   "title": "Kadane, best starts at 0",
   "source": "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    int n;\n    cin >> n;\n    long long best = 0, run = 0;      // an empty subarray is not allowed\n    for (int i = 0; i < n; i++) {\n        long long x;\n        cin >> x;\n        run = max(0LL, run + x);\n        best = max(best, run);\n    }\n    cout << best << \"\\n\";\n    return 0;\n}\n",
   "compileMs": 2103,
   "compileOk": true,
   "compilerOutput": "",
   "runs": [
    {
     "stdout": "6\n",
     "stderr": "",
     "exitCode": 0,
     "elapsedMs": 216,
     "timedOut": false
    },
    {
     "stdout": "0\n",
     "stderr": "",
     "exitCode": 0,
     "elapsedMs": 68,
     "timedOut": false
    },
    {
     "stdout": "7\n",
     "stderr": "",
     "exitCode": 0,
     "elapsedMs": 49,
     "timedOut": false
    },
    {
     "stdout": "366443315795\n",
     "stderr": "",
     "exitCode": 0,
     "elapsedMs": 367,
     "timedOut": false
    }
   ]
  },
  {
   "file": "brute.cpp",
   "title": "Every subarray, O(n\u00b2)",
   "source": "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    int n;\n    cin >> n;\n    vector<long long> a(n);\n    for (auto& x : a) cin >> x;\n    long long best = LLONG_MIN;\n    for (int i = 0; i < n; i++) {        // every subarray: O(n^2)\n        long long sum = 0;\n        for (int j = i; j < n; j++) {\n            sum += a[j];\n            best = max(best, sum);\n        }\n    }\n    cout << best << \"\\n\";\n    return 0;\n}\n",
   "compileMs": 2322,
   "compileOk": true,
   "compilerOutput": "",
   "runs": [
    {
     "stdout": "6\n",
     "stderr": "",
     "exitCode": 0,
     "elapsedMs": 210,
     "timedOut": false
    },
    {
     "stdout": "-1\n",
     "stderr": "",
     "exitCode": 0,
     "elapsedMs": 58,
     "timedOut": false
    },
    {
     "stdout": "7\n",
     "stderr": "",
     "exitCode": 0,
     "elapsedMs": 55,
     "timedOut": false
    },
    {
     "stdout": "",
     "stderr": "",
     "exitCode": -1,
     "elapsedMs": 3000,
     "timedOut": true
    }
   ]
  },
  {
   "file": "off_by_one.cpp",
   "title": "Loop runs to i <= n",
   "source": "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    int n;\n    cin >> n;\n    vector<long long> a(n);\n    for (auto& x : a) cin >> x;\n    long long best = a.at(0), run = a.at(0);\n    for (int i = 1; i <= n; i++) {       // <= reads one past the end\n        run = max(a.at(i), run + a.at(i));\n        best = max(best, run);\n    }\n    cout << best << \"\\n\";\n    return 0;\n}\n",
   "compileMs": 1884,
   "compileOk": true,
   "compilerOutput": "",
   "runs": [
    {
     "stdout": "",
     "stderr": "terminate called after throwing an instance of 'std::out_of_range'\n  what():  vector::_M_range_check: __n (which is 9) >= this->size() (which is 9)\n",
     "exitCode": 3,
     "elapsedMs": 133,
     "timedOut": false
    },
    {
     "stdout": "",
     "stderr": "terminate called after throwing an instance of 'std::out_of_range'\n  what():  vector::_M_range_check: __n (which is 4) >= this->size() (which is 4)\n",
     "exitCode": 3,
     "elapsedMs": 59,
     "timedOut": false
    },
    {
     "stdout": "",
     "stderr": "terminate called after throwing an instance of 'std::out_of_range'\n  what():  vector::_M_range_check: __n (which is 1) >= this->size() (which is 1)\n",
     "exitCode": 3,
     "elapsedMs": 47,
     "timedOut": false
    },
    {
     "stdout": "",
     "stderr": "terminate called after throwing an instance of 'std::out_of_range'\n  what():  vector::_M_range_check: __n (which is 200000) >= this->size() (which is 200000)\n",
     "exitCode": 3,
     "elapsedMs": 456,
     "timedOut": false
    }
   ]
  },
  {
   "file": "typo.cpp",
   "title": "Missing semicolon",
   "source": "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    int n;\n    cin >> n;\n    long long best = LLONG_MIN, run = 0;\n    for (int i = 0; i < n; i++) {\n        long long x;\n        cin >> x;\n        run = max(x, run + x)\n        best = max(best, run);\n    }\n    cout << best << \"\\n\";\n    return 0;\n}\n",
   "compileMs": 1414,
   "compileOk": false,
   "compilerOutput": "typo.cpp: In function 'int main()':\ntypo.cpp:11:30: error: expected ';' before 'best'\n   11 |         run = max(x, run + x)\n      |                              ^\n      |                              ;\n   12 |         best = max(best, run);\n      |         ~~~~                  \n",
   "runs": []
  }
 ]
};
