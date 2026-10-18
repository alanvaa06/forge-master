# Results

> Build log. 1-4 lines per finished item. List format. Older detail lives in `archive/`. Cap enforced by hook.

*(empty)*
- P1 done (fcb03cb, AC-2.1 AC-2.2, first-pass green, junior/heavy): lint requires gates: + validates mode/isolation/on_complete enums and budgets as contract errors; template gates: line; validate.mjs walks skills/ + hooks/ for *.test.mjs. 94/94 tests.
  - review nits: clean() strips `*`, backticks and `#...` from Run Config values, so verify must read the raw gates line (fed to P2); lint tests use runFail (any non-zero) not code===1 and match /gates/ not the exact I1 text; quoted "<cmd>" not caught as placeholder; validate.mjs execFileSync has no timeout.
- P2 done (iter 1 -> green after review, senior/heavy, AC-2.3 AC-2.6): forge-git.mjs + `verify`; runGates resolves Git Bash from `git --exec-path` on win32 (PowerShell-spawned `bash` is the broken WSL shim, not ENOENT). 35 git tests + 94 state tests.
  - review blockers fixed: AC regex `\b` rejected tdd.md's `test_AC_2_1_` names -> `(?<![a-z0-9])` (DIVERGES from spec I4 regex; AC-2.6 text wins); git maxBuffer 1 MiB ENOBUFS; backtick unwrap ran before comment strip.
  - nits: core.safecrlf=false lets verify pass a tree a safecrlf=true repo refuses to commit (fails loud at commit); a `#` inside a single backtick span is cut mid-span; [manual-check] tag only recognized at AC line end; no internal gates deadline (R6, by design); pre-existing v0.17 forge-state.test.mjs leaks a forge-state-* temp dir per test (no cleanup).
