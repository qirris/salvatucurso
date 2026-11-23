/* Aviso de actualización pendiente y activación voluntaria. */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');

const source = fs.readFileSync('src/js/update.js', 'utf8');

function button() {
  const handlers = {};
  return {
    disabled: false,
    textContent: '',
    addEventListener(type, handler) { handlers[type] = handler; },
    click() { handlers.click(); }
  };
}

async function environment(hasController = true) {
  const notice = { hidden: true };
  const updateButton = button();
  const laterButton = button();
  const description = { textContent: '' };
  const elements = {
    'update-notice': notice,
    'btn-update-now': updateButton,
    'btn-update-later': laterButton,
    'update-description': description
  };
  const messages = [];
  const waiting = { postMessage(message) { messages.push(message); } };
  const registrationHandlers = {};
  const registration = {
    waiting,
    installing: null,
    addEventListener(type, handler) { registrationHandlers[type] = handler; },
    update() { return Promise.resolve(); }
  };
  const serviceWorkerHandlers = {};
  const loadHandlers = [];
  let reloads = 0;
  const context = {
    document: { getElementById(id) { return elements[id] || null; } },
    navigator: {
      serviceWorker: {
        controller: hasController ? {} : null,
        register(path) { assert.equal(path, './service-worker.js'); return Promise.resolve(registration); },
        addEventListener(type, handler) { serviceWorkerHandlers[type] = handler; }
      }
    },
    window: {
      addEventListener(type, handler) { if (type === 'load') loadHandlers.push(handler); },
      setTimeout(handler) { handler(); },
      location: { reload() { reloads += 1; } }
    },
    console,
    Promise
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  loadHandlers.forEach(handler => handler());
  await new Promise(resolve => setImmediate(resolve));
  return {
    notice, updateButton, laterButton, description, messages,
    controllerChange: serviceWorkerHandlers.controllerchange,
    reloads: () => reloads
  };
}

(async () => {
  let env = await environment(true);
  assert.equal(env.notice.hidden, false, 'muestra una versión que está esperando');
  env.laterButton.click();
  assert.equal(env.notice.hidden, true, 'permite dejar la actualización para más tarde');

  env = await environment(true);
  env.updateButton.click();
  assert.equal(env.messages.length, 1);
  assert.equal(env.messages[0].type, 'SKIP_WAITING');
  assert.equal(env.updateButton.disabled, true);
  assert.equal(env.updateButton.textContent, 'Actualizando…');
  env.controllerChange();
  assert.equal(env.reloads(), 1, 'recarga únicamente después de aceptar la actualización');

  env = await environment(false);
  assert.equal(env.notice.hidden, true, 'la primera instalación no se presenta como actualización');

  const worker = fs.readFileSync('service-worker.js', 'utf8');
  assert.ok(worker.includes("event.data.type === 'SKIP_WAITING'"));
  const installBlock = worker.match(/self\.addEventListener\('install',[\s\S]*?\n\}\);/)[0];
  assert.ok(!installBlock.includes('skipWaiting'), 'las versiones nuevas esperan la decisión de la persona');
  console.log('OK: aviso de actualización pendiente, aplazamiento y activación voluntaria');
})().catch(error => { console.error(error); process.exit(1); });
