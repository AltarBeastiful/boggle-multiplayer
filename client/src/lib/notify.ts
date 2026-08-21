/**
 * The player's own answer to being told about a round.
 *
 * A notification is the only standard way to reach someone who has left the
 * browser altogether, and the only one that costs a permission. So the prompt
 * is never opened by the game: it is opened by the player, from the bell in
 * the header, and only then. A prompt that arrives unasked over the lobby is
 * refused out of habit, and a refusal is permanent and site-wide.
 *
 * Two states are kept apart on purpose. What the browser allows is the
 * permission, which only the browser can change; whether the player wants it
 * today is this preference, which the bell turns off without spending the
 * permission. Turning it off must not mean asking again later.
 */

const WANT_KEY = 'boggle.notify';

/** Absent on iOS Safari outside an installed app, among others. */
export function notificationsSupported(): boolean {
  return typeof Notification !== 'undefined';
}

export function notificationPermission(): NotificationPermission {
  return notificationsSupported() ? Notification.permission : 'denied';
}

/**
 * Granted, and not since turned back off. The stored value only ever records
 * a refusal: permission is granted through the bell and nowhere else, so
 * having it at all means the player asked for it.
 */
export function notificationsOn(): boolean {
  return notificationPermission() === 'granted' && localStorage.getItem(WANT_KEY) !== 'off';
}

export function setNotificationsOn(on: boolean): void {
  localStorage.setItem(WANT_KEY, on ? 'on' : 'off');
}

/** Opens the browser's prompt. Only ever called from a click. */
export async function askForNotifications(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  let answer: NotificationPermission;
  try {
    answer = await Notification.requestPermission();
  } catch {
    return 'denied';
  }
  if (answer === 'granted') setNotificationsOn(true);
  return answer;
}
