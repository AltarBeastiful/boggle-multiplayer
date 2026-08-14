/**
 * Types partagés entre le serveur et le client.
 * Les règles proviennent de https://www.boggle.fr/regles.php
 * et les variantes de https://www.boggle.fr/variantes.php
 */

export type BoardSize = 4 | 5;

/** Barème de points. */
export type ScoringMode =
  /** Règles de base : 3-4 = 1, 5 = 2, 6 = 3, 7 = 5, 8+ = 11. */
  | 'classic'
  /** Variante « décompte simplifié » : 1 point par lettre au-delà de la 3e. */
  | 'simplified';

/** Que faire lorsque plusieurs joueurs trouvent le même mot. */
export type DuplicateMode =
  /** Règle classique : un mot trouvé par plusieurs joueurs ne rapporte rien à personne. */
  | 'cancel'
  /** Chaque joueur marque tous ses mots valides. */
  | 'all';

/** Condition de fin de partie (les points s'ajoutent d'une manche à l'autre). */
export type EndCondition =
  | { type: 'rounds'; rounds: number }
  | { type: 'score'; target: number }
  | { type: 'endless' };

export interface GameSettings {
  /** 4x4 (Boggle classique) ou 5x5 (Big Boggle). */
  boardSize: BoardSize;
  /** Durée d'une manche en secondes (3 minutes par défaut). */
  roundSeconds: number;
  /** Variante « mots de quatre lettres et plus uniquement » : passer à 4. */
  minWordLength: 3 | 4;
  scoringMode: ScoringMode;
  duplicateMode: DuplicateMode;
  /** Variante « QU à la place de Q » : la case Q vaut indifféremment Q ou QU. */
  qEqualsQu: boolean;
  /**
   * Indice : afficher pendant la manche le nombre de mots que contient la grille
   * (« 3 mots trouvés sur 121 »). Masqué par défaut.
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

/** Pourquoi un mot soumis a été refusé (retour immédiat au joueur). */
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
  /** Chemin sur la grille, si accepté (indices de cases). */
  path?: number[];
  /**
   * Points potentiels du mot. En mode « cancel » ils ne sont acquis
   * qu'à la fin de la manche, si personne d'autre n'a trouvé le mot.
   */
  points?: number;
}

export type WordStatus = 'ok' | 'duplicate';

export interface ScoredWord {
  word: string;
  points: number;
  status: WordStatus;
  /** Nombre de joueurs ayant trouvé ce mot. */
  foundBy: number;
}

export interface PublicPlayer {
  id: string;
  nickname: string;
  connected: boolean;
  isHost: boolean;
  /** Score cumulé sur toutes les manches terminées. */
  totalScore: number;
  /** Nombre de mots validés dans la manche en cours (les mots restent secrets). */
  wordCount: number;
}

export interface PlayerRoundResult {
  playerId: string;
  nickname: string;
  words: ScoredWord[];
  roundScore: number;
  totalScore: number;
}

/** Un mot de la grille, et qui l'a trouvé. */
export interface SolutionWord {
  word: string;
  points: number;
  path: number[];
  /** Identifiants des joueurs qui l'ont trouvé (vide = personne). */
  finders: string[];
}

export interface RoundResults {
  roundNumber: number;
  board: string[];
  players: PlayerRoundResult[];
  /** Toutes les solutions de la grille, triées du mot le plus long au plus court. */
  solution: SolutionWord[];
  /** Nombre total de mots présents dans la grille. */
  solutionCount: number;
  /** Total des points disponibles dans la grille. */
  solutionPoints: number;
  /** La partie est-elle terminée après cette manche ? */
  gameOver: boolean;
}

export interface RoundState {
  number: number;
  board: string[];
  /**
   * Début effectif de la manche (epoch ms). Entre la réception de la grille et
   * cet instant, les lettres sont floutées : tout le monde démarre ensemble,
   * même si un client a reçu la grille quelques dizaines de ms plus tôt.
   */
  startsAt: number;
  /** Date de fin (epoch ms, horloge serveur). */
  endsAt: number;
  /** Horloge serveur au moment de l'envoi, pour corriger la dérive du client. */
  serverNow: number;
  /** Nombre de mots de la grille. Renseigné si l'indice est activé, sinon null. */
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
  /** Numéro de la dernière manche jouée. */
  roundsPlayed: number;
  gameOver: boolean;
}

/** Une définition, telle que renvoyée par GET /api/definition/:mot. */
export interface DefinitionEntry {
  /** Graphie réelle interrogée : « été », « côté ». */
  spelling: string;
  partOfSpeech: string;
  /**
   * Les sens de cette graphie, le principal en premier. Un mot polysémique en
   * a plusieurs : « cote » est à la fois une cotation, une cote de rivière et
   * une dimension sur un plan.
   */
  definitions: string[];
  /** Renseigné quand la graphie est une forme fléchie de ce lemme. */
  lemma?: string;
}

export interface DefinitionResult {
  word: string;
  entries: DefinitionEntry[];
  /** D'où vient la réponse : fichier embarqué ou appel au Wiktionnaire. */
  source?: 'local' | 'wiktionary';
}

/** Vue privée : les mots que *moi* j'ai trouvés dans la manche en cours. */
export interface MyRoundState {
  words: Array<{ word: string; points: number; path: number[] }>;
}

// ---------------------------------------------------------------------------
// Protocole Socket.IO
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
  'round:next': (ack: (res: Ack<null>) => void) => void;
  'game:reset': (ack: (res: Ack<null>) => void) => void;
  'word:submit': (word: string, ack: (res: Ack<SubmitResult>) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'round:started': (round: RoundState) => void;
  'round:ended': (results: RoundResults) => void;
  'room:closed': (reason: string) => void;
}
