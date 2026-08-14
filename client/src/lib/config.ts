/**
 * Réglages figés à la compilation.
 *
 * Pour désactiver, au moment du build :
 *   VITE_WORD_TRACE=off npm run build
 * ou, avec Docker, VITE_WORD_TRACE=off dans .env (le compose le passe en
 * argument de build à l'image).
 */

/**
 * Bref tracé du mot sur la grille quand il est accepté. Le chemin s'efface
 * tout seul : rien ne reste affiché entre deux mots.
 */
export const TRACE_FOUND_WORD = import.meta.env.VITE_WORD_TRACE !== 'off';

/** Durée d'affichage du tracé, animation comprise. */
export const TRACE_DURATION_MS = 600;
