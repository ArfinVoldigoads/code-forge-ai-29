import { tool } from "ai";
import { z } from "zod";
import type { Sandbox } from "e2b";
import { db } from "@/lib/db.server";
import { getSandboxForChat, resolvePath, WORKDIR } from "@/lib/e2b.server";
import type { Json, StreamEvent } from "@/lib/types";

type Ctx = {
  chatId: string;
  apiKey: string;
  send: (event: StreamEvent) => void;
  record: (event: StreamEvent) => void;
};

const MAX_OUT = 8000;
const clip = (text: string) => (text.length > MAX_OUT ? `${text.slice(0, MAX_OUT)}\n…truncated` : text);

export function buildAgentTools(ctx: Ctx) {
  let session: { sandbox: Sandbox; sessionId: string } | null = null;

  const sandbox = async () => {
    if (!session) session = await getSandboxForChat(ctx.chatId, ctx.apiKey);
    return session;
  };

  const logExecution = async (
    name: string,
    input: Json,
    started: number,
    output: Json,
    error?: string,
  ) => {
    await db.from("tool_executions").insert({
      chat_id: ctx.chatId,
      tool_name: name,
      input: input as never,
      output: output as never,
      status: error ? "error" : "done",
      error: error ?? null,
      duration_ms: Date.now() - started,
    } as never);
  };

  const run = async <T extends Json>(
    name: string,
    input: Json,
    fn: (toolId: string) => Promise<T>,
  ): Promise<Json> => {
    const id = crypto.randomUUID();
    const started = Date.now();
    const startEvent: StreamEvent = { type: "tool-start", id, name, input };
    ctx.send(startEvent);
    ctx.record(startEvent);
    try {
      const output = await fn(id);
      const done: StreamEvent = { type: "tool-result", id, output };
      ctx.send(done);
      ctx.record(done);
      await logExecution(name, input, started, output);
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed: StreamEvent = { type: "tool-result", id, output: null, error: message };
      ctx.send(failed);
      ctx.record(failed);
      await logExecution(name, input, started, null, message);
      return { error: message };
    }
  };

  return {
    write_file: tool({
      description: `Create or overwrite a file in the sandbox project (${WORKDIR}). Use relative paths.`,
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) =>
        run("write_file", { path }, async () => {
          const { sandbox: sbx } = await sandbox();
          await sbx.files.write(resolvePath(path), content);
          const change: StreamEvent = { type: "file-change", path, action: "write" };
          ctx.send(change);
          ctx.record(change);
          return { path, bytes: content.length };
        }),
    }),

    read_file: tool({
      description: "Read a file from the sandbox project.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) =>
        run("read_file", { path }, async () => {
          const { sandbox: sbx } = await sandbox();
          const content = await sbx.files.read(resolvePath(path));
          return { path, content: clip(content) };
        }),
    }),

    list_files: tool({
      description: "List files in a sandbox directory (defaults to the project root).",
      inputSchema: z.object({ path: z.string().optional() }),
      execute: async ({ path }) =>
        run("list_files", { path: path ?? "." }, async () => {
          const { sandbox: sbx } = await sandbox();
          const entries = await sbx.files.list(resolvePath(path ?? "."));
          return {
            entries: entries.map((e) => ({ name: e.name, type: e.type ?? "file" })),
          };
        }),
    }),

    run_command: tool({
      description:
        "Run a shell command inside the sandbox project directory. Use this to install packages, build, or run tests.",
      inputSchema: z.object({ command: z.string(), timeoutSeconds: z.number().optional() }),
      execute: async ({ command, timeoutSeconds }) =>
        run("run_command", { command }, async (toolId) => {
          const { sandbox: sbx, sessionId } = await sandbox();
          let stdout = "";
          let stderr = "";
          const { shellCommand } = await import("@/lib/e2b.server");
          const result = await sbx.commands.run(shellCommand(command), {
            cwd: WORKDIR,
            timeoutMs: Math.min((timeoutSeconds ?? 120) * 1000, 300_000),
            onStdout: (text: string) => {
              stdout += text;
              ctx.send({ type: "command-output", id: toolId, stream: "stdout", text });
              ctx.record({ type: "command-output", id: toolId, stream: "stdout", text });
            },
            onStderr: (text: string) => {
              stderr += text;
              ctx.send({ type: "command-output", id: toolId, stream: "stderr", text });
              ctx.record({ type: "command-output", id: toolId, stream: "stderr", text });
            },
          });
          await db.from("command_outputs").insert({
            sandbox_session_id: sessionId || null,
            command,
            stdout: clip(stdout),
            stderr: clip(stderr),
            exit_code: result.exitCode,
          } as never);
          return { exitCode: result.exitCode, stdout: clip(stdout), stderr: clip(stderr) };
        }),
    }),
  };
}
