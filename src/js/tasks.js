/* ============================================================
   SalvaTuCurso — tasks.js
   Gestión completa de agenda académica: deberes, exámenes, trabajos, notas.
   ============================================================ */

let editingTaskId = null;
let activeSlotContext = null;
let taskActiveTab = 'pendiente';

const TIPOS_TAREA = {
  deberes: { label: 'Deberes', badge: 'blue', icon: '' },
  estudiar: { label: 'Estudiar', badge: 'purple', icon: '' },
  examen: { label: 'Examen', badge: 'red', icon: '' },
  trabajo: { label: 'Trabajo', badge: 'orange', icon: '' },
  proyecto: { label: 'Proyecto', badge: 'orange', icon: '' },
  otros: { label: 'Otros', badge: 'gray', icon: '' },
  nota: { label: 'Nota personal', badge: 'teal', icon: '' }
};

const PRIORIDADES = {
  baja: { label: 'Baja', cls: 'p-low' },
  normal: { label: 'Normal', cls: 'p-normal' },
  alta: { label: 'Alta', cls: 'p-high' }
};

/* ---------- Utilidades de fecha y estado ---------- */
function diasHasta(fechaStr) {
  if (!validCalendarDate(fechaStr)) return null;
  return calendarDayNumber(fechaStr) - calendarDayNumber(todayISO());
}

function formatoEntrega(fechaStr) {
  if (!fechaStr) return 'Sin fecha de entrega';
  const d = diasHasta(fechaStr);
  if (d === 0) return 'Hoy';
  if (d === 1) return 'Mañana';
  if (d > 1 && d <= 7) return `En ${d} días`;
  if (d < 0) return `Vencida (${Math.abs(d)}d)`;
  return `Entrega: ${fechaStr}`;
}

function calcularEstadoVisualTask(t) {
  if (t.estado === 'eliminada') return { tone: 'gray', label: 'En la Papelera', cls: 'none' };
  if (t.estado === 'completada') return { tone: 'green', label: 'Completada', cls: 'ok' };
  const d = diasHasta(t.fechaEntrega);
  if (d != null && d < 0) return { tone: 'red', label: 'Vencida', cls: 'over' };
  if (t.prioridad === 'alta') return { tone: 'red', label: 'Urgente', cls: 'over' };
  if (d != null && d <= 2) return { tone: 'yellow', label: d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : `En ${d} días`, cls: 'miss' };
  return { tone: 'blue', label: 'Pendiente', cls: 'none' };
}

/* ---------- Consultas de tareas ---------- */
function getTareasForSlot(slotKey) {
  if (!state || !state.tareas) return [];
  return state.tareas.filter(t => t.estado !== 'eliminada' && t.slotKey === slotKey);
}

function getTareasForAsignatura(asignaturaId) {
  if (!state || !state.tareas) return [];
  return state.tareas.filter(t => t.estado !== 'eliminada' && t.asignaturaId === asignaturaId);
}

function countTareasPendientesSlot(slotKey) {
  return getTareasForSlot(slotKey).filter(t => t.estado === 'pendiente').length;
}

function countTareasPendientesAsignatura(asignaturaId) {
  return getTareasForAsignatura(asignaturaId).filter(t => t.estado === 'pendiente').length;
}

/* ---------- Acciones de tareas ---------- */
function crearTarea(data) {
  if (!state.tareas) state.tareas = [];
  const a = asignaturaPorId(data.asignaturaId);
  const nueva = {
    id: uid(),
    asignaturaId: String(data.asignaturaId || ''),
    asignaturaNombre: a ? a.nombre : String(data.asignaturaNombre || ''),
    slotKey: data.slotKey ? String(data.slotKey) : '',
    dia: String(data.dia || ''),
    horaInicio: String(data.horaInicio || ''),
    horaFin: String(data.horaFin || ''),
    fechaCreacion: todayISO(),
    fechaEntrega: data.fechaEntrega ? String(data.fechaEntrega) : '',
    tipo: TIPOS_TAREA[data.tipo] ? data.tipo : 'deberes',
    prioridad: PRIORIDADES[data.prioridad] ? data.prioridad : 'normal',
    estado: data.estado === 'completada' ? 'completada' : 'pendiente',
    titulo: String(data.titulo || '').trim(),
    descripcion: String(data.descripcion || '').trim()
  };
  commitAcademicChange({ ...state, tareas: state.tareas.concat(nueva) });
  return nueva;
}

function actualizarTarea(id, data) {
  const original = state.tareas.find(x => x.id === id);
  if (!original || original.estado === 'eliminada') return false;
  const t = { ...original, asignaturaId: String(data.asignaturaId || '') };
  const a = asignaturaPorId(t.asignaturaId);
  t.asignaturaNombre = a ? a.nombre : '';
  if (t.asignaturaId !== original.asignaturaId) t.slotKey = t.dia = t.horaInicio = t.horaFin = '';
  t.titulo = String(data.titulo || '').trim();
  t.descripcion = String(data.descripcion || '').trim();
  t.tipo = TIPOS_TAREA[data.tipo] ? data.tipo : 'deberes';
  t.prioridad = PRIORIDADES[data.prioridad] ? data.prioridad : 'normal';
  t.fechaEntrega = data.fechaEntrega ? String(data.fechaEntrega) : '';
  if (data.estado) t.estado = data.estado === 'completada' ? 'completada' : 'pendiente';
  commitAcademicChange({ ...state, tareas: state.tareas.map(item => item.id === id ? t : item) });
  return true;
}

function eliminarTarea(id, originDialog = null) {
  return UndoManager.remove('tareas', id, originDialog);
}

function alternarEstadoTarea(id) {
  const t = state.tareas.find(x => x.id === id);
  if (!t || t.estado === 'eliminada') return;
  const estado = t.estado === 'completada' ? 'pendiente' : 'completada';
  try { commitAcademicChange({ ...state, tareas: state.tareas.map(item => item.id === id ? { ...item, estado } : item) }); }
  catch (error) { render(); return toast('No se ha podido guardar. ' + error.message); }
  toast(estado === 'completada' ? 'Marcada como completada' : 'Marcada como pendiente');
  render();
}

function restaurarTarea(id) {
  const task = state.tareas.find(item => item.id === id && item.estado === 'eliminada');
  if (!task) return false;
  try { commitAcademicChange({ ...state, tareas: state.tareas.map(item => item.id === id ? { ...item, estado: 'pendiente' } : item) }); }
  catch (error) { toast('No se ha podido restaurar. ' + error.message); return false; }
  render(); toast('Tarea restaurada en Pendientes');
  const next = $('#tasks-list').querySelector('[data-restoretarea]');
  (next || $('[data-statustab="eliminada"]'))?.focus();
  return true;
}

/* ---------- Diálogos e Interfaz de Tareas ---------- */
function openTaskDialog(prefill = {}) {
  editingTaskId = null;
  clearFormErrors($('#dialog-task'));
  const asigs = state.asignaturas.filter(a => !a.archivada);
  const selAsig = $('#dlg-task-asig');
  if (selAsig) {
    selAsig.innerHTML = '<option value="">Sin asignatura · General</option>' + asigs.map(a => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('');
    selAsig.value = '';
    if (prefill.asignaturaId) selAsig.value = prefill.asignaturaId;
  }

  $('#dlg-task-title').textContent = prefill.tipo === 'nota' ? 'Nueva nota' : 'Nueva tarea';
  $('#dlg-task-titulo').value = '';
  $('#dlg-task-desc').value = '';
  $('#dlg-task-tipo').value = prefill.tipo || 'deberes';
  $('#dlg-task-prioridad').value = prefill.prioridad || 'normal';
  $('#dlg-task-fecha').value = prefill.fechaEntrega || '';
  $('#dlg-task-estado').value = 'pendiente';

  activeSlotContext = prefill.slotKey ? {
    slotKey: prefill.slotKey,
    dia: prefill.dia,
    horaInicio: prefill.horaInicio,
    horaFin: prefill.horaFin
  } : null;

  $('#task-more-options').open = prefill.tipo === 'nota' || !!(prefill.tipo && prefill.tipo !== 'deberes') || !!(prefill.prioridad && prefill.prioridad !== 'normal');
  $('#dialog-task').showModal();
  $('#dialog-task').querySelector('.dialog-content').scrollTop = 0;
  $('#dlg-task-titulo').focus();
}

function openTaskEditDialog(id) {
  const t = state.tareas.find(x => x.id === id);
  if (!t || t.estado === 'eliminada') return;
  editingTaskId = id;
  clearFormErrors($('#dialog-task'));
  const asigs = state.asignaturas.filter(a => !a.archivada || a.id === t.asignaturaId);
  const selAsig = $('#dlg-task-asig');
  if (selAsig) {
    selAsig.innerHTML = '<option value="">Sin asignatura · General</option>' + asigs.map(a => `<option value="${a.id}">${esc(a.nombre)}${a.archivada ? ' (archivada)' : ''}</option>`).join('');
    selAsig.value = t.asignaturaId;
  }

  $('#dlg-task-title').textContent = t.tipo === 'nota' ? 'Editar nota' : 'Editar tarea';
  $('#dlg-task-titulo').value = t.titulo;
  $('#dlg-task-desc').value = t.descripcion;
  $('#dlg-task-tipo').value = t.tipo;
  $('#dlg-task-prioridad').value = t.prioridad;
  $('#dlg-task-fecha').value = t.fechaEntrega;
  $('#dlg-task-estado').value = t.estado;

  activeSlotContext = t.slotKey ? {
    slotKey: t.slotKey,
    dia: t.dia,
    horaInicio: t.horaInicio,
    horaFin: t.horaFin
  } : null;

  $('#task-more-options').open = t.tipo !== 'deberes' || t.prioridad !== 'normal' || t.estado !== 'pendiente' || !!t.descripcion;
  $('#dialog-task').showModal();
  $('#dialog-task').querySelector('.dialog-content').scrollTop = 0;
  $('#dlg-task-titulo').focus();
}

function guardarTareaModal() {
  const dialogEl = $('#dialog-task');
  clearFormErrors(dialogEl);

  const tituloInput = $('#dlg-task-titulo');
  const asigSelect = $('#dlg-task-asig');
  const titulo = tituloInput.value.trim();
  const asignaturaId = asigSelect.value;

  let hasError = false;
  let firstErr = null;

  if (!titulo || titulo.length > 200) {
    setFieldError(tituloInput, 'Escribe un título de entre 1 y 200 caracteres.');
    if (!firstErr) firstErr = tituloInput;
    hasError = true;
  }
  if (asignaturaId && !asignaturaPorId(asignaturaId)) {
    setFieldError(asigSelect, 'La asignatura ya no existe. Elige otra o deja la tarea como General.');
    if (!firstErr) firstErr = asigSelect;
    hasError = true;
  }

  if (hasError) {
    if (firstErr) firstErr.focus();
    return toast('Revisa los campos marcados en rojo');
  }

  const a = asignaturaPorId(asignaturaId);
  const tipo = $('#dlg-task-tipo').value;
  const prioridad = $('#dlg-task-prioridad').value;
  const fechaEntrega = $('#dlg-task-fecha').value;
  const estado = $('#dlg-task-estado').value;
  const descripcion = $('#dlg-task-desc').value.trim();

  const data = {
    asignaturaId,
    asignaturaNombre: a ? a.nombre : '',
    titulo,
    descripcion,
    tipo,
    prioridad,
    fechaEntrega,
    estado,
    slotKey: activeSlotContext ? activeSlotContext.slotKey : '',
    dia: activeSlotContext ? activeSlotContext.dia : '',
    horaInicio: activeSlotContext ? activeSlotContext.horaInicio : '',
    horaFin: activeSlotContext ? activeSlotContext.horaFin : ''
  };

  try {
    if (editingTaskId) {
      if (!actualizarTarea(editingTaskId, data)) throw new Error('La tarea ya no está disponible.');
      toast('Actividad actualizada');
    } else {
      crearTarea(data);
      toast('Actividad creada');
    }
  } catch (error) { return toast('No se ha podido guardar. ' + error.message); }

  dialogEl.close();
  render();
}

/* ---------- Panel de detalle de clase ---------- */
function openClassDetail(day, fid) {
  const h = state.horario;
  const f = h.franjas.find(x => x.id === fid);
  const c = getCasilla(h, day, fid);
  if (!f || !c || !c.asignaturaId) return;

  const a = asignaturaPorId(c.asignaturaId);
  if (!a) return;

  const slotKey = day + '|' + fid;
  const tareasSlot = getTareasForSlot(slotKey);
  const tareasAsig = getTareasForAsignatura(a.id);

  const container = $('#dialog-class-body');
  if (!container) return;

  container.innerHTML = `
    <div class="class-detail-header sc-${a.color}">
      <span class="color-dot"></span>
      <div>
        <h3>${esc(a.nombre)}</h3>
        <p class="muted">${diaLabel(day)} · ${f.inicio}–${f.fin}</p>
      </div>
    </div>

    <div class="class-actions-bar" style="margin-top:1rem">
      <button class="btn btn-sm" type="button" id="btn-class-add-task" data-slot="${slotKey}" data-asig="${a.id}" data-dia="${day}" data-inicio="${f.inicio}" data-fin="${f.fin}">${uiIcon('plus')} Añadir tarea / examen</button>
      <button class="btn btn-secondary btn-sm" type="button" id="btn-class-change" data-cell-key="${esc(slotKey)}" ${scheduleEditing ? 'disabled' : ''}>${uiIcon('edit')} Cambiar clase</button>
      <button class="btn btn-ghost btn-sm" type="button" id="btn-class-add-note" data-slot="${slotKey}" data-asig="${a.id}" data-dia="${day}" data-inicio="${f.inicio}" data-fin="${f.fin}">${uiIcon('note')} Añadir nota</button>
    </div>

    ${scheduleEditing ? '<p class="hint">Guarda o cancela la configuración del horario antes de cambiar esta clase.</p>' : ''}
    <div class="class-tasks-section" style="margin-top:1.25rem">
      <h4 class="section-title" style="margin-top:0">Tareas de esta sesión (${tareasSlot.length})</h4>
      ${tareasSlot.length === 0 ? '<p class="muted" style="font-size:0.85rem">No hay actividades registradas para esta clase concreta.</p>' : ''}
      <div class="tasks-mini-list">
        ${tareasSlot.map(t => renderTaskMiniCard(t)).join('')}
      </div>

      <h4 class="section-title" style="margin-top:1.25rem">Otras tareas de ${esc(a.nombre)} (${tareasAsig.filter(t => t.slotKey !== slotKey).length})</h4>
      <div class="tasks-mini-list">
        ${tareasAsig.filter(t => t.slotKey !== slotKey).length === 0 ? '<p class="muted" style="font-size:0.85rem">Sin otras tareas para esta asignatura.</p>' : tareasAsig.filter(t => t.slotKey !== slotKey).map(t => renderTaskMiniCard(t)).join('')}
      </div>
    </div>
  `;

  $('#dialog-class-detail').showModal();
}

function renderTaskMiniCard(t) {
  const st = calcularEstadoVisualTask(t);
  const tipoInfo = TIPOS_TAREA[t.tipo] || TIPOS_TAREA.deberes;
  return `
    <div class="task-mini-item ${t.estado === 'completada' ? 'completed' : ''}">
      <label class="checkbox-target"><input type="checkbox" data-toggletask="${t.id}" ${t.estado === 'completada' ? 'checked' : ''} aria-label="Marcar como ${t.estado === 'completada' ? 'pendiente' : 'completada'}: ${esc(t.titulo)}"></label>
      <div class="tmi-main">
        <div class="tmi-title">${tipoInfo.icon} ${esc(t.titulo)}</div>
        <div class="tmi-sub">${tipoInfo.label}${t.fechaEntrega ? ' · ' + formatoEntrega(t.fechaEntrega) : ''}</div>
      </div>
      <span class="badge ${st.tone}">${st.label}</span>
      <button class="btn btn-ghost btn-sm" type="button" data-edittask="${t.id}" aria-label="Editar">${uiIcon('edit')}</button>
      <button class="btn btn-danger btn-sm" type="button" data-deltask="${t.id}" aria-label="Eliminar">${uiIcon('trash')}</button>
    </div>
  `;
}

/* ---------- Render: Vista «Mis tareas» ---------- */
function renderMisTareas() {
  const papelera = taskActiveTab === 'eliminada';
  const tareas = (state.tareas || []).filter(t => papelera ? t.estado === 'eliminada' : t.estado !== 'eliminada');
  const pendientes = tareas.filter(t => t.estado === 'pendiente');
  const completadas = tareas.filter(t => t.estado === 'completada');
  const examenesPendientes = pendientes.filter(t => t.tipo === 'examen');
  const proximas = pendientes.filter(t => {
    const d = diasHasta(t.fechaEntrega);
    return d != null && d >= 0 && d <= 3;
  });

  const statsEl = $('#tasks-stats');
  if (statsEl) {
    statsEl.classList.toggle('hidden', tareas.length === 0 || papelera);
    statsEl.innerHTML = tareas.length && !papelera ? `
      <span><strong>${pendientes.length}</strong> pendiente${pendientes.length === 1 ? '' : 's'}</span>
      <span><strong>${proximas.length}</strong> para los próximos 3 días</span>
      ${examenesPendientes.length ? '<span><strong>' + examenesPendientes.length + '</strong> examen' + (examenesPendientes.length === 1 ? '' : 'es') + '</span>' : ''}
      ${completadas.length ? '<span><strong>' + completadas.length + '</strong> completada' + (completadas.length === 1 ? '' : 's') + '</span>' : ''}` : '';
  }

  const filtroAsig = $('#task-filtro-asig');
  const prevAsig = filtroAsig ? filtroAsig.value : '';
  if (filtroAsig) {
    filtroAsig.innerHTML = `<option value="">Todas las tareas</option><option value="__general">Sin asignatura · General</option>` +
      state.asignaturas.map(a => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('');
    if (prevAsig) filtroAsig.value = prevAsig;
  }

  const fa = filtroAsig ? filtroAsig.value : '';
  const ft = $('#task-filtro-tipo') ? $('#task-filtro-tipo').value : '';
  const fp = $('#task-filtro-prioridad') ? $('#task-filtro-prioridad').value : '';

  const activeFilters = [fa, ft, fp].filter(Boolean).length;
  const filterCount = $('#task-filter-count');
  if (filterCount) filterCount.textContent = activeFilters ? activeFilters + ' activo' + (activeFilters === 1 ? '' : 's') : '';
  let lista = [...tareas];
  // Filtrar por pestaña activa (pendiente, completada, todos)
  if (taskActiveTab === 'pendiente') {
    lista = lista.filter(t => t.estado === 'pendiente');
  } else if (taskActiveTab === 'completada') {
    lista = lista.filter(t => t.estado === 'completada');
  }

  if (fa) lista = lista.filter(t => fa === '__general' ? !t.asignaturaId : t.asignaturaId === fa);
  if (ft) lista = lista.filter(t => t.tipo === ft);
  if (fp) lista = lista.filter(t => t.prioridad === fp);

  lista.sort((a, b) => {
    if (a.estado !== b.estado) return a.estado === 'pendiente' ? -1 : 1;
    if (!a.fechaEntrega && !b.fechaEntrega) return b.fechaCreacion.localeCompare(a.fechaCreacion);
    if (!a.fechaEntrega) return 1;
    if (!b.fechaEntrega) return -1;
    return a.fechaEntrega.localeCompare(b.fechaEntrega);
  });

  const cont = $('#tasks-list');
  if (!cont) return;

  if (lista.length === 0) {
    let title = taskActiveTab === 'completada' ? 'Aún no hay tareas completadas' : 'Todo al día';
    let description = taskActiveTab === 'completada' ? 'Aquí aparecerán las actividades que marques como terminadas.' : 'No tienes tareas pendientes. Puedes añadir la siguiente cuando quieras.';
    let action = '<button class="btn" type="button" onclick="openTaskDialog()">' + uiIcon('plus') + ' Nueva tarea</button>';
    if (activeFilters) {
      title = 'No hay coincidencias';
      description = 'Prueba con otra asignatura, tipo o prioridad.';
      action = '<button class="btn btn-secondary" type="button" onclick="document.querySelector(\'#btn-reset-task-filters\').click()">Limpiar filtros</button>';
    } else if (papelera) {
      title = 'La Papelera está vacía';
      description = 'Las tareas que elimines aparecerán aquí para que puedas restaurarlas.';
      action = '';
    } else if (!tareas.length) {
      title = 'Tu agenda empieza aquí';
      description = 'Añade una tarea general o vincúlala a una asignatura para organizar tus entregas.';
    }
    cont.innerHTML = '<div class="empty-state-card"><span class="empty-symbol">' + uiIcon('check') + '</span><h3>' + title + '</h3><p>' + description + '</p>' + action + '</div>';
    return;
  }

  cont.innerHTML = (papelera ? '<p class="muted">Las tareas de la Papelera no generan avisos. Puedes restaurarlas en Pendientes.</p>' : '') + lista.map(t => {
    const a = asignaturaPorId(t.asignaturaId);
    const color = a ? a.color : 'azul';
    const st = calcularEstadoVisualTask(t);
    const tipoInfo = TIPOS_TAREA[t.tipo] || TIPOS_TAREA.deberes;

    return `
      <div class="task-card sc-${color} ${t.estado === 'completada' ? 'completed' : ''}">
        <div class="tc-top">
          ${papelera ? '' : `<label class="checkbox-target"><input type="checkbox" data-toggletask="${t.id}" ${t.estado === 'completada' ? 'checked' : ''} aria-label="Marcar como ${t.estado === 'completada' ? 'pendiente' : 'completada'}: ${esc(t.titulo)}"></label>`}
          <div class="tc-info">
            <span class="badge ${tipoInfo.badge}">${tipoInfo.icon} ${tipoInfo.label}</span>
            <span class="badge ${st.tone}">${st.label}</span>
            ${t.prioridad === 'alta' ? '<span class="badge red">Prioridad alta</span>' : ''}
          </div>
          <div class="tc-actions">
            ${papelera ? `<button class="btn btn-secondary btn-sm" type="button" data-restoretarea="${t.id}" aria-label="Restaurar: ${esc(t.titulo)}">Restaurar</button>` : `<button class="btn btn-ghost btn-sm" type="button" data-edittask="${t.id}" aria-label="Editar: ${esc(t.titulo)}">Editar</button>
            <button class="btn btn-danger btn-sm" type="button" data-deltask="${t.id}" aria-label="Mover a Papelera: ${esc(t.titulo)}">${uiIcon('trash')}</button>`}
          </div>
        </div>
        <div class="tc-title">${esc(t.titulo)}</div>
        ${t.descripcion ? `<div class="tc-desc">${esc(t.descripcion)}</div>` : ''}
        <div class="tc-footer">
          <span>${uiIcon('book')} <strong>${esc(!t.asignaturaId ? 'General' : a ? a.nombre : t.asignaturaNombre || 'Asignatura')}</strong></span>
          ${t.dia ? `<span>${uiIcon('calendar')} ${diaLabel(t.dia)} (${t.horaInicio}–${t.horaFin})</span>` : ''}
          ${t.fechaEntrega ? `<span>${uiIcon('clock')} ${formatoEntrega(t.fechaEntrega)}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

/* ---------- Render: Dashboard Tasks Widget ---------- */
function renderDashboardTasks() {
  const cont = $('#dash-tasks-preview');
  if (!cont) return;
  const tasks = (state.tareas || []).filter(t => t.estado === 'pendiente').sort((a, b) => (a.fechaEntrega || '9999').localeCompare(b.fechaEntrega || '9999'));
  if (tasks.length <= 1) { cont.innerHTML = ''; return; }
  cont.innerHTML = `
    <div class="dash-card">
      <div class="schedule-config-head">
        <h3 class="section-title">Otras tareas</h3>
        <button class="text-action" type="button" data-dashboard-action="tareas">Ver todas ${uiIcon('arrow')}</button>
      </div>
      <div class="tasks-mini-list">${tasks.slice(1, 4).map(t => renderTaskMiniCard(t)).join('')}</div>
    </div>`;
}

/* ---------- Eventos de tareas ---------- */
function bindTasks() {
  const btnAdd = $('#btn-global-add-task');
  if (btnAdd) btnAdd.addEventListener('click', () => openTaskDialog());

  const saveBtn = $('#dlg-task-save');
  if (saveBtn) saveBtn.addEventListener('click', guardarTareaModal);
  const closeBtn = $('#dlg-task-close');
  if (closeBtn) closeBtn.addEventListener('click', () => $('#dialog-task').close());
  const cancelBtn = $('#dlg-task-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', () => $('#dialog-task').close());

  // Tabs de estado
  const tabsContainer = $('#task-state-tabs');
  if (tabsContainer) {
    tabsContainer.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const tabs = Array.from(tabsContainer.querySelectorAll('[data-statustab]'));
      const index = tabs.indexOf(e.target);
      if (index < 0) return;
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click(); tabs[next].focus();
    });
    tabsContainer.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-statustab]');
      if (!tab) return;
      taskActiveTab = tab.dataset.statustab;
      Array.from(tabsContainer.querySelectorAll('[data-statustab]')).forEach(b => {
        const on = b.dataset.statustab === taskActiveTab;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      renderMisTareas();
    });
  }

  // Reset filtros
  const btnReset = $('#btn-reset-task-filters');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      $('#task-filtro-asig').value = '';
      $('#task-filtro-tipo').value = '';
      $('#task-filtro-prioridad').value = '';
      renderMisTareas();
    });
  }

  ['#task-filtro-asig', '#task-filtro-tipo', '#task-filtro-prioridad'].forEach(sel => {
    const el = $(sel);
    if (el) el.addEventListener('change', renderMisTareas);
  });

  document.addEventListener('click', (e) => {
    const restore = e.target.closest('[data-restoretarea]');
    if (restore) { restaurarTarea(restore.dataset.restoretarea); return; }
    const toggle = e.target.closest('[data-toggletask]');
    if (toggle) {
      alternarEstadoTarea(toggle.dataset.toggletask);
      return;
    }
    const edit = e.target.closest('[data-edittask]');
    if (edit) {
      openTaskEditDialog(edit.dataset.edittask);
      return;
    }
    const del = e.target.closest('[data-deltask]');
    if (del) {
      eliminarTarea(del.dataset.deltask, del.closest('dialog'));
      return;
    }

    const changeClass = e.target.closest('#btn-class-change');
    if (changeClass) {
      if (scheduleEditing) return;
      $('#dialog-class-detail').close();
      openCellDialog(changeClass.dataset.cellKey, true);
      return;
    }
    const addTaskFromClass = e.target.closest('#btn-class-add-task');
    if (addTaskFromClass) {
      const ds = addTaskFromClass.dataset;
      $('#dialog-class-detail').close();
      openTaskDialog({
        slotKey: ds.slot,
        asignaturaId: ds.asig,
        dia: ds.dia,
        horaInicio: ds.inicio,
        horaFin: ds.fin,
        tipo: 'deberes'
      });
      return;
    }

    const addNoteFromClass = e.target.closest('#btn-class-add-note');
    if (addNoteFromClass) {
      const ds = addNoteFromClass.dataset;
      $('#dialog-class-detail').close();
      openTaskDialog({
        slotKey: ds.slot,
        asignaturaId: ds.asig,
        dia: ds.dia,
        horaInicio: ds.inicio,
        horaFin: ds.fin,
        tipo: 'nota'
      });
      return;
    }
  });

  const closeClassDetail = $('#dlg-class-close');
  if (closeClassDetail) closeClassDetail.addEventListener('click', () => $('#dialog-class-detail').close());
}
