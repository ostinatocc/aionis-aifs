# @aionis/aifs

Aionis File Surface for governed execution memory.

`@aionis/aifs` mirrors the Runtime guide, receipt, rehydrate pointers, and
snapshot metadata into a local `.aionis/` directory so coding agents can read
Aionis context with normal file operations.

The final Agent-facing file, `.aionis/guide.md`, is generated from the same SDK
AgentContext path as `guideAgentContext()` / `execution.guideAgentContextForRole()`.
AIFS writes the SDK top-level `agent_prompt` into that file; it is a file
transport, not a separate context compiler.

It is intentionally not a FUSE/NFS mount. Phase 1 is a static, read-only mirror
over the existing Aionis Runtime APIs.

The first file an agent should read is `.aionis/AGENT_INSTRUCTIONS.md`. It tells
the agent which Aionis files are authoritative for the current turn, which files
are blocked, and when to rehydrate compact evidence.

```bash
npx @aionis/aifs@latest init --scope my-project
npx @aionis/aifs@latest doctor --scope my-project
npx @aionis/aifs@latest refresh \
  --base-url http://127.0.0.1:3001 \
  --scope my-project \
  --query "Continue the current implementation from the accepted state."
```

`init` creates a local `.aionis/README.md` and `.aionis/config.json`.
`doctor` checks Runtime reachability and whether the file surface is healthy.
`refresh` writes the governed context mirror.

Execution-memory mode:

```bash
npx @aionis/aifs@latest refresh \
  --base-url http://127.0.0.1:3001 \
  --scope my-project \
  --run-id run-001 \
  --task-signature checkout-migration \
  --role worker \
  --query "Continue from the accepted route."
```

Output:

```text
.aionis/
  README.md
  AGENT_INSTRUCTIONS.md
  guide.md
  current_active_path.md
  inspect_before_use.md
  do_not_use.md
  rehydrate_needed.md
  manifest.json
  receipts/latest.json
  snapshots/latest.json
```

Agents should read `.aionis/AGENT_INSTRUCTIONS.md` first, then inspect the
focused files when they need a narrower surface.

For hosts that need a single instruction to paste into an agent prompt:

```text
Before continuing, read .aionis/AGENT_INSTRUCTIONS.md and follow the Aionis file-surface order.
Use .aionis/current_active_path.md as the active route.
Treat .aionis/do_not_use.md as blocked memory.
Rehydrate pointers in .aionis/rehydrate_needed.md before exact edits.
```

Environment variables:

```bash
AIONIS_BASE_URL=http://127.0.0.1:3001
AIONIS_API_KEY=...
AIONIS_TENANT_ID=default
AIONIS_SCOPE=my-project
```

Useful options:

| Option | Purpose |
|---|---|
| `--json` | Print machine-readable JSON instead of the default human summary. |
| `--out <dir>` | Mirror destination. Defaults to `.aionis`. |
| `--query <text>` | Current agent task/query. |
| `--run-id <id>` | Current execution run id. Enables execution guide mode when paired with `--task-signature`. |
| `--task-signature <id>` | Stable task/workflow signature. |
| `--role <agent|planner|worker|verifier|reviewer>` | Execution role for guideForRole. |
| `--context-mode <standard|compact_agent>` | Runtime context rendering mode. Defaults to Runtime standard AgentContext. |
| `--budget-profile <compact|balanced|high_recall>` | SDK execution prompt budget profile. Defaults to `balanced`. |
| `--prompt-format <contract|runtime_compact>` | Agent prompt format. `contract` emits the SDK execution contract; `runtime_compact` emits Runtime `agent_context.prompt_text`. |
| `--max-prompt-chars <n>` | Maximum generated `guide.md` size. |
| `--agent-instruction` / `--no-agent-instruction` | Write or omit `.aionis/AGENT_INSTRUCTIONS.md`. Enabled by default. |

Refresh summary:

```text
Aionis AIFS refreshed
Output: /repo/.aionis
Guide trace: guide-...
Prompt chars: 4210
Snapshot: written
Surface counts:
- use_now: 2
- inspect_before_use: 1
- do_not_use: 3
- rehydrate: 1
```
