import type { EndCondition, GameSettings, RejectReason } from '@boggle/shared';

export function rejectionMessage(reason: RejectReason | undefined, minWordLength: number): string {
  switch (reason) {
    case 'not-started':
      return 'la manche n’a pas encore commencé';
    case 'too-short':
      return `${minWordLength} lettres minimum`;
    case 'not-on-board':
      return 'pas traçable sur la grille';
    case 'not-a-word':
      return 'absent du dictionnaire';
    case 'already-found':
      return 'déjà trouvé';
    case 'round-over':
      return 'manche terminée';
    default:
      return 'refusé';
  }
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

export function endConditionLabel(end: EndCondition): string {
  if (end.type === 'rounds') return `${end.rounds} manche${end.rounds > 1 ? 's' : ''}`;
  if (end.type === 'score') return `${end.target} points`;
  return 'sans fin';
}

/** Résumé court des réglages, affiché dans le salon et pendant la partie. */
export function settingsSummary(settings: GameSettings): string[] {
  const parts = [
    `${settings.boardSize}x${settings.boardSize}`,
    formatDuration(settings.roundSeconds),
    `${settings.minWordLength} lettres min`,
    settings.scoringMode === 'classic' ? 'barème classique' : 'barème simplifié',
    settings.duplicateMode === 'cancel' ? 'doublons annulés' : 'doublons comptés',
    endConditionLabel(settings.endCondition),
  ];
  if (settings.qEqualsQu) parts.push('Q = QU');
  if (settings.showSolutionCount) parts.push('indice affiché');
  return parts;
}
