/* Aviso de actualización de la PWA. La persona decide cuándo recargar. */
(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  const notice = document.getElementById('update-notice');
  const updateButton = document.getElementById('btn-update-now');
  const laterButton = document.getElementById('btn-update-later');
  const description = document.getElementById('update-description');
  if (!notice || !updateButton || !laterButton || !description) return;

  let pendingRegistration = null;
  let updateRequested = false;

  function showUpdate(registration) {
    if (!navigator.serviceWorker.controller || !registration.waiting) return;
    pendingRegistration = registration;
    updateButton.disabled = false;
    updateButton.textContent = 'Actualizar ahora';
    description.textContent = 'Hay una versión nueva de SalvaTuCurso preparada.';
    notice.hidden = false;
  }

  function watchInstallingWorker(registration) {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', function () {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        window.setTimeout(function () { showUpdate(registration); }, 0);
      }
    });
  }

  updateButton.addEventListener('click', function () {
    const worker = pendingRegistration && pendingRegistration.waiting;
    if (!worker) {
      description.textContent = 'La actualización ya no está pendiente. Recarga la página para comprobarla.';
      updateButton.disabled = true;
      return;
    }
    updateRequested = true;
    updateButton.disabled = true;
    updateButton.textContent = 'Actualizando…';
    description.textContent = 'Guardamos la nueva versión y volvemos enseguida.';
    worker.postMessage({ type: 'SKIP_WAITING' });
  });

  laterButton.addEventListener('click', function () {
    notice.hidden = true;
  });

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!updateRequested) return;
    updateRequested = false;
    window.location.reload();
  });

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./service-worker.js').then(function (registration) {
      showUpdate(registration);
      registration.addEventListener('updatefound', function () {
        watchInstallingWorker(registration);
      });
      registration.update().catch(function () {});
    }).catch(function (error) {
      console.warn('Service worker no registrado:', error);
    });
  });
})();
