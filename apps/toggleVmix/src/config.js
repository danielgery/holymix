const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  api: {
    host: '0.0.0.0',
    port: 5000,
  },
  routes: [
    { holyricsTriggerUrl: '/holyrics/project', vmixUrl: 'http://127.0.0.1/vmix/vmix-1' },
    { holyricsTriggerUrl: '/holyrics/remove', vmixUrl: 'http://127.0.0.1/vmix/vmix-2' },
  ],
  vmixTimeoutMs: 3000,
  ui: {
    electron: true,
    web: true,
  },
  shortcut: {
    toggle: 'Ctrl+G',
    quit: 'Ctrl+Shift+Q',
  },
  notifications: {
    onToggle: true,
    onRoute: true,
  },
  state: {
    integrationEnabled: true,
  },
  logging: true,
};

function mergeConfig(base, override) {
  const routes = Array.isArray(override.routes) && override.routes.length > 0
    ? override.routes.map((r) => ({
        holyricsTriggerUrl: r.holyricsTriggerUrl,
        vmixUrl: r.vmixUrl,
      }))
    : base.routes;

  return {
    api: {
      host: override.api?.host || base.api.host,
      port: Number(override.api?.port || base.api.port),
    },
    routes,
    vmixTimeoutMs: Number(override.vmixTimeoutMs || base.vmixTimeoutMs),
    ui: {
      electron: override.ui?.electron ?? base.ui.electron,
      web: override.ui?.web ?? base.ui.web,
    },
    shortcut: {
      toggle: override.shortcut?.toggle || base.shortcut.toggle,
      quit: override.shortcut?.quit || base.shortcut.quit,
    },
    notifications: {
      onToggle: override.notifications?.onToggle ?? base.notifications.onToggle,
      onRoute: override.notifications?.onRoute ?? base.notifications.onRoute,
    },
    state: {
      integrationEnabled: override.state?.integrationEnabled ?? base.state.integrationEnabled,
    },
    logging: override.logging !== false,
  };
}

function getConfigDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }

  const executableDir = path.dirname(process.execPath || '');
  const executableConfigPath = path.resolve(executableDir, 'config.json');

  if (executableDir && fs.existsSync(executableConfigPath)) {
    return executableDir;
  }

  return path.resolve(__dirname, '..');
}

function loadConfig(baseDir) {
  const dir = baseDir || getConfigDir();
  const configPath = path.resolve(dir, 'config.json');

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(raw);

  return mergeConfig(DEFAULT_CONFIG, parsed);
}

module.exports = {
  DEFAULT_CONFIG,
  loadConfig,
};