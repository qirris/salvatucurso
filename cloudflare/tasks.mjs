/* API de tareas para sesiones web e integraciones privadas del propietario. */
import { createHash, timingSafeEqual } from 'node:crypto';
import { validDate } from './validation.mjs';
import { validateCourse } from './planning.mjs';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export const isTaskRoute = path => path === '/api/tareas' || path.startsWith('/api/tareas/') || path === '/api/jarvis/health';
const digest = value => createHash('sha256').update(value).digest();
export async function privateUser(request, env) {
  const supplied = request.headers.get('X-Jarvis-Key');
  if (typeof env.JARVIS_KEY !== 'string' || env.JARVIS_KEY.length < 32 || !env.JARVIS_USER_ID ||
    !supplied || supplied.length > 1024 || !timingSafeEqual(digest(supplied), digest(env.JARVIS_KEY))) return null;
  const user = await env.DB.prepare('SELECT id,"emailVerified" FROM "user" WHERE id=?').bind(env.JARVIS_USER_ID).first();
  return user?.emailVerified ? user.id : null;
}
const taskJSON = task => ({ id: task.id, titulo: String(task.titulo || ''), estado: task.estado,
  prioridad: ['baja', 'normal', 'alta'].includes(task.prioridad) ? task.prioridad : 'normal',
  ...(validDate(task.fechaEntrega) ? { fecha: task.fechaEntrega } : {}) });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const invalid = () => json({ error: 'Revisa los campos de la tarea' }, 400);

export async function taskAPI(request, env, userId, readBody, putCourse) {
  const path = new URL(request.url).pathname;
  if (path === '/api/jarvis/health') return request.method === 'GET' ? json({ ok: true }) : json({ error: 'Método no permitido' }, 405);
  const match = /^\/api\/tareas\/([A-Za-z0-9_-]{1,100})$/.exec(path);
  if (path !== '/api/tareas' && !match) return json({ error: 'Tarea no encontrada' }, 404);
  if (!(path === '/api/tareas' ? ['GET', 'POST'] : ['PATCH']).includes(request.method)) return json({ error: 'Método no permitido' }, 405);
  const stored = await env.DB.prepare('SELECT state,revision FROM courses WHERE user_id=?').bind(userId).first();
  const course = stored ? JSON.parse(stored.state) : { version: 4, etapa: 'fp_superior', asignaturas: [], faltas: [], tareas: [],
    config: { criterio: null, calendario: { inicio: '', fin: '', noLectivos: [] }, onboarding: { etapaConfirmada: false, oculto: false } }, horario: null };
  // El formato 3 no conocía tareas generales ni eliminadas; sus demás datos se conservan.
  if (![3, 4].includes(course.version)) return json({ error: 'Actualiza el curso desde SalvaTuCurso antes de continuar' }, 409);
  course.version = 4;
  validateCourse(course);
  if (request.method === 'GET') return json({ tareas: course.tareas.map(taskJSON) });
  const input = await readBody(request);
  if (!object(input)) return invalid();
  let task;
  if (request.method === 'POST') {
    if (Object.keys(input).some(key => !['titulo', 'prioridad', 'fecha'].includes(key)) || typeof input.titulo !== 'string' ||
      !input.titulo.trim() || input.titulo.trim().length > 200 ||
      (input.prioridad !== undefined && !['baja', 'normal', 'alta'].includes(input.prioridad)) ||
      (input.fecha !== undefined && !validDate(input.fecha))) return invalid();
    task = { id: crypto.randomUUID(), titulo: input.titulo.trim(), prioridad: input.prioridad || 'normal', fechaEntrega: input.fecha || '',
      estado: 'pendiente', asignaturaId: '', asignaturaNombre: '', tipo: 'otros', descripcion: '',
      slotKey: '', dia: '', horaInicio: '', horaFin: '', fechaCreacion: new Date().toISOString().slice(0, 10) };
    course.tareas.push(task);
  } else {
    if (Object.keys(input).length !== 1 || !['pendiente', 'completada', 'eliminada'].includes(input.estado)) return invalid();
    task = course.tareas.find(item => item.id === match[1]);
    if (!task) return json({ error: 'Tarea no encontrada' }, 404);
    if (task.estado === input.estado) return json(taskJSON(task));
    task.estado = input.estado;
  }
  const result = await putCourse(env, userId, { revision: stored?.revision || null, state: course });
  return result.ok ? json(taskJSON(task), request.method === 'POST' ? 201 : 200) : result;
}
