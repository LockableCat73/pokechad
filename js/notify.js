/**
 * System notifications: the small messages the browser or the operating
 * system shows outside the page. Used for the 45-minute reminders when the
 * tab is in the background.
 *
 * Nothing here needs a server. The page itself decides when to notify, so a
 * notification can only be sent while the page is still running: a tab in
 * the background on a computer is fine; a phone that has put the browser to
 * sleep is out of reach.
 *
 * Every function is safe to call in a browser without notifications; it just
 * reports that nothing was shown.
 */

/** Does this browser have notifications at all? */
export function supported() {
  return typeof Notification !== 'undefined';
}

/** "granted", "denied", "default" (not asked yet) or "unsupported". */
export function permission() {
  return supported() ? Notification.permission : 'unsupported';
}

/**
 * Ask for permission, but only if the question has never been answered.
 * Browsers want this to follow a tap or click.
 * @returns {Promise<string>} The permission afterwards.
 */
export async function askPermission() {
  if (!supported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/**
 * Show a notification, if allowed.
 *
 * It goes through the service worker when one is running (phones only
 * accept notifications that way, and it lets a click bring the tab forward
 * even if the page has been frozen), and otherwise straight from the page.
 *
 * @param {object} args
 * @param {string} args.title
 * @param {string} args.body
 * @param {string} [args.icon] URL of the picture.
 * @param {string} [args.tag]  A later notification with the same tag replaces this one.
 * @returns {Promise<boolean>} true when it was handed to the system.
 */
export async function notify({ title, body, icon, tag = 'pokechad' }) {
  if (permission() !== 'granted') return false;
  const options = { body, icon, badge: 'assets/icons/icon-192.png', tag, renotify: true };
  try {
    const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (registration && registration.active) {
      await registration.showNotification(title, options);
      return true;
    }
  } catch {
    /* fall through to the plain kind */
  }
  try {
    const shown = new Notification(title, options);
    shown.onclick = () => {
      window.focus();
      shown.close();
    };
    return true;
  } catch {
    return false;
  }
}
