# Spec — CQC knowledge base: foundation

Scaffold a **self-contained Next.js app** (App Router, TypeScript) in `/workspace` and seed
it with a structured, queryable model of the CQC regulatory framework. This is slice 1 of a
programme; later slices add an API, a browsing UI, and gap analysis on top of what you build
here, so lay clean foundations.

## Constraints (these make the app runnable inside an isolated micro-VM)

- **No external services.** No database server, no Supabase, no network calls at request time.
  All data lives in files inside the app. No native/compiled dependencies (no `better-sqlite3`
  etc.) — pure-JS/npm only, so `npm install` never needs a compiler.
- The app must build with `npm run build` and serve with `npm run start -- -p 3000 -H 0.0.0.0`.
- The home page (`/`) must render something real (a landing page for the knowledge base is
  fine) so the app answers HTTP from slice 1 onward.

## The knowledge base

Create a seed data file (`data/cqc.json` or similar) encoding the CQC framework structure:

1. **The 5 key questions** — Safe, Effective, Caring, Responsive, Well-led — each with an id,
   name, and a one-paragraph plain-English summary.
2. **Quality statements** under each key question (the CQC single assessment framework "we
   statements"). Use the real statement names, e.g. under **Safe**: Learning culture; Safe
   systems, pathways and transitions; Safeguarding; Involving people to manage risks; Safe
   environments; Safe and effective staffing; Infection prevention and control; Medicines
   optimisation. Populate every key question's statements by name. Each statement has an id, a
   title, the key question it belongs to, and a short summary of what it means.
3. **The fundamental standards** — Regulations 9 to 20A of the Health and Social Care Act 2008
   (Regulated Activities) Regulations 2014. Encode each with its regulation number, title
   (e.g. Reg 9 "Person-centred care", Reg 12 "Safe care and treatment", Reg 17 "Good
   governance", Reg 20 "Duty of candour"), and a short summary. Cross-reference each regulation
   to the key question(s) it most relates to.

Every record carries a `source` field naming CQC as the authority. **Do not present summaries
as verbatim regulatory text** — they are your own concise paraphrases; label them as such in a
`disclaimer` constant the later UI can surface ("Summaries are informal paraphrases; verify
against the official CQC source before relying on them"). Accuracy of *names, numbers and
structure* matters; exhaustive guidance text does not — a faithful skeleton is the goal.

## The query core (must be plain ESM JavaScript, not TypeScript)

Create `lib/kb.mjs` — a dependency-free module the API routes and the tests both import. Export:

- `getKeyQuestions()` → all 5, each with its nested quality statements.
- `getRegulations()` → all fundamental standards.
- `getById(id)` → a single key question, statement, or regulation by id, or `undefined`.
- `search(query)` → case-insensitive keyword search across names, titles and summaries of all
  record types; returns an array of `{ id, type, title, keyQuestion?, score }` ranked so that
  title/name matches outrank summary matches. Empty/whitespace query returns `[]`.

Keeping this core as plain `.mjs` lets `node --test` exercise it with zero build tooling.

## Tests (asserted deterministically every pass)

Create `test/kb.test.mjs` using Node's built-in test runner (`import { test } from 'node:test'`)
and add `"test:kb": "node --test test/"` to `package.json` scripts. Cover at least:

- exactly 5 key questions, with the correct names;
- every fundamental standard from Reg 9 through Reg 20A is present, numbers unique;
- every quality statement references a valid key question id;
- `search("medicines")` returns the Medicines optimisation statement above unrelated records;
- `search("")` returns `[]`, and `getById("<nonexistent>")` returns `undefined`.

`npm run test:kb` must exit 0.

## Done when

`npm install && npm run build` succeeds, `npm run test:kb` passes, and `npm run start` serves a
home page on port 3000.
