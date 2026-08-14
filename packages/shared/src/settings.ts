import { DEFAULT_SETTINGS, type EndCondition, type GameSettings } from './types.js';

/** Alphabet without ambiguous characters (no I/O/0/1): a code gets read out over the phone. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const char of code) if (!ROOM_CODE_ALPHABET.includes(char)) return false;
  return true;
}

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Safety floor for a timed round; the reference round stays 3 minutes, see
 * DEFAULT_SETTINGS. An untimed round is `null`, not a very large number, so
 * that "there is no clock" cannot be confused with "the clock is long".
 */
export const MIN_ROUND_SECONDS = 30;
export const MAX_ROUND_SECONDS = 900;
export const MAX_NICKNAME_LENGTH = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeEndCondition(input: unknown, fallback: EndCondition): EndCondition {
  if (!input || typeof input !== 'object') return fallback;
  const candidate = input as Partial<EndCondition> & { type?: string };
  if (candidate.type === 'endless') return { type: 'endless' };
  if (candidate.type === 'rounds') {
    const rounds = Number((candidate as { rounds?: unknown }).rounds);
    if (!Number.isFinite(rounds)) return fallback;
    return { type: 'rounds', rounds: Math.round(clamp(rounds, 1, 50)) };
  }
  if (candidate.type === 'score') {
    const target = Number((candidate as { target?: unknown }).target);
    if (!Number.isFinite(target)) return fallback;
    return { type: 'score', target: Math.round(clamp(target, 10, 2000)) };
  }
  return fallback;
}

/** The server never trusts the settings sent by the host. */
export function sanitizeSettings(
  input: Partial<GameSettings> | undefined,
  base: GameSettings = DEFAULT_SETTINGS,
): GameSettings {
  const patch = input ?? {};
  // Null is a value here, not a missing field: it asks for a round with no
  // clock. Anything unusable falls back to what the room already had.
  const roundSeconds =
    patch.roundSeconds === null
      ? null
      : Number.isFinite(patch.roundSeconds)
        ? Math.round(clamp(Number(patch.roundSeconds), MIN_ROUND_SECONDS, MAX_ROUND_SECONDS))
        : base.roundSeconds;

  return {
    boardSize: patch.boardSize === 4 || patch.boardSize === 5 ? patch.boardSize : base.boardSize,
    roundSeconds,
    minWordLength: patch.minWordLength === 3 || patch.minWordLength === 4 ? patch.minWordLength : base.minWordLength,
    scoringMode:
      patch.scoringMode === 'classic' || patch.scoringMode === 'simplified' ? patch.scoringMode : base.scoringMode,
    duplicateMode:
      patch.duplicateMode === 'cancel' || patch.duplicateMode === 'all' ? patch.duplicateMode : base.duplicateMode,
    qEqualsQu: typeof patch.qEqualsQu === 'boolean' ? patch.qEqualsQu : base.qEqualsQu,
    showSolutionCount:
      typeof patch.showSolutionCount === 'boolean' ? patch.showSolutionCount : base.showSolutionCount,
    endCondition: sanitizeEndCondition(patch.endCondition, base.endCondition),
  };
}

export function sanitizeNickname(input: unknown): string {
  const raw = typeof input === 'string' ? input : '';
  const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NICKNAME_LENGTH);
  return cleaned.length > 0 ? cleaned : 'Joueur';
}
