# Threadline

**Threadline is a graph-powered context router for MCP agents.** It uses HydraDB as the live graph store for agent skills, MCP tool schemas, MCP servers, resolved customer entities, and account facts. Given a task, it traverses only the useful subgraph and builds a small context pack.

> Hackathon track: Agent context layer. HydraDB is the graph database, not just a demo dependency.

## Demo

Try: **“Find Acme’s overdue invoice and draft a follow-up.”** Threadline traverses:

`Agent → Invoice follow-up skill → relevant tools → MCP servers`

and separately resolves:

`Acme Systems → related invoices / account facts`

The app shows the returned graph-derived context, the live query timing, and a small comparison against loading every tool schema. This MVP uses a deterministic intent dispatcher and fixture-backed response—not a remote LLM or real MCP tool execution. `/api/context` returns a ready-to-inject `contextPack` containing only the graph-selected skill, MCP-compatible JSON Schema tool definitions, and resolved entities. The prototype does not send email or mutate external systems.

## Run locally

### 1. Start HydraDB OSS

Use the open-source engine: <https://github.com/hydra-db/hydradb>. Follow its current **Getting Started → Run a local server** instructions. The engine's local development defaults are used by Threadline:

- HTTP query API: `http://127.0.0.1:8443`
- bearer token: `local-development-token-32-bytes`
- graph: `default`
- cell: `cell-0`
- namespace: `default`

The HydraDB source currently requires Rust 1.99+ and native libraries including `libcypher-parser` and SuiteSparse GraphBLAS. Keep `graph-node` running in its own terminal.

### 2. Start Threadline

```bash
cd context-router
cp .env.example .env   # optional; defaults work with the local HydraDB setup above
npm start
```

Open `http://localhost:3000`. The app server binds to `0.0.0.0` and proxies browser requests to HydraDB from the server side. On first use, choose **Initialize graph** to seed the demo catalog into HydraDB.

Environment variables are documented in `.env.example`.

### Deploy the app container

`Dockerfile` packages only Threadline. Run HydraDB OSS as its own self-hosted service and point the app at its query API:

```bash
docker build -t threadline .
docker run --rm -p 3000:3000 \\
  -e HYDRADB_URL=https://your-hydradb-query-host \\
  -e HYDRADB_TOKEN=your-server-side-token \\
  -e HYDRADB_GRAPH=default -e HYDRADB_CELL=cell-0 \\
  -e HYDRADB_NAMESPACE=default threadline
```

Do not expose the database bearer token to browser code. The Node server makes all HydraDB requests server-side.

## Technical implementation

- **HydraDB:** actual OpenCypher reads and writes through its HTTP query API.
- **Graph model:** `Agent`, `Skill`, `Tool`, `MCPServer`, and `Entity` nodes; typed edges `HAS_SKILL`, `NEEDS`, `PROVIDED_BY`, and `RELATED_TO`.
- **Routing:** a simple, deterministic intent dispatcher selects the skill; one HydraDB path query traverses `Agent → Skill → Tool → MCPServer`, while another follows the resolved account's entity relationships. The API returns the compact context pack for a downstream agent.
- **Benchmark:** a five-task, hand-labelled prototype suite. Exact-match selection is reported alongside approximate context tokens and live traversal latency. Token estimates are computed from the stored tool descriptions and schemas at roughly four characters per token. A separate load smoke test runs 20 live context requests with concurrency 10 and reports successes plus p50/p95 latency. These are small-demo measurements, not a general evaluation claim.

## Product hypothesis

Teams building MCP-enabled agents want to add tools and knowledge without paying the context-window cost—or accepting the selection noise—of loading everything for every request. Threadline is a context-routing layer that can sit between an agent and its growing tool catalog.

## Submission checklist

- [ ] Deploy app and keep the HydraDB OSS engine available to the demo
- [ ] Publish this repository as open source
- [ ] Record a short Loom showing a task, the traversed graph, and the benchmark
- [ ] Post the product pitch and measured results; tag HydraDB

## License

MIT for Threadline code. HydraDB is a separate project; see its repository for its license and use terms.
