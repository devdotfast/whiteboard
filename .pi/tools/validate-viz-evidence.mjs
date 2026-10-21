#!/usr/bin/env node
import { createHash } from "node:crypto";
// Host-side evidence validation. Reads artifacts; never runs an app or browser.
import { readFile, stat, realpath, mkdir, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
const repo = path.resolve(import.meta.dirname, "../..");
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const sorted = (value) =>
  Array.isArray(value)
    ? value.map(sorted)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sorted(value[key])]),
        )
      : value;
const canonical = (value) => JSON.stringify(sorted(value));
const unique = (values) => new Set(values).size === values.length;
let input = "";
for await (const chunk of process.stdin) input += chunk;
const begin = "<viz-validation-json>";
const end = "</viz-validation-json>";
const start = input.lastIndexOf(begin);
if (start < 0 || input.indexOf(end, start) < 0)
  throw new Error("Missing validator JSON protocol");
const request = JSON.parse(
  input.slice(start + begin.length, input.indexOf(end, start)),
);
const comparisonPolicy = request.comparisonPolicy ?? "exact";
check(["inspired", "exact", "canonical"].includes(comparisonPolicy), "Invalid comparison policy");
// Shared API work is separate from the local graphic verdict. It must be
// resolved before the workflow can accept a pass or finish a stable sweep.
if (
  ["inspection", "final"].includes(request.mode) &&
  typeof request.auditRoot === "string"
) {
  try {
    const notes = await readFile(
      path.resolve(repo, request.auditRoot, "root-api-notes.md"),
      "utf8",
    );
    for (const pending of notes.matchAll(/^## Pending:\s*(.+)$/gm))
      failures.push("Pending shared API improvement: " + pending[1].trim());
  } catch (error) {
    if (error.code !== "ENOENT")
      failures.push("Cannot read shared API work: " + error.message);
  }
}

const verified = [];
const nativeProofs = [];
const byteCache = new Map();
let reportSummary;
async function artifact(
  file,
  { png = false, json = false, fresh = false, root } = {},
) {
  if (typeof file !== "string" || !file) {
    failures.push("Missing artifact path");
    return null;
  }
  try {
    const allowed = root ? await realpath(path.resolve(repo, root)) : null;
    let requested = path.resolve(repo, file);
    try {
      await stat(requested);
    } catch (error) {
      if (error.code !== "ENOENT" || !allowed || path.isAbsolute(file)) throw error;
      requested = path.resolve(allowed, file);
    }
    const absolute = await realpath(requested);
    if (allowed) {
      if (!absolute.startsWith(allowed + path.sep))
        throw new Error("Artifact outside required attempt directory");
    }
    const info = await stat(absolute);
    if (!info.isFile() || info.size === 0)
      throw new Error("Artifact is empty or not a file");
    if (fresh && info.mtimeMs < request.startedAt - 2000)
      throw new Error("Artifact predates this workflow run");
    const cached = byteCache.get(absolute);
    const bytes =
      cached?.mtimeMs === info.mtimeMs && cached?.size === info.size
        ? cached.bytes
        : await readFile(absolute);
    byteCache.set(absolute, { mtimeMs: info.mtimeMs, size: info.size, bytes });
    if (
      png &&
      (bytes.length < 33 ||
        bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
        bytes.toString("ascii", 12, 16) !== "IHDR" ||
        bytes.readUInt32BE(16) < 1 ||
        bytes.readUInt32BE(20) < 1)
    )
      throw new Error("Invalid PNG signature or dimensions");
    let value = null;
    if (json) {
      value = JSON.parse(bytes.toString("utf8"));
      if (
        !value ||
        typeof value !== "object" ||
        Object.keys(value).length === 0
      )
        throw new Error("Empty diagnostic JSON");
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (!verified.some((item) => item.path === absolute))
      verified.push({
        path: absolute,
        bytes: info.size,
        modifiedAt: info.mtimeMs,
        sha256,
      });
    return { absolute, value, modifiedAt: info.mtimeMs, sha256 };
  } catch (error) {
    failures.push(file + ": " + error.message);
    return null;
  }
}
function validateReportShape(value, schema, location = "report") {
  if (schema.enum)
    check(schema.enum.includes(value), location + " has an invalid enum value");
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      failures.push(location + " must be an object");
      return;
    }
    for (const key of schema.required ?? [])
      check(
        Object.hasOwn(value, key),
        location + " is missing required field " + key,
      );
    if (schema.additionalProperties === false)
      for (const key of Object.keys(value))
        check(
          Object.hasOwn(schema.properties, key),
          location + " has unexpected field " + key,
        );
    for (const [key, child] of Object.entries(schema.properties ?? {}))
      if (Object.hasOwn(value, key))
        validateReportShape(value[key], child, location + "." + key);
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) {
      failures.push(location + " must be an array");
      return;
    }
    check(
      value.length >= (schema.minItems ?? 0),
      location + " has too few items",
    );
    value.forEach((item, index) =>
      validateReportShape(item, schema.items, location + "[" + index + "]"),
    );
  } else if (schema.type === "string") {
    check(
      typeof value === "string" &&
        value.trim().length >= (schema.minLength ?? 0),
      location + " must be a nonempty string",
    );
  }
}
function projected(spec) {
  return {
    sourceUrl: spec.sourceUrl,
    checks: spec.checks,
    captures: spec.captures.map(
      ({ key, theme, width, height, motion, interaction }) => ({
        key,
        theme,
        width,
        height,
        motion,
        interaction,
      }),
    ),
    graphics: spec.graphics.map(
      ({ id, title, selector, states, checks = [] }) => ({
        id,
        title,
        selector,
        states: states.map(({ key, label }) => ({ key, label })),
        checks,
      }),
    ),
  };
}
function resultPayloads(value) {
  const out = [];
  function visit(item) {
    if (!item || typeof item !== "object") return;
    out.push(item);
    if (item.structuredContent) visit(item.structuredContent);
    for (const part of item.content ?? []) {
      if (part.type === "text" && typeof part.text === "string") {
        try {
          visit(JSON.parse(part.text));
        } catch {
          /* Plain tool text is valid. */
        }
      }
    }
  }
  visit(value);
  return out;
}
function callFailed(call) {
  return (
    call.isError === true ||
    resultPayloads(call.result).some(
      (payload) =>
        payload.isError === true ||
        payload.error !== undefined ||
        payload.ok === false ||
        payload.success === false,
    )
  );
}
async function nativeAuthorCalls(id = request.authorRunId, verification = false) {
  if (
    typeof id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
  ) {
    failures.push("Missing/invalid native author run UUID");
    return [];
  }
  try {
    const runRoot = path.join(
      tmpdir(),
      `pi-subagents-uid-${process.getuid?.() ?? "user"}`,
      "async-subagent-runs",
      id,
    );
    let statusPath = path.join(runRoot, "status.json");
    let eventsPath = path.join(runRoot, "events.jsonl");
    let statusBytes;
    let foreground = false;
    try {
      statusBytes = await readFile(statusPath);
    } catch (error) {
      if (error.code !== "ENOENT" || verification || !request.foregroundMetadataPath)
        throw error;
      statusPath = await realpath(request.foregroundMetadataPath);
      const sessionRoot = await realpath(path.join(homedir(), ".pi/agent/sessions"));
      if (!statusPath.startsWith(sessionRoot + path.sep) ||
          path.basename(statusPath) !== id + "_viz-author_0_meta.json")
        throw new Error("Foreground metadata is outside the native Pi session artifacts");
      statusBytes = await readFile(statusPath);
      foreground = true;
    }
    let status = JSON.parse(statusBytes.toString("utf8"));
    if (foreground) {
      check(status.runId === id && status.agent === "viz-author" && status.exitCode === 0,
        "Foreground native author did not complete successfully");
      check(typeof request.verificationRunId === "string" && request.verificationRunId !== id,
        "Foreground receipts require independent full native read/open verification");
      eventsPath = await realpath(status.transcriptPath);
      check(path.dirname(eventsPath) === path.dirname(statusPath) &&
          path.basename(eventsPath) === id + "_viz-author_0_transcript.jsonl",
        "Foreground transcript does not belong to the native metadata");
      const records = (await readFile(eventsPath, "utf8")).trim().split("\n").map(JSON.parse);
      check(records.every((record) => record.runId === id && path.resolve(record.cwd) === repo),
        "Foreground transcript identity/checkout mismatch");
      status = { runId: id, state: "complete", cwd: repo,
        startedAt: Math.min(...records.map((record) => record.ts).filter(Number.isFinite)) };
    }
    check(
      status.runId === id && status.state === "complete",
      "Native author run is not complete or has wrong id",
    );
    check(
      (await realpath(status.cwd)) === (await realpath(repo)),
      "Native author run belongs to another checkout",
    );
    check(
      status.startedAt >= request.startedAt - 2000,
      "Native author run predates workflow",
    );
    const bytes = await readFile(eventsPath);
    const starts = new Map();
    const calls = [];
    for (const line of bytes.toString("utf8").split("\n").filter(Boolean)) {
      let event = JSON.parse(line);
      if (!/^mcp__whiteboard__/.test(event.toolName ?? "")) continue;
      if (foreground) {
        if (!["tool_start", "tool_end"].includes(event.recordType)) continue;
        event = { ...event, type: event.sourceEventType,
          subagentRunId: event.runId, observedAt: event.ts,
          args: event.recordType === "tool_start" ? JSON.parse(event.argsPayload) : undefined };
        // Foreground transcripts omit nested results. Keep that absence; the
        // independent native verification below supplies actual read/open results.
      }
      check(
        event.subagentRunId === id,
        "MCP event belongs to another native run",
      );
      if (event.type === "tool_execution_start") {
        check(!starts.has(event.toolCallId), "Duplicate native MCP start id");
        starts.set(event.toolCallId, event);
      } else if (event.type === "tool_execution_end") {
        const start = starts.get(event.toolCallId);
        check(
          Boolean(start) && start.toolName === event.toolName,
          "Native MCP result has no matching request",
        );
        if (start) {
          calls.push({
            toolCallId: event.toolCallId,
            tool: event.toolName,
            arguments: start.args,
            result: event.result,
            isError: event.isError === true,
            startedAt: start.observedAt,
            endedAt: event.observedAt,
          });
          starts.delete(event.toolCallId);
        }
      }
    }
    check(starts.size === 0, "Unfinished native MCP requests");
    nativeProofs.push({
      authorRunId: id,
      statusPath,
      eventsPath,
      statusSha256: createHash("sha256").update(statusBytes).digest("hex"),
      eventsSha256: createHash("sha256").update(bytes).digest("hex"),
      calls,
    });
    if (foreground) {
      const verifiedCalls = await nativeAuthorCalls(request.verificationRunId, true);
      for (const mutation of calls.filter((call) => call.tool.endsWith("__session_edit") && !callFailed(call))) {
        const edit = mutation.arguments?.edit;
        check(edit?.type === "update" && Boolean(edit.changes),
          "Foreground verification currently supports explicit update mutations only");
        const readback = verifiedCalls.filter((call) => call.tool.endsWith("__session_get") &&
            !callFailed(call) && call.arguments?.sessionId === mutation.arguments.sessionId &&
            call.arguments?.targetId === edit?.targetId && call.endedAt >= mutation.endedAt)
          .flatMap((call) => resultPayloads(call.result)).find((value) => value.id === edit?.targetId);
        check(Boolean(readback) && Object.entries(edit?.changes ?? {}).every(([key, value]) =>
            canonical(readback[key]) === canonical(value)),
          "Independent native readback does not match foreground mutation: " + mutation.arguments?.sessionId);
      }
      return [...calls, ...verifiedCalls];
    }
    return calls;
  } catch (error) {
    failures.push("Cannot read native author evidence: " + error.message);
    return [];
  }
}
async function validateAuthor(author, graphic) {
  check(
    author?.status === "authored" &&
      author.boardId &&
      author.boardId !== "unavailable",
    "Author did not identify an authored board",
  );
  const trace = await artifact(author?.artifact, {
    json: true,
    fresh: true,
    root: request.authorRoot,
  });
  const authored = trace?.value;
  check(
    authored?.transport === "mcp" &&
      authored?.boardId === author?.boardId &&
      authored?.graphicId === graphic?.id,
    "MCP author trace identity mismatch",
  );
  check(
    Date.parse(authored?.createdAt) >= request.startedAt - 2000,
    "MCP trace timestamp is stale/missing",
  );
  const calls = await nativeAuthorCalls();
  check(calls.length > 0, "Native author run contains no Whiteboard MCP calls");
  check(
    calls.some(
      (call) =>
        /(?:edit|write|apply|update|set|append|insert)$/i.test(call.tool) &&
        !/session_activity_/.test(call.tool) &&
        !callFailed(call) &&
        call.arguments?.sessionId === author.boardId,
    ),
    "Native author run has no successful content mutation targeting the claimed board",
  );
  check(
    canonical(calls).includes(author?.boardId ?? "\u0000"),
    "Native MCP requests/results never reference authored board id",
  );
  const opened = calls.some((call) => {
    if (!/session_(?:create|open)$/.test(call.tool) || callFailed(call))
      return false;
    return resultPayloads(call.result).some(
      (payload) =>
        (payload.opened === true ||
          (/session_open$/.test(call.tool) && payload.ok === true)) &&
        (call.arguments?.sessionId ?? payload.sessionId) === author.boardId,
    );
  });
  check(
    opened,
    "Native MCP evidence has no successful Desktop open of authored board",
  );
  const failedCalls = calls.filter(callFailed);
  const proof = nativeProofs.find(
    (item) => item.authorRunId === request.authorRunId,
  );
  if (proof) {
    proof.failedCalls = failedCalls;
    proof.toolFailureCount = failedCalls.length;
  }
  for (const call of calls) {
    if (request.mode !== "author")
      check(
        !callFailed(call),
        "Native MCP call failed and needs authoring/API improvement: " +
          call.tool,
      );
    check(
      call.arguments && Object.hasOwn(call, "result"),
      "Incomplete native MCP request/result",
    );
  }
  const states = authored?.states?.map((state) => state.key) ?? [];
  check(
    unique(states) &&
      graphic.states.every((state) => states.includes(state.key)),
    "MCP author trace omits/duplicates semantic states",
  );
}
const manifest = JSON.parse(
  await readFile(path.resolve(repo, request.manifest), "utf8"),
);
check(
  Number.isFinite(request.startedAt) && request.startedAt <= Date.now(),
  "Invalid workflow start time",
);
if (request.mode === "inventory-read") {
  process.stdout.write(
    JSON.stringify({
      pass: failures.length === 0,
      failures,
      inventory: projected(manifest),
    }) + "\n",
  );
  process.exit(0);
} else if (request.mode === "inventory") {
  check(
    canonical(request.inventory) === canonical(projected(manifest)),
    "Inventory differs from the on-disk source manifest",
  );
  const referencesRoot = path.resolve(
    repo,
    request.references ?? ".pi-subagents/visualization-parity/references-v3",
  );
  const cached = await artifact(path.join(referencesRoot, "manifest.json"), {
    json: true,
  });
  const references = cached?.value;
  check(
    references?.captureVersion === 3,
    "Source cache predates real-time source sampling; recapture it before dispatch",
  );
  check(
    references?.sourceUrl === manifest.sourceUrl &&
      references?.complete === true &&
      references?.errors?.length === 0,
    "Complete source corpus has not been captured cleanly",
  );
  for (const graphic of manifest.graphics)
    for (const state of graphic.states)
      for (const variant of manifest.captures) {
        const matches =
          references?.captures?.filter(
            (c) =>
              c.graphicId === graphic.id &&
              c.state === state.key &&
              c.variant === variant.key,
          ) ?? [];
        check(
          matches.length === 1,
          "Missing/duplicate source capture: " +
            [graphic.id, state.key, variant.key].join("/"),
        );
        if (matches.length === 1) {
          check(
            matches[0].observed?.bounds?.width > 0 &&
              matches[0].observed?.bounds?.height > 0,
            "Source capture has empty rendered bounds: " +
              [graphic.id, state.key, variant.key].join("/"),
          );
          const png = await artifact(path.resolve(referencesRoot, matches[0].path), {
            png: true,
            root: referencesRoot,
          });
          check(
            matches[0].observed?.timing?.mode === "real-browser-time" &&
              matches[0].observed?.capture?.pngSha256 === png?.sha256,
            "Source timing/hash provenance is missing or stale: " +
              [graphic.id, state.key, variant.key].join("/"),
          );
        }
      }
} else if (request.mode === "author") {
  const graphic = manifest.graphics.find(
    (item) => item.id === request.graphicId,
  );
  check(Boolean(graphic), "Unknown author graphic id");
  if (graphic) await validateAuthor(request.author, graphic);
} else if (request.mode === "inspection" || request.mode === "final") {
  const referencesRoot = path.resolve(
    repo,
    request.references ?? ".pi-subagents/visualization-parity/references-v3",
  );
  const referenceFile = await artifact(
    path.join(referencesRoot, "manifest.json"),
    { json: true },
  );
  const references = referenceFile?.value;
  check(
    references?.sourceUrl === manifest.sourceUrl,
    "Reference source URL does not match corpus",
  );
  if (request.mode === "final") {
    check(
      references?.complete === true && references?.errors?.length === 0,
      "Complete source corpus has not been captured cleanly",
    );
  }
  const graphics =
    request.mode === "final"
      ? manifest.graphics
      : manifest.graphics.filter((graphic) => graphic.id === request.graphicId);
  check(graphics.length > 0, "Unknown graphic id");
  for (const graphic of graphics)
    for (const state of graphic.states)
      for (const variant of manifest.captures) {
        const matches =
          references?.captures?.filter(
            (capture) =>
              capture.graphicId === graphic.id &&
              capture.state === state.key &&
              capture.variant === variant.key,
          ) ?? [];
        check(
          matches.length === 1,
          "Missing/duplicate source capture: " +
            [graphic.id, state.key, variant.key].join("/"),
        );
        if (matches.length === 1) {
          check(
            Boolean(matches[0].observed?.bounds) &&
              typeof matches[0].observed?.text === "string",
            "Missing source capture observations",
          );
          await artifact(path.resolve(referencesRoot, matches[0].path), {
            png: true,
            root: referencesRoot,
          });
        }
      }
  if (request.mode === "inspection") {
    const graphic = graphics[0];
    const author = request.author;
    // The host owns the required report location. A model can accidentally
    // return its runtime summary path; it cannot redirect acceptance evidence.
    const expectedReportPath =
      typeof request.inspectionRoot === "string"
        ? path.resolve(repo, request.inspectionRoot, ...(request.groupedReports === true ? ["reports", graphic.id] : []), "report.json")
        : undefined;
    const reportFile = await artifact(expectedReportPath, {
      json: true,
      fresh: true,
      root: request.inspectionRoot,
    });
    const report = reportFile?.value;
    const reportSchema = JSON.parse(
      await readFile(
        path.join(repo, ".pi/visualization-report.schema.json"),
        "utf8",
      ),
    );
    validateReportShape(report, reportSchema);
    const rules = [
      ...new Set([...manifest.checks, ...(graphic?.checks ?? [])]),
    ];
    const expectedKeys =
      graphic?.states.flatMap((state) =>
        manifest.captures.map((variant) => state.key + "--" + variant.key),
      ) ?? [];
    const rows = report?.checks ?? [];
    const capturesByKey = new Map(
      (report?.captures ?? []).map((capture) => [capture.key, capture]),
    );
    const rowKeys = rows.map((row) => row.capture + "/" + row.rule);
    check(
      Array.isArray(report?.checks) && unique(rowKeys),
      "Missing or duplicate check rows",
    );
    check(
      rows.length === expectedKeys.length * rules.length,
      "Check row count differs from exhaustive matrix",
    );
    for (const capture of expectedKeys)
      for (const rule of rules)
        check(
          rowKeys.includes(capture + "/" + rule),
          "Missing check: " + capture + "/" + rule,
        );
    for (const row of rows) {
      const capture = capturesByKey.get(row.capture);
      check(
        expectedKeys.includes(row.capture) && rules.includes(row.rule),
        "Unexpected check: " + row.capture + "/" + row.rule,
      );
      check(
        row.result === "pass",
        "Nonpassing check: " + row.capture + "/" + row.rule,
      );
      check(
        Boolean(row.observation?.trim()) &&
          Array.isArray(row.evidence) &&
          (row.rule === "mcp-only-authoring" ||
            row.evidence.includes(capture?.screenshot)) &&
          row.evidence.includes(capture?.diagnostics),
        "Check lacks actual capture evidence: " + row.capture + "/" + row.rule,
      );
      for (const evidence of row.evidence ?? [])
        await artifact(evidence, { fresh: true, root: request.inspectionRoot });
    }
    const findings = report?.findings ?? [];
    check(
      Array.isArray(report?.findings) &&
        unique(findings.map((finding) => finding.id)),
      "Missing findings array or duplicate finding ids",
    );
    for (const finding of findings) {
      check(
        expectedKeys.includes(finding.capture) &&
          rules.includes(finding.rule) &&
          ["authored-misuse", "api-defect", "reference-uncertainty"].includes(
            finding.classification,
          ) &&
          ["blocker", "major", "minor"].includes(finding.severity),
        "Invalid finding identity: " + finding.id,
      );
      check(
        finding.severity !== "blocker" && finding.severity !== "major",
        "Open " + finding.severity + ": " + finding.id,
      );
      check(
        Array.isArray(finding.evidence) &&
          finding.evidence.length > 0 &&
          Boolean(finding.observed?.trim()) &&
          Boolean(finding.expected?.trim()),
        "Incomplete finding: " + finding.id,
      );
      for (const evidence of finding.evidence ?? [])
        await artifact(evidence, { fresh: true, root: request.inspectionRoot });
    }
    check(
      report?.verdict === "pass",
      "Full inspector report verdict is not pass",
    );
    reportSummary = {
      verdict: report?.verdict ?? "fail",
      findings,
      captureCount: report?.captures?.length ?? 0,
      checkCount: rows.length,
      path: reportFile?.absolute ?? expectedReportPath,
      reportedPath: request.reportPath,
    };
    await validateAuthor(author, graphic);
    // Match only long prose lines, not short technical labels or graph data.
    // Reproductions preserve meaning with their own explanatory wording.
    const words = (value) => value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    const sourcePhrases = new Set();
    for (const source of references?.captures ?? []) {
      if (source.graphicId !== graphic.id) continue;
      for (const line of (source.observed?.text ?? "").split("\n")) {
        const tokens = words(line);
        for (let i = 0; i + 26 <= tokens.length; i++)
          sourcePhrases.add(tokens.slice(i, i + 26).join(" "));
      }
    }
    const latestAuthorMutationAt = Math.max(
      request.startedAt,
      ...nativeProofs.flatMap((proof) => proof.calls ?? [])
        .filter((call) =>
          call.arguments?.sessionId === author.boardId && !callFailed(call) &&
          /(?:edit|write|apply|update|set|append|insert)$/i.test(call.tool) &&
          !/session_activity_/.test(call.tool),
        )
        .map((call) => call.endedAt)
        .filter(Number.isFinite),
    );
    const finalPayloads = new Map();
    for (const call of nativeProofs.flatMap((proof) => proof.calls ?? [])) {
      if (call.arguments?.sessionId !== author.boardId || callFailed(call))
        continue;
      if (call.tool.endsWith("__session_get")) {
        for (const value of resultPayloads(call.result)) {
          if (value.sessionId === author.boardId && Array.isArray(value.document)) {
            for (const component of value.document)
              if (component?.id) finalPayloads.set(component.id, component);
            continue;
          }
          const targetId = call.arguments?.targetId;
          if (
            targetId &&
            value?.id === targetId &&
            typeof value.type === "string"
          )
            finalPayloads.set(targetId, value);
        }
      }
      const edit = call.arguments?.edit;
      if (!edit) continue;
      const id =
        edit.targetId ??
        resultPayloads(call.result).find((value) => value.targetId)?.targetId ??
        edit.content?.type;
      if (edit.type === "remove") {
        finalPayloads.delete(id);
        continue;
      }
      const payload = edit.content ?? edit.changes;
      if (!payload) continue;
      finalPayloads.set(
        id,
        edit.type === "update"
          ? { ...finalPayloads.get(id), ...payload }
          : payload,
      );
    }
    const authoredAnimationTitles = new Set(
      [...finalPayloads.values()]
        .filter((payload) => Array.isArray(payload.frames) && typeof payload.html === "string")
        .map((payload) => payload.title)
        .filter((title) => typeof title === "string" && title.length > 0),
    );
    check(authoredAnimationTitles.size > 0, "Native author payload has no identifiable animation title");
    const authoredFrameKeys = new Set(
      [...finalPayloads.values()].flatMap((payload) =>
        (payload.frames ?? []).map((frame) => frame.key),
      ),
    );
    const copiesSourceProse = (value) => {
      const tokens = words(value);
      for (let i = 0; i + 26 <= tokens.length; i++)
        if (sourcePhrases.has(tokens.slice(i, i + 26).join(" "))) return true;
      return false;
    };
    const copiedProse = [...finalPayloads.values()].some((payload) =>
      copiesSourceProse(JSON.stringify(payload).replace(/<[^>]*>/g, " ")),
    );
    check(
      !copiedProse,
      "Authored explanatory prose copies a long source passage; preserve technical facts but paraphrase the explanation in a fresh MCP attempt",
    );
    const expected = graphic.states.flatMap((state) =>
      manifest.captures.map((variant) => ({
        key: state.key + "--" + variant.key,
        state: state.key,
        variant,
      })),
    );
    const captures = report?.captures ?? [];
    check(
      captures.length === expected.length &&
        unique(captures.map((capture) => capture.key)),
      "Inspection capture matrix is missing/duplicated",
    );
    const physical = [];
    for (const target of expected) {
      const capture = captures.find((item) => item.key === target.key);
      if (!capture) {
        failures.push("Missing inspection capture: " + target.key);
        continue;
      }
      const png = await artifact(capture.screenshot, {
        png: true,
        fresh: true,
        root: request.inspectionRoot,
      });
      const json = await artifact(capture.diagnostics, {
        json: true,
        fresh: true,
        root: request.inspectionRoot,
      });
      if (png) physical.push(png.absolute);
      if (json) physical.push(json.absolute);
      const diagnostic = json?.value;
      check(
        diagnostic?.graphicId === graphic.id &&
          diagnostic?.state === target.state &&
          diagnostic?.variant === target.variant.key &&
          diagnostic?.boardId === author.boardId,
        "Diagnostic identity mismatch: " + target.key,
      );
      if (request.comparisonPolicy !== undefined) {
        const semanticVariant = comparisonPolicy === "canonical" &&
          target.variant.motion !== "reduce" && graphic.states.length > 1
          ? "light-wide" : target.variant.key;
        check(
          diagnostic?.comparisonPolicy === comparisonPolicy &&
            diagnostic?.semanticSourceVariant === semanticVariant,
          "Diagnostic playback comparison policy/source mismatch: " + target.key,
        );
      }
      check(
        Date.parse(diagnostic?.capturedAt) >= request.startedAt - 2000,
        "Diagnostic missing/stale capture time: " + target.key,
      );
      check(
        diagnostic?.theme === target.variant.theme &&
          diagnostic?.motion === target.variant.motion,
        "Diagnostic theme/motion mismatch: " + target.key,
      );
      const shot = diagnostic?.shot;
      check(
        Date.parse(shot?.capturedAt) >= request.startedAt - 2000,
        "Raw helper capture timestamp is stale/missing: " + target.key,
      );
      check(
        shot?.media?.reducedMotion === (target.variant.motion === "reduce"),
        "Actual reduced-motion media mismatch: " + target.key,
      );
      const classes = shot?.media?.themeClasses ?? "";
      check(
        target.variant.theme === "dark"
          ? /(?:vs-dark|hc-black)/.test(classes)
          : /(?:^|\s)vs(?:\s|$)|hc-light/.test(classes),
        "Actual workbench theme mismatch: " + target.key,
      );
      check(
        Array.isArray(shot?.captures) &&
          shot.captures.length > 0 &&
          Array.isArray(shot.consoleErrors),
        "Missing raw desktop shot diagnostics: " + target.key,
      );
      check(
        shot?.consoleErrors?.length === 0,
        "Console errors recorded: " + target.key,
      );
      const matching = shot?.captures?.find(
        (item) => path.resolve(repo, item.file ?? "") === png?.absolute,
      );
      check(
        Date.parse(matching?.capturedAt) >= latestAuthorMutationAt &&
          Date.parse(shot?.capturedAt) >= latestAuthorMutationAt,
        "Capture predates this attempt's latest native MCP mutation: " + target.key,
      );
      check(
        Boolean(matching?.diagnostic?.bounds) &&
          Array.isArray(matching?.diagnostic?.text),
        "PNG does not match raw desktop diagnostic: " + target.key,
      );
      check(
        typeof matching?.pngSha256 === "string" &&
          matching.pngSha256 === png?.sha256,
        "PNG bytes differ from captured raw diagnostic (recapture or stale wrapper): " +
          target.key,
      );
      const authoredFrames = (matching?.frames ?? []).filter(
        (frame) => authoredAnimationTitles.has(frame.title),
      );
      check(
        authoredFrames.length > 0,
        "Actual animation identity differs from native authored payload: " + target.key,
      );
      // A broad text selector can click the graphic title rather than its step.
      // When native payload keys name this semantic state, require the same
      // live SDK frame in the exact capture; filenames alone are not proof.
      if (authoredFrameKeys.has(target.state))
        check(
          authoredFrames.some(
            (frame) => frame.document?.stageFrameKey === target.state,
          ),
          "Actual SDK frame differs from requested semantic state: " + target.key,
        );
      const renderedText = [
        ...(matching?.diagnostic?.text ?? []),
        ...(matching?.frames ?? []).flatMap(
          (frame) => frame.surface?.text ?? [],
        ),
      ]
        .map((item) => item.text ?? "")
        .join(" ");
      check(
        !renderedText.includes("The animation reported an error:"),
        "Visible animation runtime error (including errors before console attachment): " +
          target.key,
      );
      check(
        !copiesSourceProse(renderedText),
        "Rendered explanatory prose copies a long source passage: " +
          target.key,
      );
      const viewport = shot?.viewport ?? matching?.diagnostic?.viewport;
      check(
        viewport?.[0] === target.variant.width &&
          viewport?.[1] === target.variant.height,
        "Captured viewport differs from requested matrix: " + target.key,
      );
      check(
        matching?.diagnostic?.truncated === false,
        "Truncated desktop diagnostics: " + target.key,
      );
      for (const interaction of diagnostic?.interactions ?? []) {
        await artifact(interaction.evidence, {
          png: /\.png$/i.test(interaction.evidence ?? ""),
          json: /\.json$/i.test(interaction.evidence ?? ""),
          fresh: true,
          root: request.inspectionRoot,
        });
      }
      check(
        Array.isArray(diagnostic?.interactions) &&
          (graphic.states.length > 1
            ? ["jump", "back", "replay", "keyboard", "hover"]
            : ["keyboard", "hover"]
          ).every((action) =>
            diagnostic.interactions.some(
              (item) => item.action === action && item.evidence,
            ),
          ),
        "Missing interaction evidence: " + target.key,
      );
    }
    check(
      unique(physical),
      "Multiple capture keys reuse the same physical artifact",
    );
  }
} else failures.push("Unknown validation mode");
const auditPath = path.resolve(repo, request.auditPath ?? "");
const auditRoot = path.resolve(repo, request.auditRoot ?? "");
const allowedBase = path.join(repo, ".pi-subagents", "visualization-parity");
if (
  !request.auditPath ||
  !request.auditRoot ||
  !auditRoot.startsWith(allowedBase + path.sep) ||
  !auditPath.startsWith(path.join(auditRoot, "validation") + path.sep) ||
  !auditPath.endsWith(".json")
)
  throw new Error(
    "Validation audit must be inside this workflow run's validation directory",
  );
await mkdir(path.dirname(auditPath), { recursive: true, mode: 0o700 });
const physicalRoot = await realpath(auditRoot);
const physicalParent = await realpath(path.dirname(auditPath));
const physicalBase = await realpath(allowedBase);
if (
  !physicalRoot.startsWith(physicalBase + path.sep) ||
  !physicalParent.startsWith(physicalRoot + path.sep)
)
  throw new Error("Validation audit containment failed");
await writeFile(
  auditPath,
  JSON.stringify(
    {
      mode: request.mode,
      comparisonPolicy,
      pass: failures.length === 0,
      failures,
      report: reportSummary,
      verified,
      nativeProofs,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
const preview = (value) =>
  typeof value === "string" ? value.slice(0, 220) : value;
const compactReport = reportSummary
  ? {
      ...reportSummary,
      findingCount: reportSummary.findings?.length ?? 0,
      findings: (reportSummary.findings ?? []).slice(0, 10).map((finding) => ({
        id: preview(finding.id),
        severity: finding.severity,
        classification: finding.classification,
        capture: preview(finding.capture),
        rule: preview(finding.rule),
        observed: preview(finding.observed),
        expected: preview(finding.expected),
      })),
    }
  : undefined;
process.stdout.write(
  JSON.stringify({
    pass: failures.length === 0,
    failureCount: failures.length,
    failures: failures.slice(0, 20).map(preview),
    auditPath,
    report: compactReport,
    verifiedCount: verified.length,
    toolFailureCount: nativeProofs.reduce(
      (count, proof) => count + (proof.toolFailureCount ?? 0),
      0,
    ),
    toolFailurePreview: nativeProofs
      .flatMap((proof) => proof.failedCalls ?? [])
      .slice(0, 5)
      .map((call) => ({
        tool: preview(call.tool),
        toolCallId: preview(call.toolCallId),
      })),
  }) + "\n",
);
