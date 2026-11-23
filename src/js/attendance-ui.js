/* Formularios de horas y criterios, con guardado explícito y revisión accesible. */
function attendanceRuleFields(prefix, inherit) {
  return `${inherit ? `<div class="field"><label for="${prefix}-mode">Criterio de esta asignatura</label><select id="${prefix}-mode"><option value="inherit">Usar el criterio general de Ajustes</option><option value="custom">Definir una excepción</option></select></div>` : ''}
    <div class="rule-fields" id="${prefix}-fields">
      <div class="form-row"><div class="field"><label for="${prefix}-tipo">Unidad y alcance</label><select id="${prefix}-tipo"><option value="">Sin definir</option><option value="porcentaje">Porcentaje de ausencia del curso completo</option><option value="horas">Horas de ausencia del curso completo</option><option value="manual">Trimestres, sesiones u otra regla: revisión manual</option></select></div>
      <div class="field"><label for="${prefix}-valor">Umbral</label><input id="${prefix}-valor" type="number" min="0" step="any"></div></div>
      <div class="form-row"><div class="field"><label for="${prefix}-operador">El umbral se aplica al</label><select id="${prefix}-operador"><option value="superar">Superar el valor</option><option value="alcanzar">Alcanzar el valor</option></select></div>
      <div class="field"><label for="${prefix}-faltas">Ausencias que cuenta el centro</label><select id="${prefix}-faltas"><option value="todas">Justificadas y no justificadas</option><option value="injustificadas">Solo no justificadas (ESO/Bachillerato)</option></select><span class="hint">En FP siempre se cuentan ambas.</span></div></div>
      <div class="field"><label for="${prefix}-referencia">Documento del centro y apartado</label><input id="${prefix}-referencia" type="text" maxlength="1000" placeholder="Plan de Convivencia o programación, curso y página"><span class="hint">Es necesario para aplicar el criterio. Si no lo conoces, puedes dejarlo pendiente.</span></div>
      <div class="field"><label for="${prefix}-revision">Fecha en que revisaste el documento</label><input id="${prefix}-revision" type="date"></div>
    </div>`;
}
function fillAttendanceRule(prefix, value, inherit) {
  const rule = normalizarCriterio(value) || normalizarCriterio({});
  if (inherit) $('#' + prefix + '-mode').value = value ? 'custom' : 'inherit';
  for (const field of ['tipo', 'valor', 'operador', 'faltas', 'referencia', 'revision']) $('#' + prefix + '-' + field).value = rule[field] == null ? '' : rule[field];
  syncAttendanceRule(prefix, inherit);
}
function syncAttendanceRule(prefix, inherit) {
  const inherited = inherit && $('#' + prefix + '-mode').value === 'inherit';
  $('#' + prefix + '-fields').hidden = !!inherited;
  const type = $('#' + prefix + '-tipo').value;
  $('#' + prefix + '-valor').disabled = inherited || !['horas', 'porcentaje'].includes(type);
  $('#' + prefix + '-operador').disabled = inherited || !['horas', 'porcentaje'].includes(type);
  $('#' + prefix + '-faltas').disabled = esFP() || inherited;
  if (esFP()) $('#' + prefix + '-faltas').value = 'todas';
}
function readAttendanceRule(prefix, inherit) {
  if (inherit && $('#' + prefix + '-mode').value === 'inherit') return null;
  const value = { etapa: state.etapa };
  for (const field of ['tipo', 'valor', 'operador', 'faltas', 'referencia', 'revision']) value[field] = $('#' + prefix + '-' + field).value;
  if (['horas', 'porcentaje'].includes(value.tipo) && (value.valor === '' || !Number.isFinite(Number(value.valor)) || Number(value.valor) < 0 || (value.tipo === 'porcentaje' && Number(value.valor) > 100))) throw new Error('Introduce un umbral válido: horas no negativas o porcentaje entre 0 y 100.');
  if (value.revision && (!validAttendanceDate(value.revision) || value.revision > todayISO())) throw new Error('La fecha de revisión debe existir y no ser futura.');
  if (esFP()) value.faltas = 'todas';
  return normalizarCriterio(value);
}
function mountSubjectHours(prefix, a) {
  const host = $('#' + prefix + '-computo');
  if (!host) return;
  host.innerHTML = `<div class="field"><label for="${prefix}-origen">¿Cómo calculamos las horas del curso?</label><select id="${prefix}-origen"><option value="estimado">Estimar las horas</option><option value="confirmado">Introducir el total del centro</option></select></div>
    <div class="field" id="${prefix}-weeks-wrap"><label for="${prefix}-semanas">Semanas previstas</label><input type="number" id="${prefix}-semanas" min="0.1" max="53" step="any"><span class="hint">Empezamos con 30 semanas como suposición. Puedes cambiarlas.</span></div>
    <div class="field" id="${prefix}-total-wrap"><label for="${prefix}-total">Total de horas computables</label><input type="number" id="${prefix}-total" min="0.01" step="any"><span class="hint">Confirmadas por ti según la información del centro.</span></div>
    <p class="hours-equation" id="${prefix}-equation" role="status"></p>
    <div class="field"><label for="${prefix}-fuente">Dónde has consultado las horas (opcional)</label><input type="text" id="${prefix}-fuente" maxlength="1000" placeholder="Programación del módulo o consulta a tutoría"></div>
    <div class="field" id="${prefix}-inicio-wrap"><label for="${prefix}-inicio">Matrícula o inicio del cómputo en FP (opcional)</label><input type="date" id="${prefix}-inicio"><span class="hint">Las faltas anteriores se conservan, pero no cuentan desde esta fecha. El total debe corresponder a ese periodo e incluir centro y empresa cuando proceda.</span></div>
    <details class="attendance-help"><summary>¿Dónde encuentro las horas?</summary><p>Consulta la programación didáctica del módulo o materia, la información del curso en la plataforma del centro o pregunta al profesorado o a tutoría. Busca «duración total» o «carga horaria». Mientras tanto puedes utilizar una estimación.</p></details>
    <details class="attendance-help"><summary>Criterio del centro para esta asignatura</summary>${attendanceRuleFields(prefix + '-rule', true)}</details>
    <p class="form-feedback" id="${prefix}-attendance-error" role="alert"></p>`;
  $('#' + prefix + '-origen').value = a?.computo?.origen || 'estimado';
  $('#' + prefix + '-semanas').value = a?.semanas || 30;
  $('#' + prefix + '-total').value = a?.horasTotales || '';
  $('#' + prefix + '-fuente').value = a?.computo?.referencia || '';
  $('#' + prefix + '-inicio').value = a?.computo?.inicio || '';
  $('#' + prefix + '-inicio-wrap').hidden = !esFP();
  fillAttendanceRule(prefix + '-rule', a?.criterio, true);
  const update = () => updateHoursEquation(prefix, a);
  host.oninput = update;
  host.onchange = () => { syncAttendanceRule(prefix + '-rule', true); update(); };
  $('#' + (prefix === 'asig' ? 'asig-horas' : 'dlg-horas')).oninput = update;
  update();
}
function updateHoursEquation(prefix, previous) {
  const estimated = $('#' + prefix + '-origen').value === 'estimado';
  $('#' + prefix + '-weeks-wrap').hidden = !estimated;
  $('#' + prefix + '-total-wrap').hidden = estimated;
  const weekly = Number($('#' + (prefix === 'asig' ? 'asig-horas' : 'dlg-horas')).value);
  const weeks = Number($('#' + prefix + '-semanas').value);
  const unchanged = previous && horasEstimadas(previous) && weekly === (Number(previous.horasSemanales) || 0) && weeks === (Number(previous.semanas) || 30);
  const total = unchanged ? previous.horasTotales : weekly * weeks;
  $('#' + prefix + '-equation').textContent = estimated ?
    (unchanged && (!weekly || Math.abs(total - weekly * weeks) > .000001) ? `Estimación orientativa: se conserva el total anterior de ${fmt(total)} h hasta que cambies las horas o las semanas.` : `Estimación orientativa: ${fmt(weekly)} h/sem × ${fmt(weeks)} semanas = ${fmt(total)} h.`) :
    'Confirmadas por ti. Cambiar el horario semanal no modifica este total.';
}
function readSubjectHours(prefix, previous) {
  const weeklyInput = $('#' + (prefix === 'asig' ? 'asig-horas' : 'dlg-horas'));
  const weekly = weeklyInput.value === '' ? null : Number(weeklyInput.value);
  const weeks = Number($('#' + prefix + '-semanas').value);
  const origen = $('#' + prefix + '-origen').value;
  if (weekly !== null && (!Number.isFinite(weekly) || weekly <= 0)) throw new Error('Las horas semanales deben ser mayores que cero o quedar vacías si conoces el total.');
  const unchanged = previous && horasEstimadas(previous) && origen === 'estimado' && weekly === (previous.horasSemanales == null ? null : Number(previous.horasSemanales)) && weeks === (Number(previous.semanas) || 30);
  if (origen === 'estimado' && !unchanged && (!weekly || !Number.isFinite(weeks) || weeks <= 0 || weeks > 53)) throw new Error('Para estimar, introduce horas semanales y entre 0 y 53 semanas (mayor que cero).');
  const total = origen === 'confirmado' ? Number($('#' + prefix + '-total').value) : unchanged ? previous.horasTotales : weekly * weeks;
  if (!Number.isFinite(total) || total <= 0) throw new Error('Introduce un total de horas mayor que cero.');
  const inicio = $('#' + prefix + '-inicio').value;
  if (inicio && !validAttendanceDate(inicio)) throw new Error('La fecha de matrícula debe ser una fecha válida.');
  return { horasSemanales: weekly, semanas: unchanged ? previous.semanas : origen === 'estimado' ? weeks : previous?.semanas || null, horasTotales: total,
    computo: { origen, inicio, referencia: $('#' + prefix + '-fuente').value.trim() }, criterio: readAttendanceRule(prefix + '-rule', true) };
}
function subjectAttendanceNote(a, c) {
  const center = estadoCentro(a, c);
  return `<p class="attendance-detail">${horasEstimadas(a) ? 'Estimación orientativa · Horas pendientes de confirmar' : 'Horas confirmadas por ti'}${a.computo?.referencia ? ' · ' + esc(a.computo.referencia) : ''}</p>
    ${c.horasAusencia > c.horasPlanificadas ? '<p class="attendance-detail">Las ausencias superan el total previsto. Revisa las horas y los registros antes de interpretar el porcentaje.</p>' : ''}
    ${esFP() ? `<p class="attendance-detail">Centro: ${esc(center.label)}.</p>` : ''}
    ${c.excluidas.length ? `<p class="attendance-detail">Fuera del cómputo por ser anteriores a la matrícula: ${c.excluidas.length} registro(s), ${formatAbsenceDuration(c.excluidas.reduce((sum, f) => sum + f.horas, 0))}. Siguen en Historial.</p>` : ''}`;
}
function attendancePending(a) {
  const rule = criterioAsignatura(a);
  return horasEstimadas(a) || !(a.horasTotales > 0) || calcAsignatura(a).horasAusencia > a.horasTotales || !rule?.tipo || (rule.tipo !== 'manual' && (rule.valor === null || !rule.referencia.trim() || !rule.revision));
}
function renderAttendanceReview() {
  const host = $('#attendance-review-list');
  if (!host) return;
  const subjects = state.asignaturas.filter(a => !a.archivada && attendancePending(a));
  $('#attendance-review-count').textContent = subjects.length ? subjects.length + ' asignatura(s) con datos pendientes' : 'Tus datos están revisados';
  host.innerHTML = subjects.length ? subjects.map(a => `<li><div><strong>${esc(a.nombre)}</strong><span>${horasEstimadas(a) ? 'Horas estimadas. ' : ''}${esc(estadoCentro(a, calcAsignatura(a)).label)}</span></div><button class="btn btn-secondary btn-sm" type="button" data-review-subject="${esc(a.id)}">Revisar</button></li>`).join('') : '<li>No hay asignaturas activas pendientes de revisar.</li>';
  for (const selector of ['#settings-pending-desktop', '#settings-pending-mobile', '#settings-pending-more']) {
    const badge = $(selector);
    if (badge) { badge.hidden = !subjects.length; badge.textContent = String(subjects.length); badge.setAttribute('aria-label', subjects.length + ' asignaturas con datos pendientes en Ajustes'); }
  }
  const form = $('#center-rule-form');
  if (form && form.dataset.dirty !== 'true') {
    const rule = state.config.criterio;
    fillAttendanceRule('center-rule', rule && (!rule.etapa || rule.etapa === state.etapa) ? rule : null, false);
  }
}
function attendanceFormError(prefix, error) {
  const feedback = $('#' + prefix + '-attendance-error');
  feedback.textContent = error.message || 'No se pudo guardar. Tus datos anteriores se conservan.';
  feedback.setAttribute('tabindex', '-1'); feedback.focus();
}
function bindAttendanceSettings() {
  const desktopBadge = $('#settings-pending-desktop');
  document.querySelector('.app-nav [data-view="config"]')?.appendChild?.(desktopBadge);
  document.querySelector('.mobile-more-link[data-view="config"]')?.appendChild?.($('#settings-pending-mobile'));
  mountSubjectHours('asig', null);
  $('#center-rule-inputs').innerHTML = attendanceRuleFields('center-rule', false);
  $('#center-rule-form').addEventListener('input', event => { event.currentTarget.dataset.dirty = 'true'; });
  $('#center-rule-form').addEventListener('change', event => { event.currentTarget.dataset.dirty = 'true'; syncAttendanceRule('center-rule', false); });
  $('#center-rule-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const next = JSON.parse(JSON.stringify(state));
      next.config.criterio = readAttendanceRule('center-rule', false);
      commitAcademicChange(next); event.currentTarget.dataset.dirty = 'false';
      $('#center-rule-status').textContent = 'Criterio guardado. Las excepciones por asignatura se conservan.'; render();
    } catch (error) { $('#center-rule-status').textContent = error.message; }
  });
  $('#attendance-review-list').addEventListener('click', event => {
    const target = event.target.closest('[data-review-subject]');
    if (target) openEdit(target.dataset.reviewSubject);
  });
  $('#dialog-asig').addEventListener('close', () => setTimeout(() => {
    const origin = document.querySelector('[data-review-subject="' + editingId + '"]') || document.querySelector('[data-edit="' + editingId + '"]');
    origin?.focus();
  }, 0));
}
function startAccountServices() {
  if (typeof CourseAccount !== 'undefined') CourseAccount.bind();
  if (typeof TaskReminders !== 'undefined') TaskReminders.bind();
}
function showDataMigration() {
  if (!pendingDataMigration) { startAccountServices(); return; }
  const dialog = $('#dialog-data-migration');
  $('#migration-download').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([pendingDataMigration], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'salvatucurso-antes-de-revisar-horas.json'; link.click(); URL.revokeObjectURL(url);
  });
  $('#migration-continue').addEventListener('click', () => {
    try { saveState(); pendingDataMigration = null; dialog.close(); startAccountServices(); }
    catch (error) { $('#migration-status').textContent = 'No se ha podido guardar la versión nueva. Tu curso anterior permanece intacto. Libera espacio y vuelve a intentarlo.'; }
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); });
  dialog.showModal(); $('#migration-download').focus();
}
