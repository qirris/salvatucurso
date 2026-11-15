/* Versiones del curso, copias, sesión y cambios sin conexión en la interfaz. */
const assert = require('assert/strict'), fs = require('fs'), vm = require('vm');
function environment(options = {}) {
  const nodes = new Map(), values = {}, timers = new Map(), events = {}, calls = [], reminderStates = [];
  const sessionValues = { salvatucursoTemporal: 'pendiente' }, replacements = [];
  let nextTimer = 0, revisionNumber = 1, offline = false, blocked = false, exported = 0, courseApi, deleteFailure = false, reminderCleanup = 0;
  const clone = value => JSON.parse(JSON.stringify(value));
  const guest = { version: 2, asignaturas: [{ id: 'local', nombre: 'Local' }], tareas: [], faltas: [], config: {} };
  let serverUser = options.anonymous ? null : { id: 'u1', email: 'prueba@example.test' };
  let server = { revision: 'r1', state: { ...clone(guest), asignaturas: [{ id: 'nube', nombre: 'Cuenta' }] } };
  const doc = { hidden: false, addEventListener(name, fn) { events[name] = fn; },
    querySelector(selector) { return selector === 'dialog[open]' ? [...nodes.values()].find(node => node.open) || null : node(selector); } };
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', textContent: '', hidden: false, disabled: false, open: false,
      addEventListener(name, fn) { this[name] = fn; }, focus() { doc.activeElement = this; },
      showModal() { this.open = true; }, close() { this.open = false; if (typeof this.onclose === 'function') this.onclose(); },
      set autocomplete(value) { this._autocomplete = value; }
    });
    const element = nodes.get(selector);
    if (!element._patched) {
      element._patched = true; const add = element.addEventListener;
      element.addEventListener = function(name, fn) { if (name === 'close') this.onclose = fn; else add.call(this, name, fn); };
    }
    return element;
  }
  const storage = { getItem: key => values[key] ?? null,
    setItem(key, value) { if (blocked) throw Error('Guardado bloqueado'); values[key] = String(value); },
    removeItem: key => { delete values[key]; }, key: index => Object.keys(values)[index] ?? null,
    clear() { Object.keys(values).forEach(key => delete values[key]); },
    get length() { return Object.keys(values).length; } };
  const sessionStorage = { getItem: key => sessionValues[key] ?? null, setItem: (key, value) => { sessionValues[key] = String(value); },
    removeItem: key => { delete sessionValues[key]; }, clear() { Object.keys(sessionValues).forEach(key => delete sessionValues[key]); } };
  values.miAsistenciaState = JSON.stringify(guest);
  const context = { console, Date, JSON, URL, URLSearchParams, AbortController, document: doc, localStorage: storage, sessionStorage,
    window: { SalvaTuCursoPushConfig: { enabled: true, apiBase: '/api', email: true, google: true }, addEventListener(name, fn) { events[name] = fn; } },
    location: { origin: 'https://prueba.example', pathname: '/index.html', search: '', assign() {}, replace(url) { replacements.push(url); } }, history: { replaceState() {} },
    state: clone(guest), STORAGE_KEY: 'miAsistenciaState', DEFAULT_STATE: clone(guest), $: node,
    normalizeState: clone, isStoredStateCurrent: () => values.miAsistenciaState === JSON.stringify(context.state),
    saveState() { values.miAsistenciaState = JSON.stringify(context.state); courseApi?.queueSync(); },
    render() { courseApi.renderSettings(); }, UndoManager: { clear() {} }, TaskReminders: { queueSync() {}, renderSettings() { reminderStates.push(courseApi?.ready() || false); }, async disableForLogout() { return true; }, async cleanupAfterAccountDeletion() { reminderCleanup++; } },
    exportJSON() { exported++; }, importJSON() {},
    setTimeout(fn, delay) { timers.set(++nextTimer, { fn, delay }); return nextTimer; }, clearTimeout(id) { timers.delete(id); },
    async fetch(url, init) {
      if (offline) throw Error('Sin conexión');
      const body = init.body ? JSON.parse(init.body) : null; calls.push({ url, method: init.method, body });
      const reply = (data, status = 200) => ({ ok: status < 400, status, async json() { return clone(data); } });
      if (url.endsWith('auth/get-session')) return reply(serverUser ? { user: serverUser } : null);
      if (url.endsWith('auth/sign-in/email')) { serverUser = { id: 'u1', email: 'prueba@example.test' }; return reply({}); }
      if (url.endsWith('auth/sign-out')) { serverUser = null; return reply({}); }
      if (url.endsWith('/account') && init.method === 'DELETE') {
        if (deleteFailure) return reply({ error: 'Fallo simulado del servidor' }, 503);
        if (body.confirmation !== 'ELIMINAR') return reply({ error: 'Confirmación incorrecta' }, 400);
        serverUser = null; return reply({ ok: true });
      }
      if (url.endsWith('/course')) {
        if (init.method === 'GET') return reply(server);
        if (body.revision !== server.revision) return reply({ error: 'Conflicto' }, 409);
        server = { state: clone(body.state), revision: 'r' + (++revisionNumber) }; return reply({ revision: server.revision });
      }
      return reply({});
    }
  };
  vm.createContext(context); vm.runInContext(fs.readFileSync('src/js/account.js', 'utf8') + '\nthis.api = CourseAccount;', context);
  courseApi = context.api; courseApi.bind();
  return { context, api: courseApi, node, values, sessionValues, calls, timers, events, guest, reminderStates, replacements,
    get server() { return server; }, get exported() { return exported; },
    changeServer(state) { server = { state: clone(state), revision: 'r' + (++revisionNumber) }; },
    offline(value) { offline = value; }, blocked(value) { blocked = value; }, failDelete(value) { deleteFailure = value; },
    get reminderCleanup() { return reminderCleanup; } };
}
(async () => {
  const e = environment(); await e.api.started();
  assert.equal(e.node('#dialog-sync').open, true, 'revisa antes de reemplazar datos existentes');
  assert.equal(e.calls.filter(call => call.method === 'PUT').length, 0, 'no sube datos locales automáticamente al entrar');
  assert.equal(e.context.state.asignaturas[0].id, 'local');
  e.node('#sync-cancel').click(); assert.equal(e.context.state.asignaturas[0].id, 'local');
  e.node('#account-sync').click(); await e.node('#sync-use-cloud').click();
  assert.equal(e.context.state.asignaturas[0].id, 'nube'); assert.equal(e.api.ready(), true);
  assert.equal(e.reminderStates.at(-1), true, 'los avisos reconocen la cuenta al terminar la sincronización');
  assert.ok(Object.keys(e.values).some(key => key.startsWith('salvatucursoCopiaSync_')));
  e.context.state.tareas.push({ id: 'tarea-local', titulo: 'Cambio sin conexión' }); e.context.saveState();
  e.offline(true); await e.api.sync();
  assert.equal(e.context.state.tareas.length, 1); assert.equal(e.server.state.tareas.length, 0);
  e.offline(false); await e.api.sync(); assert.equal(e.server.state.tareas.length, 1);
  const remote = JSON.parse(JSON.stringify(e.server.state)); remote.asignaturas[0].nombre = 'Cambio desde el móvil'; e.changeServer(remote);
  await e.api.sync(); assert.equal(e.context.state.asignaturas[0].nombre, 'Cambio desde el móvil');
  e.context.state.tareas[0].titulo = 'Cambio desde el ordenador'; e.context.saveState();
  const parallel = JSON.parse(JSON.stringify(e.server.state)); parallel.tareas[0].titulo = 'Otra edición'; e.changeServer(parallel);
  await e.api.sync(); assert.equal(e.node('#dialog-sync').open, true);
  assert.equal(e.server.state.tareas[0].titulo, 'Otra edición', 'no sobrescribe un curso cambiado');
  await e.node('#sync-use-local').click(); assert.equal(e.server.state.tareas[0].titulo, 'Cambio desde el ordenador');
  assert.equal(e.api.ready(), true);
  const saved = JSON.stringify(e.context.state); e.blocked(true);
  const changed = JSON.parse(JSON.stringify(e.server.state)); changed.asignaturas[0].nombre = 'Cambio posterior'; e.changeServer(changed);
  await e.api.sync(); assert.equal(JSON.stringify(e.context.state), saved, 'un fallo de copia no reemplaza el curso local'); e.blocked(false);
  await e.api.sync();
  await e.node('#account-logout').click();
  assert.equal(e.api.user(), null); assert.equal(e.context.state.asignaturas[0].id, 'local', 'salir recupera los datos de invitado');
  assert.equal(e.reminderStates.at(-1), false, 'los avisos se actualizan al salir de la cuenta');
  e.node('#account-login').click(); e.node('#auth-email').value = 'prueba@example.test'; e.node('#auth-password').value = 'no-guardar-esta-clave';
  await e.node('#auth-form').submit({ preventDefault() {} });
  assert.equal(e.context.state.asignaturas[0].nombre, 'Cambio posterior', 'vuelve a la copia de la cuenta al entrar');
  assert.equal(e.node('#auth-password').value, '');
  assert.equal(Object.values(e.values).some(value => value.includes('no-guardar-esta-clave')), false, 'no persiste la contraseña');
  const a = environment({ anonymous: true }); await a.api.started();
  a.node('#account-login').click(); a.node('#auth-mode-register').click(); assert.equal(a.node('#auth-password').minLength, 12);
  a.node('#auth-forgot').click(); assert.equal(a.node('#auth-password-field').hidden, true); assert.equal(a.node('#auth-password').required, false);
  a.node('#auth-cancel').click(); assert.equal(a.node('#dialog-account').open, false);
  const googleOnly = environment({ anonymous: true }); await googleOnly.api.started();
  googleOnly.context.window.SalvaTuCursoPushConfig.email = false;
  googleOnly.node('#account-login').click();
  assert.equal(googleOnly.node('#auth-form').hidden, true, 'no ofrece campos de correo cuando solo está conectado Google');
  assert.equal(googleOnly.node('#auth-options').hidden, true);
  assert.equal(googleOnly.node('#auth-submit').hidden, true);
  assert.equal(googleOnly.context.document.activeElement, googleOnly.node('#auth-google'), 'el foco empieza en el acceso disponible');
  assert.equal(googleOnly.node('#account-delete-panel').hidden, true, 'sin sesión no se ofrece eliminar una cuenta');

  const d = environment(); await d.api.started(); await d.node('#sync-use-cloud').click();
  assert.equal(d.node('#account-delete-panel').hidden, false, 'la eliminación aparece únicamente con sesión autenticada');
  d.node('#account-delete-open').click();
  assert.equal(d.node('#dialog-delete-account').open, true);
  assert.equal(d.context.document.activeElement, d.node('#account-delete-confirmation'));
  d.node('#account-delete-confirmation').value = 'eliminar'; d.node('#account-delete-confirmation').input();
  assert.equal(d.node('#account-delete-submit').disabled, true, 'exige la palabra exacta');
  d.node('#account-delete-export').click(); assert.equal(d.exported, 1, 'permite descargar antes una copia');
  const beforeCancel = JSON.stringify(d.values); d.node('#account-delete-cancel').click();
  assert.equal(JSON.stringify(d.values), beforeCancel, 'cancelar conserva todos los datos locales');
  assert.equal(d.context.document.activeElement, d.node('#account-delete-open'), 'al cerrar devuelve el foco al origen');

  d.node('#account-delete-open').click(); d.node('#account-delete-confirmation').value = 'ELIMINAR'; d.node('#account-delete-confirmation').input();
  d.failDelete(true); await d.node('#account-delete-form').submit({ preventDefault() {} });
  assert.ok(d.values.miAsistenciaState, 'un fallo del servidor conserva los datos del dispositivo');
  assert.equal(d.replacements.length, 0); assert.match(d.node('#account-delete-status').textContent, /No se ha borrado nada/);
  d.failDelete(false);
  const firstDelete = d.node('#account-delete-form').submit({ preventDefault() {} });
  const repeatedDelete = d.node('#account-delete-form').submit({ preventDefault() {} });
  await Promise.all([firstDelete, repeatedDelete]);
  assert.equal(d.calls.filter(call => call.url.endsWith('/account') && call.method === 'DELETE').length, 2, 'tras el fallo, la doble pulsación solo añade un envío correcto');
  assert.deepEqual(Object.keys(d.values), [], 'el éxito borra todo el almacenamiento local');
  assert.deepEqual(Object.keys(d.sessionValues), [], 'el éxito borra el almacenamiento de sesión');
  assert.equal(d.reminderCleanup, 1, 'cancela la suscripción Push del navegador');
  assert.deepEqual(d.replacements, ['https://prueba.example/index.html'], 'reinicia la app como una instalación nueva');
  console.log('OK: sincronización, copias, salida, acceso y eliminación completa de cuenta con confirmación, cancelación, fallo seguro y doble pulsación');
})().catch(error => { console.error(error); process.exitCode = 1; });
