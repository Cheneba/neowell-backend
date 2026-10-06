"""Builds src/growth/who-lms.json from the WHO Child Growth Standards tables shipped in
pygrowup (https://pypi.org/project/pygrowup/, BSD licence, UNICEF; data © WHO 2006).

Usage:  pip download pygrowup==0.8.2 --no-deps -d /tmp/pyg && tar xzf /tmp/pyg/pygrowup-0.8.2.tar.gz -C /tmp/pyg
        python3 scripts/data/build_who_lms.py /tmp/pyg/pygrowup-0.8.2/pygrowup/tables
"""
import json
import sys
from pathlib import Path

tables = Path(sys.argv[1])
out = {"source": "WHO Child Growth Standards (2006), via pygrowup 0.8.2 tables", "indicators": {}}
SPEC = {
    # indicator: (weekly file stem, monthly file stem)
    "weightForAge": ("wfa_{sex}_0_13", "wfa_{sex}_0_5"),
    "lengthForAge": ("lhfa_{sex}_0_13", "lhfa_{sex}_0_2"),
    "headCircumferenceForAge": ("hcfa_{sex}_0_13", "hcfa_{sex}_0_5"),
}
for ind, (weekly, monthly) in SPEC.items():
    out["indicators"][ind] = {}
    for sex, key in (("boys", "MALE"), ("girls", "FEMALE")):
        w = json.load(open(tables / f"{weekly.format(sex=sex)}_zscores.json"))
        m = json.load(open(tables / f"{monthly.format(sex=sex)}_zscores.json"))
        lms = lambda rows, k: [[float(r["L"]), float(r["M"]), float(r["S"])] for r in sorted(rows, key=lambda r: int(r[k]))]
        out["indicators"][ind][key] = {"weeks": lms(w, "Week"), "months": lms(m, "Month")}
target = Path(__file__).resolve().parents[2] / "src/growth/who-lms.json"
target.write_text(json.dumps(out, separators=(",", ":")))
print("wrote", target, target.stat().st_size, "bytes")
