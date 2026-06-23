# @aionis/aifs

Aionis File Surface for governed execution memory.

`@aionis/aifs` mirrors the Runtime guide, receipt, rehydrate pointers, and
snapshot metadata into a local `.aionis/` directory so coding agents can read
Aionis context with normal file operations.

It is intentionally not a FUSE/NFS mount. Phase 1 is a static, read-only mirror
over the existing Aionis Runtime APIs.

```bash
npx @aionis/aifs@latest refresh \
  --base-url http://127.0.0.1:3001 \
  --scope my-project \
  --query "Continue the current implementation without repeating failed branches."
```

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
  guide.md
  current_active_path.md
  inspect_before_use.md
  do_not_use.md
  rehydrate_needed.md
  manifest.json
  receipts/latest.json
  snapshots/latest.json
```

Agents should read `.aionis/guide.md` first, then inspect the focused files when
they need a narrower surface.

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
| `--out <dir>` | Mirror destination. Defaults to `.aionis`. |
| `--query <text>` | Current agent task/query. |
| `--run-id <id>` | Current execution run id. Enables execution guide mode when paired with `--task-signature`. |
| `--task-signature <id>` | Stable task/workflow signature. |
| `--role <agent|planner|worker|verifier|reviewer>` | Execution role for guideForRole. |
| `--context-mode <standard|compact_agent>` | Runtime context rendering mode. Defaults to `compact_agent`. |
| `--budget-profile <compact|balanced|high_recall>` | SDK execution prompt budget profile. Defaults to `balanced`. |
| `--max-prompt-chars <n>` | Maximum generated `guide.md` size. |
| `--include-base-prompt` / `--no-include-base-prompt` | Include or omit Runtime `agent_context.prompt_text` under the contract renderer. |

