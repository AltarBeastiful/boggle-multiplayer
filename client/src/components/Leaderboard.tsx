import type { DailyRanking } from '@boggle/shared';

import { formatDuration } from '../lib/labels';

/**
 * The day's finished attempts. Ties on score are broken by time, which is what
 * gives the timer a point: it stops nothing, but it separates two players who
 * found the same words.
 */
export function Leaderboard({ ranking, rank }: { ranking: DailyRanking[]; rank: number | null }) {
  if (ranking.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-panel p-4">
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-fg-muted uppercase">Classement du jour</h2>
        <p className="text-sm text-fg-faint">Personne d’autre n’a encore terminé la grille aujourd’hui.</p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border">
      <div className="flex items-baseline justify-between bg-panel px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold tracking-wide text-fg-muted uppercase">Classement du jour</h2>
        {rank !== null && (
          <span className="text-sm text-fg-faint">
            {rank}
            <sup>{rank === 1 ? 'er' : 'e'}</sup> sur {ranking.length}
          </span>
        )}
      </div>
      <table className="w-full text-sm">
        <thead className="bg-panel-soft text-xs tracking-wide text-fg-faint uppercase">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Joueur</th>
            <th className="px-3 py-2 text-right font-medium">Mots</th>
            <th className="px-3 py-2 text-right font-medium">Temps</th>
            <th className="px-3 py-2 text-right font-medium">Points</th>
          </tr>
        </thead>
        <tbody>
          {ranking.map((entry, index) => (
            <tr
              key={`${entry.nickname}-${index}`}
              className={`border-t border-border bg-panel ${entry.me ? 'bg-accent-soft' : ''}`}
            >
              <td className="px-3 py-2 text-fg">
                <span className="mr-2 text-fg-faint">{index + 1}</span>
                {entry.nickname}
                {entry.me && <span className="ml-1.5 text-xs text-fg-faint">(vous)</span>}
              </td>
              <td className="px-3 py-2 text-right text-fg-muted">{entry.words}</td>
              <td className="px-3 py-2 text-right text-fg-muted tabular-nums">
                {formatDuration(entry.seconds)}
              </td>
              <td className="px-3 py-2 text-right font-semibold text-fg">{entry.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
