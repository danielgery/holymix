const { app, BrowserWindow, ipcMain, globalShortcut, Notification, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { loadConfig } = require('./config');
const { getDefaultState, loadState, saveState } = require('./trigger-state');
const { requestVmix } = require('./vmix-client');

let mainWindow;
let tray;
let config;
let currentState;
let forceQuit = false;

function getAppBaseUrl() {
  const host = config.api.host === '0.0.0.0' ? '127.0.0.1' : config.api.host;
  return `http://${host}:${config.api.port}`;
}

function getRoutesInfo() {
  return config.routes.map((r) => ({
    holyricsTriggerUrl: r.holyricsTriggerUrl,
    vmixUrl: r.vmixUrl,
    label: r.holyricsTriggerUrl.split('/').pop(),
  }));
}

function getStatePayload() {
  return {
    success: true,
    integrationEnabled: currentState.integrationEnabled,
    updatedAt: currentState.updatedAt,
    lastAction: currentState.lastAction || null,
    routes: getRoutesInfo(),
    baseUrl: getAppBaseUrl(),
  };
}

function setIntegrationEnabled(enabled) {
  currentState = {
    ...currentState,
    integrationEnabled: enabled,
    updatedAt: new Date().toISOString(),
  };
  saveState(currentState);
  return currentState;
}

async function startHttpServer() {
  const { start } = require('./main');
  await start();
}

function registerIpcHandlers() {
  ipcMain.handle('toggle:get-state', () => {
    return getStatePayload();
  });

  ipcMain.handle('toggle:set-state', (_event, enabled) => {
    setIntegrationEnabled(enabled);
    return getStatePayload();
  });

  ipcMain.handle('toggle:toggle', () => {
    setIntegrationEnabled(!currentState.integrationEnabled);
    return getStatePayload();
  });

  ipcMain.handle('toggle:test-vmix', async (_event, holyricsTriggerUrl) => {
    const route = config.routes.find((r) => r.holyricsTriggerUrl === holyricsTriggerUrl);
    if (!route) {
      return { ...getStatePayload(), testResult: { ok: false, error: 'Rota nao encontrada' } };
    }

    const result = await requestVmix(route.vmixUrl, config.vmixTimeoutMs);

    if (result.ok) {
      currentState = {
        ...currentState,
        lastAction: {
          endpoint: route.holyricsTriggerUrl,
          targetUrl: route.vmixUrl,
          statusCode: result.statusCode,
          at: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      };
      saveState(currentState);
    }

    return {
      ...getStatePayload(),
      testResult: {
        ok: result.ok,
        statusCode: result.statusCode,
        targetUrl: route.vmixUrl,
      },
    };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 700,
    minWidth: 480,
    minHeight: 400,
    title: 'HolyMix',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(getAppBaseUrl());

  mainWindow.on('close', (e) => {
    if (!forceQuit) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  config = loadConfig();
  currentState = loadState(config) || getDefaultState(config);

  registerIpcHandlers();
  await startHttpServer();

  if (config.notifications.onRoute) {
    const { onRouteTriggered } = require('./main');
    onRouteTriggered((route) => {
      const label = route.holyricsTriggerUrl.split('/').pop();
      new Notification({
        title: 'HolyMix',
        body: `Rota acionada: /${label}`,
        silent: true,
      }).show();
    });
  }

  if (config.shortcut.toggle) {
    const http = require('http');
    const registered = globalShortcut.register(config.shortcut.toggle, () => {
      const req = http.request(`${getAppBaseUrl()}/api/toggle`, { method: 'GET' }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (config.notifications.onToggle) {
              const enabled = payload.integrationEnabled;
              new Notification({
                title: 'HolyMix',
                body: enabled ? 'Integracao ATIVADA' : 'Integracao DESLIGADA',
                silent: true,
              }).show();
            }
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('state-changed', payload);
            }
          } catch (_) {}
        });
      });
      req.on('error', () => {});
      req.end();
    });
    if (!registered) {
      console.error(`Falha ao registrar shortcut global: ${config.shortcut.toggle}`);
    }
  }

  if (config.shortcut.quit) {
    globalShortcut.register(config.shortcut.quit, () => {
      forceQuit = true;
      app.quit();
    });
  }

  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('HolyMix');

  function updateTrayMenu() {
    const enabled = currentState.integrationEnabled;
    const contextMenu = Menu.buildFromTemplate([
      { label: 'HolyMix', enabled: false },
      { type: 'separator' },
      {
        label: enabled ? 'Desligar integracao' : 'Ligar integracao',
        click: () => {
          const http = require('http');
          const req = http.request(`${getAppBaseUrl()}/api/toggle`, { method: 'GET' }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
              try {
                const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                currentState = { ...currentState, integrationEnabled: payload.integrationEnabled };
                updateTrayMenu();
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('state-changed', payload);
                }
              } catch (_) {}
            });
          });
          req.on('error', () => {});
          req.end();
        },
      },
      { type: 'separator' },
      {
        label: 'Abrir janela',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          } else if (config.ui.electron) {
            createWindow();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => {
          forceQuit = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(contextMenu);
  }

  updateTrayMenu();

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else if (config.ui.electron) {
      createWindow();
    }
  });

  if (config.ui.electron) {
    createWindow();
  }

  app.on('activate', () => {
    if (config.ui.electron && BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // keep running in tray
});
