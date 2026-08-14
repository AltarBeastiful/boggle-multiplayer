import { randomInt } from 'node:crypto';

import {
  DEFAULT_SETTINGS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  generateBoard,
  normalizeWord,
  sanitizeNickname,
  sanitizeSettings,
  solveBoard,
  wordScore,
  type Board,
  type Dictionary,
  type GameSettings,
  type MyRoundState,
  type PlayerRoundResult,
  type RoomPhase,
  type RoomState,
  type RoundResults,
  type ScoredWord,
  type SolutionWord,
  type SubmitResult,
} from '@boggle/shared';

/** Latency tolerance: a word sent just before the buzzer still counts. */
const SUBMIT_GRACE_MS = 700;
/** Pre-round countdown, two beats, during which the grid shows but stays blurred. */
const COUNTDOWN_MS = 2000;
/** A room with nobody connected is dropped after this delay. */
const ROOM_TTL_MS = 30 * 60 * 1000;

interface ServerPlayer {
  id: string;
  nickname: string;
  connected: boolean;
  socketId: string | null;
  totalScore: number;
  /** Words found in the current round. */
  words: Map<string, { points: number; path: number[] }>;
  lastSeen: number;
}

interface ActiveRound {
  number: number;
  board: Board;
  seed: number;
  startedAt: number;
  /** End of the countdown; no word is accepted before it. */
  startsAt: number;
  endsAt: number;
  /** Every word in the grid, for O(1) validation and for listing missed words. */
  solution: Map<string, number[]>;
  solutionPoints: number;
  timer: NodeJS.Timeout | null;
}

export interface RoomBroadcaster {
  state(room: Room): void;
  roundStarted(room: Room): void;
  roundEnded(room: Room, results: RoundResults): void;
}

export class Room {
  readonly code: string;
  hostId: string;
  settings: GameSettings;
  phase: RoomPhase = 'lobby';
  readonly players = new Map<string, ServerPlayer>();
  round: ActiveRound | null = null;
  results: RoundResults | null = null;
  roundsPlayed = 0;
  gameOver = false;
  lastActivity = Date.now();

  constructor(
    code: string,
    settings: GameSettings,
    private readonly dictionary: Dictionary,
    private readonly broadcaster: RoomBroadcaster,
  ) {
    this.code = code;
    this.settings = settings;
    this.hostId = '';
  }

  // -- players ---------------------------------------------------------------

  addPlayer(playerId: string, nickname: string, socketId: string): ServerPlayer {
    const existing = this.players.get(playerId);
    if (existing) {
      existing.nickname = sanitizeNickname(nickname);
      existing.connected = true;
      existing.socketId = socketId;
      existing.lastSeen = Date.now();
      this.touch();
      return existing;
    }

    const player: ServerPlayer = {
      id: playerId,
      nickname: sanitizeNickname(nickname),
      connected: true,
      socketId,
      totalScore: 0,
      words: new Map(),
      lastSeen: Date.now(),
    };
    this.players.set(playerId, player);
    if (!this.hostId || !this.players.has(this.hostId)) this.hostId = playerId;
    this.touch();
    return player;
  }

  markDisconnected(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.connected = false;
    player.socketId = null;
    player.lastSeen = Date.now();
    this.migrateHostIfNeeded();
    this.touch();
  }

  removePlayer(playerId: string): void {
    this.players.delete(playerId);
    this.migrateHostIfNeeded();
    this.touch();
  }

  private migrateHostIfNeeded(): void {
    const host = this.players.get(this.hostId);
    if (host?.connected) return;
    for (const player of this.players.values()) {
      if (player.connected) {
        this.hostId = player.id;
        return;
      }
    }
  }

  isHost(playerId: string): boolean {
    return this.hostId === playerId;
  }

  get connectedCount(): number {
    let count = 0;
    for (const player of this.players.values()) if (player.connected) count++;
    return count;
  }

  get isExpired(): boolean {
    if (this.players.size === 0) return true;
    if (this.connectedCount > 0) return false;
    return Date.now() - this.lastActivity > ROOM_TTL_MS;
  }

  private touch(): void {
    this.lastActivity = Date.now();
  }

  // -- settings --------------------------------------------------------------

  updateSettings(playerId: string, patch: Partial<GameSettings>): void {
    if (!this.isHost(playerId)) throw new Error("Seul l'hôte peut changer les réglages");
    if (this.phase === 'playing') throw new Error('Manche en cours');
    this.settings = sanitizeSettings(patch, this.settings);
    this.touch();
    this.broadcaster.state(this);
  }

  // -- round lifecycle -------------------------------------------------------

  startGame(playerId: string): void {
    if (!this.isHost(playerId)) throw new Error("Seul l'hôte peut lancer la partie");
    if (this.phase === 'playing') throw new Error('Manche déjà en cours');
    for (const player of this.players.values()) {
      player.totalScore = 0;
      player.words.clear();
    }
    this.roundsPlayed = 0;
    this.gameOver = false;
    this.results = null;
    this.startRound(1);
  }

  nextRound(playerId: string): void {
    if (!this.isHost(playerId)) throw new Error("Seul l'hôte peut lancer la manche suivante");
    if (this.phase === 'playing') throw new Error('Manche déjà en cours');
    if (this.gameOver) throw new Error('La partie est terminée');
    this.startRound(this.roundsPlayed + 1);
  }

  resetGame(playerId: string): void {
    if (!this.isHost(playerId)) throw new Error("Seul l'hôte peut réinitialiser la partie");
    this.clearTimer();
    this.phase = 'lobby';
    this.round = null;
    this.results = null;
    this.roundsPlayed = 0;
    this.gameOver = false;
    for (const player of this.players.values()) {
      player.totalScore = 0;
      player.words.clear();
    }
    this.touch();
    this.broadcaster.state(this);
  }

  private startRound(number: number): void {
    const { boardSize, minWordLength, qEqualsQu, roundSeconds, scoringMode } = this.settings;

    const generated = generateBoard({ size: boardSize, dictionary: this.dictionary, minWordLength, qEqualsQu });
    const solution = solveBoard(generated.board, this.dictionary, { minWordLength, qEqualsQu }, scoringMode);

    for (const player of this.players.values()) player.words.clear();

    const now = Date.now();
    const startsAt = now + COUNTDOWN_MS;
    this.round = {
      number,
      board: generated.board,
      seed: generated.seed,
      startedAt: now,
      startsAt,
      endsAt: startsAt + roundSeconds * 1000,
      solution: solution.words,
      solutionPoints: solution.totalPoints,
      timer: null,
    };
    this.phase = 'playing';
    this.results = null;
    this.touch();

    this.round.timer = setTimeout(
      () => this.endRound(),
      COUNTDOWN_MS + roundSeconds * 1000 + SUBMIT_GRACE_MS,
    );
    this.broadcaster.roundStarted(this);
  }

  private clearTimer(): void {
    if (this.round?.timer) {
      clearTimeout(this.round.timer);
      this.round.timer = null;
    }
  }

  /** End of round: scoring, duplicate cancellation, running totals. */
  endRound(): void {
    const round = this.round;
    if (!round || this.phase !== 'playing') return;
    this.clearTimer();

    // Who found what. Feeds both the scoring and the solutions page.
    const finders = new Map<string, string[]>();
    for (const player of this.players.values()) {
      for (const word of player.words.keys()) {
        const list = finders.get(word);
        if (list) list.push(player.id);
        else finders.set(word, [player.id]);
      }
    }
    const foundBy = new Map<string, number>();
    for (const [word, list] of finders) foundBy.set(word, list.length);

    const cancelDuplicates = this.settings.duplicateMode === 'cancel';
    const playerResults: PlayerRoundResult[] = [];

    for (const player of this.players.values()) {
      const words: ScoredWord[] = [];
      let roundScore = 0;

      for (const [word, found] of player.words) {
        const count = foundBy.get(word) ?? 1;
        const duplicate = cancelDuplicates && count > 1;
        const points = duplicate ? 0 : found.points;
        roundScore += points;
        words.push({ word, points, status: duplicate ? 'duplicate' : 'ok', foundBy: count });
      }

      words.sort((a, b) => b.points - a.points || a.word.localeCompare(b.word, 'fr'));
      player.totalScore += roundScore;
      playerResults.push({
        playerId: player.id,
        nickname: player.nickname,
        words,
        roundScore,
        totalScore: player.totalScore,
      });
    }

    playerResults.sort((a, b) => b.roundScore - a.roundScore || b.totalScore - a.totalScore);

    // Every solution, longest word first.
    const solution: SolutionWord[] = [];
    for (const [word, path] of round.solution) {
      solution.push({
        word,
        points: wordScore(word.length, this.settings.scoringMode),
        path,
        finders: finders.get(word) ?? [],
      });
    }
    solution.sort((a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word, 'fr'));

    this.roundsPlayed = round.number;
    this.gameOver = this.checkGameOver();
    this.phase = 'results';

    const results: RoundResults = {
      roundNumber: round.number,
      board: [...round.board.cells],
      players: playerResults,
      solution,
      solutionCount: round.solution.size,
      solutionPoints: round.solutionPoints,
      gameOver: this.gameOver,
    };

    this.results = results;
    this.round = null;
    this.touch();
    this.broadcaster.roundEnded(this, results);
  }

  private checkGameOver(): boolean {
    const end = this.settings.endCondition;
    if (end.type === 'endless') return false;
    if (end.type === 'rounds') return this.roundsPlayed >= end.rounds;
    for (const player of this.players.values()) {
      if (player.totalScore >= end.target) return true;
    }
    return false;
  }

  // -- word submission -------------------------------------------------------

  submitWord(playerId: string, raw: string): SubmitResult {
    const player = this.players.get(playerId);
    const word = normalizeWord(raw);
    if (!player) return { word, accepted: false, reason: 'not-playing' };

    const round = this.round;
    if (this.phase !== 'playing' || !round) return { word, accepted: false, reason: 'round-over' };
    if (Date.now() < round.startsAt) return { word, accepted: false, reason: 'not-started' };
    if (Date.now() > round.endsAt + SUBMIT_GRACE_MS) return { word, accepted: false, reason: 'round-over' };
    if (word.length < this.settings.minWordLength) return { word, accepted: false, reason: 'too-short' };
    if (player.words.has(word)) return { word, accepted: false, reason: 'already-found' };

    const path = round.solution.get(word);
    if (!path) {
      // Telling "not a word" from "not on the grid" is what helps a player improve.
      const reason = this.dictionary.has(word) ? 'not-on-board' : 'not-a-word';
      return { word, accepted: false, reason };
    }

    const points = wordScore(word.length, this.settings.scoringMode);
    player.words.set(word, { points, path });
    player.lastSeen = Date.now();
    this.touch();
    this.broadcaster.state(this);

    return { word, accepted: true, path: [...path], points };
  }

  // -- serialisation ---------------------------------------------------------

  toState(): RoomState {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      settings: this.settings,
      players: [...this.players.values()].map((player) => ({
        id: player.id,
        nickname: player.nickname,
        connected: player.connected,
        isHost: player.id === this.hostId,
        totalScore: player.totalScore,
        wordCount: player.words.size,
      })),
      round: this.round
        ? {
            number: this.round.number,
            board: [...this.round.board.cells],
            startsAt: this.round.startsAt,
            endsAt: this.round.endsAt,
            serverNow: Date.now(),
            solutionCount: this.settings.showSolutionCount ? this.round.solution.size : null,
          }
        : null,
      results: this.results,
      roundsPlayed: this.roundsPlayed,
      gameOver: this.gameOver,
    };
  }

  /** A player's private view: their own words, restored after reconnecting. */
  myState(playerId: string): MyRoundState {
    const player = this.players.get(playerId);
    if (!player) return { words: [] };
    return {
      words: [...player.words.entries()].map(([word, found]) => ({
        word,
        points: found.points,
        path: found.path,
      })),
    };
  }

  dispose(): void {
    this.clearTimer();
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly dictionary: Dictionary,
    private readonly broadcaster: RoomBroadcaster,
  ) {}

  get size(): number {
    return this.rooms.size;
  }

  private generateCode(): string {
    for (let attempt = 0; attempt < 20; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    // Unlikely fallback: lengthen the code.
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH + 2; i++) {
      code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    }
    return code;
  }

  create(settings: Partial<GameSettings> | undefined): Room {
    const room = new Room(this.generateCode(), sanitizeSettings(settings, DEFAULT_SETTINGS), this.dictionary, this.broadcaster);
    this.rooms.set(room.code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  delete(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room.dispose();
    this.rooms.delete(code);
  }

  /** Drops empty or abandoned rooms. */
  sweep(): number {
    let removed = 0;
    for (const [code, room] of this.rooms) {
      if (room.isExpired) {
        room.dispose();
        this.rooms.delete(code);
        removed++;
      }
    }
    return removed;
  }
}
