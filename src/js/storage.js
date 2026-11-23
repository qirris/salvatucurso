/* ============================================================
   SalvaTuCurso — storage.js
   Persistencia en localStorage, migración y normalización de datos.
   ============================================================ */

const STORAGE_KEY = 'salvatucursoStateV3';
const PREVIOUS_STORAGE_KEY = 'miAsistenciaState';
const LEGACY_KEY = 'asistenciaData';
let persistedStateJSON = null;
let pendingDataMigration = null;

const DEFAULT_STATE = {
  version: 3,
  etapa: 'fp_superior',
  asignaturas: [],
  faltas: [],
  tareas: [],
  config: { criterio: { tipo: '', valor: null, operador: 'superar', faltas: 'todas', referencia: '', revision: '', etapa: 'fp_superior' } },
  horario: null
};

/* ---------- Utilidades ---------- */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/* ---------- Persistencia ---------- */
function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  persistedStateJSON = raw;
  const previous = raw || localStorage.getItem(PREVIOUS_STORAGE_KEY);
  if (previous) {
    state = normalizeState(JSON.parse(previous));
    if (!raw) pendingDataMigration = previous;
    return;
  }
  state = normalizeState(JSON.parse(JSON.stringify(DEFAULT_STATE)));
  migrateLegacy();
}

function migrateLegacy() {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return;
  try {
    const old = JSON.parse(raw);
    if (!old || !Array.isArray(old.asignaturas) || old.asignaturas.length === 0) return;
    state.etapa = old.nivel === 'eso' ? 'eso' : 'fp_superior';
    state.asignaturas = old.asignaturas.map((a, i) => ({
      id: uid(),
      nombre: a.nombre || ('Materia ' + (i + 1)),
      horasSemanales: null,
      semanas: null,
      horasTotales: Number(a.total) || 0,
      archivada: false
    }));
    state.faltas = [];
    old.asignaturas.forEach((a, i) => {
      const h = Number(a.faltas) || 0;
      if (h > 0 && state.asignaturas[i]) {
        state.faltas.push({
          id: uid(),
          asignaturaId: state.asignaturas[i].id,
          fecha: todayISO(),
          horas: h,
          tipo: 'no_justificada',
          motivo: 'Migrado desde versión anterior'
        });
      }
    });
    // Conservar copia de los datos antiguos antes de migrar
    localStorage.setItem(LEGACY_KEY + '_backup', raw);
    state = normalizeState(Object.assign({}, state, { version: 2 }));
    saveState();
  } catch (e) {
    console.warn('No se pudo migrar la versión anterior.', e);
  }
}

function saveState() {
  const serialized = JSON.stringify(state);
  localStorage.setItem(STORAGE_KEY, serialized);
  persistedStateJSON = serialized;
  if (typeof CourseAccount !== 'undefined') CourseAccount.queueSync();
  if (typeof TaskReminders !== 'undefined') TaskReminders.queueSync();
}

// Comparar con la copia leída, para admitir ampliaciones del formato al normalizar.
function isStoredStateCurrent() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return persistedStateJSON !== null ? saved === persistedStateJSON : !saved || saved === JSON.stringify(state);
}

function normalizeState(input) {
  if (input && input.version != null && ![1, 2, 3].includes(input.version)) throw new Error('Esta copia necesita una versión más reciente de SalvaTuCurso.');
  if (input && input.version === 3 && (!Array.isArray(input.asignaturas) || !Array.isArray(input.faltas) || !Array.isArray(input.tareas) || !input.config ||
    !validAttendanceRule(input.config.criterio) || input.asignaturas.some(a => !a || !a.computo || !['estimado', 'confirmado'].includes(a.computo.origen) ||
      !Number.isFinite(a.horasTotales) || a.horasTotales < 0 || typeof a.computo.referencia !== 'string' ||
      typeof a.computo.inicio !== 'string' || (a.computo.inicio && !validAttendanceDate(a.computo.inicio)) || !Object.prototype.hasOwnProperty.call(a, 'criterio') || !validAttendanceRule(a.criterio)) ||
    input.faltas.some(f => !f || !['centro', 'empresa', 'sin_especificar'].includes(f.procedencia))))
    throw new Error('La copia de versión 3 está incompleta. No se han sustituido tus datos.');
  const out = Object.assign({}, DEFAULT_STATE, input || {});
  out.version = 3;
  if (!ETAPAS[out.etapa]) out.etapa = 'fp_superior';

  out.asignaturas = Array.isArray(out.asignaturas)
    ? out.asignaturas.filter(a => a && a.id).map((a, i) => ({
        id: String(a.id),
        nombre: String(a.nombre || 'Sin nombre'),
        color: colorValido(a.color, i),
        horasSemanales: a.horasSemanales == null || a.horasSemanales === '' ? null : Number(a.horasSemanales),
        semanas: a.semanas == null || a.semanas === '' ? null : Number(a.semanas),
        horasTotales: Number.isFinite(Number(a.horasTotales)) ? Math.max(0, Number(a.horasTotales)) : 0,
        computo: { origen: a.computo?.origen === 'confirmado' ? 'confirmado' : 'estimado',
          referencia: String(a.computo?.referencia || '').slice(0, 1000),
          inicio: validAttendanceDate(a.computo?.inicio) ? a.computo.inicio : '' },
        criterio: normalizarCriterio(a.criterio),
        archivada: !!a.archivada
      }))
    : [];

  out.faltas = Array.isArray(out.faltas)
    ? out.faltas.filter(f => f && f.id && f.asignaturaId).map(f => {
        const record = {
          id: String(f.id), asignaturaId: String(f.asignaturaId), fecha: String(f.fecha || todayISO()),
          horas: Number(f.horas) || 0, tipo: f.tipo === 'justificada' ? 'justificada' : 'no_justificada',
          motivo: String(f.motivo || ''),
          procedencia: ['centro', 'empresa'].includes(f.procedencia) ? f.procedencia : 'sin_especificar'
        };
        const session = normalizeAbsenceSession(f.sesion, record.horas);
        if (session) record.sesion = session;
        return record;
      })
    : [];

  out.tareas = Array.isArray(out.tareas)
    ? out.tareas.filter(t => t && t.id && t.asignaturaId).map(t => ({
        id: String(t.id),
        asignaturaId: String(t.asignaturaId),
        asignaturaNombre: String(t.asignaturaNombre || ''),
        slotKey: t.slotKey ? String(t.slotKey) : '',
        dia: String(t.dia || ''),
        horaInicio: String(t.horaInicio || ''),
        horaFin: String(t.horaFin || ''),
        fechaCreacion: String(t.fechaCreacion || todayISO()),
        fechaEntrega: String(t.fechaEntrega || ''),
        tipo: ['deberes', 'estudiar', 'examen', 'trabajo', 'proyecto', 'otros', 'nota'].includes(t.tipo) ? t.tipo : 'deberes',
        prioridad: ['baja', 'normal', 'alta'].includes(t.prioridad) ? t.prioridad : 'normal',
        estado: t.estado === 'completada' ? 'completada' : 'pendiente',
        titulo: String(t.titulo || ''),
        descripcion: String(t.descripcion || '')
      }))
    : [];

  out.config = Object.assign({ criterio: { tipo: '', valor: null } }, out.config || {});
  const savedOnboarding = out.config.onboarding || {};
  out.config.onboarding = {
    etapaConfirmada: typeof savedOnboarding.etapaConfirmada === 'boolean' ? savedOnboarding.etapaConfirmada : out.asignaturas.some(a => !a.archivada),
    oculto: savedOnboarding.oculto === true
  };
  out.config.criterio = normalizarCriterio(out.config.criterio) || normalizarCriterio({});
  if (!out.config.criterio.etapa) out.config.criterio.etapa = out.etapa;
  out.config.calendario = normalizeCalendar(out.config.calendario);
  out.horario = normalizeHorario(out.horario);
  return out;
}

// Las nuevas ediciones se aplican completas o conservan el estado anterior.
function commitAcademicChange(next) {
  if (!isStoredStateCurrent()) throw new Error('Tus datos han cambiado en otra pestaña. Recarga antes de guardar.');
  const previous = state;
  try { state = next; saveState(); }
  catch (error) { state = previous; throw error; }
}
