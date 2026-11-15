# Submission notes — Threadline

## 45–60 second Loom walkthrough

1. **Problem (0–8s):** “MCP agents often load every tool schema before they know what a task needs. That wastes context and makes selection noisy.”
2. **Task (8–18s):** Enter “Find Acme’s overdue invoice and draft a follow-up.” Run it.
3. **Graph (18–32s):** Show the live HydraDB status, `Agent → Skill → Tool → MCPServer` path, and the separate `Acme → invoice` relationship. Point out the selected schemas and source facts; the app makes a draft but does not send it. Be clear that this MVP uses deterministic routing and fixture-backed output; the returned context pack is ready for an LLM, but no external model is called.
4. **Evidence (32–45s):** Click **Run benchmark**. Explain that the five-task exact-match suite is hand-labelled and the context-token estimate is approximate. Show the separate 20-request / 10-concurrent smoke test and its measured p95.
5. **Product (45–60s):** “Threadline is a context-routing layer for teams whose agents have growing MCP catalogs. HydraDB keeps the relationships live; the agent traverses the relevant subgraph instead of stuffing every tool into the prompt.”

## Current workspace measurement snapshot

Latest local run: **5/5 exact-match tool selections** on the curated suite; **186 vs. 446 estimated tokens on average** (about **58% fewer** than loading every tool schema); the 20-request, concurrency-10 smoke test completed **20/20** with **234.5 ms p95** in this sandbox. Re-run the benchmark before recording; latency varies with the host. The suite is small and hand-labelled, so present this as prototype evidence, not a broad accuracy claim.

## Go-to-market framing

- **Buyer/user:** AI product teams operating MCP-connected agents with many internal tools, company facts, and permissions.
- **Pain:** tool catalogs and context grow faster than prompt budgets; an agent can have the right data but miss the useful relationship or load irrelevant schemas.
- **Product:** a graph-backed context-routing layer that maps a task to skills, tool definitions, MCP servers, and already-resolved entities; it returns a compact, explainable context pack.
- **Why a graph:** the useful context is connected (task → skill → tool → server; account → invoice/ticket/contract), not just semantically similar text.
- **Validation still needed:** interviews and tests with real agent teams; the demo fixtures do not establish customer demand or production readiness.

## Social post draft

We built **Threadline** for the HydraDB hackathon: a graph-powered context router for MCP agents. Instead of loading every tool schema into the prompt, Threadline traverses HydraDB from the task to the relevant skill, tools, MCP servers, and resolved account facts.

On our small hand-labelled demo suite, it selected the expected tools on 5/5 tasks and used ~58% fewer estimated schema tokens than loading the full catalog. We also ran 20 live context requests at 10-way concurrency (20/20 successful; 235 ms p95 on our sandbox host). Prototype results, not a general benchmark.

Built on the HydraDB open-source engine. [Live demo: add link] · [Repo: add link] · [Loom: add link]

#HydraDB #MCP #AIagents #KnowledgeGraphs

Remember to tag the HydraDB account on X/LinkedIn and replace the three link placeholders before posting.

## Final submission checklist

- [ ] Confirm the demo remains live and shows **HydraDB connected**
- [ ] Re-run the benchmark and capture the results for the Loom
- [ ] Publish this folder as a public GitHub repository
- [ ] Deploy the app and the HydraDB OSS engine so the live demo can reach the database
- [ ] Record and link the Loom
- [ ] Post on social and tag HydraDB
- [ ] Submit all three links before the 9 AM IST cutoff (4:30 AM in Zürich)
