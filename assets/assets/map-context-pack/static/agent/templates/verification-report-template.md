# Verification report — <task name>

- **Map:** `__OMNIMOD_MAP__`
- **Date:** <yyyy-mm-dd hh:mm>
- **Agent:** <your model / tool>
- **Task as requested:** <the user's words>
- **Specification built to:** <the numeric spec: origin, size, materials, orientation>
- **Batches:** <filenames>
- **Log marker:** agentlog seq <n> (`START <task>`) .. seq <m> (`DONE <task>`)

---

## Level 0 — Static validation

| check | result | PASS/FAIL |
|---|---|---|
| JSON parses, format correct | | |
| all op names legal | | |
| required fields present per op | | |
| all vectors are 3 integers | | |
| all y within 0..255 | | |
| all meta within 0..15 | | |
| all vanilla ids are 1.8 names | | |
| op count / file size within caps | | |
| no bulk op over 1,000,000 blocks | | |
| op order correct (shell, carve, frame, roof) | | |
| estimated block count | | |

## Level 1 — Application proof

| batch file | ledger entry? | ops | placed | failed | blue chat? | PASS/FAIL |
|---|---|---|---|---|---|---|
| | | | | | | |

Estimated vs actual placed: <estimate> vs <actual>. Explanation of any gap: <...>

## Level 2 — World-state proof

| position | expected block/meta | observed | PASS/FAIL |
|---|---|---|---|
| corner 1 (x,y,z) | | | |
| corner 2 | | | |
| corner 3 | | | |
| corner 4 | | | |
| corner 5 | | | |
| corner 6 | | | |
| corner 7 | | | |
| corner 8 | | | |
| one block outside face -x | | | |
| one block outside face +x | | | |
| one block outside face -z | | | |
| one block outside face +z | | | |
| one block above the roof | | | |
| door jamb left / right | | | |
| window frame sample | | | |
| roof ridge sample | | | |
| interior centre (expect air) | | | |

Non-air count in the region: expected <n>, observed <n>.
Raycast from <origin> toward <direction>: first hit <block> at <pos>. Expected <block>.

## Level 3 — Log-ring proof

| filter | count | PASS/FAIL |
|---|---|---|
| `unknown_block` since marker | | |
| `volume_too_large` since marker | | |
| coordinate rejections since marker | | |
| `command_failed` since marker | | |
| parse errors naming my files | | |
| any other WARN+ | | |

Raw log lines (paste, do not paraphrase):

```
<paste>
```

## Level 4 — Negative controls and regression

| control | what I did | result | PASS/FAIL |
|---|---|---|---|
| negative position (not built) | | | |
| deliberate wrong expectation | | | |
| regression on earlier structure | | | |
| idempotency (re-apply unchanged batch) | | | |
| reload persistence (quit + re-enter) | | | |
| mod content across load/entry/interaction | | | |

## Result

- **Verdict:** PASS / PARTIAL / FAIL
- **Matches the specification exactly:** yes / no — <detail>
- **Unverified, and why:** <be explicit; "nothing" is a valid answer only if true>
- **Known defects remaining:** <...>
- **Follow-up needed:** <...>

<!-- omnimod-docs-version: omnimod-agent-docs-4 -->
