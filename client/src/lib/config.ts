/**
 * Settings frozen at build time.
 *
 * To turn one off while building:
 *   VITE_WORD_TRACE=off npm run build
 * or, with Docker, VITE_WORD_TRACE=off in .env, which compose passes to the
 * image as a build argument.
 */

/**
 * Brief trace of the word on the grid once accepted. The path clears itself,
 * so nothing stays on screen between two words.
 */
export const TRACE_FOUND_WORD = import.meta.env.VITE_WORD_TRACE !== 'off';

/**
 * How long the trace shows, animation included. Deliberately short: the grid
 * must go neutral again quickly, ready for the next word.
 */
export const TRACE_DURATION_MS = 380;
