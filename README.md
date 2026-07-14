# Introduction

This is a template for a "software factory".

The rationale is to have a have a reusable starting tech stack that can be coupled with agentic harnesses to build software autonomously.

The decision behind NextJS + Supabase is:

- Wide adoption and models are well trained
- Open source so can run everything locally - significantly improves debugging and feedback loops
- AI-native developer experiences (MCPs, Agent Skills, docs)

# Set up

Make sure the NextJS dev server and Supabase docker images are running before using the coding agent.

The NextJS and Supabase MCPs are locally hosted from the above processes.

```bash
npx supabase init
npx supabase start

```

```bash
npm run dev
```

# Agent harness

`harness/` runs coding agents unattended inside Apple `container` micro-VMs: a generate → evaluate loop against a spec, with per-run isolated workspaces and full agentic traces. See [harness/README.md](harness/README.md) for setup and usage.

```bash
./harness/bin/factory doctor        # check requirements (prints fixes)
./harness/bin/factory run hello     # run the example spec
```
