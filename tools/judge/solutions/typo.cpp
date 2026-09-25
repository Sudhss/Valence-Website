#include <bits/stdc++.h>
using namespace std;

int main() {
    int n;
    cin >> n;
    long long best = LLONG_MIN, run = 0;
    for (int i = 0; i < n; i++) {
        long long x;
        cin >> x;
        run = max(x, run + x)
        best = max(best, run);
    }
    cout << best << "\n";
    return 0;
}
