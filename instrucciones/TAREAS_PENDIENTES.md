# Tareas pendientes de SalvaTuCurso

Estado actualizado el 23/11/2026. Repositorio: <https://github.com/qirris/salvatucurso>. La única web publicada es <https://salvatucurso.qirris.workers.dev>; GitHub Pages permanece desactivado.

## Completado

- [x] Publicación HTTPS en Cloudflare Workers con D1 en la Unión Europea.
- [x] Acceso opcional con Google en producción y uso completo sin cuenta.
- [x] Sincronización del curso con control de versiones y copias locales separadas.
- [x] Copias JSON de descarga e importación.
- [x] Avisos Push programados, incluida una recepción real con la app cerrada.
- [x] Política de privacidad pública y eliminación definitiva de la cuenta desde Ajustes.
- [x] GitHub Pages retirado y repositorio renombrado a `qirris/salvatucurso`.
- [x] Horas estimadas o confirmadas, criterios documentados por asignatura y migración protegida al formato 3; pruebas automáticas y de formularios sobre HTML real.

## Comprobaciones reales pendientes

- [ ] Confirmar que un mismo curso muestra los mismos contenidos en un móvil y un ordenador con la misma cuenta de Google.
- [ ] Probar la instalación PWA y el modo sin conexión en dispositivos reales: Android/Chrome, iPhone/Safari y Chrome o Edge de escritorio.
- [ ] Revisar el icono maskable en las pantallas de inicio de Android y otros lanzadores, incluida su zona de seguridad.
- [ ] Comprobar manualmente la descarga e importación JSON entre navegadores y entre versiones.
- [ ] Verificar con datos de prueba la migración desde `asistenciaData` y formatos anteriores.
- [ ] Recorrer las operaciones habituales: añadir, editar, archivar y eliminar asignaturas; registrar, editar y deshacer faltas; crear y completar tareas; cambiar clases y periodos no lectivos.
- [ ] Revisión visual de los nuevos formularios de horas/criterios en claro y oscuro a 320, 390, 768 y 1280 px, con teclado y poca altura. En esta entrega el navegador de pruebas no pudo acceder al servidor local.

## Decisiones vigentes

- El registro con correo y contraseña sigue aplazado para mantener el servicio gratuito; Google es el único acceso remoto.
- Cloudflare es la única publicación. No reactivar GitHub Pages.
- No activar facturación, dominio propio ni servicios de correo sin una autorización nueva y expresa.
