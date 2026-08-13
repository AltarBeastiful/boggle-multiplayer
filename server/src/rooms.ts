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
  type SubmitResult,
} from '@boggle/shared';

/** Tolérance de latence : un mot parti juste avant le buzzer compte encore. */
const SUBMIT_GRACE_MS = 700;
/** Nombre de mots manqués renvoyés en fin de manche. */
const MISSED_WORDS_SHOWN = 60;
/** Une salle sans joueur connecté est supprimée après ce délai. */
const ROOM_TTL_MS = 30 * 60 * 1000;

interface ServerPlayer {
  id: string;
  nickname: string;
  connected: boolean;
  socketId: string | null;
  totalScore: number;
  /** Mots trouvés dans la manche en cours. */
  words: Map<string, { points: number; path: number[] }>;
  lastSeen: number;
}

interface ActiveRound {
  number: number;
  board: Board;
  seed: number;
  startedAt: number;
  endsAt: number;
  /** Tous les mots de la grille : sert à valider en O(1) et à lister les mots manqués. */
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

  // -- joueurs --------------------------------------------------------------

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

  // -- réglages -------------------------------------------------------------

  updateSettings(playerId: string, patch: Partial<GameSettings>): void {
    if (!this.isHost(playerId)) throw new Error("Seul l'hôte peut changer les réglages");
    if (this.phase === 'playing') throw new Error('Manche en cours');
    this.settings = sanitizeSettings(patch, this.settings);
    this.touch();
    this.broadcaster.state(this);
  }

  // -- déroulement ----------------------------------------------------------

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
    this.round = {
      number,
      board: generated.board,
      seed: generated.seed,
      startedAt: now,
      endsAt: now + roundSeconds * 1000,
      solution: solution.words,
      solutionPoints: solution.totalPoints,
      timer: null,
    };
    this.phase = 'playing';
    this.results = null;
    this.touch();

    this.round.timer = setTimeout(() => this.endRound(), roundSeconds * 1000 + SUBMIT_GRACE_MS);
    this.broadcaster.roundStarted(this);
  }

  private clearTimer(): void {
    if (this.round?.timer) {
      clearTimeout(this.round.timer);
      this.round.timer = null;
    }
  }

  /** Fin de manche : décompte, annulation des doublons, cumul des scores. */
  endRound(): void {
    const round = this.round;
    if (!round || this.phase !== 'playing') return;
    this.clearTimer();

    // Combien de joueurs ont trouvé chaque mot ?
    const foundBy = new Map<string, number>();
    for (const player of this.players.values()) {
      for (const word of player.words.keys()) {
        foundBy.set(word, (foundBy.get(word) ?? 0) + 1);
      }
    }

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

    // Les meilleurs mots que personne n'a trouvés.
    const missedWords: RoundResults['missedWords'] = [];
    for (const [word, path] of round.solution) {
      if (foundBy.has(word)) continue;
      missedWords.push({ word, points: wordScore(word.length, this.settings.scoringMode), path });
    }
    missedWords.sort((a, b) => b.points - a.points || a.word.localeCompare(b.word, 'fr'));

    this.roundsPlayed = round.number;
    this.gameOver = this.checkGameOver();
    this.phase = 'results';

    const results: RoundResults = {
      roundNumber: round.number,
      board: [...round.board.cells],
      players: playerResults,
      missedWords: missedWords.slice(0, MISSED_WORDS_SHOWN),
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

  // -- soumission de mots ---------------------------------------------------

  submitWord(playerId: string, raw: string): SubmitResult {
    const player = this.players.get(playerId);
    const word = normalizeWord(raw);
    if (!player) return { word, accepted: false, reason: 'not-playing' };

    const round = this.round;
    if (this.phase !== 'playing' || !round) return { word, accepted: false, reason: 'round-over' };
    if (Date.now() > round.endsAt + SUBMIT_GRACE_MS) return { word, accepted: false, reason: 'round-over' };
    if (word.length < this.settings.minWordLength) return { word, accepted: false, reason: 'too-short' };
    if (player.words.has(word)) return { word, accepted: false, reason: 'already-found' };

    const path = round.solution.get(word);
    if (!path) {
      // Distinguer « pas un mot » de « pas dans la grille » : c'est ce qui aide à progresser.
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

  // -- sérialisation --------------------------------------------------------

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

  /** Vue privée d'un joueur : ses propres mots (restaurés après une reconnexion). */
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
    // Repli improbable : on rallonge le code.
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

  /** Supprime les salles vides ou abandonnées. */
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
