/**
 * The "grille du jour": one grid a day, the same for everybody, played alone
 * and without a room.
 */

import { fnv1a } from './rng.js';
import type { BoardSize } from './types.js';

/**
 * A day has to start somewhere. Europe/Paris is the honest choice for a game
 * played in French: the grid changes at midnight where the players are, not at
 * midnight UTC, which falls at one or two in the morning for them.
 */
export const DAILY_TIME_ZONE = 'Europe/Paris';

const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: DAILY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The day an instant falls on, in Paris, as `YYYY-MM-DD`. */
export function dailyKey(at: Date = new Date()): string {
  const parts = DAY_FORMAT.formatToParts(at);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * The seed of a day's grid, derived from the date alone (FNV-1a). Nothing is
 * stored: any server, at any time, rebuilds the same grid for the same day,
 * which is what lets the puzzle survive a restart without persistence.
 */
export function dailySeed(day: string): number {
  return fnv1a(day);
}

/**
 * Fixed rules, not the host's to change: everyone has to be playing the same
 * game for a leaderboard to mean anything.
 */
export const DAILY_RULES = Object.freeze({
  boardSize: 4 as BoardSize,
  minWordLength: 3,
  qEqualsQu: false,
  scoringMode: 'classic' as const,
});

export interface DailyWord {
  word: string;
  points: number;
  path: number[];
}

/** A word of the day's grid, and whether this player found it. */
export interface DailySolutionWord {
  word: string;
  points: number;
  path: number[];
  found: boolean;
}

export interface DailyRanking {
  nickname: string;
  score: number;
  words: number;
  /** Time taken, in seconds, which breaks ties between equal scores. */
  seconds: number;
  /** True for the player reading it, so their own line can be picked out. */
  me: boolean;
}

export interface DailyState {
  day: string;
  board: string[];
  size: BoardSize;
  minWordLength: number;
  /** Words found so far, most recent first. */
  words: DailyWord[];
  score: number;
  /** When this player opened the grid (epoch ms, server clock). */
  startedAt: number;
  /** Server clock at send time, to correct client drift. */
  serverNow: number;
  finished: boolean;
  /** How many players have finished the day's grid. */
  playerCount: number;
  /** Everything below is filled in only once the player has finished. */
  seconds: number | null;
  solution: DailySolutionWord[] | null;
  solutionCount: number | null;
  solutionPoints: number | null;
  ranking: DailyRanking[] | null;
  rank: number | null;
}

/** What the home page shows before anyone commits to playing. */
export interface DailyTeaser {
  day: string;
  playerCount: number;
  /** Has this player already finished today's grid? */
  done: boolean;
}
