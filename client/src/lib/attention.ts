/**
 * Calling a player back to a game they are not looking at.
 *
 * Two channels, in the order the browser lets them work.
 *
 * **The application icon**, through the Badging API: `setAppBadge()` puts the
 * operating system's own dot on the icon in the dock, the taskbar or the home
 * screen. It is a W3C specification, it asks for no permission, and the mark
 * it leaves is the browser's, not ours. What it costs instead is an install:
 * the badge only exists once the game has an icon of its own to carry it, so a
 * player in an ordinary tab gets nothing from it.
 *
 * **The tab**, through its title and its icon, for everyone else. There is no
 * standard way to raise the small circle Chrome draws on a tab; that mark
 * belongs to a dialog waiting for an answer, and web content cannot ask for it
 * short of `alert()`, which blocks the page it is trying to call attention to.
 * So the tab draws its own, in the favicon, which is how every site that
 * appears to have one does it.
 *
 * **A notification**, on top of both, for the player who asked for one. It is
 * the only channel that reaches someone who has left the browser, and the only
 * one that costs a permission, so whether it fires at all is the player's
 * standing answer and not ours: see `./notify`.
 *
 * All three are put back the moment the player returns.
 */

import { notificationsOn } from './notify';

/** The title as the page was served, restored when the flashing stops. */
const RESTING_TITLE = document.title;

const RESTING_ICON = '/favicon.svg';
const ALERT_ICON = '/favicon-alert.svg';

/**
 * A beat slower than a second. Chrome clamps timers in a hidden tab to one a
 * second, so a quicker beat is simply not honoured; and a pulse catches the
 * eye where a strobe only wears it out.
 *
 * Only the title beats. The dot on the icon is a state and stays put: a tab
 * hidden for five minutes falls under intensive throttling and gets one turn a
 * minute, which makes a blinking icon look broken and leaves a steady one
 * exactly as legible as it was.
 */
const BEAT_MS = 1200;

/** The page's icon link, created on the spot if the document has none. */
function iconLink(): HTMLLinkElement {
  const existing = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (existing) return existing;
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  document.head.append(link);
  return link;
}

/**
 * Marks the application icon, or does nothing at all.
 *
 * A badge with no count is the dot: something to come back to, and no claim
 * about how much of it there is. The call is refused wherever there is no
 * installed application to badge, which is most of the time and not an error.
 */
function badge(lit: boolean): void {
  if (!('setAppBadge' in navigator)) return;
  const marked = lit ? navigator.setAppBadge() : navigator.clearAppBadge();
  void marked.catch(() => {});
}

/** What the player is being called back to, in each of the two lengths. */
export interface Call {
  /** Short enough for a tab strip, since that is where it mostly lands. */
  title: string;
  /** The line under it in a notification, where there is room to say more. */
  body: string;
}

/**
 * Shows the notification, if the player has one coming.
 *
 * A tag rather than a queue: two rounds cannot both be waiting to be joined,
 * so the second replaces the first instead of stacking under it. The click
 * brings the game back, which is the only thing anyone would want from it.
 */
function announce(call: Call): Notification | null {
  if (!notificationsOn()) return null;
  try {
    const shown = new Notification(call.title, {
      body: call.body,
      icon: '/icon-192.png',
      tag: 'boggle-round',
      lang: 'fr',
    });
    shown.onclick = () => {
      window.focus();
      shown.close();
    };
    return shown;
  } catch {
    // Android requires notifications to come from a service worker, which the
    // game has none of. The tab keeps calling; that part never throws.
    return null;
  }
}

/**
 * Calls the player back until they come, and returns the way to stop it early.
 * Coming back is what the call was for, so seeing the tab is enough to end it:
 * there is nothing left to dismiss.
 */
export function callAttention(call: Call): () => void {
  const link = iconLink();
  let lit = false;
  let timer: number | undefined;

  const beat = () => {
    lit = !lit;
    document.title = lit ? call.title : RESTING_TITLE;
  };

  const stop = () => {
    if (timer === undefined) return;
    window.clearInterval(timer);
    timer = undefined;
    document.removeEventListener('visibilitychange', onVisibility);
    document.title = RESTING_TITLE;
    link.href = RESTING_ICON;
    badge(false);
    // A notification left on screen for a round already joined is litter.
    shown?.close();
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') stop();
  };

  // States, not pulses: set once, and left alone until the player returns.
  link.href = ALERT_ICON;
  badge(true);
  const shown = announce(call);
  beat();
  timer = window.setInterval(beat, BEAT_MS);
  document.addEventListener('visibilitychange', onVisibility);
  return stop;
}
