import { getProjectConfig } from './project-config.js';

export const MCP_SERVER_NAME = 'pi-devloop-chrome';
export function createChromeDevToolsConfig(cwd, browserUrl = null) {
  const args = ['-y', 'chrome-devtools-mcp@latest'];
  if (browserUrl == null) args.push('--isolated');
  else args.push(`--browser-url=${validateBrowserUrl(browserUrl)}`);
  return {
    command: 'npx',
    args,
    cwd,
    exposure: 'direct',
    description: 'Inspect and control the project browser through Chrome DevTools MCP.',
  };
}

export function createChromeDevTools(pi, launcher) {
  let registrationPromise;
  let ownedExtensionPath = null;
  const isOwned = (server) => Boolean(ownedExtensionPath && server?.extensionPath === ownedExtensionPath);

  return {
    async openReady(cwd, url, extensionConfig) {
      const existing = this.status();
      if (existing.registered && !existing.owned) {
        throw new Error(`MCP server "${MCP_SERVER_NAME}" is registered by another extension; refusing to open the browser.`);
      }
      const { browserUrl } = await getProjectConfig(cwd);
      const opened = browserUrl
        ? await launcher.openConfigured(browserUrl, url)
        : await launcher.open(url, extensionConfig);
      try {
        const connected = await registerSerially(cwd, opened.browserUrl);
        if (!opened.owned && launcher?.owned && launcher.endpoint !== opened.browserUrl) await launcher.close();
        return { ...connected, browserUrl: opened.browserUrl, mode: opened.owned ? 'managed' : 'attach', browserOwned: opened.owned };
      } catch (error) {
        if (opened.owned) await launcher.close();
        throw error;
      }
    },

    connect(cwd, browserUrlOverride) {
      return registerSerially(cwd, browserUrlOverride);
    },

    status() {
      const registered = pi.getMcpServers().find((server) => server.name === MCP_SERVER_NAME);
      if (!registered) {
        ownedExtensionPath = null;
        return { registered: false, owned: false, serverName: MCP_SERVER_NAME, browserUrl: null, mode: null };
      }
      const owned = isOwned(registered);
      if (!owned) ownedExtensionPath = null;
      const browserUrl = registered.config.args?.find((argument) => argument.startsWith('--browser-url='))?.slice('--browser-url='.length) ?? null;
      const mode = owned && launcher?.owned && launcher.endpoint === browserUrl ? 'managed' : browserUrl ? 'attach' : 'managed';
      return { registered: true, owned, serverName: MCP_SERVER_NAME, browserUrl, mode };
    },

    async disconnect() {
      const registered = pi.getMcpServers().find((server) => server.name === MCP_SERVER_NAME);
      const owned = isOwned(registered);
      if (!owned) {
        ownedExtensionPath = null;
        if (!registered && launcher?.owned) {
          const browserClosed = await launcher.close();
          return { registered: false, owned: false, serverName: MCP_SERVER_NAME, disconnected: false, ...(browserClosed ? { browserClosed: true } : {}) };
        }
        return { registered: Boolean(registered), owned: false, serverName: MCP_SERVER_NAME, disconnected: false };
      }
      await pi.unregisterMcpServer(MCP_SERVER_NAME);
      ownedExtensionPath = null;
      const browserClosed = await launcher?.close() ?? false;
      return { registered: false, owned: false, serverName: MCP_SERVER_NAME, disconnected: true, ...(browserClosed ? { browserClosed: true } : {}) };
    },
  };

  function registerSerially(cwd, browserUrlOverride) {
    const previous = registrationPromise;
    const pending = (previous?.catch(() => {}) ?? Promise.resolve())
      .then(() => register(cwd, browserUrlOverride));
    registrationPromise = pending;
    return pending.finally(() => { if (registrationPromise === pending) registrationPromise = undefined; });
  }

  async function register(cwd, browserUrlOverride) {
    const { browserUrl: configuredUrl } = await getProjectConfig(cwd);
    const browserUrl = browserUrlOverride ?? configuredUrl ?? launcher?.endpoint ?? null;
    const config = createChromeDevToolsConfig(cwd, browserUrl);
    const previous = pi.getMcpServers().find((server) => server.name === MCP_SERVER_NAME);
    if (previous && !isOwned(previous)) {
      throw new Error(`MCP server name "${MCP_SERVER_NAME}" is already registered by another extension (${previous.extensionPath}).`);
    }
    const alreadyRegistered = previous && hasSameConfig(previous.config, config);
    if (!alreadyRegistered) {
      if (previous && isOwned(previous)) {
        await pi.unregisterMcpServer(MCP_SERVER_NAME);
        ownedExtensionPath = null;
      }
      pi.registerMcpServer(MCP_SERVER_NAME, config);
    }
    const current = pi.getMcpServers().find((server) => server.name === MCP_SERVER_NAME);
    if (!current?.extensionPath) throw new Error(`Could not confirm ownership of MCP server "${MCP_SERVER_NAME}" after registration.`);
    ownedExtensionPath = current.extensionPath;
    const mode = launcher?.owned && launcher.endpoint === browserUrl ? 'managed' : browserUrl ? 'attach' : 'managed';
    return { registered: true, owned: true, serverName: MCP_SERVER_NAME, browserUrl, mode, alreadyRegistered: Boolean(alreadyRegistered) };
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
