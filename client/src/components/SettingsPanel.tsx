import type { EndCondition, GameSettings } from '@boggle/shared';

import { formatDuration } from '../lib/labels';

interface ChoiceProps<T extends string | number> {
  label: string;
  hint?: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
  onChange(value: T): void;
}

function Choice<T extends string | number>({ label, hint, value, options, disabled, onChange }: ChoiceProps<T>) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-sm font-medium text-fg-muted">{label}</span>
        {hint && <span className="text-xs text-fg-faint">{hint}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={[
                'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                active
                  ? 'bg-accent text-accent-fg'
                  : 'bg-chip text-fg-muted hover:bg-chip-hover disabled:hover:bg-chip',
                disabled ? 'cursor-not-allowed opacity-60' : '',
              ].join(' ')}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function endKey(end: EndCondition): string {
  if (end.type === 'endless') return 'endless';
  if (end.type === 'rounds') return `rounds:${end.rounds}`;
  return `score:${end.target}`;
}

function parseEndKey(key: string): EndCondition {
  if (key === 'endless') return { type: 'endless' };
  const [type, raw] = key.split(':');
  const value = Number(raw);
  if (type === 'score') return { type: 'score', target: value };
  return { type: 'rounds', rounds: value };
}

interface SettingsPanelProps {
  settings: GameSettings;
  disabled: boolean;
  onChange(patch: Partial<GameSettings>): void;
}

export function SettingsPanel({ settings, disabled, onChange }: SettingsPanelProps) {
  return (
    <div className="space-y-4">
      <Choice
        label="Grille"
        value={settings.boardSize}
        disabled={disabled}
        onChange={(boardSize) => onChange({ boardSize })}
        options={[
          { value: 4, label: '4 x 4' },
          { value: 5, label: '5 x 5' },
        ]}
      />

      {/* Keyed by string so "sans limite" can sit in the same row as the
          durations; null is a value here, not an absent setting. */}
      <Choice
        label="Durée d'une manche"
        hint="sans limite : l'hôte arrête la manche"
        value={settings.roundSeconds === null ? 'libre' : String(settings.roundSeconds)}
        disabled={disabled}
        onChange={(key) => onChange({ roundSeconds: key === 'libre' ? null : Number(key) })}
        options={[
          ...[60, 120, 180, 300].map((seconds) => ({
            value: String(seconds),
            label: formatDuration(seconds),
          })),
          { value: 'libre', label: 'sans limite' },
        ]}
      />

      <Choice
        label="Longueur minimale"
        hint="variante : 4 lettres et plus"
        value={settings.minWordLength}
        disabled={disabled}
        onChange={(minWordLength) => onChange({ minWordLength })}
        options={[
          { value: 3, label: '3 lettres' },
          { value: 4, label: '4 lettres' },
        ]}
      />

      <Choice
        label="Barème"
        hint="variante : décompte simplifié"
        value={settings.scoringMode}
        disabled={disabled}
        onChange={(scoringMode) => onChange({ scoringMode })}
        options={[
          { value: 'classic', label: '1 / 2 / 3 / 5 / 11' },
          { value: 'simplified', label: 'longueur − 3' },
        ]}
      />

      <Choice
        label="Mots trouvés par plusieurs joueurs"
        value={settings.duplicateMode}
        disabled={disabled}
        onChange={(duplicateMode) => onChange({ duplicateMode })}
        options={[
          { value: 'cancel', label: 'annulés' },
          { value: 'all', label: 'comptés pour tous' },
        ]}
      />

      <Choice
        label="Lettre Q"
        hint="variante : QU à la place de Q"
        value={settings.qEqualsQu ? 'qu' : 'q'}
        disabled={disabled}
        onChange={(mode) => onChange({ qEqualsQu: mode === 'qu' })}
        options={[
          { value: 'q', label: 'Q seul' },
          { value: 'qu', label: 'Q vaut Q ou QU' },
        ]}
      />

      <Choice
        label="Indice pendant la manche"
        hint="nombre de mots présents dans la grille"
        value={settings.showSolutionCount ? 'on' : 'off'}
        disabled={disabled}
        onChange={(mode) => onChange({ showSolutionCount: mode === 'on' })}
        options={[
          { value: 'off', label: 'masqué' },
          { value: 'on', label: 'affiché' },
        ]}
      />

      <Choice
        label="Fin de partie"
        value={endKey(settings.endCondition)}
        disabled={disabled}
        onChange={(key) => onChange({ endCondition: parseEndKey(key) })}
        options={[
          { value: 'rounds:1', label: '1 manche' },
          { value: 'rounds:3', label: '3 manches' },
          { value: 'rounds:5', label: '5 manches' },
          { value: 'score:100', label: '100 points' },
          { value: 'endless', label: 'sans fin' },
        ]}
      />
    </div>
  );
}
