/**
 * Keeping the screen awake while a stopwatch session exists.
 *
 * A phone that dims and locks stops running the page, and with it the
 * reminders. While a session is under way the page asks the browser to keep
 * the screen on. The browser drops the request whenever the tab is hidden,
 * so it is asked again each time the tab comes back.
 *
 * Time is counted from saved timestamps, never from this, so a session is
 * measured correctly whether or not the screen stays on.
 */

let lock = null;
let asking = false;

/**
 * Make the screen lock match what is wanted. Cheap to call often; the app
 * calls it on every tick.
 *
 * @param {boolean} wanted true while a stopwatch session exists.
 */
export function syncWakeLock(wanted) {
  if (!('wakeLock' in navigator)) return;
  if (!wanted) {
    if (lock) lock.release().catch(() => {});
    lock = null;
    return;
  }
  if (lock || asking || document.hidden) return;
  asking = true;
  navigator.wakeLock
    .request('screen')
    .then((sentinel) => {
      lock = sentinel;
      // The browser releases it by itself when the tab is hidden.
      sentinel.addEventListener('release', () => {
        if (lock === sentinel) lock = null;
      });
    })
    .catch(() => {
      /* low battery or not allowed: carry on without it */
    })
    .finally(() => {
      asking = false;
    });
}
