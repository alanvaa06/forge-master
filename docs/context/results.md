# Results

> Build log. 1-4 lines per finished item. List format. Older detail lives in `archive/`. Cap enforced by hook.

*(empty)*
- P1 done (fcb03cb, AC-2.1 AC-2.2, first-pass green, junior/heavy): lint requires gates: + validates mode/isolation/on_complete enums and budgets as contract errors; template gates: line; validate.mjs walks skills/ + hooks/ for *.test.mjs. 94/94 tests.
  - review nits: clean() strips `*`, backticks and `#...` from Run Config values, so verify must read the raw gates line (fed to P2); lint tests use runFail (any non-zero) not code===1 and match /gates/ not the exact I1 text; quoted "<cmd>" not caught as placeholder; validate.mjs execFileSync has no timeout.
