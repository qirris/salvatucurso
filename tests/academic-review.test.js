/* Datos revisados: estimación, reglas, migración y guardado sin pérdida. */
const fs = require('fs'), vm = require('vm'), assert = require('assert/strict');
const clone = value => JSON.parse(JSON.stringify(value));
const code = ['attendance', 'attendance-ui', 'calendar', 'absence-day', 'storage', 'schedule', 'tasks', 'history', 'recovery', 'app']
  .map(name => fs.readFileSync('src/js/' + name + '.js', 'utf8')).join('\n') + '\nthis.getState=()=>state;this.setState=s=>state=s;';
function harness(saved) {
  const values = {}, nodes = new Map(); let fail = false;
  if (saved) values.miAsistenciaState = JSON.stringify(saved);
  function node(selector) {
    if (!nodes.has(selector)) {
      const events = {};
      nodes.set(selector, { value: '', innerHTML: '', textContent: '', dataset: {}, style: {}, hidden: false, disabled: false, open: false,
        addEventListener(name, fn) { events[name] = fn; }, fire(name) { events[name]?.({ preventDefault() {}, currentTarget: this }); },
        setAttribute(name, value) { this[name] = value; }, focus() {}, appendChild() {},
        showModal() { this.open = true; }, close() { this.open = false; },
        classList: { add() {}, remove() {}, toggle() {} }, querySelectorAll() { return []; } });
    }
    return nodes.get(selector);
  }
  const s = { console, Date, JSON, document: { addEventListener() {}, querySelector: node, querySelectorAll: () => [], body: node('body') },
    window: { addEventListener() {} }, setTimeout: () => 1, clearTimeout() {},
    localStorage: { getItem: key => values[key] ?? null, setItem(key, value) { if (fail) throw Error('sin espacio'); values[key] = String(value); }, removeItem(key) { delete values[key]; } } };
  vm.createContext(s); vm.runInContext(code, s); s.loadState();
  return { s, values, node, state: () => s.getState(), fail(value) { fail = value; } };
}
const old = { version: 2, etapa: 'fp_superior', asignaturas: [{ id: 'a', nombre: 'Redes', color: 'coral', horasSemanales: 4, semanas: 30, horasTotales: 120 }],
  faltas: [{ id: 'f1', asignaturaId: 'a', fecha: '2026-11-01', horas: 11, tipo: 'justificada', motivo: 'Consulta' },
    { id: 'f2', asignaturaId: 'a', fecha: '2026-11-03', horas: 10, tipo: 'no_justificada', sesion: { inicio: '08:00', fin: '18:00' } }],
  tareas: [{ id: 't', asignaturaId: 'a', titulo: 'Conservar', fechaEntrega: '2026-12-01', estado: 'completada' }],
  config: { onboarding: { etapaConfirmada: true, oculto: true } } };
let h = harness(old), s = h.s, subject = h.state().asignaturas[0];
assert.equal(h.state().version, 3);
assert.equal(h.values.miAsistenciaState, JSON.stringify(old));
assert.equal(h.values.salvatucursoStateV3, undefined, 'no guarda la migración antes de ofrecer la copia');
assert.equal(subject.computo.origen, 'estimado'); assert.equal(subject.horasTotales, 120);
assert.equal(h.state().faltas[1].sesion.fin, '18:00');
assert.equal(h.state().tareas[0].estado, 'completada'); assert.equal(h.state().config.onboarding.oculto, true);
s.showDataMigration(); assert.equal(h.node('#dialog-data-migration').open, true);
h.fail(true); h.node('#migration-continue').fire('click');
assert.equal(h.node('#dialog-data-migration').open, true); assert.equal(h.values.salvatucursoStateV3, undefined);
assert.equal(h.values.miAsistenciaState, JSON.stringify(old));
h.fail(false); h.node('#migration-continue').fire('click');
assert.equal(h.node('#dialog-data-migration').open, false); assert.ok(h.values.salvatucursoStateV3);
assert.equal(h.values.miAsistenciaState, JSON.stringify(old));
assert.equal(s.calcAsignatura(subject).pctAusencia, 17.5);
subject.horasTotales = 100; subject.computo.origen = 'confirmado';
assert.equal(s.calcAsignatura(subject).pctAusencia, 21); assert.equal(s.estadoAsignatura(subject, s.calcAsignatura(subject)).tone, 'red');
subject.horasTotales = 105;
assert.equal(s.calcAsignatura(subject).pctAusencia, 20); assert.equal(s.estadoAsignatura(subject, s.calcAsignatura(subject)).tone, 'yellow');
subject.computo.inicio = '2026-11-02';
assert.equal(s.calcAsignatura(subject).horasAusencia, 10); assert.equal(s.calcAsignatura(subject).excluidas.length, 1);
assert.equal(h.state().faltas.length, 2, 'no borra las faltas anteriores a matrícula');
const documented = { tipo: 'horas', valor: 10, operador: 'alcanzar', faltas: 'todas', referencia: 'Programación 2026/27, página 4', revision: '2026-11-23', etapa: 'fp_superior' };
subject.criterio = clone(documented);
assert.equal(s.estadoCentro(subject, s.calcAsignatura(subject)).tone, 'red');
subject.criterio.operador = 'superar';
assert.equal(s.estadoCentro(subject, s.calcAsignatura(subject)).tone, 'yellow');
subject.criterio = { ...documented, valor: 5, faltas: 'injustificadas' }; subject.computo.inicio = '';
assert.equal(s.calcAsignatura(subject).horasAusencia, 21, 'FP sigue contando las justificadas');
h.state().etapa = 'eso'; subject.criterio.etapa = 'eso'; subject.criterio.valor = 12;
assert.equal(s.estadoCentro(subject, s.calcAsignatura(subject)).tone, 'yellow', 'ESO cuenta solo injustificadas si el documento lo indica');
subject.criterio.faltas = 'todas'; assert.equal(s.estadoCentro(subject, s.calcAsignatura(subject)).tone, 'red');
subject.criterio.referencia = ''; assert.equal(s.estadoCentro(subject, s.calcAsignatura(subject)).tone, 'gray');
subject.criterio.tipo = 'manual'; assert.equal(s.estadoCentro(subject, s.calcAsignatura(subject)).label, 'Requiere revisión manual');
subject.criterio = null; h.state().config.criterio = { ...documented, etapa: 'eso' };
assert.equal(s.estadoCentro(subject, s.calcAsignatura(subject)).tone, 'red', 'hereda el criterio general');
h.state().etapa = 'bachillerato'; assert.equal(s.estadoCentro(subject, s.calcAsignatura(subject)).tone, 'gray', 'no traslada criterios entre etapas');
// Edición: semanas, total confirmado y conservación de totales antiguos al cambiar solo el color.
h.state().etapa = 'fp_superior'; subject = h.state().asignaturas[0];
subject.horasTotales = 120; subject.computo.origen = 'estimado'; subject.criterio = null;
h.node('#dlg-horas').value = '4'; s.mountSubjectHours('dlg', subject);
h.node('#dlg-semanas').value = '25';
let edited = s.readSubjectHours('dlg', subject); assert.equal(edited.horasTotales, 100);
h.node('#dlg-origen').value = 'confirmado'; h.node('#dlg-total').value = '105'; h.node('#dlg-horas').value = '6';
edited = s.readSubjectHours('dlg', subject); assert.equal(edited.horasTotales, 105);
subject.computo.origen = 'estimado'; subject.horasTotales = 99;
h.node('#dlg-horas').value = '4'; s.mountSubjectHours('dlg', subject);
assert.equal(s.readSubjectHours('dlg', subject).horasTotales, 99);
assert.ok(!h.node('#dlg-equation').textContent.includes('= 99'), 'no muestra una multiplicación falsa para un total migrado');
h.node('#dlg-semanas').value = '0'; assert.throws(() => s.readSubjectHours('dlg', subject));
h.node('#dlg-semanas').value = '30'; h.node('#dlg-inicio').value = '2026-02-30'; assert.throws(() => s.readSubjectHours('dlg', subject));
assert.equal(s.validAttendanceDate('2028-02-29'), true); assert.equal(s.validAttendanceDate('2026-02-29'), false);
subject.computo.origen = 'estimado'; s.renderAttendanceReview(); assert.equal(h.node('#settings-pending-more').hidden, false);
subject.computo.origen = 'confirmado'; subject.computo.inicio = ''; subject.criterio = clone(documented);
s.renderAttendanceReview(); assert.equal(h.node('#settings-pending-more').hidden, true);
s.saveState(); const before = JSON.stringify(h.state()); const next = clone(h.state()); next.asignaturas[0].horasTotales = 200;
h.fail(true); assert.throws(() => s.commitAcademicChange(next)); assert.equal(JSON.stringify(h.state()), before);
h.fail(false); h.values.salvatucursoStateV3 = '{"anotherTab":true}'; assert.throws(() => s.commitAcademicChange(next)); assert.equal(JSON.stringify(h.state()), before);
assert.throws(() => s.normalizeState({ ...clone(h.state()), version: 99 }));
const broken = clone(h.state()); delete broken.asignaturas[0].computo;
assert.throws(() => s.normalizeState(broken));
const roundtrip = s.normalizeState(JSON.parse(before)); assert.deepEqual(clone(roundtrip), JSON.parse(before));
const blank = harness(); assert.equal(blank.state().version, 3, 'una instalación nueva abre con configuración válida');
console.log('OK: horas estimadas/confirmadas, criterios documentados, matrícula, alertas, migración con copia previa, fallos y formatos incompatibles');
