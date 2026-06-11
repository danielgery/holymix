const http = require('http');
const fs = require('fs');
const path = require('path');
const { requestVmix } = require('./vmix-client');
const { getDefaultState, loadState, saveState } = require('./trigger-state');
const { loadConfig } = require('./config');

const STATIC_FILES = {
  '/': path.join(__dirname, 'renderer.html'),
  '/index.html': path.join(__dirname, 'renderer.html'),
  '/renderer.html': path.join(__dirname, 'renderer.html'),
  '/renderer.js': path.join(__dirname, 'renderer.js'),
  '/styles.css': path.join(__dirname, 'styles.css'),
};

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

let config;
let currentState;
let routeMap;
let routeListener = null;

function log(...args) {
  if (!config?.logging) {
    return;
  }

  console.log(new Date().toISOString(), '-', ...args);
}

function jsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || 'text/plain; charset=utf-8';

  try {
    const body = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (error) {
    jsonResponse(res, 500, { success: false, error: error.message });
  }
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

function setLastAction(lastAction) {
  currentState = {
    ...currentState,
    lastAction,
    updatedAt: new Date().toISOString(),
  };

  saveState(currentState);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(null);
        return;
      }

      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

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

async function handleHolyricsRoute(route, res) {
  if (!currentState.integrationEnabled) {
    jsonResponse(res, 503, {
      success: false,
      integrationEnabled: false,
      error: 'Integracao desligada',
    });
    return;
  }

  const result = await requestVmix(route.vmixUrl, config.vmixTimeoutMs);

  if (result.ok) {
    setLastAction({
      endpoint: route.holyricsTriggerUrl,
      targetUrl: route.vmixUrl,
      statusCode: result.statusCode,
      at: new Date().toISOString(),
    });

    if (routeListener) {
      routeListener(route);
    }

    jsonResponse(res, 200, {
      success: true,
      integrationEnabled: true,
      endpoint: route.holyricsTriggerUrl,
      targetUrl: route.vmixUrl,
      statusCode: result.statusCode,
    });
    return;
  }

  log('Falha ao chamar vMix', { endpoint: route.holyricsTriggerUrl, targetUrl: route.vmixUrl, statusCode: result.statusCode });
  jsonResponse(res, 502, {
    success: false,
    integrationEnabled: true,
    endpoint: route.holyricsTriggerUrl,
    error: 'Erro ao comunicar com vMix',
    statusCode: result.statusCode,
  });
}

function createServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const pathname = url.pathname;
      const method = req.method || 'GET';

      if (config.ui.web && STATIC_FILES[pathname] && method === 'GET') {
        sendFile(res, STATIC_FILES[pathname]);
        return;
      }

      if (pathname === '/api/state' && method === 'GET') {
        jsonResponse(res, 200, {
          success: true,
          integrationEnabled: currentState.integrationEnabled,
          updatedAt: currentState.updatedAt,
          lastAction: currentState.lastAction || null,
          routes: getRoutesInfo(),
          baseUrl: getAppBaseUrl(),
          shortcut: config.shortcut,
        });
        return;
      }

      if (pathname === '/api/toggle' && (method === 'GET' || method === 'POST')) {
        let enabled = !currentState.integrationEnabled;

        if (method === 'POST') {
          const body = await readJsonBody(req).catch((error) => {
            throw new Error(`JSON invalido: ${error.message}`);
          });

          if (body && typeof body.enabled === 'boolean') {
            enabled = body.enabled;
          }
        }

        const updatedState = setIntegrationEnabled(enabled);
        jsonResponse(res, 200, {
          success: true,
          integrationEnabled: updatedState.integrationEnabled,
          updatedAt: updatedState.updatedAt,
          lastAction: updatedState.lastAction || null,
          routes: getRoutesInfo(),
          baseUrl: getAppBaseUrl(),
          shortcut: config.shortcut,
        });
        return;
      }

      if (routeMap[pathname] && (method === 'GET' || method === 'POST')) {
        await handleHolyricsRoute(routeMap[pathname], res);
        return;
      }

      if (pathname === '/api/health' && method === 'GET') {
        jsonResponse(res, 200, {
          success: true,
          baseUrl: getAppBaseUrl(),
        });
        return;
      }

      jsonResponse(res, 404, {
        success: false,
        error: 'Rota nao encontrada',
      });
    } catch (error) {
      log('Erro ao processar requisicao', error.message);
      jsonResponse(res, 500, {
        success: false,
        error: error.message,
      });
    }
  });

  return server;
}

async function start() {
  config = loadConfig();
  currentState = loadState(config) || getDefaultState(config);
  routeMap = {};
  for (const route of config.routes) {
    routeMap[route.holyricsTriggerUrl] = route;
  }
  const server = createServer();

  await new Promise((resolve) => {
    server.listen(config.api.port, config.api.host, resolve);
  });

  log(`API escutando em ${getAppBaseUrl()}`);
  log(`Rotas configuradas: ${config.routes.map((r) => r.holyricsTriggerUrl).join(', ')}`);
  log('Abra a interface no navegador apontando para a URL acima.');

  const shutdown = () => {
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

function onRouteTriggered(listener) {
  routeListener = listener;
}

module.exports = {
  start,
  setIntegrationEnabled,
  onRouteTriggered,
};
