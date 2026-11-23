/* ============================================================
   Mi Asistencia — attendance.js
   Etapas educativas y cálculos de asistencia y riesgo.
   ============================================================ */

const ETAPAS = {
  eso: { label: 'ESO', tipo: 'secundaria' },
  bachillerato: { label: 'Bachillerato', tipo: 'secundaria' },
  fp_basico: { label: 'FP Grado Básico', tipo: 'fp' },
  fp_medio: { label: 'FP Grado Medio', tipo: 'fp' },
  fp_superior: { label: 'FP Grado Superior', tipo: 'fp' }
};

function normalizarCriterio(value) {
  if (!value || typeof value !== 'object') return null;
  return { tipo: ['horas', 'porcentaje', 'manual'].includes(value.tipo) ? value.tipo : '',
    valor: value.valor !== '' && value.valor != null && Number.isFinite(Number(value.valor)) && Number(value.valor) >= 0 && (value.tipo !== 'porcentaje' || Number(value.valor) <= 100) ? Number(value.valor) : null,
    operador: value.operador === 'alcanzar' ? 'alcanzar' : 'superar',
    faltas: value.faltas === 'injustificadas' ? 'injustificadas' : 'todas',
    referencia: String(value.referencia || '').slice(0, 1000),
    revision: validAttendanceDate(value.revision) ? value.revision : '',
    etapa: ETAPAS[value.etapa] ? value.etapa : '' };
}
function validAttendanceDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00');
  return !isNaN(date) && date.getFullYear() > 0 &&
    date.getFullYear() === Number(value.slice(0, 4)) && date.getMonth() + 1 === Number(value.slice(5, 7)) && date.getDate() === Number(value.slice(8));
}
function validAttendanceRule(rule) {
  return rule === null || !!rule && ['', 'horas', 'porcentaje', 'manual'].includes(rule.tipo) &&
    (rule.valor === null || Number.isFinite(rule.valor) && rule.valor >= 0 && (rule.tipo !== 'porcentaje' || rule.valor <= 100)) &&
    ['superar', 'alcanzar'].includes(rule.operador) && ['todas', 'injustificadas'].includes(rule.faltas) &&
    typeof rule.referencia === 'string' && rule.referencia.length <= 1000 && typeof rule.revision === 'string' && (!rule.revision || validAttendanceDate(rule.revision)) &&
    ['', 'eso', 'bachillerato', 'fp_basico', 'fp_medio', 'fp_superior'].includes(rule.etapa);
}
function criterioAsignatura(a) {
  const rule = a.criterio || state.config.criterio;
  return rule && (!rule.etapa || rule.etapa === state.etapa) ? normalizarCriterio(rule) : null;
}
function esFP() { return (ETAPAS[state.etapa] || {}).tipo === 'fp'; }
function horasEstimadas(a) { return !a.computo || a.computo.origen !== 'confirmado'; }
function estadoCentro(a, c) {
  const rule = criterioAsignatura(a);
  if (!rule || !rule.tipo) return { tone: 'gray', label: 'Falta consultar el criterio del centro' };
  if (rule.tipo === 'manual') return { tone: 'gray', label: 'Requiere revisión manual' };
  if (rule.valor == null || (rule.tipo === 'porcentaje' && rule.valor > 100) || !rule.referencia.trim() || !rule.revision)
    return { tone: 'gray', label: 'Criterio del centro pendiente de documentar' };
  const hours = !esFP() && rule.faltas === 'injustificadas' ? c.horasInjustificadas : c.horasAusencia;
  const value = rule.tipo === 'horas' ? hours : c.horasPlanificadas > 0 ? hours / c.horasPlanificadas * 100 : null;
  if (value === null) return { tone: 'gray', label: 'Faltan horas para aplicar el criterio' };
  const exceeded = rule.operador === 'alcanzar' ? value >= rule.valor : value > rule.valor;
  if (exceeded) return { tone: 'red', label: 'Umbral del centro alcanzado: consulta su procedimiento' };
  if (value >= rule.valor * .75) return { tone: 'yellow', label: 'Cerca del umbral del centro' };
  return { tone: 'green', label: 'Por debajo del umbral de referencia' };
}

/* ---------- Cálculos ---------- */
function calcAsignatura(a) {
  const horasPlanificadas = Math.max(0, Number(a.horasTotales) || 0);
  const todas = state.faltas.filter(f => f.asignaturaId === a.id);
  const inicio = esFP() && a.computo ? a.computo.inicio : '';
  const faltas = todas.filter(f => !inicio || f.fecha >= inicio);
  const horasAusencia = faltas.reduce((s, f) => s + (Number(f.horas) || 0), 0);
  const horasInjustificadas = faltas.filter(f => f.tipo !== 'justificada').reduce((s, f) => s + (Number(f.horas) || 0), 0);
  const horasAsistidas = Math.max(0, horasPlanificadas - horasAusencia);
  const pct = horasPlanificadas > 0 ? (horasAsistidas / horasPlanificadas) * 100 : null;
  const pctAusencia = horasPlanificadas > 0 ? (horasAusencia / horasPlanificadas) * 100 : null;
  return { horasPlanificadas, horasAusencia, horasInjustificadas, horasAsistidas, pct, pctAusencia,
    excluidas: todas.filter(f => inicio && f.fecha < inicio), estimado: horasEstimadas(a) };
}

function estadoAsignatura(a, c) {
  const tipo = ETAPAS[state.etapa] ? ETAPAS[state.etapa].tipo : 'fp';
  if (!c.horasPlanificadas) {
    return { tone: 'gray', label: 'Faltan datos' };
  }
  if (tipo === 'fp') {
    if (c.pctAusencia > 20) return { tone: 'red', label: 'Supera el 20 % de ausencias de referencia (FP presencial)' };
    if (c.pctAusencia >= 15) return { tone: 'yellow', label: 'Aviso preventivo de la app: desde el 15 %' };
    return { tone: 'green', label: 'Por debajo del umbral de referencia' };
  }
  return estadoCentro(a, c);
}

function calcGlobal() {
  const activas = state.asignaturas.filter(a => !a.archivada && Number(a.horasTotales) > 0);
  const totalPlan = activas.reduce((s, a) => s + Number(a.horasTotales), 0);
  const totalAsist = activas.reduce((s, a) => s + calcAsignatura(a).horasAsistidas, 0);
  const pct = totalPlan > 0 ? (totalAsist / totalPlan) * 100 : null;
  const totalAusencia = activas.reduce((s, a) => s + calcAsignatura(a).horasAusencia, 0);
  return { totalPlan, totalAsist, pct, activas, totalAusencia, pctAusencia: totalPlan > 0 ? totalAusencia / totalPlan * 100 : null };
}
