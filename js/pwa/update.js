// Installable app: registers the service worker, shows "New!" when an update is ready, and provides the
// cache clean-up for the emergency reset. Only touches caches named "logic-lane:…" (D16).

import { h } from '../ui/dom.js';
import { PREFIX } from '../core/storage.js';

/** @type {ServiceWorkerRegistration | null} */
let registration = null;
let updateRequested = false;

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only reload when she tapped "New!". The very first install also changes the controller, and must not
    // reload the page under her finger.
    if (!updateRequested || reloading) return;
    reloading = true;
    location.reload(); // the new version is in control; resume brings her back to the same puzzle
  });

  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      registration = reg;
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(worker);
        });
      });
    })
    .catch(() => {
      /* no offline support this time; the app still works online */
    });

  // iOS rarely relaunches an installed app, so check for updates whenever it comes back to the front.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registration?.update().catch(() => {});
  });
}

/** @param {ServiceWorker} worker */
function showUpdateBanner(worker) {
  if (document.querySelector('.update-banner')) return;
  const banner = h('button', { className: 'update-banner', label: 'New version. Tap to update.' }, [
    h('span', { text: '⬆️' }),
    h('span', { text: 'New!' }),
  ]);
  banner.addEventListener('click', () => {
    updateRequested = true;
    askToTakeOver(worker);
  });
  document.body.append(banner);
}

/**
 * Tells the waiting new version to take over now. WebKit (Safari's engine, as on her iPad) sometimes loses this
 * message: in a test on Linux WebKit 3 of 150 taps did nothing, and sending it again always worked. So it's sent again
 * every second until the new version is in control (the page then reloads), for up to 10 tries. Sending it twice is
 * harmless.
 * @param {ServiceWorker} worker  The new version, as it was when the banner appeared.
 * @param {number} [tries]
 */
function askToTakeOver(worker, tries = 10) {
  (registration?.waiting ?? worker).postMessage('skipWaiting');
  if (tries <= 1) return;
  setTimeout(() => {
    if (registration?.waiting) askToTakeOver(worker, tries - 1); // still waiting: the message was lost
  }, 1000);
}

/** Deletes this app's caches and unregisters its service worker. Leaves other sites' caches alone. */
export async function clearAppCaches() {
  try {
    if (globalThis.caches) {
      for (const name of await caches.keys()) if (name.startsWith(PREFIX)) await caches.delete(name);
    }
    await registration?.unregister();
  } catch {
    /* best effort */
  }
}
