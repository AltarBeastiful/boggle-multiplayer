/**
 * End-of-game awards, in the manner of TowerFall Ascension: when the last
 * round is over, the standings say who won and the awards say how everyone
 * played. Being fastest, or stubbornest, or the one who kept inventing words
 * is worth something even when it is not worth points.
 *
 * Three principles hold the whole thing up:
 *
 *   - Awards describe, they do not rank. Several players can earn the same
 *     one, and the player who came last can walk away with three.
 *   - A threshold has to be hard enough to mean something. Two rules that
 *     between them cover every possible player hand out no information at all,
 *     which is why "found what nobody else did" and "thought like everybody
 *     else" leave a wide band of ordinary play between them.
 *   - Every player leaves with at least one. An empty line under a name reads
 *     as a verdict, which is the opposite of the point.
 *   - Nothing is measured that costs anything to measure. What a round already
 *     knows is reused; the rest is a handful of counters bumped on submission,
 *     never a list of events kept for later.
 */

/** Six letters or more is a long word: 3 points in the classic table. */
export const LONG_WORD_LENGTH = 6;
/** Three or four letters, the two lengths that score the same 1 point. */
export const SHORT_WORD_LENGTH = 4;

/**
 * What a player's game amounts to, in numbers. One of these per player per
 * game, about twenty fields, updated in place: the cost of the whole feature.
 *
 * Practice words are deliberately absent. They are found after the buzzer and
 * count for nothing, so letting them colour a play style would be a way of
 * scoring them after all.
 */
export interface PlayerMetrics {
  /** Words sent up for judgement, whatever became of them. */
  attempts: number;
  /** Words the grid accepted, before duplicates were cancelled. */
  accepted: number;
  /** Refused: no such word in the dictionary. */
  invented: number;
  /** Refused: a real word, but not traceable on this grid. */
  offBoard: number;
  /** Accepted words of six letters or more, and the points they brought in. */
  longWords: number;
  longPoints: number;
  /** Accepted words of three or four letters. */
  shortWords: number;
  /** The longest word accepted all game. Ties keep the first one found. */
  longestWord: string;
  /** Points kept, once duplicates were cancelled. */
  points: number;
  /** Accepted words nobody else found, and words at least one rival had too. */
  soloWords: number;
  sharedWords: number;
  /** Rounds this player opened, by being first to have a word accepted. */
  openings: number;
  /**
   * Sum of the gaps between accepted words, and how many gaps that is. A mean
   * rather than a list: two numbers say "one word every eleven seconds" just
   * as well as three hundred timestamps would.
   */
  waitMs: number;
  waits: number;
  /** Rounds played through to the end. */
  rounds: number;
}

export function emptyMetrics(): PlayerMetrics {
  return {
    attempts: 0,
    accepted: 0,
    invented: 0,
    offBoard: 0,
    longWords: 0,
    longPoints: 0,
    shortWords: 0,
    longestWord: '',
    points: 0,
    soloWords: 0,
    sharedWords: 0,
    openings: 0,
    waitMs: 0,
    waits: 0,
    rounds: 0,
  };
}

/**
 * Metrics read back from disk, where the file may predate half these fields
 * and, in the worst case, hold anything at all. Written out field by field so
 * that adding a counter will not compile until it has been thought about here.
 */
export function restoreMetrics(input: unknown): PlayerMetrics {
  if (!input || typeof input !== 'object') return emptyMetrics();
  const stored = input as Record<string, unknown>;
  const count = (key: keyof PlayerMetrics): number => {
    const value = stored[key];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  };
  return {
    attempts: count('attempts'),
    accepted: count('accepted'),
    invented: count('invented'),
    offBoard: count('offBoard'),
    longWords: count('longWords'),
    longPoints: count('longPoints'),
    shortWords: count('shortWords'),
    longestWord: typeof stored.longestWord === 'string' ? stored.longestWord : '',
    points: count('points'),
    soloWords: count('soloWords'),
    sharedWords: count('sharedWords'),
    openings: count('openings'),
    waitMs: count('waitMs'),
    waits: count('waits'),
    rounds: count('rounds'),
  };
}

export type AwardId =
  | 'big-brain'
  | 'long-shot'
  | 'nibbler'
  | 'hare'
  | 'brute-force'
  | 'mirage'
  | 'ghost'
  | 'telepath'
  | 'sniper'
  | 'harvester'
  | 'first-blood'
  | 'tortoise'
  | 'all-rounder'
  | 'bystander';

export interface Award {
  id: AwardId;
  name: string;
  icon: string;
  /** The play style, in one line. */
  blurb: string;
  /** The figure that earned it, so the award is never just an assertion. */
  detail: string;
}

export interface PlayerAwards {
  playerId: string;
  nickname: string;
  awards: Award[];
}

export interface AwardEntry {
  playerId: string;
  nickname: string;
  metrics: PlayerMetrics;
}

/** Nobody carries more than this: a wall of trophies says nothing at all. */
export const MAX_AWARDS_PER_PLAYER = 3;

interface Scored {
  entry: AwardEntry;
  value: number;
}

interface Rule {
  id: AwardId;
  name: string;
  icon: string;
  blurb: string;
  /** Comparative awards mean nothing in a room of one. */
  needsRivals?: boolean;
  /** Whoever earns it, and the figure to show them. */
  earn(field: AwardEntry[]): Array<{ playerId: string; detail: string }>;
}

/**
 * Everyone the measure returns a number for. Returning null is how a rule says
 * "not this player": the threshold lives in the measure, not out here.
 */
function qualifiers(field: AwardEntry[], measure: (metrics: PlayerMetrics) => number | null): Scored[] {
  const scored: Scored[] = [];
  for (const entry of field) {
    const value = measure(entry.metrics);
    if (value !== null && Number.isFinite(value)) scored.push({ entry, value });
  }
  return scored;
}

/** Of those who qualify, the ones at the top. Ties all win, as they should. */
function leaders(
  field: AwardEntry[],
  measure: (metrics: PlayerMetrics) => number | null,
  lowestWins = false,
): Scored[] {
  const scored = qualifiers(field, measure);
  if (scored.length === 0) return [];
  const values = scored.map((row) => row.value);
  const best = lowestWins ? Math.min(...values) : Math.max(...values);
  return scored.filter((row) => row.value === best);
}

/** Mean seconds between two accepted words, or null for too few to mean anything. */
function pace(metrics: PlayerMetrics): number | null {
  if (metrics.waits < 1) return null;
  return metrics.waitMs / metrics.waits / 1000;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count > 1 ? many : one}`;
/** French decimals take a comma: "toutes les 6,4 s". */
const seconds = (value: number) => `${value.toFixed(value < 10 ? 1 : 0).replace('.', ',')} s`;

/**
 * The rules, in the order they say most about a player: the first three a
 * player earns are the ones they keep. Ordering by a fixed list rather than by
 * how strongly each was earned keeps the result predictable, and lets "found
 * the longest word of the game" outrank "was accurate", which is a judgement
 * about the game and not something a formula should be making.
 */
const RULES: Rule[] = [
  {
    id: 'big-brain',
    name: 'Gros Cerveau',
    icon: '🧠',
    blurb: 'a sorti le plus long mot de la partie',
    earn: (field) =>
      leaders(field, (m) => (m.longestWord.length >= LONG_WORD_LENGTH ? m.longestWord.length : null)).map(
        ({ entry }) => ({
          playerId: entry.playerId,
          detail: `${entry.metrics.longestWord}, ${entry.metrics.longestWord.length} lettres`,
        }),
      ),
  },
  {
    id: 'long-shot',
    name: 'Longue Portée',
    icon: '🏹',
    blurb: 'vise les gros mots, et tant pis pour les miettes',
    earn: (field) =>
      qualifiers(field, (m) =>
        m.longWords >= 2 && m.points > 0 && m.longPoints / m.points >= 0.5 ? m.longPoints / m.points : null,
      ).map(({ entry, value }) => ({
        playerId: entry.playerId,
        detail: `${Math.round(value * 100)} % de ses points en ${LONG_WORD_LENGTH} lettres ou plus`,
      })),
  },
  {
    id: 'nibbler',
    name: 'Grignoteur',
    icon: '🐜',
    blurb: 'des petits mots, et beaucoup',
    earn: (field) =>
      qualifiers(field, (m) =>
        m.accepted >= 8 && m.shortWords / m.accepted >= 0.7 ? m.shortWords / m.accepted : null,
      ).map(({ entry }) => ({
        playerId: entry.playerId,
        detail: `${entry.metrics.shortWords} mots courts sur ${entry.metrics.accepted}`,
      })),
  },
  {
    id: 'hare',
    name: 'Lièvre',
    icon: '🐇',
    blurb: 'tape plus vite que son ombre',
    earn: (field) =>
      qualifiers(field, (m) => {
        const gap = pace(m);
        return m.accepted >= 6 && gap !== null && gap <= 15 ? gap : null;
      }).map(({ entry, value }) => ({
        playerId: entry.playerId,
        detail: `un mot toutes les ${seconds(value)}`,
      })),
  },
  {
    id: 'brute-force',
    name: 'Force Brute',
    icon: '🔨',
    blurb: 'tente tout, le dictionnaire suivra',
    earn: (field) =>
      qualifiers(field, (m) =>
        m.invented >= 6 && m.attempts > 0 && m.invented / m.attempts >= 0.25 ? m.invented : null,
      ).map(({ entry }) => ({
        playerId: entry.playerId,
        detail: `${entry.metrics.invented} mots inventés sur ${entry.metrics.attempts} essais`,
      })),
  },
  {
    id: 'mirage',
    name: 'Mirage',
    icon: '🌀',
    blurb: 'voit des mots qui ne sont pas dans la grille',
    earn: (field) =>
      qualifiers(field, (m) =>
        m.offBoard >= 5 && m.attempts > 0 && m.offBoard / m.attempts >= 0.2 ? m.offBoard : null,
      ).map(({ entry }) => ({
        playerId: entry.playerId,
        detail: `${entry.metrics.offBoard} vrais mots absents de la grille`,
      })),
  },
  {
    id: 'ghost',
    name: 'Fantôme',
    icon: '👻',
    blurb: 'trouve ce que personne d’autre ne voit',
    needsRivals: true,
    earn: (field) =>
      leaders(field, (m) =>
        m.soloWords >= 4 && m.accepted > 0 && m.soloWords / m.accepted >= 0.5 ? m.soloWords : null,
      ).map(({ entry }) => ({
        playerId: entry.playerId,
        detail: `${entry.metrics.soloWords} mots que personne d’autre n’a trouvés`,
      })),
  },
  {
    id: 'telepath',
    name: 'Télépathe',
    icon: '🔮',
    blurb: 'pense exactement comme les autres',
    needsRivals: true,
    earn: (field) =>
      qualifiers(field, (m) =>
        m.accepted >= 6 && m.sharedWords / m.accepted >= 0.7 ? m.sharedWords / m.accepted : null,
      ).map(({ entry, value }) => ({
        playerId: entry.playerId,
        detail: `${Math.round(value * 100)} % de ses mots trouvés par un autre`,
      })),
  },
  {
    id: 'sniper',
    name: 'Œil de Lynx',
    icon: '🎯',
    blurb: 'n’envoie que ce qui va passer',
    earn: (field) =>
      qualifiers(field, (m) =>
        m.attempts >= 12 && m.accepted / m.attempts >= 0.9 ? m.accepted / m.attempts : null,
      ).map(({ entry }) => ({
        playerId: entry.playerId,
        detail: `${entry.metrics.accepted} mots acceptés sur ${entry.metrics.attempts}`,
      })),
  },
  {
    id: 'harvester',
    name: 'Moissonneur',
    icon: '🌾',
    blurb: 'ramasse tout ce qui traîne dans la grille',
    needsRivals: true,
    earn: (field) =>
      leaders(field, (m) => (m.accepted >= 10 ? m.accepted : null)).map(({ entry }) => ({
        playerId: entry.playerId,
        detail: `${entry.metrics.accepted} mots trouvés en tout`,
      })),
  },
  {
    id: 'first-blood',
    name: 'Premier Sang',
    icon: '⚡',
    blurb: 'ouvre la manche avant tout le monde',
    needsRivals: true,
    earn: (field) =>
      leaders(field, (m) => (m.openings >= 1 ? m.openings : null)).map(({ entry }) => ({
        playerId: entry.playerId,
        detail: `${plural(entry.metrics.openings, 'manche ouverte', 'manches ouvertes')}`,
      })),
  },
  {
    id: 'tortoise',
    name: 'Tortue',
    icon: '🐢',
    blurb: 'prend son temps, et le prend bien',
    needsRivals: true,
    earn: (field) =>
      qualifiers(field, (m) => {
        const gap = pace(m);
        return m.accepted >= 3 && gap !== null && gap >= 40 ? gap : null;
      }).map(({ entry, value }) => ({
        playerId: entry.playerId,
        detail: `un mot toutes les ${seconds(value)}`,
      })),
  },
];

/**
 * For a player no rule had anything to say about. Coming out of a game with a
 * blank line under your name is worse than coming out of it a tortoise.
 */
const FALLBACKS: Record<'silent' | 'balanced', Omit<Award, 'detail'>> = {
  silent: {
    id: 'bystander',
    name: 'Spectateur',
    icon: '👀',
    blurb: 'a surtout regardé la grille',
  },
  balanced: {
    id: 'all-rounder',
    name: 'Touche-à-tout',
    icon: '🎲',
    blurb: 'un peu de tout, rien à l’excès',
  },
};

/**
 * Hands out the awards. Order within a player is the order of the rules, which
 * is deliberate: the most telling thing about how they played comes first.
 */
export function computeAwards(field: AwardEntry[]): PlayerAwards[] {
  const earned = new Map<string, Award[]>();
  for (const entry of field) earned.set(entry.playerId, []);

  const hasRivals = field.length > 1;
  for (const rule of RULES) {
    if (rule.needsRivals && !hasRivals) continue;
    for (const { playerId, detail } of rule.earn(field)) {
      const list = earned.get(playerId);
      if (!list || list.length >= MAX_AWARDS_PER_PLAYER) continue;
      list.push({ id: rule.id, name: rule.name, icon: rule.icon, blurb: rule.blurb, detail });
    }
  }

  return field.map((entry) => {
    const awards = earned.get(entry.playerId) ?? [];
    if (awards.length === 0) {
      const silent = entry.metrics.accepted === 0;
      const fallback = silent ? FALLBACKS.silent : FALLBACKS.balanced;
      awards.push({
        ...fallback,
        detail: silent
          ? 'aucun mot trouvé'
          : `${plural(entry.metrics.accepted, 'mot')} pour ${plural(entry.metrics.points, 'point')}`,
      });
    }
    return { playerId: entry.playerId, nickname: entry.nickname, awards };
  });
}
