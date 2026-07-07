import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { compileExecutionAgentContext } from "@aionis/sdk";
import {
  buildAifsFiles,
  doctorAifsMirror,
  formatDoctorSummary,
  formatInitSummary,
  formatRefreshSummary,
  initAifsMirror,
  isCliEntrypoint,
  parseAionisAifsArgs,
  refreshAifsMirror,
  writeAifsFiles,
  type AionisAifsOptions,
} from "../src/index.ts";

function baseOptions(overrides: Partial<AionisAifsOptions> = {}): AionisAifsOptions {
  return {
    command: "refresh",
    baseUrl: "http://runtime.test",
    tenant_id: "tenant-a",
    scope: "scope-a",
    outDir: ".aionis",
    query_text: "Continue the accepted checkout path.",
    run_id: "run-1",
    task_signature: "checkout-migration",
    role: "worker",
    mode: "full_power",
    context_mode: "compact_agent",
    budget_profile: "balanced",
    include_base_prompt: false,
    agent_instruction: true,
    snapshot: true,
    output_format: "summary",
    cwd: process.cwd(),
    ...overrides,
  };
}

function fakeGuide() {
  return {
    guide_trace_id: "guide-1",
    tenant_id: "tenant-a",
    scope: "scope-a",
    agent_context: {
      prompt_text: "AIONIS_CTX\nContinue accepted checkout adapter path.",
      command_posture: [
        {
          posture: "should_continue",
          surface: "current",
          memory_id: "mem-current",
          instruction: "Continue the checkout adapter.",
          reason: "It is the accepted route.",
          target_files: ["src/checkoutAdapter.ts"],
        },
        {
          posture: "inspect_first",
          surface: "inspect_before_use",
          memory_id: "mem-candidate",
          instruction: "Inspect candidate migration note before action.",
          reason: "Candidate evidence only.",
          target_files: ["src/candidate.ts"],
        },
        {
          posture: "must_not",
          surface: "do_not_use",
          memory_id: "mem-failed",
          instruction: "Do not extend the legacy full bundle route.",
          reason: "Verifier rejected it.",
          target_files: ["src/fullBundleEnvironment.ts"],
        },
      ],
      route_contract: {
        active_targets: [
          {
            target: "src/checkoutAdapter.ts",
            source_memory_id: "mem-current",
            source: "should_continue",
            artifact_status: "may_be_absent",
            missing_policy: "restore_or_create_if_task_consistent_or_rehydrate",
          },
        ],
        pending_artifacts: [
          {
            target: "src/checkoutAdapter.ts",
            source_memory_id: "mem-current",
            source: "should_continue",
            allowed_actions: ["create", "restore", "rehydrate"],
          },
        ],
        reference_only_targets: [],
        blocked_direction_targets: [
          {
            target: "src/fullBundleEnvironment.ts",
            source_memory_id: "mem-failed",
            source: "must_not",
          },
        ],
        evidence_sources: [],
        blocked_routes: [
          {
            target: "src/fullBundleEnvironment.ts",
            source_memory_id: "mem-failed",
            source: "must_not",
          },
        ],
      },
      rehydrate_hints: [
        {
          memory_id: "mem-rehydrate",
          reason: "Exact patch evidence is compact.",
          required: true,
        },
      ],
    },
    memory_decision_trace: {
      memory_use_receipt: {
        contract_version: "aionis_memory_use_receipt_v1",
        intended_use: "memory_use_audit",
        agent_prompt_included: false,
        runtime_mutation: false,
        guide_trace_id: "guide-1",
        history_used: true,
        actionable_history_used: true,
        prompt_char_count: 123,
        exposed_memory_ids: ["mem-current", "mem-candidate", "mem-failed", "mem-rehydrate"],
        use_now_memory_ids: ["mem-current"],
        inspect_before_use_memory_ids: ["mem-candidate"],
        do_not_use_memory_ids: ["mem-failed"],
        rehydrate_memory_ids: ["mem-rehydrate"],
        attributed_memory_ids: [],
        unattributed_recalled_memory_ids: [],
        read_only_signal_memory_ids: [],
        decision_summaries: [
          {
            memory_id: "mem-current",
            agent_surface: "use_now",
            decision_kind: "used",
            actionable: true,
            reason_codes: ["current_execution_state"],
          },
          {
            memory_id: "mem-failed",
            agent_surface: "do_not_use",
            decision_kind: "blocked",
            actionable: false,
            reason_codes: ["failed_branch"],
          },
        ],
        risk_flags: [],
        summary: "Aionis exposed current state and blocked failed branch.",
      },
    },
  };
}

function fakeAgentContext(contextOptions: Record<string, unknown> = {}) {
  const guide = fakeGuide();
  const compiled = compileExecutionAgentContext({
    guide,
    ...contextOptions,
  });
  const agentPrompt = guide.agent_context.prompt_text;
  return {
    contract_version: "aionis_sdk_agent_context_with_evidence_v1",
    guide,
    compiled_context: compiled,
    agent_context: guide.agent_context,
    agent_prompt: agentPrompt,
    resolved_evidence: [],
    unresolved_memory_ids: [],
    evidence_char_count: 0,
    prompt_char_count: agentPrompt.length,
    guide_trace_id: guide.guide_trace_id,
  };
}

function fakeClient(calls: string[]) {
  return {
    guideAgentContext: async (_input: unknown, _options: unknown, contextOptions: Record<string, unknown>) => {
      calls.push("guideAgentContext");
      return fakeAgentContext(contextOptions);
    },
    snapshot: async (input: unknown) => {
      calls.push(`snapshot:${JSON.stringify(input)}`);
      return {
        contract_version: "aionis_operator_snapshot_v1",
        run_id: "run-1",
        status: "ok",
      };
    },
    execution: {
      guideAgentContextForRole: async (input: unknown, _options: unknown, contextOptions: Record<string, unknown>) => {
        calls.push(`guideAgentContextForRole:${JSON.stringify(input)}`);
        return fakeAgentContext(contextOptions);
      },
    },
  };
}

test("@aionis/aifs parses refresh args and env defaults", () => {
  const options = parseAionisAifsArgs([
    "refresh",
    "--base-url",
    "http://127.0.0.1:3101",
    "--scope",
    "checkout",
    "--query",
    "Continue",
    "--run-id",
    "run-1",
    "--task-signature",
    "checkout",
    "--role",
    "reviewer",
    "--budget-profile",
    "compact",
    "--no-agent-instruction",
    "--no-snapshot",
  ], {
    AIONIS_TENANT_ID: "tenant-a",
  }, "/tmp/project");

  assert.equal(options.baseUrl, "http://127.0.0.1:3101");
  assert.equal(options.tenant_id, "tenant-a");
  assert.equal(options.scope, "checkout");
  assert.equal(options.query_text, "Continue");
  assert.equal(options.run_id, "run-1");
  assert.equal(options.task_signature, "checkout");
  assert.equal(options.role, "reviewer");
  assert.equal(options.budget_profile, "compact");
  assert.equal(options.agent_instruction, false);
  assert.equal(options.snapshot, false);
  assert.equal(options.output_format, "summary");
  assert.equal(options.cwd, "/tmp/project");
});

test("@aionis/aifs parses init, doctor, and json output", () => {
  const initOptions = parseAionisAifsArgs(["init", "--scope", "checkout"], {}, "/tmp/project");
  assert.equal(initOptions.command, "init");
  assert.equal(initOptions.scope, "checkout");

  const doctorOptions = parseAionisAifsArgs(["doctor", "--json"], {}, "/tmp/project");
  assert.equal(doctorOptions.command, "doctor");
  assert.equal(doctorOptions.output_format, "json");
  assert.equal(doctorOptions.agent_instruction, true);
});

test("@aionis/aifs builds governed file mirror from execution guide", async () => {
  const calls: string[] = [];
  const built = await buildAifsFiles({
    options: baseOptions(),
    client: fakeClient(calls),
    now: new Date("2026-06-23T00:00:00.000Z"),
  });

  assert.equal(built.result.guide_trace_id, "guide-1");
  assert.equal(built.result.snapshot_status, "written");
  assert.equal(calls.some((call) => call.startsWith("guideAgentContextForRole:")), true);
  assert.equal(calls.some((call) => call.startsWith("snapshot:")), true);
  assert.deepEqual(built.result.files, [
    "README.md",
    "AGENT_INSTRUCTIONS.md",
    "guide.md",
    "current_active_path.md",
    "inspect_before_use.md",
    "do_not_use.md",
    "rehydrate_needed.md",
    "receipts/latest.json",
    "snapshots/latest.json",
    "manifest.json",
  ]);
  assert.deepEqual(built.result.surface_counts, {
    use_now: 1,
    inspect_before_use: 1,
    do_not_use: 1,
    rehydrate: 1,
  });

  const guide = built.files.find((file) => file.relativePath === "guide.md")?.content ?? "";
  const instructions = built.files.find((file) => file.relativePath === "AGENT_INSTRUCTIONS.md")?.content ?? "";
  const current = built.files.find((file) => file.relativePath === "current_active_path.md")?.content ?? "";
  const blocked = built.files.find((file) => file.relativePath === "do_not_use.md")?.content ?? "";
  const rehydrate = built.files.find((file) => file.relativePath === "rehydrate_needed.md")?.content ?? "";

  assert.match(guide, /AIONIS_CTX/);
  assert.doesNotMatch(guide, /AIONIS_EXECUTION_AGENT_CONTEXT v1/);
  assert.match(instructions, /Aionis Agent Instructions/);
  assert.match(instructions, /current_active_path\.md/);
  assert.match(instructions, /do_not_use\.md/);
  assert.match(current, /src\/checkoutAdapter\.ts/);
  assert.match(blocked, /mem-failed/);
  assert.match(blocked, /src\/fullBundleEnvironment\.ts/);
  assert.match(rehydrate, /mem-rehydrate/);
});

test("@aionis/aifs initializes local file surface", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aionis-aifs-init-"));
  const result = initAifsMirror(baseOptions({ cwd: dir, outDir: ".aionis", scope: "scope-a" }));

  assert.equal(result.out_dir, path.join(dir, ".aionis"));
  assert.deepEqual(result.files, ["README.md", "AGENT_INSTRUCTIONS.md", "config.json"]);
  assert.equal(fs.existsSync(path.join(dir, ".aionis", "README.md")), true);
  assert.equal(fs.existsSync(path.join(dir, ".aionis", "AGENT_INSTRUCTIONS.md")), true);
  assert.equal(fs.existsSync(path.join(dir, ".aionis", "config.json")), true);
  assert.match(fs.readFileSync(path.join(dir, ".aionis", "README.md"), "utf8"), /Configured scope: `scope-a`/);
  assert.match(fs.readFileSync(path.join(dir, ".aionis", "AGENT_INSTRUCTIONS.md"), "utf8"), /not refreshed yet/);
  assert.match(formatInitSummary(result), /Aionis AIFS initialized/);
});

test("@aionis/aifs doctor reports runtime and file checks", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aionis-aifs-doctor-"));
  await refreshAifsMirror({
    options: baseOptions({ cwd: dir, outDir: ".aionis" }),
    client: fakeClient([]),
    now: new Date("2026-06-23T00:00:00.000Z"),
  });

  const result = await doctorAifsMirror({
    options: baseOptions({ cwd: dir, outDir: ".aionis" }),
    client: fakeClient([]),
  });

  assert.equal(result.ok, true);
  assert.equal(result.checks.some((check) => check.name === "runtime_guide" && check.status === "ok"), true);
  assert.equal(result.checks.some((check) => check.name === "generated_files" && check.status === "ok"), true);
  assert.match(formatDoctorSummary(result), /doctor passed/);
});

test("@aionis/aifs doctor fails when Runtime guide fails", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aionis-aifs-doctor-fail-"));
  const result = await doctorAifsMirror({
    options: baseOptions({ cwd: dir, outDir: ".aionis" }),
    client: {
      guideAgentContext: async () => {
        throw new Error("Runtime unavailable");
      },
      snapshot: async () => ({}),
      execution: {
        guideAgentContextForRole: async () => {
          throw new Error("Runtime unavailable");
        },
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.checks.some((check) => check.name === "runtime_guide" && check.status === "fail"), true);
  assert.match(formatDoctorSummary(result), /found issues/);
});

test("@aionis/aifs writes .aionis mirror files", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aionis-aifs-"));
  const result = await refreshAifsMirror({
    options: baseOptions({ cwd: dir, outDir: ".aionis" }),
    client: fakeClient([]),
    now: new Date("2026-06-23T00:00:00.000Z"),
  });

  assert.equal(result.out_dir, path.join(dir, ".aionis"));
  assert.equal(fs.existsSync(path.join(dir, ".aionis", "AGENT_INSTRUCTIONS.md")), true);
  assert.equal(fs.existsSync(path.join(dir, ".aionis", "guide.md")), true);
  assert.equal(fs.existsSync(path.join(dir, ".aionis", "receipts", "latest.json")), true);
  assert.equal(fs.existsSync(path.join(dir, ".aionis", "snapshots", "latest.json")), true);

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, ".aionis", "manifest.json"), "utf8")) as Record<string, unknown>;
  assert.equal(manifest.contract_version, "aionis_aifs_manifest_v1");
  assert.equal(manifest.guide_trace_id, "guide-1");
});

test("@aionis/aifs formats refresh summary", async () => {
  const built = await buildAifsFiles({
    options: baseOptions(),
    client: fakeClient([]),
    now: new Date("2026-06-23T00:00:00.000Z"),
  });
  const summary = formatRefreshSummary(built.result);

  assert.match(summary, /Aionis AIFS refreshed/);
  assert.match(summary, /Guide trace: guide-1/);
  assert.match(summary, /use_now: 1/);
  assert.match(summary, /do_not_use: 1/);
});

test("@aionis/aifs rejects unsafe relative output paths", () => {
  assert.throws(() => writeAifsFiles(".aionis", [{ relativePath: "../bad", content: "bad" }]));
  assert.throws(() => writeAifsFiles(".aionis", [{ relativePath: "/tmp/bad", content: "bad" }]));
});

test("@aionis/aifs detects npm symlink bin as CLI entrypoint", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aionis-aifs-bin-"));
  const targetDir = path.join(dir, "package", "dist");
  const binDir = path.join(dir, ".bin");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });

  const target = path.join(targetDir, "index.js");
  const bin = path.join(binDir, "aionis-aifs");
  fs.writeFileSync(target, "#!/usr/bin/env node\n", "utf8");
  fs.symlinkSync(target, bin);

  assert.equal(isCliEntrypoint(bin, pathToFileURL(target).href), true);
  assert.equal(isCliEntrypoint(path.join(dir, "other-bin"), pathToFileURL(target).href), false);
});
