/* Integración local con SQLite y el mismo contrato de D1. No envía correos ni Push reales. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import worker, { dispatch } from '../cloudflare/worker.mjs';
import { inZone, jobsForCourse } from '../cloudflare/planning.mjs';

class LocalD1 {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.failSQL = ''; }
  exec(sql) { this.sqlite.exec(sql); }
  prepare(sql) {
    const database = this;
    return { sql, params: [], bind(...params) { return { ...this, params }; },
      execute() {
        if (database.failSQL && sql.includes(database.failSQL)) { database.failSQL = ''; throw Error('Fallo simulado de guardado'); }
        const before = database.sqlite.prepare('SELECT total_changes() AS n').get().n;
        const results = database.sqlite.prepare(sql).all(...this.params);
        const after = database.sqlite.prepare('SELECT total_changes() AS n').get().n;
        return { success: true, results, meta: { changes: after - before, last_row_id: database.sqlite.prepare('SELECT last_insert_rowid() AS n').get().n } };
      },
      async all() { return this.execute(); }, async run() { return this.execute(); },
      async first() { return this.execute().results[0] || null; }, async raw() { return this.execute().results.map(Object.values); }
    };
  }
  async batch(statements) {
    this.exec('SAVEPOINT batch_test');
    try { const results = statements.map(statement => statement.execute()); this.exec('RELEASE batch_test'); return results; }
    catch (error) { this.exec('ROLLBACK TO batch_test; RELEASE batch_test'); throw error; }
  }
}
const db = new LocalD1();
db.exec(readFileSync('cloudflare/migrations/0001_acceso.sql', 'utf8'));
db.exec(readFileSync('cloudflare/migrations/0002_curso_y_avisos.sql', 'utf8'));
const mails = [], background = [];
const env = { DB: db, APP_ORIGIN: 'http://localhost:8787', BETTER_AUTH_SECRET: randomBytes(40).toString('base64url'),
  AUTH_EMAIL_ENABLED: 'true', EMAIL_FROM: 'pruebas@example.test', EMAIL: { async send(email) { mails.push(email); } } };
const ctx = { waitUntil(promise) { background.push(promise); } };
async function call(path, method = 'GET', body, cookie = '', origin = env.APP_ORIGIN, dataVersion = '4') {
  const response = await worker.fetch(new Request(env.APP_ORIGIN + path, { method,
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie, 'cf-connecting-ip': '127.0.0.1', 'X-SalvaTuCurso-Data-Version': dataVersion },
    body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  await Promise.all(background.splice(0));
  return response;
}
const cookieOf = response => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
async function register(name) {
  const email = name + '@example.test', password = 'Clave-local-de-prueba-12345';
  const signup = await call('/api/auth/sign-up/email', 'POST', { name, email, password, callbackURL: env.APP_ORIGIN });
  assert.equal(signup.status, 200, 'registro local aceptado');
  assert.equal((await signup.json()).user.emailVerified, false);
  const beforeVerify = await call('/api/auth/sign-in/email', 'POST', { email, password });
  assert.equal(beforeVerify.status, 403, 'no entra con un correo sin verificar');
  const url = new URL(mails.at(-1).text.match(/https?:\/\/\S+/)[0]);
  const verified = await call(url.pathname + url.search);
  assert.equal(verified.status, 302);
  const signin = await call('/api/auth/sign-in/email', 'POST', { email, password });
  assert.equal(signin.status, 200, 'entra después de verificar');
  return { cookie: cookieOf(signin), email, password };
}
try {
  const configRequest = new Request(env.APP_ORIGIN + '/src/js/push-config.js');
  const publicConfig = async values => {
    const response = await worker.fetch(configRequest, values, ctx);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const script = await response.text();
    assert.ok(!script.includes(env.BETTER_AUTH_SECRET), 'la configuración pública no expone secretos');
    return JSON.parse(script.slice(script.indexOf('=') + 1, -1));
  };
  assert.equal((await publicConfig({})).enabled, false, 'sin proveedor conectado no se anuncia acceso disponible');
  assert.equal((await publicConfig(env)).email, true);
  const googleConfig = await publicConfig({ BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID: 'cliente', GOOGLE_CLIENT_SECRET: 'secreto-google' });
  assert.equal(googleConfig.enabled, true); assert.equal(googleConfig.google, true); assert.equal(googleConfig.email, false);
  assert.ok(!JSON.stringify(googleConfig).includes('secreto-google'));
  const a = await register('alumna');
  const b = await register('alumno');
  const before = await call('/api/course'); assert.equal(before.status, 401);
  assert.equal((await (await call('/api/course', 'GET', undefined, a.cookie)).json()).state, null);
  const due = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const course = { version: 4, etapa: 'fp_superior', asignaturas: [{ id: 'a', nombre: 'Redes', archivada: false, horasTotales: 120, computo: { origen: 'estimado', referencia: '', inicio: '' }, criterio: null }],
    tareas: [{ id: 't', asignaturaId: 'a', titulo: 'Examen de redes', tipo: 'examen', estado: 'pendiente', fechaEntrega: due }],
    faltas: [{ id: 'f', asignaturaId: 'a', fecha: '2026-11-12', horas: 1, procedencia: 'sin_especificar' }], config: { criterio: null, onboarding: { oculto: true } }, horario: null };
  assert.equal((await call('/api/course', 'GET', undefined, a.cookie, env.APP_ORIGIN, '')).status, 426, 'un cliente antiguo no lee el nuevo curso');
  assert.equal((await call('/api/course', 'PUT', { revision: null, state: course }, a.cookie, env.APP_ORIGIN, '2')).status, 426, 'un cliente antiguo no sustituye los datos nuevos');
  assert.equal((await call('/api/course', 'GET', undefined, a.cookie, env.APP_ORIGIN, '3')).status, 426, 'el cliente V3 no puede descartar tareas generales ni reactivar la Papelera');
  assert.equal((await call('/api/course', 'PUT', { revision: null, state: { ...course, asignaturas: [{ id: 'a' }] } }, a.cookie)).status, 400, 'rechaza formato nuevo incompleto antes de guardar');
  let result = await call('/api/course', 'PUT', { revision: null, state: course }, a.cookie);
  assert.equal(result.status, 200); let revision = (await result.json()).revision;
  assert.deepEqual((await (await call('/api/course', 'GET', undefined, a.cookie)).json()).state, course);
  assert.equal((await (await call('/api/course?userId=alumna', 'GET', undefined, b.cookie)).json()).state, null, 'las cuentas quedan aisladas');
  assert.equal((await call('/api/course', 'PUT', { revision, state: course }, a.cookie, 'https://evil.test')).status, 403);
  const parallel = await Promise.all([call('/api/course', 'PUT', { revision, state: { ...course, etapa: 'eso' } }, a.cookie), call('/api/course', 'PUT', { revision, state: { ...course, etapa: 'bachillerato' } }, a.cookie)]);
  assert.deepEqual(parallel.map(r => r.status).sort(), [200, 409], 'un cambio concurrente no sobrescribe el otro');
  revision = (await (await call('/api/course', 'GET', undefined, a.cookie)).json()).revision;
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/prueba-local', keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } };
  const deviceId = crypto.randomUUID();
  result = await call('/api/push', 'POST', { action: 'sync', deviceId, subscription, prefs: { examDays: 3, taskDays: 1, time: '18:00' }, timeZone: 'Europe/Madrid' }, a.cookie);
  assert.equal(result.status, 200); assert.equal((await result.json()).count, 1);
  assert.equal((await call('/api/push', 'POST', { action: 'disable', deviceId }, b.cookie)).status, 403);
  const sent = [];
  await dispatch(env, async (...args) => sent.push(args));
  assert.equal(sent.length, 1, 'el cron envía el aviso que ya corresponde');
  result = await call('/api/course', 'PUT', { revision, state: { ...course, tareas: [{ ...course.tareas[0], titulo: 'Título actualizado' }] } }, a.cookie);
  revision = (await result.json()).revision;
  await dispatch(env, async (...args) => sent.push(args));
  assert.equal(sent.length, 1, 'guardar o editar el título no repite un aviso enviado');
  const extra = { ...course, tareas: [{ ...course.tareas[0], id: 't2' }] };
  result = await call('/api/course', 'PUT', { revision, state: extra }, a.cookie); revision = (await result.json()).revision;
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM push_jobs WHERE status='pending'").get().n, 1);
  const beforeFailure = db.sqlite.prepare('SELECT state,revision FROM courses').get(); db.failSQL = 'INSERT INTO push_jobs';
  result = await call('/api/course', 'PUT', { revision, state: { ...extra, tareas: [] } }, a.cookie);
  assert.equal(result.status, 503); assert.deepEqual(db.sqlite.prepare('SELECT state,revision FROM courses').get(), beforeFailure, 'un fallo conserva curso y avisos anteriores');
  result = await call('/api/course', 'PUT', { revision, state: { ...extra, tareas: [] } }, a.cookie); assert.equal(result.status, 200);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM push_jobs WHERE status='pending'").get().n, 0, 'completar o borrar desde otro dispositivo retira los avisos pendientes');
  await call('/api/push', 'POST', { action: 'disable', deviceId }, a.cookie);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM push_devices').get().n, 0);
  result = await call('/api/auth/request-password-reset', 'POST', { email: a.email, redirectTo: env.APP_ORIGIN + '?restablecer=1' });
  assert.equal(result.status, 200);
  const resetURL = new URL(mails.at(-1).text.match(/https?:\/\/\S+/)[0]);
  const token = resetURL.pathname.split('/').at(-1);
  result = await call('/api/auth/reset-password', 'POST', { token, newPassword: 'Nueva-clave-local-12345' });
  assert.equal(result.status, 200);
  assert.equal((await call('/api/course', 'GET', undefined, a.cookie)).status, 401, 'restablecer contraseña retira sesiones anteriores');
  const storedPassword = db.sqlite.prepare("SELECT password FROM account WHERE providerId='credential' LIMIT 1").get().password;
  assert.notEqual(storedPassword, a.password); assert.notEqual(storedPassword, 'Nueva-clave-local-12345');

  db.sqlite.prepare('DELETE FROM "rateLimit"').run();
  const disposable = await register('cuenta-borrable');
  const disposableUser = db.sqlite.prepare('SELECT id FROM "user" WHERE email=?').get(disposable.email);
  assert.equal((await call('/api/account', 'DELETE', { confirmation: 'ELIMINAR' })).status, 401, 'sin sesión no se puede eliminar una cuenta');
  assert.equal((await call('/api/account', 'DELETE', { confirmation: 'ELIMINAR' }, disposable.cookie, 'https://evil.test')).status, 403, 'otro origen no puede eliminarla');
  assert.equal((await call('/api/account', 'DELETE', { confirmation: 'eliminar' }, disposable.cookie)).status, 400, 'la confirmación debe ser exacta');
  assert.equal((await call('/api/account', 'DELETE', null, disposable.cookie)).status, 400, 'un cuerpo inválido se rechaza sin tocar la cuenta');
  result = await call('/api/course', 'PUT', { revision: null, state: course }, disposable.cookie);
  assert.equal(result.status, 200);
  const disposableDevice = crypto.randomUUID();
  result = await call('/api/push', 'POST', { action: 'sync', deviceId: disposableDevice, subscription, prefs: { examDays: 3, taskDays: 1, time: '18:00' }, timeZone: 'Europe/Madrid' }, disposable.cookie);
  assert.equal(result.status, 200);
  db.sqlite.prepare('INSERT INTO "account" (id,accountId,providerId,userId,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run('google-delete', 'google-account', 'google', disposableUser.id, new Date().toISOString(), new Date().toISOString());
  db.sqlite.prepare('INSERT INTO "verification" (id,identifier,value,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run('verification-delete', disposable.email, 'temporal', new Date(Date.now() + 60000).toISOString(), new Date().toISOString(), new Date().toISOString());
  db.sqlite.prepare('INSERT INTO "verification" (id,identifier,value,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run('reset-delete', 'reset-password:token-descartable', disposableUser.id, new Date(Date.now() + 60000).toISOString(), new Date().toISOString(), new Date().toISOString());
  db.sqlite.prepare('INSERT INTO "rateLimit" (id,"key","count","lastRequest") VALUES(?,?,?,?)').run('limit-delete', 'curso:' + disposableUser.id + ':anterior', 1, Date.now());
  const footprint = () => ({
    users: db.sqlite.prepare('SELECT count(*) AS n FROM "user" WHERE id=?').get(disposableUser.id).n,
    sessions: db.sqlite.prepare('SELECT count(*) AS n FROM "session" WHERE "userId"=?').get(disposableUser.id).n,
    accounts: db.sqlite.prepare('SELECT count(*) AS n FROM "account" WHERE "userId"=?').get(disposableUser.id).n,
    courses: db.sqlite.prepare('SELECT count(*) AS n FROM courses WHERE user_id=?').get(disposableUser.id).n,
    backups: db.sqlite.prepare('SELECT count(*) AS n FROM course_backups WHERE user_id=?').get(disposableUser.id).n,
    devices: db.sqlite.prepare('SELECT count(*) AS n FROM push_devices WHERE user_id=?').get(disposableUser.id).n,
    jobs: db.sqlite.prepare('SELECT count(*) AS n FROM push_jobs WHERE device_id=?').get(disposableDevice).n,
    verifications: db.sqlite.prepare('SELECT count(*) AS n FROM "verification" WHERE identifier=? OR value=?').get(disposable.email, disposableUser.id).n
  });
  const beforeDeleteFailure = footprint();
  assert.ok(beforeDeleteFailure.sessions && beforeDeleteFailure.accounts >= 2 && beforeDeleteFailure.courses && beforeDeleteFailure.backups && beforeDeleteFailure.devices && beforeDeleteFailure.jobs && beforeDeleteFailure.verifications, 'la cuenta descartable contiene todos los datos que se van a retirar');
  db.failSQL = 'DELETE FROM "user"';
  result = await call('/api/account', 'DELETE', { confirmation: 'ELIMINAR' }, disposable.cookie);
  assert.equal(result.status, 503); assert.deepEqual(footprint(), beforeDeleteFailure, 'un fallo intermedio revierte toda la eliminación');
  const deleted = await call('/api/account', 'DELETE', { confirmation: 'ELIMINAR' }, disposable.cookie);
  assert.equal(deleted.status, 200); assert.equal(deleted.headers.get('Clear-Site-Data'), '"cookies"');
  assert.deepEqual(footprint(), { users: 0, sessions: 0, accounts: 0, courses: 0, backups: 0, devices: 0, jobs: 0, verifications: 0 }, 'elimina usuario, sesiones, conexiones, curso, copias, dispositivos, avisos y verificaciones');
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM "rateLimit" WHERE "key" LIKE ?').get('curso:' + disposableUser.id + ':%').n, 0, 'retira los límites asociados');
  assert.equal((await call('/api/course', 'GET', undefined, disposable.cookie)).status, 401, 'todas sus sesiones quedan invalidadas');
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM "user" WHERE email=?').get(b.email).n, 1, 'las demás cuentas continúan funcionando');

  const london = inZone('2026-03-30', '18:00', 'Europe/London'); assert.equal(new Date(london).toISOString(), '2026-03-30T17:00:00.000Z');
  const madrid = inZone('2026-10-26', '18:00', 'Europe/Madrid'); assert.equal(new Date(madrid).toISOString(), '2026-10-26T17:00:00.000Z');
  assert.equal(jobsForCourse({ ...course, tareas: [{ ...course.tareas[0], estado: 'completada' }] }, { examDays: 3, taskDays: 1, time: '18:00' }, 'Europe/Madrid').length, 0);
  // Integración privada: únicamente tareas y salud, sin cookies ni datos de identidad en las respuestas.
  const owner = db.sqlite.prepare('SELECT id FROM "user" WHERE email=?').get(a.email).id;
  env.JARVIS_KEY = randomBytes(32).toString('hex'); env.JARVIS_USER_ID = owner;
  const clearLimits = () => db.sqlite.prepare('DELETE FROM "rateLimit"').run();
  clearLimits();
  const privateCall = (path, method = 'GET', body, { key = env.JARVIS_KEY, cookie = '', origin } = {}) => worker.fetch(new Request(env.APP_ORIGIN + path, {
    method, headers: { ...(key === null ? {} : { 'X-Jarvis-Key': key }), ...(cookie ? { Cookie: cookie } : {}),
      ...(origin === undefined ? {} : { Origin: origin }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env, ctx);
  assert.equal((await privateCall('/api/jarvis/health', 'GET', undefined, { key: null, cookie: b.cookie })).status, 401);
  for (const key of [null, '', 'incorrecta', 'a'.repeat(1025), env.JARVIS_KEY.slice(0, -1)])
    assert.equal((await privateCall('/api/tareas', 'GET', undefined, { key })).status, 401);
  result = await privateCall('/api/jarvis/health');
  assert.equal(result.status, 200); assert.deepEqual(await result.json(), { ok: true });
  assert.equal(result.headers.get('Cache-Control'), 'no-store'); assert.equal(result.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await privateCall('/api/jarvis/health', 'POST')).status, 405);
  assert.equal((await privateCall('/api/tareas', 'POST', { titulo: 'Local' }, { origin: 'https://otro.example' })).status, 403);
  assert.equal((await privateCall('/api/course')).status, 401, 'la clave no permite leer el curso');
  assert.ok([401,403].includes((await privateCall('/api/account', 'DELETE', { confirmation: 'ELIMINAR' })).status));
  assert.ok([401,403].includes((await privateCall('/api/push', 'POST', {})).status));
  const otherTasks = await privateCall('/api/tareas', 'GET', undefined, { key: 'incorrecta', cookie: b.cookie });
  assert.equal(otherTasks.status, 200); assert.deepEqual(await otherTasks.json(), { tareas: [] }, 'la sesión web usa su propia cuenta');
  assert.equal((await privateCall('/api/tareas', 'POST', { titulo: 'Sin origen' }, { key: null, cookie: b.cookie })).status, 403);
  assert.equal((await privateCall('/api/tareas', 'GET', undefined, { key: null, cookie: b.cookie, origin: env.APP_ORIGIN })).status, 200);
  assert.equal((await privateCall('/api/tareas', 'POST', { titulo: 'Solo web' }, { key: null, cookie: b.cookie, origin: env.APP_ORIGIN })).status, 201);
  for (const body of [null, [], {}, { titulo: '' }, { titulo: ' '.repeat(10) }, { titulo: 'a'.repeat(201) },
    { titulo: 'A', prioridad: 'urgente' }, { titulo: 'A', fecha: '2027-02-29' }, { titulo: 'A', fecha: null }, { titulo: 'A', userId: owner }])
    assert.equal((await privateCall('/api/tareas', 'POST', body)).status, 400);
  clearLimits();
  const untouched = JSON.parse(db.sqlite.prepare('SELECT state FROM courses WHERE user_id=?').get(owner).state);
  db.sqlite.prepare('INSERT INTO push_devices(id,user_id,subscription,prefs,timezone,updated_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(), owner,
    JSON.stringify(subscription), JSON.stringify({ examDays: 3, taskDays: 1, time: '18:00' }), 'Europe/Madrid', Date.now());
  result = await privateCall('/api/tareas', 'POST', { titulo: '  Preparar material  ', prioridad: 'alta', fecha: due });
  assert.equal(result.status, 201);
  const created = await result.json();
  assert.deepEqual(Object.keys(created).sort(), ['estado','fecha','id','prioridad','titulo']);
  assert.equal(created.titulo, 'Preparar material'); assert.equal(created.estado, 'pendiente'); assert.equal(created.fecha, due);
  const savedCourse = () => JSON.parse(db.sqlite.prepare('SELECT state FROM courses WHERE user_id=?').get(owner).state);
  assert.equal(savedCourse().version, 4);
  for (const field of ['asignaturas','faltas','config','horario']) assert.deepEqual(savedCourse()[field], untouched[field]);
  const newTask = savedCourse().tareas.find(t => t.id === created.id);
  assert.equal(newTask.asignaturaId, ''); assert.equal(newTask.slotKey, ''); assert.equal(newTask.tipo, 'otros');
  const scheduledCount = () => db.sqlite.prepare("SELECT count(*) AS n FROM push_jobs WHERE json_extract(payload,'$.taskId')=? AND status<>'sent'").get(created.id).n;
  assert.equal(scheduledCount(), 1, 'una tarea general con fecha programa su aviso');
  for (const estado of ['completada','pendiente','eliminada','pendiente']) {
    result = await privateCall('/api/tareas/' + created.id, 'PATCH', { estado });
    assert.equal(result.status, 200); assert.equal((await result.json()).estado, estado);
    assert.deepEqual(savedCourse().tareas.find(t => t.id === created.id), { ...newTask, estado });
    assert.equal(scheduledCount(), estado === 'pendiente' ? 1 : 0);
  }
  for (const body of [{ estado: 'otra' }, {}, { estado: 'pendiente', titulo: 'Reemplazar' }])
    assert.equal((await privateCall('/api/tareas/' + created.id, 'PATCH', body)).status, 400);
  assert.equal((await privateCall('/api/tareas/no-existe', 'PATCH', { estado: 'eliminada' })).status, 404);
  assert.equal((await privateCall('/api/tareas/' + created.id, 'PATCH', { estado: 'eliminada' }, { key: null, cookie: b.cookie, origin: env.APP_ORIGIN })).status, 404);
  await privateCall('/api/tareas/' + created.id, 'PATCH', { estado: 'eliminada' });
  const list = await (await privateCall('/api/tareas?userId=otra-cuenta')).json();
  assert.equal(list.tareas.find(t => t.id === created.id).estado, 'eliminada');
  assert.ok(!JSON.stringify(list).includes(owner) && !JSON.stringify(list).includes(env.JARVIS_KEY));
  assert.deepEqual(await (await privateCall('/api/tareas', 'GET', undefined, { cookie: b.cookie })).json(), list, 'una clave válida tiene prioridad sobre una cookie de otra cuenta');
  const exposedConfig = JSON.stringify(await publicConfig(env));
  assert.ok(!exposedConfig.includes(env.JARVIS_KEY) && !exposedConfig.includes(owner) && !exposedConfig.includes('JARVIS_USER_ID'));
  const unchangedRevision = db.sqlite.prepare('SELECT revision FROM courses WHERE user_id=?').get(owner).revision;
  await privateCall('/api/tareas/' + created.id, 'PATCH', { estado: 'eliminada' });
  assert.equal(db.sqlite.prepare('SELECT revision FROM courses WHERE user_id=?').get(owner).revision, unchangedRevision, 'PATCH repetido es idempotente');
  const footprintTask = () => JSON.stringify(['courses','course_backups','push_jobs'].map(table => db.sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()));
  const beforeTaskFailure = footprintTask(); db.failSQL = 'INSERT INTO course_backups';
  assert.equal((await privateCall('/api/tareas', 'POST', { titulo: 'Fallo atómico', fecha: due })).status, 503);
  assert.equal(footprintTask(), beforeTaskFailure, 'el fallo conserva curso, copias y avisos');
  const originalBatch = db.batch.bind(db);
  db.batch = async statements => {
    db.batch = originalBatch;
    const changed = savedCourse(); changed.config.concurrente = true;
    db.sqlite.prepare('UPDATE courses SET revision=?,state=? WHERE user_id=?').run('cambio-paralelo', JSON.stringify(changed), owner);
    return originalBatch(statements);
  };
  assert.equal((await privateCall('/api/tareas', 'POST', { titulo: 'No debe sustituir el curso' })).status, 409);
  assert.equal(savedCourse().config.concurrente, true); assert.ok(!savedCourse().tareas.some(t => t.titulo === 'No debe sustituir el curso'));
  const legacy = { ...course, version: 3, tareas: [{ ...course.tareas[0], slotKey: 'lunes|h1', dia: 'lunes', horaInicio: '08:00', horaFin: '09:00' }] };
  db.sqlite.prepare('UPDATE courses SET state=?,revision=? WHERE user_id=?').run(JSON.stringify(legacy), 'curso-v3', owner);
  assert.equal((await privateCall('/api/tareas')).status, 200);
  assert.equal(savedCourse().version, 3, 'leer no modifica el curso antiguo');
  assert.equal((await privateCall('/api/tareas/t', 'PATCH', { estado: 'completada' })).status, 200);
  assert.equal(savedCourse().version, 4);
  assert.deepEqual(savedCourse().tareas[0], { ...legacy.tareas[0], estado: 'completada' }, 'conserva contenido, asignatura y vínculos al migrar');
  const oldKey = env.JARVIS_KEY; env.JARVIS_KEY = randomBytes(32).toString('hex');
  assert.equal((await privateCall('/api/jarvis/health', 'GET', undefined, { key: oldKey })).status, 401);
  clearLimits();
  for (let i = 0; i < 60; i++) assert.equal((await privateCall('/api/jarvis/health')).status, 200);
  assert.equal((await privateCall('/api/jarvis/health')).status, 429);
  clearLimits(); env.JARVIS_USER_ID = disposableUser.id;
  assert.equal((await privateCall('/api/jarvis/health')).status, 401, 'una cuenta eliminada no se puede suplantar');
  env.JARVIS_USER_ID = owner;
  db.sqlite.prepare('UPDATE "user" SET "emailVerified"=0 WHERE id=?').run(owner);
  assert.equal((await privateCall('/api/jarvis/health')).status, 401);
  db.sqlite.prepare('UPDATE "user" SET "emailVerified"=1 WHERE id=?').run(owner);
  delete env.JARVIS_KEY;
  assert.equal((await privateCall('/api/jarvis/health', 'GET', undefined, { key: oldKey })).status, 401);
  console.log('OK: API privada sin cookies, aislamiento, estados, tareas generales, avisos, límites y guardado atómico');
  console.log('OK: autenticación, aislamiento, sincronización, avisos y eliminación atómica completa de una cuenta descartable en Cloudflare');
} finally { db.sqlite.close(); }
