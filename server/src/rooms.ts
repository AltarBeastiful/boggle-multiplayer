import { randomInt } from 'node:crypto';

import {
  DEFAULT_SETTINGS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  disambiguateNicknames,
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

import { deleteRecord, listRecords, readRecord, scheduleWrite } from './store.js';

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
  /** Null for an untimed round, which only the host can close. */
  endsAt: number | null;
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

/**
 * A room on disk. Only what cannot be recomputed is kept: the grid's solution
 * is solved again on the way back in, taking a millisecond or two, and each
 * player's words are stored as words, their points and paths coming from that
 * fresh solution. A saved room therefore cannot carry a score its own grid no
 * longer supports.
 */
interface StoredRoom {
  code: string;
  hostId: string;
  settings: GameSettings;
  phase: RoomPhase;
  roundsPlayed: number;
  gameOver: boolean;
  lastActivity: number;
  players: Array<{ id: string; nickname: string; totalScore: number; words: string[] }>;
  round: { number: number; cells: string[]; startedAt: number; startsAt: number; endsAt: number | null } | null;
  results: RoundResults | null;
}

const recordName = (code: string) => `room-${code}`;

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

  /** Public names, numbered when two players chose the same one. The join
   *  order is what `players` iterates in. */
  private displayNames(): Map<string, string> {
    return disambiguateNicknames([...this.players.values()]);
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

  /** Every mutation passes through here, so this is where the room is saved. */
  private touch(): void {
    this.lastActivity = Date.now();
    scheduleWrite(recordName(this.code), () => this.toStored());
  }

  // -- persistence -----------------------------------------------------------

  private toStored(): StoredRoom {
    return {
      code: this.code,
      hostId: this.hostId,
      settings: this.settings,
      phase: this.phase,
      roundsPlayed: this.roundsPlayed,
      gameOver: this.gameOver,
      lastActivity: this.lastActivity,
      players: [...this.players.values()].map((player) => ({
        id: player.id,
        nickname: player.nickname,
        totalScore: player.totalScore,
        words: [...player.words.keys()],
      })),
      round: this.round
        ? {
            number: this.round.number,
            cells: [...this.round.board.cells],
            startedAt: this.round.startedAt,
            startsAt: this.round.startsAt,
            endsAt: this.round.endsAt,
          }
        : null,
      results: this.results,
    };
  }

  /**
   * Rebuilds a room a restart interrupted. The clock is the delicate part: a
   * round saved with three seconds left and restored a minute later has to end
   * at once, not resume as though nothing had happened.
   */
  static fromStored(stored: StoredRoom, dictionary: Dictionary, broadcaster: RoomBroadcaster): Room | null {
    if (!stored.code || !Array.isArray(stored.players)) return null;

    const room = new Room(stored.code, sanitizeSettings(stored.settings), dictionary, broadcaster);
    room.hostId = stored.hostId;
    room.phase = stored.phase;
    room.roundsPlayed = stored.roundsPlayed ?? 0;
    room.gameOver = Boolean(stored.gameOver);
    room.results = stored.results ?? null;
    room.lastActivity = stored.lastActivity ?? Date.now();

    for (const entry of stored.players) {
      room.players.set(entry.id, {
        id: entry.id,
        nickname: entry.nickname,
        // Everyone is away: the sockets died with the process. They come back
        // through the usual reconnection, with their words and their score.
        connected: false,
        socketId: null,
        totalScore: entry.totalScore ?? 0,
        words: new Map(),
        lastSeen: room.lastActivity,
      });
    }

    if (stored.phase !== 'playing' || !stored.round) {
      if (stored.phase === 'playing') room.phase = room.results ? 'results' : 'lobby';
      return room;
    }

    const { minWordLength, qEqualsQu, scoringMode } = room.settings;
    const board: Board = { size: room.settings.boardSize, cells: stored.round.cells };
    const solved = solveBoard(board, dictionary, { minWordLength, qEqualsQu }, scoringMode);

    room.round = {
      number: stored.round.number,
      board,
      seed: 0,
      startedAt: stored.round.startedAt,
      startsAt: stored.round.startsAt,
      endsAt: stored.round.endsAt,
      solution: solved.words,
      solutionPoints: solved.totalPoints,
      timer: null,
    };

    // Points and paths come from the grid, never from the file.
    for (const entry of stored.players) {
      const player = room.players.get(entry.id);
      if (!player) continue;
      for (const word of entry.words) {
        const path = solved.words.get(word);
        if (path) player.words.set(word, { points: wordScore(word.length, scoringMode), path });
      }
    }

    const remaining = stored.round.endsAt === null ? null : stored.round.endsAt + SUBMIT_GRACE_MS - Date.now();
    if (remaining === null) {
      // An untimed round has nothing to catch up on: it waits for its host.
    } else if (remaining <= 0) {
      room.endRound();
    } else {
      room.round.timer = setTimeout(() => room.endRound(), remaining);
    }
    return room;
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
      endsAt: roundSeconds === null ? null : startsAt + roundSeconds * 1000,
      solution: solution.words,
      solutionPoints: solution.totalPoints,
      timer: null,
    };
    this.phase = 'playing';
    this.results = null;
    this.touch();

    // An untimed round arms no timer at all: it ends when the host says so.
    if (roundSeconds !== null) {
      this.round.timer = setTimeout(
        () => this.endRound(),
        COUNTDOWN_MS + roundSeconds * 1000 + SUBMIT_GRACE_MS,
      );
    }
    this.broadcaster.roundStarted(this);
  }

  private clearTimer(): void {
    if (this.round?.timer) {
      clearTimeout(this.round.timer);
      this.round.timer = null;
    }
  }

  /**
   * The host closes the round by hand. It is the only way out of an untimed
   * round, and stays available in a timed one: the host can already reset the
   * game, so cutting a round short adds no power they did not have.
   */
  endRoundNow(playerId: string): void {
    if (!this.isHost(playerId)) throw new Error("Seul l'hôte peut terminer la manche");
    if (this.phase !== 'playing' || !this.round) throw new Error('Aucune manche en cours');
    this.endRound();
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
    const names = this.displayNames();
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
        nickname: names.get(player.id) ?? player.nickname,
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
    if (round.endsAt !== null && Date.now() > round.endsAt + SUBMIT_GRACE_MS) {
      return { word, accepted: false, reason: 'round-over' };
    }
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
    const names = this.displayNames();
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      settings: this.settings,
      players: [...this.players.values()].map((player) => ({
        id: player.id,
        nickname: names.get(player.id) ?? player.nickname,
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
    deleteRecord(recordName(code));
  }

  /** Drops empty or abandoned rooms. */
  sweep(): number {
    let removed = 0;
    for (const [code, room] of this.rooms) {
      if (room.isExpired) {
        room.dispose();
        this.rooms.delete(code);
        deleteRecord(recordName(code));
        removed++;
      }
    }
    return removed;
  }

  /**
   * Picks up the rooms a restart interrupted. A deploy takes seconds and a
   * round lasts minutes, so without this every deploy cuts short whatever was
   * being played.
   */
  restore(): number {
    for (const name of listRecords('room-')) {
      const stored = readRecord<StoredRoom>(name);
      const room = stored ? Room.fromStored(stored, this.dictionary, this.broadcaster) : null;
      if (room) this.rooms.set(room.code, room);
      else deleteRecord(name);
    }
    // Rooms nobody came back to are dropped straight away rather than lingering
    // for another half hour: their thirty minutes were served while we were down.
    const restored = this.rooms.size;
    this.sweep();
    return restored;
  }
}
