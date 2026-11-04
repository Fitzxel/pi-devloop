import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createFeedbackServer, createSessionToken } from './server.js';
import { getDevLogs, readDevState, startDevServer, stopDevServer } from './herdr.js';
import { getProjectConfig, parseSettingArgs, setProjectConfig } from './project-config.js';
import { createChromeDevTools } from './chrome-devtools.js';

type OperationParams = { lines?: number };
type Operation = (cwd: string, params?: OperationParams) => Promise<unknown>;

function createOperations(): Record<string, Operation> {
  return {
    start: async (cwd) => startDevServer({ cwd, stateFile: path.join(cwd, '.pi/devloop/state.json') }),
    status: async (cwd) => {
      const state = await readDevState(path.join(cwd, '.pi/devloop/state.json'));
      if (!state || state.status !== 'running') return state ?? { status: 'stopped' };
      return { ...state, logs: await getDevLogs(state, { cwd, lines: 40 }) };
    },
    logs: async (cwd, params) => {
      const state = await readDevState(path.join(cwd, '.pi/devloop/state.json'));
      if (!state || state.status !== 'running') return { status: 'stopped' };
      return { pane_id: state.pane_id, logs: await getDevLogs(state, { cwd, lines: params?.lines ?? 80 }) };
    },
    stop: async (cwd) => stopDevServer(path.join(cwd, '.pi/devloop/state.json'), { cwd }),
  };
}

function asToolResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

async function runCommand(ctx: ExtensionContext, action: Operation, params?: OperationParams) {
  try {
    const output = await action(ctx.cwd, params);
    ctx.ui.notify(JSON.stringify(output, null, 2), 'info');
  } catch (error) {
    ctx.ui.notify(`devloop: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

export default function (pi: ExtensionAPI) {
  let feedbackServer: ReturnType<typeof createFeedbackServer> | undefined;
  let feedbackToken: string | undefined;
  let feedbackPort: number | undefined;
  const operations = createOperations();
  const browser = createChromeDevTools(pi);

  const tools = [
    { name: 'dev_start', label: 'Start dev server', description: 'Start the configured project dev server in a Herdr pane and wait for its ready output.', operation: 'start', parameters: Type.Object({}) },
    { name: 'dev_status', label: 'Dev server status', description: 'Read the saved dev server state and current Herdr pane output.', operation: 'status', parameters: Type.Object({}) },
    { name: 'dev_logs', label: 'Read dev server logs', description: 'Read recent output from the Herdr dev-server pane.', operation: 'logs', parameters: Type.Object({ lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) }) },
    { name: 'dev_stop', label: 'Stop dev server', description: 'Close the Herdr pane created for the dev server.', operation: 'stop', parameters: Type.Object({}) },
  ] as const;
  for (const tool of tools) {
    pi.registerTool({
      name: tool.name, label: tool.label, description: tool.description, parameters: tool.parameters,
      async execute(_id, params, _signal, _onUpdate, ctx) {
        return asToolResult(await operations[tool.operation](ctx.cwd, params as OperationParams));
      },
    });
  }
  pi.registerTool({
    name: 'browser_connect', label: 'Connect Chrome DevTools', description: 'On demand, register Chrome DevTools MCP. Managed mode launches an isolated Chrome profile on the first browser-tool call; attach mode uses configured browserUrl. Use its MCP tools for navigation and inspection.',
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) { return asToolResult(await browser.connect(ctx.cwd)); },
  });
  pi.registerTool({
    name: 'browser_status', label: 'Chrome MCP status', description: 'Report whether Chrome DevTools MCP is registered in managed or attach mode; registration does not guarantee Chrome has launched yet.',
    parameters: Type.Object({}),
    async execute() { return asToolResult(browser.status()); },
  });
  pi.registerTool({
    name: 'browser_disconnect', label: 'Disconnect Chrome DevTools', description: 'Unregister Chrome DevTools MCP. This closes an MCP-launched browser; an attached existing Chrome remains open.',
    parameters: Type.Object({}),
    async execute() { return asToolResult(browser.disconnect()); },
  });

  const commands: Array<{ name: string; description: string; operation: keyof typeof operations; parse?: (args: string) => OperationParams }> = [
    { name: 'devloop:start', description: 'Start the project dev server in Herdr', operation: 'start' },
    { name: 'devloop:stop', description: 'Stop the project dev server', operation: 'stop' },
    { name: 'devloop:status', description: 'Show project dev server status and recent output', operation: 'status' },
    { name: 'devloop:logs', description: 'Show recent project dev-server logs; optionally pass a line count', operation: 'logs', parse: (args) => {
      if (!args.trim()) return {};
      if (!/^\d+$/.test(args.trim())) throw new Error('Usage: /devloop:logs [line-count]');
      return { lines: Number(args.trim()) };
    } },
  ];
  for (const command of commands) {
    pi.registerCommand(command.name, {
      description: command.description,
      handler: async (args, ctx) => {
        try {
          const params = command.parse?.(args) ?? {};
          await runCommand(ctx, operations[command.operation], params);
        } catch (error) {
          ctx.ui.notify(`devloop: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
      },
    });
  }

  pi.registerCommand('devloop:browser', {
    description: 'Register Chrome DevTools MCP on demand; managed mode launches isolated Chrome on first browser-tool use unless browserUrl is configured',
    handler: async (_args, ctx) => {
      try {
        const state = await browser.connect(ctx.cwd);
        const target = state.mode === 'managed'
          ? 'the isolated Chrome profile will launch on the first browser-tool call'
          : `the existing browser at ${state.browserUrl} will be attached on the first browser-tool call`;
        ctx.ui.notify(`Chrome DevTools MCP registered in ${state.mode} mode; ${target}. Use its MCP tools to navigate and inspect pages; check /mcp for connection details.`, 'info');
      } catch (error) { ctx.ui.notify(`devloop: ${error instanceof Error ? error.message : String(error)}`, 'error'); }
    },
  });
  pi.registerCommand('devloop:browser-status', {
    description: 'Show whether Chrome DevTools MCP is registered and its managed or attach mode',
    handler: async (_args, ctx) => ctx.ui.notify(JSON.stringify(browser.status(), null, 2), 'info'),
  });
  pi.registerCommand('devloop:browser-stop', {
    description: 'Disconnect Chrome DevTools MCP; closes its managed browser but leaves an attached existing Chrome open',
    handler: async (_args, ctx) => ctx.ui.notify(JSON.stringify(browser.disconnect(), null, 2), 'info'),
  });

  pi.registerCommand('devloop:config', {
    description: 'Show effective devloop settings for the current project',
    handler: async (_args, ctx) => {
      try { ctx.ui.notify(JSON.stringify(await getProjectConfig(ctx.cwd), null, 2), 'info'); }
      catch (error) { ctx.ui.notify(`devloop: ${error instanceof Error ? error.message : String(error)}`, 'error'); }
    },
  });
  pi.registerCommand('devloop:set', {
    description: 'Set or clear current project dev-server and browser connection settings',
    handler: async (args, ctx) => {
      try {
        const { key, value } = parseSettingArgs(args);
        const config = await setProjectConfig(ctx.cwd, key, value);
        ctx.ui.notify(`${key} ${value === undefined ? 'cleared' : 'updated'}.\n${JSON.stringify(config, null, 2)}`, 'info');
      } catch (error) { ctx.ui.notify(`devloop: ${error instanceof Error ? error.message : String(error)}`, 'error'); }
    },
  });

  pi.registerCommand('devloop', {
    description: 'Start the local selection feedback endpoint and show its token',
    handler: async (_args, ctx) => {
      if (!feedbackServer) {
        feedbackToken = createSessionToken();
        feedbackServer = createFeedbackServer({ token: feedbackToken, onSelection: async (selection) => {
          pi.sendUserMessage(`Browser selection:\n${JSON.stringify(selection, null, 2)}`, { triggerTurn: true });
        } });
        const address = await feedbackServer.listen();
        feedbackPort = address.port;
        const stateFile = path.join(ctx.cwd, '.pi/devloop/state.json');
        await mkdir(path.dirname(stateFile), { recursive: true });
        const state = await readDevState(stateFile) ?? { status: 'stopped' };
        await writeFile(stateFile, `${JSON.stringify({ ...state, feedback: { host: '127.0.0.1', port: feedbackPort } }, null, 2)}\n`, { mode: 0o600 });
      }
      ctx.ui.notify(`Feedback endpoint: http://127.0.0.1:${feedbackPort} (token: ${feedbackToken})`, 'info');
    },
  });
  pi.on('before_agent_start', async (_event, ctx) => {
    try {
      const state = await readDevState(path.join(ctx.cwd, '.pi/devloop/state.json'));
      if (!state?.status || state.status === 'stopped') return;
      return { message: { customType: 'devloop-status', content: `dev server: ${state.status}${state.url ? ` at ${state.url}` : ''}${feedbackPort ? `; feedback endpoint at 127.0.0.1:${feedbackPort}` : ''}`, display: false } };
    } catch { /* status context is best-effort */ }
  });
  pi.on('session_shutdown', async () => {
    await feedbackServer?.close();
    feedbackServer = undefined;
  });
}
