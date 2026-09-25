#include <bits/stdc++.h>
using namespace std;

int main() {
    int n;
    cin >> n;
    long long best = 0, run = 0;      // an empty subarray is not allowed
    for (int i = 0; i < n; i++) {
        long long x;
        cin >> x;
        run = max(0LL, run + x);
        best = max(best, run);
    }
    cout << best << "\n";
    return 0;
}
