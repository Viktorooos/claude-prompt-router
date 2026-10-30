# Usage: python3 -I eval.py <results.tsv> [more.tsv...]  (lines: id where model effort why)
# Cases with "why_lang" in expected.json also print their reason, to check its language by eye.
import json, sys, os
exp = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "expected.json")))
ok = bad = 0
for path in sys.argv[1:]:
    for line in open(path):
        f = line.rstrip("\n").split("\t")
        if len(f) < 2 or f[0] not in exp: continue
        e = exp[f[0]]; where = f[1]
        model = f[2] if len(f) > 2 else ""; effort = f[3] if len(f) > 3 else ""
        errs = []
        if where not in e["where"]: errs.append(f"where {where} (want {'/'.join(e['where'])})")
        elif where in ("subagent", "session") and e["model"] and model not in e["model"]: errs.append(f"model {model} (want {'/'.join(e['model'])})")
        if where != "keep" and e["effort"] and effort not in e["effort"]: errs.append(f"effort {effort} (want {'/'.join(e['effort'])})")
        if errs: bad += 1; print(f"✗ {f[0]}: {'; '.join(errs)} | {f[-1]}")
        else: ok += 1
        if e.get("why_lang") and len(f) > 4: print(f"? {f[0]}: reason should be in {e['why_lang']}: {f[4]}")
print(f"OK {ok}, wrong {bad}")
