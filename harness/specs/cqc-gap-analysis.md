# Spec — CQC knowledge base: policy gap analysis

Add the feature the knowledge base exists for: paste in one of your own policy/evidence
documents and see, requirement by requirement, where you have coverage and where the gaps are.
This runs **fully offline** — deterministic keyword mapping against the KB, no LLM call at
request time.

## Mapping core (extend `lib/kb.mjs`, still plain ESM JS)

Add and export `analyse(policyText)`:

- For every fundamental standard and every quality statement, decide **covered / partial /
  gap** by matching the record's key terms against `policyText` (case-insensitive; derive terms
  from the record title and summary, ignoring stopwords).
  - `covered` — a strong/multi-term match.
  - `partial` — a weak/single-term match.
  - `gap` — no meaningful match.
- Return `{ summary: { covered, partial, gap, total }, rows: [ { id, type, title, keyQuestion?,
  status, matchedTerms: [...] } ] }`, rows ordered gaps-first (gap, then partial, then covered)
  so the most urgent items surface at the top.
- Empty/whitespace `policyText` → every row is a `gap` and `summary.covered === 0`.

Extend `test/kb.test.mjs`: a short policy string mentioning, say, medication and safeguarding
marks those requirements `covered`/`partial` while an unrelated requirement stays a `gap`; empty
input yields all gaps. `npm run test:kb` must still exit 0.

## API

- `POST /api/analyse` with JSON `{ policyText: string }` → the `analyse(...)` result.
  Missing/invalid body → HTTP **400** `{ error: "..." }`, never a 500.

## UI — `/gap-analysis`

- A form with a large textarea to paste policy text and submit.
- On submit, render a **compliance matrix**: the summary counts (covered / partial / gap) up
  top, then a table of rows (requirement title, type, key question, status badge, matched
  terms), gaps first. Colour-code the three statuses.
- Include a "load example" affordance that fills the textarea with a short sample policy, so the
  matrix can be demonstrated in one click.
- Works without client JS where reasonable (a server-action or plain form post is fine).
- Link `/gap-analysis` from the home page.

## Requirements

- Deterministic: the same policy text always yields the same matrix.
- Everything from slices 1–3 (API endpoints, explorer UI, `npm run test:kb`) still passes.

## Done when

Pasting a policy that talks about medication management and staff training marks the medicines
and staffing requirements as covered/partial and clearly lists the untouched requirements as
gaps, with the summary counts adding up to the total number of requirements.
