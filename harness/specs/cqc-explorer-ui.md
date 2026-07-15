# Spec — CQC knowledge base: explorer UI

Build a browsable web UI over the API from slice 2, so a compliance lead can navigate the CQC
framework and search it without touching JSON. Server components fetching the KB directly (or
the API routes) are both fine; keep it a normal Next.js App Router UI.

## Pages

- **`/` — home.** Lists the 5 key questions as cards (name + summary), each linking to its
  detail page. Shows a persistent **search box** (a plain HTML form, `GET` to `/search`, so it
  works without client JS). Surfaces the `disclaimer` from slice 1 in the footer.

- **`/key-questions/[id]`** — one key question: its summary, its quality statements (each
  linking to the statement detail), and the fundamental standards cross-referenced to it.

- **`/requirements/[id]`** — detail for any record (key question, quality statement, or
  regulation): title, type, full summary, `source`, and — for regulations — the regulation
  number and the key question(s) it relates to, as links. Unknown id renders a friendly
  not-found page (Next.js `notFound()`), not a stack trace.

- **`/search?q=<term>`** — renders the ranked results as a list, each linking to
  `/requirements/[id]`. Empty query shows an empty-state prompt, not an error.

## Requirements

- Every link must resolve to a real page (no dead links between listed records and their
  detail pages).
- Readable, self-consistent styling — inline styles, CSS modules, or Tailwind if scaffolded;
  no external CSS/font CDNs (the app runs offline).
- The disclaimer about paraphrased summaries is visible somewhere on every page.
- The API from slice 2 and `npm run test:kb` must both still pass unchanged.

## Done when

Starting from `/`, you can search for "safeguarding", click a result through to its detail
page, navigate from a key question to a related regulation and back, and never hit a broken
link or an unstyled error page.
