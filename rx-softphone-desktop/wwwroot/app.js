const $ = (selector) => document.querySelector(selector);
const elements = {
  form: $('#registrationForm'),
  server: $('#server'),
  port: $('#port'),
  localSipPort: $('#localSipPort'),
  username: $('#username'),
  displayName: $('#displayName'),
  password: $('#password'),
  togglePassword: $('#togglePassword'),
  register: $('#registerButton'),
  unregister: $('#unregisterButton'),
  registrationBadge: $('#registrationBadge'),
  callBadge: $('#callBadge'),
  callTitle: $('#callTitle'),
  timer: $('#timer'),
  incomingPanel: $('#incomingPanel'),
  incomingPeer: $('#incomingPeer'),
  answer: $('#answerButton'),
  reject: $('#rejectButton'),
  destination: $('#destination'),
  clear: $('#clearButton'),
  backspace: $('#backspaceButton'),
  call: $('#callButton'),
  hangup: $('#hangupButton'),
  mute: $('#muteButton'),
  hint: $('#phoneHint'),
  detailPbx: $('#detailPbx'),
  detailExtension: $('#detailExtension'),
  detailLocalPort: $('#detailLocalPort'),
  eventLog: $('#eventLog'),
  clearLog: $('#clearLogButton'),
  relayForm: $('#relayForm'),
  relayTrackerUrl: $('#relayTrackerUrl'),
  relayPairingCode: $('#relayPairingCode'),
  relayPair: $('#relayPairButton'),
  relayDisconnect: $('#relayDisconnectButton'),
  relayBadge: $('#relayBadge'),
  relayMessage: $('#relayMessage'),
  toast: $('#toast')
};

let state = null;
let latestSequence = 0;
let hiddenThroughSequence = 0;
let toastTimer = null;
let polling = false;
let relayPolling = false;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || body.detail || `Request failed (${response.status}).`);
  }
  return body;
}

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', error);
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 4200);
}

function titleCase(value) {
  return String(value || '').replace(/(^|[-_ ])\w/g, match => match.toUpperCase());
}

function isCallBusy(call) {
  return !['idle', 'ended', 'failed'].includes(call);
}

function render(snapshot) {
  state = snapshot;
  const registration = snapshot.registration || 'offline';
  const call = snapshot.call || 'idle';
  const registered = registration === 'registered';
  const busy = isCallBusy(call);

  elements.registrationBadge.className = `status-badge ${registration}`;
  elements.registrationBadge.innerHTML = `<span class="status-dot"></span>${titleCase(registration)}`;
  elements.callBadge.textContent = titleCase(call);
  elements.callTitle.textContent = snapshot.incoming
    ? `Call from ${snapshot.peer || 'unknown'}`
    : call === 'connected'
      ? snapshot.peer || 'Connected'
      : call === 'ringing'
        ? `Ringing ${snapshot.peer || ''}`
        : call === 'dialing' || call === 'trying'
          ? `Calling ${snapshot.peer || ''}`
          : 'Ready to dial';

  elements.incomingPanel.hidden = !snapshot.incoming;
  elements.incomingPeer.textContent = snapshot.peer || 'Unknown';
  elements.call.hidden = busy;
  elements.hangup.hidden = !busy;
  elements.call.disabled = !registered || !elements.destination.value.trim();
  elements.mute.disabled = call !== 'connected';
  elements.mute.classList.toggle('active', snapshot.muted);
  elements.mute.lastChild.textContent = snapshot.muted ? 'Unmute' : 'Mute';
  elements.register.disabled = registration === 'registering';
  elements.unregister.disabled = registration === 'offline';
  elements.server.disabled = registration !== 'offline' && registration !== 'failed';
  elements.port.disabled = elements.server.disabled;
  elements.localSipPort.disabled = elements.server.disabled;
  elements.username.disabled = elements.server.disabled;
  elements.displayName.disabled = elements.server.disabled;

  elements.hint.textContent = !registered
    ? 'Enter the account password and register to the PBX.'
    : call === 'connected'
      ? 'Audio is using the Windows default microphone and speakers.'
      : 'Registered. Enter a number or extension to call.';

  elements.detailPbx.textContent = `${snapshot.server}:${snapshot.port}`;
  elements.detailExtension.textContent = snapshot.username || '—';
  elements.detailLocalPort.textContent = snapshot.localSipPort ? `UDP ${snapshot.localSipPort}` : 'Not open';

  renderEvents(snapshot.events || []);
  renderTimer();
}

function renderEvents(events) {
  const visible = events.filter(event => event.sequence > hiddenThroughSequence).slice().reverse();
  latestSequence = Math.max(latestSequence, ...events.map(x => x.sequence), 0);
  elements.eventLog.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No events in this view.';
    elements.eventLog.append(empty);
    return;
  }

  for (const event of visible) {
    const item = document.createElement('li');
    item.className = event.level;
    const time = document.createElement('time');
    time.dateTime = event.timestamp;
    time.textContent = new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const message = document.createElement('span');
    message.textContent = event.message;
    item.append(time, message);
    elements.eventLog.append(item);
  }
}

function renderTimer() {
  if (!state?.connectedAt) {
    elements.timer.textContent = '00:00';
    return;
  }
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(state.connectedAt).getTime()) / 1000));
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  elements.timer.textContent = `${minutes}:${remainder}`;
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    render(await api('/api/status'));
  } catch (error) {
    elements.registrationBadge.className = 'status-badge failed';
    elements.registrationBadge.innerHTML = '<span class="status-dot"></span>Backend offline';
  } finally {
    polling = false;
  }
}

function renderRelay(status) {
  const configured = status?.configured === true;
  const connected = status?.connected === true;
  elements.relayBadge.className = `relay-badge ${connected ? 'online' : configured ? 'waiting' : 'offline'}`;
  elements.relayBadge.textContent = connected ? 'Relay online' : configured ? 'Connecting' : 'Not paired';
  elements.relayDisconnect.disabled = !configured;
  if (status?.trackerUrl && !elements.relayTrackerUrl.value) elements.relayTrackerUrl.value = status.trackerUrl;
  elements.relayMessage.textContent = connected
    ? `Connected to ${status.trackerUrl}. Remote browser calls will ring on this PC.`
    : status?.error
      ? status.error
      : configured
        ? `Waiting for ${status.trackerUrl}. The phone will reconnect automatically.`
        : 'Generate a pairing code from RX Tracker Call Center.';
  elements.relayBadge.classList.toggle('error', !!status?.error && !connected);
}

async function pollRelay() {
  if (relayPolling) return;
  relayPolling = true;
  try { renderRelay(await api('/api/relay/status')); }
  catch (_) { /* The main status poll reports local API failures. */ }
  finally { relayPolling = false; }
}

elements.form.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const snapshot = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({
        server: elements.server.value,
        port: Number(elements.port.value),
        username: elements.username.value,
        password: elements.password.value,
        displayName: elements.displayName.value,
        localSipPort: Number(elements.localSipPort.value || 0)
      })
    });
    render(snapshot);
    elements.password.value = '';
    showToast('Registration started. Watch the status badge for the PBX response.');
  } catch (error) {
    showToast(error.message, true);
  }
});

elements.unregister.addEventListener('click', async () => {
  try {
    render(await api('/api/unregister', { method: 'POST', body: '{}' }));
    showToast('Unregistered and cleared the in-memory password.');
  } catch (error) { showToast(error.message, true); }
});

elements.call.addEventListener('click', async () => {
  try {
    render(await api('/api/calls', { method: 'POST', body: JSON.stringify({ destination: elements.destination.value }) }));
  } catch (error) { showToast(error.message, true); }
});

elements.hangup.addEventListener('click', async () => {
  try { render(await api('/api/calls/current', { method: 'DELETE' })); }
  catch (error) { showToast(error.message, true); }
});

elements.answer.addEventListener('click', async () => {
  try { render(await api('/api/calls/answer', { method: 'POST', body: '{}' })); }
  catch (error) { showToast(error.message, true); }
});

elements.reject.addEventListener('click', async () => {
  try { render(await api('/api/calls/reject', { method: 'POST', body: '{}' })); }
  catch (error) { showToast(error.message, true); }
});

elements.mute.addEventListener('click', async () => {
  try {
    render(await api('/api/calls/mute', { method: 'POST', body: JSON.stringify({ muted: !state?.muted }) }));
  } catch (error) { showToast(error.message, true); }
});

document.querySelectorAll('[data-key]').forEach(button => {
  button.addEventListener('click', async () => {
    const key = button.dataset.key;
    if (state?.call === 'connected') {
      try { render(await api('/api/calls/dtmf', { method: 'POST', body: JSON.stringify({ tone: key }) })); }
      catch (error) { showToast(error.message, true); }
    } else {
      elements.destination.value += key;
      render(state);
    }
  });
});

elements.destination.addEventListener('input', () => { if (state) render(state); });
elements.destination.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !elements.call.disabled) elements.call.click();
});
elements.clear.addEventListener('click', () => { elements.destination.value = ''; if (state) render(state); });
elements.backspace.addEventListener('click', () => { elements.destination.value = elements.destination.value.slice(0, -1); if (state) render(state); });
elements.clearLog.addEventListener('click', () => { hiddenThroughSequence = latestSequence; if (state) render(state); });
elements.togglePassword.addEventListener('click', () => {
  const show = elements.password.type === 'password';
  elements.password.type = show ? 'text' : 'password';
  elements.togglePassword.textContent = show ? 'Hide' : 'Show';
  elements.togglePassword.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

elements.relayForm.addEventListener('submit', async event => {
  event.preventDefault();
  elements.relayPair.disabled = true;
  try {
    await api('/api/relay/pair', {
      method: 'POST',
      body: JSON.stringify({
        trackerUrl: elements.relayTrackerUrl.value.trim(),
        pairingCode: elements.relayPairingCode.value.trim()
      })
    });
    elements.relayPairingCode.value = '';
    await pollRelay();
    showToast('Windows softphone paired with RX Tracker.');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.relayPair.disabled = false;
  }
});

elements.relayDisconnect.addEventListener('click', async () => {
  if (!window.confirm('Remove this RX Tracker relay pairing? Local phone controls will continue to work.')) return;
  try {
    renderRelay(await api('/api/relay/pairing', { method: 'DELETE' }));
    showToast('Relay pairing removed.');
  } catch (error) { showToast(error.message, true); }
});

setInterval(poll, 750);
setInterval(pollRelay, 1500);
setInterval(renderTimer, 1000);
poll();
pollRelay();
