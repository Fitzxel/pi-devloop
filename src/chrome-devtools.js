import { getProjectConfig } from './project-config.js';

export const MCP_SERVER_NAME = 'pi-devloop-chrome';
export const DEFAULT_BROWSER_URL = 'http://127.0.0.1:9222';

export function createChromeDevToolsConfig(cwd, browserUrl = DEFAULT_BROWSER_URL) {
  const endpoint = validateBrowserUrl(browserUrl);
  return {
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest', `--browser-url=${endpoint}`],
    cwd,
    exposure: 'direct',
    description: 'Inspect and control the project browser through Chrome DevTools MCP.',
  };
}

export function createChromeDevTools(pi) {
  let registrationPromise;
  let ownedExtensionPath = null;
  const isOwned = (server) => Boolean(ownedExtensionPath && server?.extensionPath === ownedExtensionPath);
  return {
    connect(cwd) {
      if (registrationPromise) return registrationPromise;
      registrationPromise = register(cwd).finally(() => { registrationPromise = undefined; });
      return registrationPromise;
    },
    status() {
      const registered = pi.getMcpServers().find((server) => server.name === MCP_SERVER_NAME);
      if (!registered) {
        ownedExtensionPath = null;
        return { registered: false, owned: false, serverName: MCP_SERVER_NAME, browserUrl: null };
      }
      const owned = isOwned(registered);
      if (!owned) ownedExtensionPath = null;
      const browserUrl = registered.config.args?.find((argument) => argument.startsWith('--browser-url='))?.slice('--browser-url='.length) ?? null;
      return { registered: true, owned, serverName: MCP_SERVER_NAME, browserUrl };
    },
    disconnect() {
      const registered = pi.getMcpServers().find((server) => server.name === MCP_SERVER_NAME);
      const owned = isOwned(registered);
      if (!owned) {
        ownedExtensionPath = null;
        return { registered: Boolean(registered), owned: false, serverName: MCP_SERVER_NAME, disconnected: false };
      }
      pi.unregisterMcpServer(MCP_SERVER_NAME);
      ownedExtensionPath = null;
      return { registered: false, owned: false, serverName: MCP_SERVER_NAME, disconnected: true };
    },
  };

  async function register(cwd) {
    const { browserUrl } = await getProjectConfig(cwd);
    const config = createChromeDevToolsConfig(cwd, browserUrl);
    const previous = pi.getMcpServers().find((server) => server.name === MCP_SERVER_NAME);
    if (previous && !isOwned(previous)) {
      throw new Error(`MCP server name "${MCP_SERVER_NAME}" is already registered by another extension (${previous.extensionPath}).`);
    }
    const alreadyRegistered = previous && hasSameConfig(previous.config, config);
    if (!alreadyRegistered) pi.registerMcpServer(MCP_SERVER_NAME, config);
    const current = pi.getMcpServers().find((server) => server.name === MCP_SERVER_NAME);
    if (!current?.extensionPath) throw new Error(`Could not confirm ownership of MCP server "${MCP_SERVER_NAME}" after registration.`);
    ownedExtensionPath = current.extensionPath;
    return { registered: true, owned: true, serverName: MCP_SERVER_NAME, browserUrl, alreadyRegistered: Boolean(alreadyRegistered) };
  }
}

function hasSameConfig(previous, next) {
  return previous.command === next.command && previous.cwd === next.cwd &&
    JSON.stringify(previous.args ?? []) === JSON.stringify(next.args ?? []) &&
    (previous.exposure ?? 'codemode') === next.exposure && previous.description === next.description;
}

function validateBrowserUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('browserUrl must be an http or https URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.host) throw new Error('browserUrl must be an http or https URL');
  if (parsed.username || parsed.password) throw new Error('browserUrl must not include credentials');
  return value;
}
