import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createFeedbackServer, createSessionToken } from './server.js';
import { getDevLogs, readDevState, startDevServer, stopDevServer } from './herdr.js';

export default function (pi: ExtensionAPI) {
  let feedbackServer: ReturnType<typeof createFeedbackServer> | undefined;
  let feedbackToken: string | undefined;
  let feedbackPort: number | undefined;
  const stateFile = path.join(process.cwd(), '.pi/devloop/state.json');

  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
  pi.registerTool({
    name: 'dev_start', label: 'Start dev server', description: 'Start the configured project dev server in a Herdr pane and wait for its ready output.',
    parameters: Type.Object({}),
    async execute() { return result(await startDevServer({ cwd: process.cwd(), stateFile })); },
  });
  pi.registerTool({
    name: 'dev_status', label: 'Dev server status', description: 'Read the saved dev server state and current Herdr pane output.',
    parameters: Type.Object({}),
    async execute() {
      const state = await readDevState(stateFile);
      if (!state || state.status !== 'running') return result(state ?? { status: 'stopped' });
      const logs = await getDevLogs(state, { lines: 40 });
      return result({ ...state, logs });
    },
  });
  pi.registerTool({
    name: 'dev_logs', label: 'Read dev server logs', description: 'Read recent output from the running Herdr dev-server pane.',
    parameters: Type.Object({ lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) }),
    async execute(_id, params) {
      const state = await readDevState(stateFile);
      if (!state || state.status !== 'running') return result({ status: 'stopped' });
      return result({ pane_id: state.pane_id, logs: await getDevLogs(state, { lines: params.lines ?? 80 }) });
    },
  });
  pi.registerTool({
    name: 'dev_stop', label: 'Stop dev server', description: 'Close the Herdr pane created for the dev server.',
    parameters: Type.Object({}),
    async execute() { return result(await stopDevServer(stateFile)); },
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
        await mkdir(path.dirname(stateFile), { recursive: true });
        let state = await readDevState(stateFile) ?? { status: 'stopped' };
        state = { ...state, feedback: { host: '127.0.0.1', port: feedbackPort } };
        await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      }
      ctx.ui.notify(`Feedback endpoint: http://127.0.0.1:${feedbackPort} (token: ${feedbackToken})`, 'info');
    },
  });
  pi.on('before_agent_start', async (_event, _ctx) => {
    try {
      const state = await readDevState(stateFile);
      if (!state?.status || state.status === 'stopped') return;
      return { message: { customType: 'devloop-status', content: `dev server: ${state.status}${state.url ? ` at ${state.url}` : ''}${feedbackPort ? `; feedback endpoint at 127.0.0.1:${feedbackPort}` : ''}`, display: false } };
    } catch { /* status context is best-effort */ }
  });
  pi.on('session_shutdown', async () => {
    await feedbackServer?.close();
    feedbackServer = undefined;
  });
}
