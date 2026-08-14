const PLAYER_ID_KEY = 'boggle.playerId';
const NICKNAME_KEY = 'boggle.nickname';

/** Identité stable du joueur : permet de retrouver ses mots et son score après une coupure. */
export function getPlayerId(): string {
  let id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id || id.length < 8) {
    id = crypto.randomUUID();
    localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

export function getNickname(): string {
  return localStorage.getItem(NICKNAME_KEY) ?? '';
}

export function setNickname(nickname: string): void {
  localStorage.setItem(NICKNAME_KEY, nickname);
}

const TRACE_MODE_KEY = 'boggle.traceMode';

/**
 * Saisie au doigt sur la grille, en complément du clavier.
 *
 * Activée d'office sur écran tactile : sans cela, il fallait d'abord repérer un
 * petit bouton pour que glisser le doigt fasse quoi que ce soit, et rien
 * n'indiquait qu'il existait. Sur un écran à souris elle reste désactivée, le
 * clavier y étant plus rapide. Un choix explicite est toujours mémorisé.
 */
export function getTraceMode(): boolean {
  const stored = localStorage.getItem(TRACE_MODE_KEY);
  if (stored === 'on') return true;
  if (stored === 'off') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

export function setTraceMode(enabled: boolean): void {
  localStorage.setItem(TRACE_MODE_KEY, enabled ? 'on' : 'off');
}
