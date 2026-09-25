#include <bits/stdc++.h>
using namespace std;

int main() {
    int n;
    cin >> n;
    vector<long long> a(n);
    for (auto& x : a) cin >> x;
    long long best = a.at(0), run = a.at(0);
    for (int i = 1; i <= n; i++) {       // <= reads one past the end
        run = max(a.at(i), run + a.at(i));
        best = max(best, run);
    }
    cout << best << "\n";
    return 0;
}
