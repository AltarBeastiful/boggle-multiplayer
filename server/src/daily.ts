/**
 * The "grille du jour": one grid a day, the same for everyone, played alone.
 *
 * The grid is derived from the date (`dailySeed`), so any server rebuilds the
 * same one for the same day; what players did with it is written down beside
 * it. The grid itself is written down too, but only as an anchor: see
 * `restore()` for the one thing that can move it.
 */

import {
  DAILY_RULES,
  dailyKey,
  dailySeed,
  disambiguateNicknames,
  generateBoard,
  normalizeWord,
  sanitizeNickname,
  solveBoard,
  wordScore,
  type Board,
  type DailyRanking,
  type DailyState,
  type DailySolutionWord,
  type DailyTeaser,
  type Dictionary,
  type SubmitResult,
} from '@boggle/shared';

import { readRecord, scheduleWrite } from './store.js';

interface Session {
  playerId: string;
  nickname: string;
  /** Word to points and path, in the order they were found. */
  words: Map<string, { points: number; path: number[] }>;
  startedAt: number;
  finishedAt: number | null;
}

/** What is written to disk. Deliberately dull, and readable by hand. */
interface StoredDay {
  day: string;
  /** The grid as it was played. Absent in files written before this existed. */
  cells?: string[];
  sessions: Array<{
    playerId: string;
    nickname: string;
    words: string[];
    startedAt: number;
    finishedAt: number | null;
  }>;
}

const recordName = (day: string) => `daily-${day}`;

class DailyGame {
  readonly board: Board;
  readonly solution: Map<string, number[]>;
  readonly solutionPoints: number;
  private readonly sessions = new Map<string, Session>();

  constructor(
    readonly day: string,
    private readonly dictionary: Dictionary,
  ) {
    const { boardSize, minWordLength, qEqualsQu, scoringMode } = DAILY_RULES;
    const stored = readRecord<StoredDay>(recordName(day));
    const kept = stored?.day === day ? stored.cells : undefined;

    /*
     * A day already played keeps the grid it was played on.
     *
     * The seed alone does not fix the grid: `generateBoard` redraws until it
     * finds one with enough words, so the dictionary is part of the derivation.
     * Adding 85,000 words moved one grid in forty, which would have left a
     * finished attempt holding words that no longer trace, and a leaderboard
     * quietly scored against a board nobody saw.
     */
    this.board =
      kept?.length === boardSize * boardSize
        ? { size: boardSize, cells: kept }
        : generateBoard({
            size: boardSize,
            dictionary,
            minWordLength,
            qEqualsQu,
            seed: dailySeed(day),
          }).board;

    const solved = solveBoard(this.board, dictionary, { minWordLength, qEqualsQu }, scoringMode);
    this.solution = solved.words;
    this.solutionPoints = solved.totalPoints;
    this.restore(stored);
  }

  // -- persistence -----------------------------------------------------------

  /**
   * Only the words are kept, not their points or paths: both are recomputed
   * from the grid. A saved file that disagrees with today's scoring therefore
   * corrects itself rather than preserving a stale score. The grid is the one
   * thing taken as written, because it is what the words were found on.
   */
  private restore(stored: StoredDay | null): void {
    if (!stored || stored.day !== this.day) return;
    for (const entry of stored.sessions) {
      const words = new Map<string, { points: number; path: number[] }>();
      for (const word of entry.words) {
        const path = this.solution.get(word);
        if (path) words.set(word, { points: wordScore(word.length, DAILY_RULES.scoringMode), path });
      }
      this.sessions.set(entry.playerId, {
        playerId: entry.playerId,
        nickname: entry.nickname,
        words,
        startedAt: entry.startedAt,
        finishedAt: entry.finishedAt,
      });
    }
    console.log(`[daily] ${this.day}: ${this.sessions.size} sessions restored`);
  }

  private save(): void {
    scheduleWrite(recordName(this.day), () => ({
      day: this.day,
      cells: this.board.cells,
      sessions: [...this.sessions.values()].map((session) => ({
        playerId: session.playerId,
        nickname: session.nickname,
        words: [...session.words.keys()],
        startedAt: session.startedAt,
        finishedAt: session.finishedAt,
      })),
    }));
  }

  // -- playing ---------------------------------------------------------------

  /** Opens the grid, or hands back the attempt already under way. */
  start(playerId: string, nickname: string): Session {
    const existing = this.sessions.get(playerId);
    if (existing) {
      // The name can still be corrected while the attempt is open.
      if (!existing.finishedAt) existing.nickname = sanitizeNickname(nickname);
      return existing;
    }
    const session: Session = {
      playerId,
      nickname: sanitizeNickname(nickname),
      words: new Map(),
      startedAt: Date.now(),
      finishedAt: null,
    };
    this.sessions.set(playerId, session);
    this.save();
    return session;
  }

  submit(playerId: string, raw: string): SubmitResult {
    const word = normalizeWord(raw);
    const session = this.sessions.get(playerId);
    if (!session) return { word, accepted: false, reason: 'not-playing' };
    // Finishing is what reveals the answers, so it cannot be walked back.
    if (session.finishedAt) return { word, accepted: false, reason: 'round-over' };
    if (word.length < DAILY_RULES.minWordLength) return { word, accepted: false, reason: 'too-short' };
    if (session.words.has(word)) return { word, accepted: false, reason: 'already-found' };

    const path = this.solution.get(word);
    if (!path) {
      // Telling "not a word" from "not on the grid" is what helps a player improve.
      return { word, accepted: false, reason: this.dictionary.has(word) ? 'not-on-board' : 'not-a-word' };
    }

    const points = wordScore(word.length, DAILY_RULES.scoringMode);
    session.words.set(word, { points, path });
    this.save();
    return { word, accepted: true, path: [...path], points };
  }

  finish(playerId: string): Session | null {
    const session = this.sessions.get(playerId);
    if (!session) return null;
    if (!session.finishedAt) {
      session.finishedAt = Date.now();
      this.save();
    }
    return session;
  }

  // -- reading ---------------------------------------------------------------

  get(playerId: string): Session | undefined {
    return this.sessions.get(playerId);
  }

  get finishedCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) if (session.finishedAt) count++;
    return count;
  }

  private score(session: Session): number {
    let total = 0;
    for (const found of session.words.values()) total += found.points;
    return total;
  }

  /**
   * Finished attempts only, best score first, then the quickest. A grid you
   * are still playing is not a result, and showing it would let anyone sit at
   * the top of the day with a score they have not stopped improving.
   */
  ranking(playerId: string): DailyRanking[] {
    const done = [...this.sessions.values()].filter((session) => session.finishedAt !== null);
    // One line per player, so a name shared by two people stays two lines.
    const names = disambiguateNicknames(
      done.map((session) => ({ id: session.playerId, nickname: session.nickname })),
    );
    return done
      .map((session) => ({
        nickname: names.get(session.playerId) ?? session.nickname,
        score: this.score(session),
        words: session.words.size,
        seconds: Math.max(0, Math.round(((session.finishedAt ?? 0) - session.startedAt) / 1000)),
        me: session.playerId === playerId,
      }))
      .sort((a, b) => b.score - a.score || a.seconds - b.seconds || a.nickname.localeCompare(b.nickname, 'fr'));
  }

  state(playerId: string): DailyState {
    const session = this.sessions.get(playerId);
    const finished = Boolean(session?.finishedAt);
    const words = session
      ? [...session.words.entries()]
          .map(([word, found]) => ({ word, points: found.points, path: found.path }))
          .reverse()
      : [];

    const base: DailyState = {
      day: this.day,
      board: [...this.board.cells],
      size: DAILY_RULES.boardSize,
      minWordLength: DAILY_RULES.minWordLength,
      words,
      score: session ? this.score(session) : 0,
      startedAt: session?.startedAt ?? Date.now(),
      serverNow: Date.now(),
      finished,
      playerCount: this.finishedCount,
      seconds: null,
      solution: null,
      solutionCount: null,
      solutionPoints: null,
      ranking: null,
      rank: null,
    };
    if (!finished || !session) return base;

    const solution: DailySolutionWord[] = [];
    for (const [word, path] of this.solution) {
      solution.push({
        word,
        points: wordScore(word.length, DAILY_RULES.scoringMode),
        path,
        found: session.words.has(word),
      });
    }
    solution.sort((a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word, 'fr'));

    const ranking = this.ranking(playerId);
    return {
      ...base,
      seconds: Math.max(0, Math.round(((session.finishedAt ?? 0) - session.startedAt) / 1000)),
      solution,
      solutionCount: this.solution.size,
      solutionPoints: this.solutionPoints,
      ranking,
      rank: ranking.findIndex((entry) => entry.me) + 1 || null,
    };
  }
}

export class DailyManager {
  private game: DailyGame | null = null;

  constructor(private readonly dictionary: Dictionary) {}

  /** The grid for right now, rebuilt when the day turns over in Paris. */
  private today(): DailyGame {
    const day = dailyKey();
    if (!this.game || this.game.day !== day) {
      const started = Date.now();
      this.game = new DailyGame(day, this.dictionary);
      console.log(
        `[daily] ${day}: ${this.game.board.cells.join('')}, ` +
          `${this.game.solution.size} words, ${Date.now() - started} ms`,
      );
    }
    return this.game;
  }

  start(playerId: string, nickname: string): DailyState {
    const game = this.today();
    game.start(playerId, nickname);
    return game.state(playerId);
  }

  submit(playerId: string, word: string): SubmitResult {
    return this.today().submit(playerId, word);
  }

  finish(playerId: string): DailyState {
    const game = this.today();
    game.finish(playerId);
    return game.state(playerId);
  }

  state(playerId: string): DailyState {
    return this.today().state(playerId);
  }

  /** What the home page needs, without committing the player to anything. */
  teaser(playerId: string): DailyTeaser {
    const game = this.today();
    return {
      day: game.day,
      playerCount: game.finishedCount,
      done: Boolean(game.get(playerId)?.finishedAt),
    };
  }
}
