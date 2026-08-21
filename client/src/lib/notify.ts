/**
 * Asking for the right to interrupt, once, at the door.
 *
 * A notification is the only standard way to reach someone who has left the
 * browser altogether, and the only one that costs a permission. The question
 * is when to ask, and the answer is not "on arrival": a prompt over the home
 * page is about nothing yet, and it is refused out of habit. It is asked when
 * the player enters a room, because that is the moment the game acquires the
 * thing it would interrupt them about, and because entering a room is a click,
 * which is what Firefox and Safari require before the prompt will open at all.
 *
 * Asked once and never again. `default` means the question is still open;
 * `granted` and `denied` are both answers, and re-asking an answered question
 * is not possible anyway, since the browser stops relaying it.
 */

/** Asked already in this page's life: a second room is not a second reason. */
let asked = false;

/** Absent on iOS Safari outside an installed app, among others. */
export function notificationsSupported(): boolean {
  return typeof Notification !== 'undefined';
}

/**
 * Whether a round may be announced this way. There is no preference of ours on
 * top of the permission: the browser holds the answer and its own site
 * settings are where it is taken back, which is where players look for it.
 */
export function notificationsOn(): boolean {
  return notificationsSupported() && Notification.permission === 'granted';
}

/** Opens the prompt if the question is still open. Called from a click. */
export function askAboutRounds(): void {
  if (asked || !notificationsSupported() || Notification.permission !== 'default') return;
  asked = true;
  try {
    // Safari 15 and older took a callback and returned nothing at all.
    void Promise.resolve(Notification.requestPermission()).catch(() => {});
  } catch {
    /* Nothing to fall back to, and nothing to report. */
  }
}
