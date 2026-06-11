const stateLabel = document.getElementById('stateLabel');
const toggleButton = document.getElementById('toggleButton');
const detailLabel = document.getElementById('detailLabel');
const footerLabel = document.getElementById('footerLabel');
const statusPill = document.getElementById('statusPill');
const actionResult = document.getElementById('actionResult');
const baseUrlLabel = document.getElementById('baseUrlLabel');
const routeList = document.getElementById('routeList');
const testButtons = document.getElementById('testButtons');

let currentState = null;

async function api(pathname, options = {}) {
  const response = await fetch(pathname, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    cache: 'no-store',
    ...options,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }

  return payload;
}

function renderState(payload) {
  currentState = payload;
  const enabled = Boolean(payload.integrationEnabled);

  stateLabel.textContent = enabled ? 'INTEGRACAO ATIVA' : 'INTEGRACAO DESLIGADA';
  toggleButton.textContent = enabled ? 'Desligar integracao' : 'Ligar integracao';
  toggleButton.classList.toggle('is-on', enabled);
  statusPill.textContent = enabled ? 'Ativa' : 'Desligada';
  statusPill.classList.toggle('is-off', !enabled);
  footerLabel.textContent = enabled
    ? `As ${payload.routes.length} rotas Holyrics vao encaminhar para os destinos configurados.`
    : 'As rotas Holyrics respondem com erro controlado 503.';
  detailLabel.textContent = payload.lastAction
    ? `Ultima acao: ${payload.lastAction.endpoint} em ${new Date(payload.lastAction.at).toLocaleString()}`
    : 'Nenhuma acao executada ainda.';
  baseUrlLabel.textContent = payload.baseUrl || 'http://127.0.0.1:5000';

  if (payload.shortcut && payload.shortcut.toggle) {
    bindShortcut(payload.shortcut.toggle);
  }

  if (Array.isArray(payload.routes)) {
    routeList.innerHTML = payload.routes
      .map((r) => `<li><code>${r.holyricsTriggerUrl}</code> -> chama <code>${r.vmixUrl}</code></li>`)
      .join('');

    testButtons.innerHTML = '';
    payload.routes.forEach((r) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ghost';
      btn.textContent = `Acionar /${r.label}`;
      btn.addEventListener('click', () => runHolyricsRoute(r.holyricsTriggerUrl, r.label));
      testButtons.appendChild(btn);
    });
  }
}

function setBusy(isBusy) {
  toggleButton.disabled = isBusy;
  testButtons.querySelectorAll('button').forEach((btn) => { btn.disabled = isBusy; });
}

async function refreshState() {
  const payload = await api('/api/state');
  renderState(payload);
}

async function toggleIntegration() {
  setBusy(true);
  try {
    const payload = await api('/api/toggle', { method: 'POST', body: '{}' });
    renderState(payload);
    actionResult.textContent = `Integracao ${payload.integrationEnabled ? 'ativada' : 'desativada'}.`;
  } catch (error) {
    actionResult.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function runHolyricsRoute(route, label) {
  setBusy(true);
  try {
    const payload = await api(route, { method: 'POST', body: '{}' });
    actionResult.textContent = `/${label} enviado com sucesso para ${payload.targetUrl}.`;
    await refreshState();
  } catch (error) {
    actionResult.textContent = `Erro ao executar /${label}: ${error.message}`;
  } finally {
    setBusy(false);
  }
}

toggleButton.addEventListener('click', toggleIntegration);

function parseShortcut(shortcutStr) {
  const parts = shortcutStr.toLowerCase().split('+').map((s) => s.trim());
  const key = parts.pop();
  const modifiers = { ctrl: false, alt: false, shift: false, meta: false };
  for (const mod of parts) {
    if (mod === 'ctrl' || mod === 'control' || mod === 'commandorcontrol') modifiers.ctrl = true;
    else if (mod === 'alt') modifiers.alt = true;
    else if (mod === 'shift') modifiers.shift = true;
    else if (mod === 'meta' || mod === 'super') modifiers.meta = true;
  }
  return { key, modifiers };
}

let boundShortcut = null;

function bindShortcut(shortcutStr) {
  if (boundShortcut === shortcutStr) return;
  boundShortcut = shortcutStr;

  const parsed = parseShortcut(shortcutStr);

  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== parsed.key) return;
    if (e.ctrlKey !== parsed.modifiers.ctrl) return;
    if (e.altKey !== parsed.modifiers.alt) return;
    if (e.shiftKey !== parsed.modifiers.shift) return;
    if (e.metaKey !== parsed.modifiers.meta) return;
    e.preventDefault();
    toggleIntegration();
  });
}

if (window.toggleVmix && window.toggleVmix.onStateChanged) {
  window.toggleVmix.onStateChanged((payload) => renderState(payload));
}

refreshState().catch((error) => {
  stateLabel.textContent = 'ERRO';
  detailLabel.textContent = error.message;
  footerLabel.textContent = 'Verifique se a API local esta rodando.';
  toggleButton.disabled = true;
  statusPill.textContent = 'Offline';
  statusPill.classList.add('is-off');
});