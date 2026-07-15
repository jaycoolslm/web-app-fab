# Spec — CQC knowledge base: JSON API

Expose the knowledge base from slice 1 over HTTP with Next.js App Router route handlers. The
API is backed entirely by `lib/kb.mjs` — no new data source. All responses are JSON with
`Content-Type: application/json`.

## Endpoints

- `GET /api/key-questions`
  → `{ keyQuestions: [...] }`, all 5, each including its nested quality statements.

- `GET /api/regulations`
  → `{ regulations: [...] }`, all fundamental standards (Reg 9–20A), ordered by regulation number.

- `GET /api/requirements/:id`
  → the single record (key question, quality statement, or regulation) with that id.
  Unknown id → HTTP **404** with `{ error: "not found" }`. Never 500 on a bad id.

- `GET /api/search?q=<term>`
  → `{ query: "<term>", results: [...] }` using `kb.search`. Missing/empty `q` →
  HTTP **400** with `{ error: "..." }` (do not throw). Results carry enough fields
  (`id`, `type`, `title`) for a client to link to the detail endpoint.

## Requirements

- Correct HTTP status codes: 200 on success, 400 on a missing search term, 404 on unknown id.
- Every requirement id returned by a list endpoint must resolve via `GET /api/requirements/:id`
  (the endpoints are internally consistent).
- No endpoint may crash the server or return a 500 for the inputs described above, including
  odd input like `?q=` with only spaces, or ids containing URL-escaped characters.
- Keep the slice-1 home page and tests working; `npm run test:kb` must still pass.

## Done when

With the app running, every endpoint above returns the documented shape and status code, and a
search for a regulation title (e.g. `?q=duty of candour`) surfaces the matching regulation.
