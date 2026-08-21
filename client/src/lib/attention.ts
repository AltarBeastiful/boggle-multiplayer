/**
 * Calling a player back to a tab they are not looking at, without asking them
 * for anything.
 *
 * The Notification API would do this properly, but it opens a permission
 * prompt, and a prompt is a poor way to announce a game of Boggle: it is
 * refused out of habit, the refusal is permanent, and the browser only asks
 * once. What the tab already owns costs nothing and cannot be refused: its
 * title and its icon. Both keep being redrawn while the tab sits in the
 * background, which is precisely where the player has to be reached, and both
 * go back to normal the moment they return.
 */

/** The title as the page was served, restored when the flashing stops. */
const RESTING_TITLE = document.title;

const RESTING_ICON = '/favicon.svg';
const ALERT_ICON = '/favicon-alert.svg';

/**
 * A beat slower than a second. Chrome clamps timers in a hidden tab to one a
 * second, so a quicker beat is simply not honoured; and a pulse catches the
 * eye where a strobe only wears it out.
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
 * Flashes the tab until the player comes back to it, and returns the way to
 * stop it early. Coming back is what the call was for, so seeing the tab is
 * enough to end it: there is nothing left to dismiss.
 */
export function flashTab(label: string): () => void {
  const link = iconLink();
  let lit = false;
  let timer: number | undefined;

  const beat = () => {
    lit = !lit;
    document.title = lit ? label : RESTING_TITLE;
    link.href = lit ? ALERT_ICON : RESTING_ICON;
  };

  const stop = () => {
    if (timer === undefined) return;
    window.clearInterval(timer);
    timer = undefined;
    document.removeEventListener('visibilitychange', onVisibility);
    document.title = RESTING_TITLE;
    link.href = RESTING_ICON;
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') stop();
  };

  beat();
  timer = window.setInterval(beat, BEAT_MS);
  document.addEventListener('visibilitychange', onVisibility);
  return stop;
}
