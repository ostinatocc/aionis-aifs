#!/usr/bin/env node
import {
  createAionisClient,
  type AionisClient,
  type AionisClientOptions,
  type AionisCompiledExecutionAgentContext,
  type AionisExecutionAgentRole,
  type AionisExecutionContextBudgetProfile,
  type AionisGuideContextMode,
  type AionisGuideMode,
  type AionisJsonObject,
} from "@aionis/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type AionisAifsCommand = "refresh" | "init" | "doctor";
export type AionisAifsOutputFormat = "summary" | "json";

export type AionisAifsOptions = {
  command: AionisAifsCommand;
  baseUrl: string;
  apiKey?: string;
  tenant_id?: string;
  scope?: string;
  outDir: string;
  query_text: string;
  run_id?: string;
  task_id?: string;
  task_signature?: string;
  task_family?: string;
  workflow_signature?: string;
  agent_id?: string;
  team_id?: string;
  role?: AionisExecutionAgentRole;
  mode?: AionisGuideMode;
  context_mode?: AionisGuideContextMode;
  budget_profile: AionisExecutionContextBudgetProfile;
  max_prompt_chars?: number;
  include_base_prompt: boolean;
  agent_instruction: boolean;
  snapshot: boolean;
  output_format: AionisAifsOutputFormat;
  cwd: string;
};

export type AionisAifsFile = {
  relativePath: string;
  content: string;
};

export type AionisAifsRefreshResult = {
  contract_version: "aionis_aifs_refresh_result_v1";
  out_dir: string;
  generated_at: string;
  guide_trace_id: string | null;
  prompt_char_count: number;
  surface_counts: {
    use_now: number;
    inspect_before_use: number;
    do_not_use: number;
    rehydrate: number;
  };
  files: string[];
  snapshot_status: "written" | "not_requested" | "unavailable";
};

export type AionisAifsInitResult = {
  contract_version: "aionis_aifs_init_result_v1";
  out_dir: string;
  files: string[];
};

export type AionisAifsDoctorCheck = {
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
};

export type AionisAifsDoctorResult = {
  contract_version: "aionis_aifs_doctor_result_v1";
  ok: boolean;
  base_url: string;
  scope: string | null;
  out_dir: string;
  checks: AionisAifsDoctorCheck[];
};

export type AionisAifsRefreshInput = {
  options: AionisAifsOptions;
  client?: Pick<AionisClient, "guideAgentContext" | "snapshot"> & {
    execution: Pick<AionisClient["execution"], "guideAgentContextForRole">;
  };
  now?: Date;
};

type AionisAgentContextLike = {
  guide: unknown;
  compiled_context: AionisCompiledExecutionAgentContext;
  agent_prompt: string;
  prompt_char_count?: number;
  guide_trace_id: string | null;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:3001";
const DEFAULT_QUERY = "Continue the current task using Aionis governed execution memory.";

function readFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseGuideMode(value: string): AionisGuideMode {
  if (value === "full_power" || value === "standard") return value;
  throw new Error(`Unsupported guide mode "${value}". Use full_power or standard.`);
}

function parseContextMode(value: string): AionisGuideContextMode {
  if (value === "full_power" || value === "standard" || value === "compact_agent") return value;
  throw new Error(`Unsupported context mode "${value}". Use standard, compact_agent, or full_power.`);
}

function parseBudgetProfile(value: string): AionisExecutionContextBudgetProfile {
  if (value === "compact" || value === "balanced" || value === "high_recall") return value;
  throw new Error(`Unsupported budget profile "${value}". Use compact, balanced, or high_recall.`);
}

function parseRole(value: string): AionisExecutionAgentRole {
  if (value === "agent" || value === "planner" || value === "worker" || value === "verifier" || value === "reviewer") {
    return value;
  }
  throw new Error(`Unsupported role "${value}". Use agent, planner, worker, verifier, or reviewer.`);
}

function optionalPositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

export function aionisAifsUsage(): string {
  return `Usage:
  npx @aionis/aifs init [options]
  npx @aionis/aifs doctor [options]
  npx @aionis/aifs refresh [options]

Commands:
  init                         Create a local .aionis README and config.
  doctor                       Check Runtime reachability and .aionis file surface health.
  refresh                      Generate the governed .aionis file mirror.

Options:
  --base-url <url>              Aionis Runtime URL. Defaults to AIONIS_BASE_URL or ${DEFAULT_BASE_URL}
  --api-key <key>               Runtime bearer token. Prefer AIONIS_API_KEY for shell history safety.
  --tenant <id>                 Tenant id. Defaults to AIONIS_TENANT_ID or AIONIS_TENANT.
  --scope <scope>               Memory scope. Defaults to AIONIS_SCOPE.
  --out <dir>                   Output directory. Defaults to .aionis.
  --query <text>                Agent task/query for Runtime guide.
  --run-id <id>                 Execution run id.
  --task-id <id>                Task id.
  --task-signature <signature>  Task/workflow signature. With --run-id, enables execution guide mode.
  --task-family <name>          Optional task family.
  --workflow-signature <name>   Optional workflow signature.
  --agent-id <id>               Optional agent id.
  --team-id <id>                Optional team id.
  --role <role>                 agent, planner, worker, verifier, or reviewer. Defaults to agent.
  --mode <name>                 Runtime guide mode. Defaults to full_power.
  --context-mode <name>         standard, compact_agent, or full_power. Defaults to compact_agent.
  --budget-profile <profile>    compact, balanced, or high_recall. Defaults to balanced.
  --max-prompt-chars <n>        Maximum guide.md chars.
  --include-base-prompt         Include Runtime base prompt under the AIFS execution contract.
  --no-include-base-prompt      Omit Runtime base prompt. Default.
  --agent-instruction           Write AGENT_INSTRUCTIONS.md for file-reading agents. Default.
  --no-agent-instruction        Omit AGENT_INSTRUCTIONS.md.
  --snapshot                    Fetch operator snapshot when possible. Default when --run-id is provided.
  --no-snapshot                 Do not fetch operator snapshot.
  --json                        Print machine-readable JSON instead of a human summary.
  -h, --help                    Show help.

Examples:
  npx @aionis/aifs init --scope my-project
  npx @aionis/aifs doctor --scope my-project
  npx @aionis/aifs refresh --scope my-project --query "Continue safely."
  npx @aionis/aifs refresh --run-id run-001 --task-signature checkout --role worker
  AIONIS_BASE_URL=http://127.0.0.1:3001 AIONIS_SCOPE=my-project npx @aionis/aifs refresh
`;
}

export function parseAionisAifsArgs(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): AionisAifsOptions {
  const positional = [...argv];
  const first = positional[0];
  const command: AionisAifsCommand = first === "init" || first === "doctor" || first === "refresh" ? first : "refresh";
  let indexStart = first === "init" || first === "doctor" || first === "refresh" ? 1 : 0;
  if (first === "-h" || first === "--help") {
    process.stdout.write(aionisAifsUsage());
    process.exit(0);
  }
  if (first && !first.startsWith("-") && first !== "init" && first !== "doctor" && first !== "refresh") {
    throw new Error(`Unknown command "${first}". Use init, doctor, or refresh.`);
  }

  let baseUrl = env.AIONIS_BASE_URL?.trim() || env.AIONIS_PRODUCT_E2E_BASE_URL?.trim() || DEFAULT_BASE_URL;
  let apiKey = env.AIONIS_API_KEY?.trim() || undefined;
  let tenantId = env.AIONIS_TENANT_ID?.trim() || env.AIONIS_TENANT?.trim() || undefined;
  let scope = env.AIONIS_SCOPE?.trim() || undefined;
  let outDir = env.AIONIS_AIFS_DIR?.trim() || ".aionis";
  let queryText = env.AIONIS_AIFS_QUERY?.trim() || DEFAULT_QUERY;
  let runId = env.AIONIS_RUN_ID?.trim() || undefined;
  let taskId = env.AIONIS_TASK_ID?.trim() || undefined;
  let taskSignature = env.AIONIS_TASK_SIGNATURE?.trim() || undefined;
  let taskFamily = env.AIONIS_TASK_FAMILY?.trim() || undefined;
  let workflowSignature = env.AIONIS_WORKFLOW_SIGNATURE?.trim() || undefined;
  let agentId = env.AIONIS_AGENT_ID?.trim() || undefined;
  let teamId = env.AIONIS_TEAM_ID?.trim() || undefined;
  let role: AionisExecutionAgentRole | undefined = env.AIONIS_AGENT_ROLE ? parseRole(env.AIONIS_AGENT_ROLE.trim()) : "agent";
  let mode: AionisGuideMode = env.AIONIS_GUIDE_MODE ? parseGuideMode(env.AIONIS_GUIDE_MODE.trim()) : "full_power";
  let contextMode: AionisGuideContextMode = env.AIONIS_CONTEXT_MODE ? parseContextMode(env.AIONIS_CONTEXT_MODE.trim()) : "compact_agent";
  let budgetProfile: AionisExecutionContextBudgetProfile = env.AIONIS_AIFS_BUDGET_PROFILE
    ? parseBudgetProfile(env.AIONIS_AIFS_BUDGET_PROFILE.trim())
    : "balanced";
  let maxPromptChars = env.AIONIS_AIFS_MAX_PROMPT_CHARS
    ? optionalPositiveInteger(env.AIONIS_AIFS_MAX_PROMPT_CHARS.trim(), "AIONIS_AIFS_MAX_PROMPT_CHARS")
    : undefined;
  let includeBasePrompt = env.AIONIS_AIFS_INCLUDE_BASE_PROMPT === "1" || env.AIONIS_AIFS_INCLUDE_BASE_PROMPT === "true";
  let agentInstruction = env.AIONIS_AIFS_AGENT_INSTRUCTION !== "0" && env.AIONIS_AIFS_AGENT_INSTRUCTION !== "false";
  let snapshot = env.AIONIS_AIFS_SNAPSHOT === "1" || env.AIONIS_AIFS_SNAPSHOT === "true";
  let snapshotSet = env.AIONIS_AIFS_SNAPSHOT !== undefined;
  let outputFormat: AionisAifsOutputFormat = env.AIONIS_AIFS_JSON === "1" || env.AIONIS_AIFS_JSON === "true" ? "json" : "summary";

  for (let index = indexStart; index < positional.length; index += 1) {
    const arg = positional[index];
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(aionisAifsUsage());
      process.exit(0);
    }
    if (arg === "--base-url") {
      baseUrl = readFlagValue(positional, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--api-key") {
      apiKey = readFlagValue(positional, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--tenant") {
      tenantId = readFlagValue(positional, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--scope") {
      scope = readFlagValue(positional, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--out") {
      outDir = readFlagValue(positional, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--query") {
      queryText = readFlagValue(positional, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--run-id") {
      runId = readFlagValue(positional, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--task-id") {
      taskId = readFlagValue(positional, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--task-signature") {
      taskSignature = readFlagValue(positional, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--task-family") {
      taskFamily = readFlagValue(positional, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--workflow-signature") {
      workflowSignature = readFlagValue(positional, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--agent-id") {
      agentId = readFlagValue(positional, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--team-id") {
      teamId = readFlagValue(positional, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--role") {
      role = parseRole(readFlagValue(positional, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--mode") {
      mode = parseGuideMode(readFlagValue(positional, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--context-mode") {
      contextMode = parseContextMode(readFlagValue(positional, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--budget-profile") {
      budgetProfile = parseBudgetProfile(readFlagValue(positional, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--max-prompt-chars") {
      maxPromptChars = optionalPositiveInteger(readFlagValue(positional, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--include-base-prompt") {
      includeBasePrompt = true;
      continue;
    }
    if (arg === "--no-include-base-prompt") {
      includeBasePrompt = false;
      continue;
    }
    if (arg === "--agent-instruction") {
      agentInstruction = true;
      continue;
    }
    if (arg === "--no-agent-instruction") {
      agentInstruction = false;
      continue;
    }
    if (arg === "--snapshot") {
      snapshot = true;
      snapshotSet = true;
      continue;
    }
    if (arg === "--no-snapshot") {
      snapshot = false;
      snapshotSet = true;
      continue;
    }
    if (arg === "--json") {
      outputFormat = "json";
      continue;
    }
    throw new Error(`Unknown option "${arg}"`);
  }

  if (!snapshotSet && runId) snapshot = true;

  return {
    command,
    baseUrl,
    apiKey,
    tenant_id: tenantId,
    scope,
    outDir,
    query_text: queryText,
    run_id: runId,
    task_id: taskId,
    task_signature: taskSignature,
    task_family: taskFamily,
    workflow_signature: workflowSignature,
    agent_id: agentId,
    team_id: teamId,
    role,
    mode,
    context_mode: contextMode,
    budget_profile: budgetProfile,
    max_prompt_chars: maxPromptChars,
    include_base_prompt: includeBasePrompt,
    agent_instruction: agentInstruction,
    snapshot,
    output_format: outputFormat,
    cwd,
  };
}

function clientOptionsFromAifs(options: AionisAifsOptions): AionisClientOptions {
  return {
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    tenant_id: options.tenant_id,
    scope: options.scope,
    default_guide_mode: options.mode,
  };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function markdownList(values: string[], empty = "none"): string[] {
  return values.length > 0 ? values.map((entry) => `- ${entry}`) : [`- ${empty}`];
}

function postureMarkdown(
  title: string,
  rows: Array<{ memory_id: string; instruction: string; reason: string; target_files: string[] }>,
): string {
  return [
    `# ${title}`,
    "",
    rows.length === 0
      ? "No entries."
      : rows.map((row) => [
        `- Memory: ${row.memory_id}`,
        `  - Instruction: ${row.instruction}`,
        `  - Reason: ${row.reason}`,
        ...(row.target_files.length > 0 ? [`  - Targets: ${row.target_files.join(", ")}`] : []),
      ].join("\n")).join("\n"),
    "",
  ].join("\n");
}

function readmeMarkdown(generatedAt: string): string {
  return [
    "# .aionis",
    "",
    "This directory is generated by Aionis File Surface.",
    "",
    "Read order for agents:",
    "",
    "1. `AGENT_INSTRUCTIONS.md` - the direct instruction for file-reading agents.",
    "2. `guide.md` - the governed execution-memory contract for the current task.",
    "3. `current_active_path.md` - active route, pending artifacts, and should-continue instructions.",
    "4. `do_not_use.md` - blocked, failed, stale, retired, or must-not-use memory surfaces.",
    "5. `inspect_before_use.md` - memory that may be useful but must be checked before action.",
    "6. `rehydrate_needed.md` - compact memory pointers that need raw evidence before exact use.",
    "",
    "Machine-readable records:",
    "",
    "- `receipts/latest.json`",
    "- `snapshots/latest.json`",
    "- `manifest.json`",
    "",
    `Generated at: ${generatedAt}`,
    "",
    "Do not edit these files by hand. Run `aionis-aifs refresh` to update them.",
    "",
  ].join("\n");
}

function initReadmeMarkdown(scope: string | undefined): string {
  return [
    "# .aionis",
    "",
    "This directory is the Aionis File Surface for this workspace.",
    "",
    "Run:",
    "",
    "```bash",
    "npx @aionis/aifs@latest refresh",
    "```",
    "",
    "Then ask your agent to read:",
    "",
    "1. `.aionis/AGENT_INSTRUCTIONS.md`",
    "2. `.aionis/README.md`",
    "3. `.aionis/guide.md`",
    "4. `.aionis/current_active_path.md`",
    "5. `.aionis/do_not_use.md`",
    "6. `.aionis/rehydrate_needed.md`",
    "",
    "The Runtime remains the source of truth. These files are a generated read surface.",
    "",
    scope ? `Configured scope: \`${scope}\`` : "Configured scope: not set yet",
    "",
  ].join("\n");
}

function agentInstructionMarkdown(input: {
  generatedAt: string;
  options: AionisAifsOptions;
  guideTraceId?: string | null;
  promptCharCount?: number;
  initializedOnly?: boolean;
}): string {
  const scopeLine = input.options.scope ? `- Scope: ${input.options.scope}` : "- Scope: not set";
  const traceLine = input.guideTraceId ? `- Guide trace: ${input.guideTraceId}` : "- Guide trace: not generated yet";
  const promptLine = input.promptCharCount !== undefined ? `- Prompt chars: ${input.promptCharCount}` : "- Prompt chars: not generated yet";
  return [
    "# Aionis Agent Instructions",
    "",
    "This workspace contains an Aionis file surface. Before continuing the task, read the governed context files in this order:",
    "",
    "1. `.aionis/guide.md` - use this as the compact Aionis context contract.",
    "2. `.aionis/current_active_path.md` - continue the accepted route and pending artifacts.",
    "3. `.aionis/do_not_use.md` - do not use these memories as implementation direction.",
    "4. `.aionis/inspect_before_use.md` - inspect these only as candidates before relying on them.",
    "5. `.aionis/rehydrate_needed.md` - expand these pointers before exact edits or claims.",
    "",
    "Rules for the agent:",
    "",
    "- Prefer `current_active_path.md` over older matching files or notes.",
    "- If an active target is missing, treat it as pending work rather than falling back to a blocked route.",
    "- Never turn `do_not_use.md` entries into direct implementation steps.",
    "- If `rehydrate_needed.md` contains required evidence, request or fetch that evidence before making exact changes.",
    "- Use `receipts/latest.json` when you need to explain which memory was used or suppressed.",
    "",
    input.initializedOnly
      ? "The mirror has been initialized but not refreshed yet. Run `npx @aionis/aifs@latest refresh` before relying on Aionis context."
      : "The mirror has been refreshed from the Aionis Runtime.",
    "",
    "Metadata:",
    "",
    `- Generated at: ${input.generatedAt}`,
    scopeLine,
    traceLine,
    promptLine,
    "",
  ].join("\n");
}

function initConfig(options: AionisAifsOptions): AionisJsonObject {
  return {
    contract_version: "aionis_aifs_config_v1",
    base_url: options.baseUrl,
    tenant_id: options.tenant_id ?? null,
    scope: options.scope ?? null,
    default_query: options.query_text,
    generated_by: "@aionis/aifs",
  };
}

function manifestFile(input: {
  options: AionisAifsOptions;
  generatedAt: string;
  guideTraceId: string | null;
  promptCharCount: number;
  snapshotStatus: AionisAifsRefreshResult["snapshot_status"];
  files: string[];
}): AionisJsonObject {
  return {
    contract_version: "aionis_aifs_manifest_v1",
    intended_use: "agent_file_surface",
    generated_at: input.generatedAt,
    runtime: {
      base_url: input.options.baseUrl,
      tenant_id: input.options.tenant_id ?? null,
      scope: input.options.scope ?? null,
    },
    guide_trace_id: input.guideTraceId,
    run_id: input.options.run_id ?? null,
    task_id: input.options.task_id ?? null,
    task_signature: input.options.task_signature ?? null,
    role: input.options.role ?? null,
    prompt_char_count: input.promptCharCount,
    snapshot_status: input.snapshotStatus,
    files: input.files,
  };
}

async function fetchAgentContext(
  input: AionisAifsRefreshInput,
  client: NonNullable<AionisAifsRefreshInput["client"]>,
): Promise<AionisAgentContextLike> {
  const options = input.options;
  const task = {
    task_id: options.task_id,
    run_id: options.run_id,
    task_signature: options.task_signature ?? "aionis-aifs",
    query_text: options.query_text,
  };
  const contextOptions = {
    task,
    budget_profile: options.budget_profile,
    max_prompt_chars: options.max_prompt_chars,
    include_base_prompt: options.include_base_prompt,
  };

  if (options.run_id && options.task_signature) {
    return client.execution.guideAgentContextForRole({
      run_id: options.run_id,
      task_id: options.task_id,
      task_signature: options.task_signature,
      task_family: options.task_family,
      workflow_signature: options.workflow_signature,
      agent_id: options.agent_id,
      team_id: options.team_id,
      role: options.role,
      tenant_id: options.tenant_id,
      scope: options.scope,
      query_text: options.query_text,
      mode: options.mode,
      context_mode: options.context_mode,
      include_packets: true,
    }, undefined, contextOptions);
  }

  return client.guideAgentContext({
    query_text: options.query_text,
    consumer_agent_id: options.agent_id,
    tenant_id: options.tenant_id,
    scope: options.scope,
    mode: options.mode,
    context_mode: options.context_mode,
    include_packets: true,
  }, undefined, contextOptions);
}

async function fetchSnapshot(
  options: AionisAifsOptions,
  client: NonNullable<AionisAifsRefreshInput["client"]>,
): Promise<{ status: AionisAifsRefreshResult["snapshot_status"]; payload: unknown }> {
  if (!options.snapshot) {
    return {
      status: "not_requested",
      payload: {
        contract_version: "aionis_aifs_snapshot_placeholder_v1",
        status: "not_requested",
        reason: "Pass --snapshot or --run-id to fetch Runtime operator snapshot.",
      },
    };
  }
  if (!options.run_id) {
    return {
      status: "unavailable",
      payload: {
        contract_version: "aionis_aifs_snapshot_placeholder_v1",
        status: "unavailable",
        reason: "Snapshot requested but --run-id was not provided.",
      },
    };
  }
  try {
    const payload = await client.snapshot({
      run_id: options.run_id,
      tenant_id: options.tenant_id,
      scope: options.scope,
      include_markdown: true,
    });
    return { status: "written", payload };
  } catch (error) {
    return {
      status: "unavailable",
      payload: {
        contract_version: "aionis_aifs_snapshot_placeholder_v1",
        status: "unavailable",
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function buildAifsFiles(input: AionisAifsRefreshInput): Promise<{
  files: AionisAifsFile[];
  result: AionisAifsRefreshResult;
}> {
  const options = input.options;
  const client = input.client ?? createAionisClient(clientOptionsFromAifs(options));
  const generatedAt = (input.now ?? new Date()).toISOString();
  const agentContext = await fetchAgentContext(input, client);
  const executionContext = agentContext.compiled_context;
  const agentPrompt = agentContext.agent_prompt;
  const agentPromptCharCount = agentContext.prompt_char_count ?? agentPrompt.length;
  const snapshot = await fetchSnapshot(options, client);
  const guideTraceId = executionContext.memory_use_receipt.guide_trace_id;
  const receipt = executionContext.memory_use_receipt as Record<string, unknown>;
  const surfaceCounts = {
    use_now: arrayLength(receipt.use_now_memory_ids),
    inspect_before_use: arrayLength(receipt.inspect_before_use_memory_ids),
    do_not_use: arrayLength(receipt.do_not_use_memory_ids),
    rehydrate: arrayLength(receipt.rehydrate_memory_ids),
  };

  const currentActivePath = [
    "# Current Active Path",
    "",
    "Active targets:",
    ...markdownList(executionContext.active_targets),
    "",
    "Missing active targets:",
    ...markdownList(executionContext.missing_active_targets, "none observed"),
    "",
    "Pending artifacts:",
    ...markdownList(executionContext.pending_artifacts),
    "",
    "Should continue:",
    ...executionContext.command_posture
      .filter((entry) => entry.posture === "should_continue")
      .map((entry) => `- ${entry.memory_id}: ${entry.instruction}`),
    ...(executionContext.command_posture.some((entry) => entry.posture === "should_continue") ? [] : ["- none"]),
    "",
  ].join("\n");

  const rehydrateNeeded = [
    "# Rehydrate Needed",
    "",
    executionContext.rehydrate_requests.length === 0
      ? "No rehydrate pointers were exposed."
      : executionContext.rehydrate_requests.map((entry) => [
        `- Memory: ${entry.memory_id}`,
        `  - Required: ${entry.required ? "yes" : "no"}`,
        ...(entry.reason ? [`  - Reason: ${entry.reason}`] : []),
      ].join("\n")).join("\n"),
    "",
  ].join("\n");

  const coreFiles: AionisAifsFile[] = [
    { relativePath: "README.md", content: readmeMarkdown(generatedAt) },
    ...(options.agent_instruction
      ? [{
        relativePath: "AGENT_INSTRUCTIONS.md",
        content: agentInstructionMarkdown({
          generatedAt,
          options,
          guideTraceId,
          promptCharCount: agentPromptCharCount,
        }),
      }]
      : []),
    { relativePath: "guide.md", content: `${agentPrompt}\n` },
    { relativePath: "current_active_path.md", content: currentActivePath },
    {
      relativePath: "inspect_before_use.md",
      content: postureMarkdown(
        "Inspect Before Use",
        executionContext.command_posture.filter((entry) => entry.posture === "inspect_first"),
      ),
    },
    {
      relativePath: "do_not_use.md",
      content: [
        postureMarkdown("Do Not Use", executionContext.command_posture.filter((entry) => entry.posture === "must_not")).trimEnd(),
        "",
        "Blocked direction targets:",
        ...markdownList(executionContext.blocked_direction_targets),
        "",
      ].join("\n"),
    },
    { relativePath: "rehydrate_needed.md", content: rehydrateNeeded },
    { relativePath: "receipts/latest.json", content: json(executionContext.memory_use_receipt) },
    { relativePath: "snapshots/latest.json", content: json(snapshot.payload) },
  ];

  const fileNames = [...coreFiles.map((file) => file.relativePath), "manifest.json"];
  const manifest = manifestFile({
    options,
    generatedAt,
    guideTraceId,
    promptCharCount: agentPromptCharCount,
    snapshotStatus: snapshot.status,
    files: fileNames,
  });
  const files = [
    ...coreFiles,
    { relativePath: "manifest.json", content: json(manifest) },
  ];
  return {
    files,
    result: {
      contract_version: "aionis_aifs_refresh_result_v1",
      out_dir: path.resolve(options.cwd, options.outDir),
      generated_at: generatedAt,
      guide_trace_id: guideTraceId,
      prompt_char_count: agentPromptCharCount,
      surface_counts: surfaceCounts,
      files: fileNames,
      snapshot_status: snapshot.status,
    },
  };
}

function assertSafeRelativePath(relativePath: string): void {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes("..")) {
    throw new Error(`Unsafe AIFS output path: ${relativePath}`);
  }
}

export function writeAifsFiles(outDir: string, files: AionisAifsFile[], cwd = process.cwd()): void {
  const root = path.resolve(cwd, outDir);
  fs.mkdirSync(root, { recursive: true });
  for (const file of files) {
    assertSafeRelativePath(file.relativePath);
    const target = path.join(root, file.relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, { mode: file.relativePath.endsWith(".json") ? 0o600 : 0o644 });
  }
}

export async function refreshAifsMirror(input: AionisAifsRefreshInput): Promise<AionisAifsRefreshResult> {
  const built = await buildAifsFiles(input);
  writeAifsFiles(input.options.outDir, built.files, input.options.cwd);
  return built.result;
}

export function initAifsMirror(options: AionisAifsOptions): AionisAifsInitResult {
  const generatedAt = new Date().toISOString();
  const files: AionisAifsFile[] = [
    { relativePath: "README.md", content: initReadmeMarkdown(options.scope) },
    ...(options.agent_instruction
      ? [{
        relativePath: "AGENT_INSTRUCTIONS.md",
        content: agentInstructionMarkdown({
          generatedAt,
          options,
          initializedOnly: true,
        }),
      }]
      : []),
    { relativePath: "config.json", content: json(initConfig(options)) },
  ];
  writeAifsFiles(options.outDir, files, options.cwd);
  return {
    contract_version: "aionis_aifs_init_result_v1",
    out_dir: path.resolve(options.cwd, options.outDir),
    files: files.map((file) => file.relativePath),
  };
}

function pushCheck(checks: AionisAifsDoctorCheck[], check: AionisAifsDoctorCheck): void {
  checks.push(check);
}

export async function doctorAifsMirror(input: AionisAifsRefreshInput): Promise<AionisAifsDoctorResult> {
  const options = input.options;
  const checks: AionisAifsDoctorCheck[] = [];
  const root = path.resolve(options.cwd, options.outDir);
  const parent = path.dirname(root);

  try {
    fs.mkdirSync(parent, { recursive: true });
    fs.accessSync(parent, fs.constants.W_OK);
    pushCheck(checks, {
      name: "output_parent_writable",
      status: "ok",
      message: `Writable parent directory: ${parent}`,
    });
  } catch (error) {
    pushCheck(checks, {
      name: "output_parent_writable",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (fs.existsSync(root)) {
    const required = [
      "README.md",
      ...(options.agent_instruction ? ["AGENT_INSTRUCTIONS.md"] : []),
      "guide.md",
      "current_active_path.md",
      "inspect_before_use.md",
      "do_not_use.md",
      "rehydrate_needed.md",
      "receipts/latest.json",
      "snapshots/latest.json",
      "manifest.json",
    ];
    const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
    pushCheck(checks, {
      name: "generated_files",
      status: missing.length === 0 ? "ok" : "warn",
      message: missing.length === 0 ? "All expected AIFS files exist." : `Missing generated files: ${missing.join(", ")}`,
    });
  } else {
    pushCheck(checks, {
      name: "generated_files",
      status: "warn",
      message: `${root} does not exist yet. Run aionis-aifs refresh.`,
    });
  }

  try {
    const client = input.client ?? createAionisClient(clientOptionsFromAifs(options));
    await fetchAgentContext(input, client);
    pushCheck(checks, {
      name: "runtime_guide",
      status: "ok",
      message: `Runtime guide succeeded at ${options.baseUrl}`,
    });
  } catch (error) {
    pushCheck(checks, {
      name: "runtime_guide",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    contract_version: "aionis_aifs_doctor_result_v1",
    ok: checks.every((check) => check.status !== "fail"),
    base_url: options.baseUrl,
    scope: options.scope ?? null,
    out_dir: root,
    checks,
  };
}

export function formatInitSummary(result: AionisAifsInitResult): string {
  return [
    "Aionis AIFS initialized",
    `Output: ${result.out_dir}`,
    "Files:",
    ...result.files.map((file) => `- ${file}`),
    "",
    "Next:",
    "npx @aionis/aifs@latest doctor",
    "npx @aionis/aifs@latest refresh",
    "",
  ].join("\n");
}

export function formatRefreshSummary(result: AionisAifsRefreshResult): string {
  return [
    "Aionis AIFS refreshed",
    `Output: ${result.out_dir}`,
    `Guide trace: ${result.guide_trace_id ?? "none"}`,
    `Prompt chars: ${result.prompt_char_count}`,
    `Snapshot: ${result.snapshot_status}`,
    "Surface counts:",
    `- use_now: ${result.surface_counts.use_now}`,
    `- inspect_before_use: ${result.surface_counts.inspect_before_use}`,
    `- do_not_use: ${result.surface_counts.do_not_use}`,
    `- rehydrate: ${result.surface_counts.rehydrate}`,
    "Files:",
    ...result.files.map((file) => `- ${file}`),
    "",
    "Agent read order:",
    "1. .aionis/AGENT_INSTRUCTIONS.md",
    "2. .aionis/README.md",
    "3. .aionis/guide.md",
    "4. .aionis/current_active_path.md",
    "5. .aionis/do_not_use.md",
    "6. .aionis/rehydrate_needed.md",
    "",
  ].join("\n");
}

export function formatDoctorSummary(result: AionisAifsDoctorResult): string {
  return [
    result.ok ? "Aionis AIFS doctor passed" : "Aionis AIFS doctor found issues",
    `Runtime: ${result.base_url}`,
    `Scope: ${result.scope ?? "not set"}`,
    `Output: ${result.out_dir}`,
    "Checks:",
    ...result.checks.map((check) => `- [${check.status}] ${check.name}: ${check.message}`),
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const options = parseAionisAifsArgs();
  if (options.command === "init") {
    const result = initAifsMirror(options);
    process.stdout.write(options.output_format === "json" ? json(result) : formatInitSummary(result));
    return;
  }
  if (options.command === "doctor") {
    const result = await doctorAifsMirror({ options });
    process.stdout.write(options.output_format === "json" ? json(result) : formatDoctorSummary(result));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const result = await refreshAifsMirror({ options });
  process.stdout.write(options.output_format === "json" ? json(result) : formatRefreshSummary(result));
}

function realpathForEntrypoint(input: string): string {
  try {
    return fs.realpathSync(input);
  } catch {
    return path.resolve(input);
  }
}

export function isCliEntrypoint(entry = process.argv[1], moduleUrl = import.meta.url): boolean {
  if (!entry) return false;
  return realpathForEntrypoint(entry) === realpathForEntrypoint(fileURLToPath(moduleUrl));
}

if (isCliEntrypoint()) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
