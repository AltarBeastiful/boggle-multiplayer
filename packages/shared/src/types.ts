/**
 * Types shared by server and client.
 * Rules come from https://www.boggle.fr/regles.php
 * and variants from https://www.boggle.fr/variantes.php
 */

export type BoardSize = 4 | 5;

/** Scoring table. */
export type ScoringMode =
  /** Base rules: 3-4 = 1, 5 = 2, 6 = 3, 7 = 5, 8+ = 11. */
  | 'classic'
  /** "Simplified scoring" variant: 1 point per letter beyond the third. */
  | 'simplified';

/** What to do when several players find the same word. */
export type DuplicateMode =
  /** Classic rule: a word found by several players scores for nobody. */
  | 'cancel'
  /** Every player scores all their valid words. */
  | 'all';

/** End-of-game condition (points accumulate from round to round). */
export type EndCondition =
  | { type: 'rounds'; rounds: number }
  | { type: 'score'; target: number }
  | { type: 'endless' };

export interface GameSettings {
  /** 4x4 (classic Boggle) or 5x5 (Big Boggle). */
  boardSize: BoardSize;
  /**
   * Round length in seconds (3 minutes by default), or `null` for a round
   * with no clock, which the host closes when everyone has had enough.
   */
  roundSeconds: number | null;
  /** "Four letters and over only" variant: set to 4. */
  minWordLength: 3 | 4;
  scoringMode: ScoringMode;
  duplicateMode: DuplicateMode;
  /** "QU instead of Q" variant: a Q tile counts as either Q or QU. */
  qEqualsQu: boolean;
  /**
   * Hint showing how many words the grid holds during the round
   * ("3 words found out of 121"). Hidden by default.
   */
  showSolutionCount: boolean;
  endCondition: EndCondition;
}

export const DEFAULT_SETTINGS: GameSettings = {
  boardSize: 4,
  roundSeconds: 180,
  minWordLength: 3,
  scoringMode: 'classic',
  duplicateMode: 'cancel',
  qEqualsQu: false,
  showSolutionCount: false,
  endCondition: { type: 'rounds', rounds: 3 },
};

export type RoomPhase = 'lobby' | 'playing' | 'results';

/** Why a submitted word was refused, reported straight back to the player. */
export type RejectReason =
  | 'not-started'
  | 'too-short'
  | 'not-on-board'
  | 'not-a-word'
  | 'already-found'
  | 'round-over'
  | 'not-playing';

export interface SubmitResult {
  word: string;
  accepted: boolean;
  reason?: RejectReason;
  /** Path across the grid when accepted, as tile indices. */
  path?: number[];
  /**
   * What the word could be worth. Under duplicate cancellation it is only
   * earned at the end of the round, if nobody else found the word.
   */
  points?: number;
}

export type WordStatus = 'ok' | 'duplicate';

export interface ScoredWord {
  word: string;
  points: number;
  status: WordStatus;
  /** How many players found this word. */
  foundBy: number;
}

export interface PublicPlayer {
  id: string;
  nickname: string;
  connected: boolean;
  isHost: boolean;
  /** Score accumulated over every finished round. */
  totalScore: number;
  /** Words accepted in the current round; the words themselves stay secret. */
  wordCount: number;
}

export interface PlayerRoundResult {
  playerId: string;
  nickname: string;
  words: ScoredWord[];
  roundScore: number;
  totalScore: number;
}

/** A word of the grid, and who found it. */
export interface SolutionWord {
  word: string;
  points: number;
  path: number[];
  /** Ids of the players who found it; empty means nobody. */
  finders: string[];
}

export interface RoundResults {
  roundNumber: number;
  board: string[];
  players: PlayerRoundResult[];
  /** Every solution in the grid, longest word first. */
  solution: SolutionWord[];
  /** How many words the grid holds in total. */
  solutionCount: number;
  /** Total points available in the grid. */
  solutionPoints: number;
  /** Is the game over after this round? */
  gameOver: boolean;
}

export interface RoundState {
  number: number;
  board: string[];
  /**
   * When the round actually starts (epoch ms). Between receiving the grid and
   * that moment the letters stay blurred, so everyone starts together even if
   * one client got the grid a few dozen milliseconds earlier.
   */
  startsAt: number;
  /** End of the round (epoch ms, server clock). Null when untimed. */
  endsAt: number | null;
  /** Server clock at send time, to correct client drift. */
  serverNow: number;
  /** Words in the grid. Set when the hint is enabled, null otherwise. */
  solutionCount: number | null;
}

export interface RoomState {
  code: string;
  hostId: string;
  phase: RoomPhase;
  settings: GameSettings;
  players: PublicPlayer[];
  round: RoundState | null;
  results: RoundResults | null;
  /** Number of the last round played. */
  roundsPlayed: number;
  gameOver: boolean;
}

/** A definition, as returned by GET /api/definition/:word. */
export interface DefinitionEntry {
  /** The real spelling looked up: "été", "côté". */
  spelling: string;
  partOfSpeech: string;
  /**
   * The senses of that spelling, main one first. A polysemous word has
   * several: "cote" is a rating, a river level and a dimension on a drawing.
   */
  definitions: string[];
  /** Set when the spelling is an inflected form of that lemma. */
  lemma?: string;
}

export interface DefinitionResult {
  word: string;
  entries: DefinitionEntry[];
  /** Where the answer came from: bundled file or Wiktionary call. */
  source?: 'local' | 'wiktionary';
}

/** Private view: the words *I* have found in the current round. */
export interface MyRoundState {
  words: Array<{ word: string; points: number; path: number[] }>;
}

// ---------------------------------------------------------------------------
// Socket.IO protocol
// ---------------------------------------------------------------------------

export interface CreateRoomPayload {
  nickname: string;
  playerId: string;
  settings?: Partial<GameSettings>;
}

export interface JoinRoomPayload {
  code: string;
  nickname: string;
  playerId: string;
}

export interface JoinedPayload {
  state: RoomState;
  me: MyRoundState;
  playerId: string;
}

export type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ClientToServerEvents {
  'room:create': (payload: CreateRoomPayload, ack: (res: Ack<JoinedPayload>) => void) => void;
  'room:join': (payload: JoinRoomPayload, ack: (res: Ack<JoinedPayload>) => void) => void;
  'room:leave': () => void;
  'settings:update': (settings: Partial<GameSettings>, ack: (res: Ack<RoomState>) => void) => void;
  'game:start': (ack: (res: Ack<null>) => void) => void;
  /** The host closes the round: the only way out of an untimed one. */
  'round:end': (ack: (res: Ack<null>) => void) => void;
  'round:next': (ack: (res: Ack<null>) => void) => void;
  'game:reset': (ack: (res: Ack<null>) => void) => void;
  'word:submit': (word: string, ack: (res: Ack<SubmitResult>) => void) => void;
  /**
   * A word tried after the buzzer, to finish the grid for practice. Judged
   * exactly as a real one, counts for nothing.
   */
  'word:practice': (word: string, ack: (res: Ack<SubmitResult>) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'round:started': (round: RoundState) => void;
  'round:ended': (results: RoundResults) => void;
  'room:closed': (reason: string) => void;
}
