/* Tareas generales y Papelera sobre los módulos reales, con almacenamiento y DOM simulados. */
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const copy = value => JSON.parse(JSON.stringify(value));
function environment(saved = {}) {
  const store = { ...saved }, nodes = new Map(); let fail = '', now = Date.now();
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', innerHTML: '', textContent: '', hidden: false, disabled: false, open: false, dataset: {}, style: {},
      classList: { add() {}, remove() {}, toggle() {} }, listeners: {},
      addEventListener(name, fn) { this.listeners[name] = fn; }, focus() {}, setAttribute() {}, removeAttribute() {},
      querySelector(child) { return node(selector + ' ' + child); }, querySelectorAll() { return []; }, contains() { return false; },
      showModal() { this.open = true; }, close() { this.open = false; } });
    return nodes.get(selector);
  };
  const s = { console, Date: Clock, JSON, setTimeout: () => 1, clearTimeout() {},
    document: { hidden: false, querySelector: selector => selector === 'dialog[open]' ? [...nodes.values()].find(item => item.open) || null : node(selector), querySelectorAll: () => [], addEventListener() {}, body: node('body') },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
    localStorage: { getItem: key => store[key] ?? null, setItem(key, value) { if (key === fail) throw Error('sin espacio'); store[key] = String(value); }, removeItem(key) { delete store[key]; } } };
  const source = ['attendance','attendance-ui','calendar','absence-day','storage','schedule','tasks','history','recovery','app']
    .map(name => fs.readFileSync('src/js/' + name + '.js','utf8')).join('\n');
  vm.createContext(s); vm.runInContext(source + '\nthis.getState=()=>state;this.tab=value=>taskActiveTab=value;',s);
  s.loadState(); s.render = () => s.renderMisTareas();
  return { s, store, node, state: () => s.getState(), fail: key => { fail = key; }, advance: ms => { now += ms; } };
}
let h = environment(), s = h.s;
s.saveState(); s.UndoManager.bind();
const task = s.crearTarea({ titulo: 'Organizar material', fechaEntrega: '2026-12-10' });
assert.equal(task.asignaturaId, ''); assert.equal(h.state().asignaturas.length, 0);
s.renderMisTareas(); assert.match(h.node('#tasks-list').innerHTML,/General/);
s.renderDashboardPriorities(); assert.equal(h.node('#dash-priorities').innerHTML.includes(task.titulo), true, 'Inicio muestra tareas aunque no haya asignaturas');
const preserved = copy(h.state());
h.fail('salvatucursoStateV4'); assert.throws(() => s.crearTarea({ titulo: 'No guardar' })); assert.deepEqual(copy(h.state()),preserved);
h.fail(''); s.alternarEstadoTarea(task.id); assert.equal(h.state().tareas[0].estado,'completada');
assert.equal(s.UndoManager.remove('tareas',task.id),true); assert.equal(h.state().tareas[0].estado,'eliminada');
s.tab('todos');s.renderMisTareas();assert.ok(!h.node('#tasks-list').innerHTML.includes('Organizar material'));
s.tab('eliminada');s.renderMisTareas();assert.match(h.node('#tasks-list').innerHTML,/Restaurar/);
assert.ok(!h.node('#tasks-list').innerHTML.includes('data-toggletask'));
assert.equal(s.actualizarTarea(task.id,{ titulo:'No editar desde la Papelera' }),false);
assert.equal(s.UndoManager.restore(),true);assert.equal(h.state().tareas[0].estado,'completada','Deshacer recupera el estado anterior');
assert.equal(s.UndoManager.remove('tareas',task.id),true);
const persisted=copy(h.store);h=environment(persisted);s=h.s;s.UndoManager.bind();
assert.equal(s.UndoManager.restore(),true,'Deshacer sigue funcionando tras recargar');
s.UndoManager.remove('tareas',task.id);h.advance(11000);assert.equal(s.UndoManager.restore(),false);
assert.equal(h.state().tareas[0].estado,'eliminada','la expiración no elimina definitivamente');
h.fail('salvatucursoStateV4'); assert.equal(s.restaurarTarea(task.id),false); assert.equal(h.state().tareas[0].estado,'eliminada');
h.fail('');assert.equal(s.restaurarTarea(task.id),true);assert.equal(h.state().tareas[0].estado,'pendiente');
s.UndoManager.remove('tareas',task.id);
assert.equal(s.normalizeState(copy(h.state())).tareas[0].estado,'eliminada','importar y normalizar conservan la Papelera');
// Migración V3: conservar copia anterior y no resucitar registros ni perder vínculos.
const v3=copy(preserved);v3.version=3;v3.tareas=[{...v3.tareas[0],asignaturaId:'antigua',estado:'completada'}];
h=environment({salvatucursoStateV3:JSON.stringify(v3)});s=h.s;
assert.equal(h.state().version,4);assert.equal(h.store.salvatucursoStateV4,undefined);
s.showDataMigration();h.fail('salvatucursoStateV4');h.node('#migration-continue').listeners.click();
assert.equal(h.store.salvatucursoStateV3,JSON.stringify(v3));assert.equal(h.node('#dialog-data-migration').open,true);
h.fail('');h.node('#migration-continue').listeners.click();assert.equal(JSON.parse(h.store.salvatucursoStateV4).tareas[0].estado,'completada');
assert.equal(h.store.salvatucursoStateV3,JSON.stringify(v3));
const roundtrip=s.normalizeState(JSON.parse(h.store.salvatucursoStateV4));assert.deepEqual(copy(roundtrip.tareas),copy(h.state().tareas));
// Diario V3 de un borrado anterior: se puede recuperar una vez sin tocar el respaldo.
const oldJournal={token:'anterior',expiresAt:Date.now()+10000,entries:[{collection:'tareas',index:0,item:{...copy(task),estado:'pendiente'}}]};
const blank={...copy(preserved),tareas:[]};
h=environment({salvatucursoStateV4:JSON.stringify(blank),salvatucursoDeshacerV3:JSON.stringify(oldJournal)});s=h.s;s.UndoManager.bind();
assert.equal(s.UndoManager.restore(),true);assert.equal(h.state().tareas[0].id,task.id);
assert.equal(h.store.salvatucursoDeshacerV3,JSON.stringify(oldJournal));
const replay=environment(copy(h.store));replay.s.UndoManager.bind();assert.equal(replay.s.UndoManager.restore(),false);
(async () => {
  // La migración real de metadatos mantiene el usuario, revisión, base y cambios sin conexión.
  const base = { ...copy(preserved), version: 3 }, local = copy(base);
  local.tareas[0].titulo = 'Cambio sin conexión';
  const user = { id: 'propietario-prueba', email: 'propietario@example.test', emailVerified: true };
  for (const conflict of [false,true]) {
    const previousMeta = { user, revision: 'r1', base: JSON.stringify(base), dirty: true };
    const previousGuest = { ...copy(base), tareas: [] };
    const env = environment({ salvatucursoStateV3: JSON.stringify(local), salvatucursoCuentaV3: JSON.stringify(previousMeta), salvatucursoInvitadoV3: JSON.stringify(previousGuest) });
    const context = env.s, uploads = [];
    context.window.SalvaTuCursoPushConfig = { enabled: true, apiBase: '/api', google: true, email: false };
    Object.assign(context, { URL, URLSearchParams, AbortController,
      location: { origin: 'https://prueba.example', pathname: '/', search: '' }, history: { replaceState() {} } });
    context.fetch = async (url, init) => {
      let data;
      if (url.includes('auth/get-session')) data = { user };
      else if (init.method === 'GET') data = { state: base, revision: conflict ? 'r2' : 'r1' };
      else { uploads.push(JSON.parse(init.body)); data = { revision: 'r3' }; }
      return { ok: true, status: 200, json: async () => copy(data) };
    };
    vm.runInContext(fs.readFileSync('src/js/account.js','utf8') + '\nthis.account=CourseAccount;',context);
    context.saveState(); context.account.bind(); await context.account.started();
    assert.equal(env.store.salvatucursoStateV3,JSON.stringify(local));
    assert.equal(env.store.salvatucursoCuentaV3,JSON.stringify(previousMeta));
    assert.equal(env.store.salvatucursoInvitadoV3,JSON.stringify(previousGuest));
    assert.equal(context.getState().tareas[0].titulo,'Cambio sin conexión');
    assert.equal(JSON.parse(env.store.salvatucursoInvitadoV4).version,4);
    if (conflict) {
      assert.equal(uploads.length,0,'un cambio remoto exige revisar, sin perder el borrador migrado');
      assert.equal(env.node('#dialog-sync').open,true);
      assert.equal(JSON.parse(env.store.salvatucursoCuentaV4).dirty,true);
    } else {
      assert.equal(uploads.length,1);assert.equal(uploads[0].revision,'r1');assert.equal(uploads[0].state.version,4);
      const migratedMeta=JSON.parse(env.store.salvatucursoCuentaV4);
      assert.equal(migratedMeta.dirty,false);assert.equal(JSON.parse(migratedMeta.base).version,4);
    }
  }
  console.log('OK: tareas generales, Inicio, Papelera, Deshacer, recarga, importación, migración de curso/cuenta/invitado y fallos de guardado');
})().catch(error => { console.error(error);process.exitCode=1; });
