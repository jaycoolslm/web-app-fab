# Before writing any code

- Next.js: read the relevant doc in node_modules/next/dist/docs/ first.
- Supabase: use the relevant Agent Skills.
- shadcn/ui: only add components via the shadcn MCP, never hand-write into components/ui/.

Your training data is stale; rely on documented information for implementation and best practices.

# MCP usage

Two of these servers only appear once their process is running:

- **nextjs** (`localhost:3000/_next/mcp`, needs `npm run dev`)
- **supabase** (`localhost:54321/mcp`, needs local Docker)
- **playwright** (`npx`, always available; needs `npm run dev` for an app to hit)
