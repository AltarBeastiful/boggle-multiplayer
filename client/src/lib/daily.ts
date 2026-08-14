import type { DailyState, DailyTeaser, SubmitResult } from '@boggle/shared';

import { getPlayerId } from './storage';

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId: getPlayerId(), ...body }),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? 'Le serveur ne répond pas');
  }
  return (await response.json()) as T;
}

export const dailyApi = {
  /** What the home page shows, without opening the grid. */
  teaser: async (): Promise<DailyTeaser | null> => {
    const response = await fetch(`/api/daily?playerId=${encodeURIComponent(getPlayerId())}`);
    return response.ok ? ((await response.json()) as DailyTeaser) : null;
  },
  start: (nickname: string) => post<DailyState>('/api/daily/start', { nickname }),
  submit: (word: string) => post<SubmitResult>('/api/daily/word', { word }),
  finish: () => post<DailyState>('/api/daily/finish', {}),
};

/** "lundi 17 août", for the heading. */
export function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return day;
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString('fr-FR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}
