# API de tareas para integraciones privadas

Base: `https://salvatucurso.qirris.workers.dev`. La API utiliza HTTPS y no guarda respuestas privadas en caché. No es una API pública de acceso anónimo.

## Acceso

Una integración local puede enviar `X-Jarvis-Key` con una clave configurada en el secreto `JARVIS_KEY` del Worker. `JARVIS_USER_ID`, también secreto, identifica una única cuenta existente y verificada en D1. No se acepta un usuario indicado en el cuerpo, la URL o una cabecera del cliente.

La clave permite exclusivamente las operaciones de esta página. No autoriza acceso a `/api/course`, notificaciones, autenticación ni eliminación de cuentas. Si una petición de tareas incluye una clave válida, se usa su cuenta vinculada; de lo contrario puede autenticarse mediante una sesión web verificada, que solo accede a su propia cuenta. La comprobación de salud exige siempre la clave.

Las peticiones locales con clave no necesitan cookies ni `Origin`. Si se envía `Origin`, debe coincidir con el de la app. Las escrituras con sesión web requieren ese origen. No se habilita CORS para otros sitios. Hay un límite compartido de 60 solicitudes autenticadas por cuenta y minuto entre estas rutas y las escrituras del curso.

## Rutas y respuestas

| Método y ruta | Resultado |
| --- | --- |
| `GET /api/jarvis/health` | `200` con `{"ok":true}`. |
| `GET /api/tareas` | `200` con `{"tareas":[...]}`. Incluye todos los estados; sin curso devuelve una lista vacía. |
| `POST /api/tareas` | `201` con el objeto creado. |
| `PATCH /api/tareas/{id}` | `200` con el objeto actualizado. |

Ejemplo de tarea; el identificador es ficticio:

```json
{"id":"ejemplo-123","titulo":"Preparar el material","estado":"pendiente","prioridad":"normal","fecha":"2026-12-10"}
```

Los objetos siempre tienen `id`, `titulo`, `estado` y `prioridad`. `fecha` solo aparece cuando existe una fecha de entrega. La lista incluye la Papelera; el cliente puede filtrar por estado. No se devuelven datos de identidad ni el resto del curso.

Para crear, envía `{"titulo":"Preparar el material","prioridad":"alta","fecha":"2026-12-10"}`. Solo `titulo` es obligatorio: se recorta y admite entre 1 y 200 caracteres. `prioridad` acepta `baja`, `normal` o `alta` y por defecto es `normal`. `fecha` debe ser una fecha real `AAAA-MM-DD`; omítela si no hay entrega. Se rechazan campos adicionales.

La tarea nueva será **General**, de tipo **Otros**, pendiente y sin vínculo a una clase. No se crea una asignatura. Si todavía no hay curso sincronizado, se crea un curso vacío válido con esa tarea.

Para actualizar, envía únicamente `{"estado":"completada"}`, `{"estado":"eliminada"}` o `{"estado":"pendiente"}`. Se conservan el identificador, contenido, asignatura, fechas y vínculos. Repetir el mismo estado no crea otro cambio. `pendiente` también restaura desde la Papelera.

El guardado utiliza la revisión actual del curso y actualiza copias y recordatorios en la misma transacción. Si cambia el curso durante la operación, devuelve `409` sin sustituirlo. Un fallo devuelve `503` y conserva los datos anteriores. No reintentes un `POST` automáticamente tras una pérdida de conexión: podría haberse guardado aunque no llegara la respuesta; consulta antes la lista.

| Estado HTTP | Significado |
| --- | --- |
| `400` | JSON o campos inválidos. |
| `401` | No hay una clave o sesión válida; también si la cuenta vinculada ya no existe o no está verificada. |
| `403` | Origen no permitido. |
| `404` | Tarea inexistente o de otra cuenta. |
| `405` | Método no disponible. |
| `409` | Cambio concurrente o curso que necesita actualizarse desde la app. |
| `429` | Límite temporal; espera al siguiente minuto. |
| `503` | Operación no completada. |

## Configurar o rotar la clave

La configuración la realiza el propietario del despliegue, fuera de la interfaz pública. Genera 32 bytes aleatorios en tu terminal local:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Guarda ese valor en el secreto del Worker y el identificador de tu cuenta verificada en el otro secreto. Estos comandos solicitan los valores de forma interactiva:

```powershell
npx wrangler secret put JARVIS_KEY
npx wrangler secret put JARVIS_USER_ID
```

No añadas sus valores a `wrangler.jsonc`, código, capturas ni documentación. Usa el mismo valor de `JARVIS_KEY` en la configuración privada del cliente local; el cliente no necesita conocer el identificador de usuario. En este proyecto, `.wrangler/`, `.dev.vars` y los archivos `.env` están excluidos de Git; la construcción pública utiliza una lista cerrada de recursos.

Para rotar, genera otra clave, sustituye `JARVIS_KEY` con el mismo comando y actualiza el cliente local. La anterior dejará de funcionar. Si se elimina la cuenta, la clave pierde el acceso aunque el secreto siga configurado. Cloudflare explica el almacenamiento y la publicación de secretos en su [documentación oficial](https://developers.cloudflare.com/workers/configuration/secrets/).

## Ejemplo de cliente en PowerShell

Con `JARVIS_KEY` cargada previamente en el entorno local del cliente:

```powershell
$apiCurso = 'https://salvatucurso.qirris.workers.dev'
$cabecerasCurso = @{ 'X-Jarvis-Key' = $env:JARVIS_KEY }
Invoke-RestMethod -Uri "$apiCurso/api/jarvis/health" -Headers $cabecerasCurso
Invoke-RestMethod -Uri "$apiCurso/api/tareas" -Headers $cabecerasCurso
$tareaCurso = Invoke-RestMethod -Method Post -Uri "$apiCurso/api/tareas" -Headers $cabecerasCurso -ContentType 'application/json' -Body '{"titulo":"Preparar el material"}'
Invoke-RestMethod -Method Patch -Uri "$apiCurso/api/tareas/$($tareaCurso.id)" -Headers $cabecerasCurso -ContentType 'application/json' -Body '{"estado":"completada"}'
```

La clave se envía en la cabecera, nunca en la URL. No imprimas su contenido ni lo guardes en el historial de comandos o en registros del asistente.
