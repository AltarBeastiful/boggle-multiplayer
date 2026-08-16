import { useEffect, useRef, useState, type FormEvent } from 'react';

import type { DailyState, SolutionWord } from '@boggle/shared';

import { dailyApi, formatDay } from '../lib/daily';
import { TRACE_DURATION_MS, TRACE_FOUND_WORD } from '../lib/config';
import { formatDuration, rejectionMessage } from '../lib/labels';
import { getNickname, setNickname } from '../lib/storage';
import { BoardGrid } from './BoardGrid';
import { DefinitionCard } from './DefinitionCard';
import { Leaderboard } from './Leaderboard';
import { SolutionPanel } from './SolutionPanel';
import { ThemeToggle } from './ThemeToggle';

/** Any identifier will do to mark "mine": the panel only compares it to itself. */
const ME = 'moi';

/** The daily solutions carry a flag rather than a list of finders. */
function asSolutionWords(state: DailyState): SolutionWord[] {
  return (state.solution ?? []).map((word) => ({
    word: word.word,
    points: word.points,
    path: word.path,
    finders: word.found ? [ME] : [],
  }));
}

interface Flash {
  word: string;
  text: string;
  key: number;
}

/**
 * The grille du jour: the same grid for everyone until midnight in Paris,
 * played alone. The clock counts up and stops nothing; it only breaks ties on
 * the leaderboard, so there is a reason to hurry without an obligation to.
 */
export function Daily({ onLeave }: { onLeave(): void }) {
  const [state, setState] = useState<DailyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [path, setPath] = useState<number[]>([]);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [highlight, setHighlight] = useState<number[] | undefined>();
  const [faintTrace, setFaintTrace] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const flashCounter = useRef(0);
  const traceTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    dailyApi
      .start(getNickname().trim() || 'Joueur')
      .then((fresh) => {
        if (cancelled) return;
        setState(fresh);
        setNickname(getNickname().trim() || 'Joueur');
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Clock offset, so a client running fast does not show a negative time. */
  const offset = state ? state.serverNow - Date.now() : 0;

  useEffect(() => {
    if (!state) return;
    if (state.finished) {
      setElapsed(state.seconds ?? 0);
      return;
    }
    const tick = () => setElapsed(Math.max(0, (Date.now() + offset - state.startedAt) / 1000));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.startedAt, state?.finished, state?.seconds]);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(id);
  }, [flash]);

  useEffect(() => () => window.clearTimeout(traceTimer.current), []);

  useEffect(() => {
    if (state && !state.finished && window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  }, [state?.finished, Boolean(state)]);

  /** `faint` marks the quick flick after a word is accepted; see Playing. */
  const traceWord = (tiles: number[] | undefined, duration = TRACE_DURATION_MS, faint = false) => {
    window.clearTimeout(traceTimer.current);
    if (!tiles) {
      setHighlight(undefined);
      return;
    }
    setFaintTrace(faint);
    setHighlight(tiles);
    traceTimer.current = window.setTimeout(() => setHighlight(undefined), duration);
  };

  if (error) {
    return (
      <div className="mx-auto w-full max-w-xl px-5 py-10 text-center">
        <p className="mb-4 rounded-xl bg-bad-bg px-4 py-3 text-bad">{error}</p>
        <button type="button" onClick={onLeave} className="text-sm text-fg-faint underline hover:text-fg-muted">
          Revenir à l’accueil
        </button>
      </div>
    );
  }

  if (!state) {
    return <p className="px-5 py-10 text-center text-fg-faint">Préparation de la grille du jour…</p>;
  }

  const send = async (raw: string) => {
    const word = raw.trim();
    if (word.length === 0) return;
    const composed = path;
    setValue('');
    setPath([]);
    try {
      const result = await dailyApi.submit(word);
      if (result.accepted) {
        setState((current) =>
          current
            ? {
                ...current,
                words: [
                  { word: result.word, points: result.points ?? 0, path: result.path ?? [] },
                  ...current.words,
                ],
                score: current.score + (result.points ?? 0),
              }
            : current,
        );
        if (TRACE_FOUND_WORD) traceWord(composed.length > 0 ? composed : result.path, TRACE_DURATION_MS, true);
        return;
      }
      flashCounter.current += 1;
      setFlash({
        word: result.word,
        text: rejectionMessage(result.reason, state.minWordLength),
        key: flashCounter.current,
      });
    } catch {
      flashCounter.current += 1;
      setFlash({ word, text: 'connexion perdue', key: flashCounter.current });
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      setState(await dailyApi.finish());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  };

  const pathToWord = (tiles: number[]) => tiles.map((index) => state.board[index] ?? '').join('');

  const applyPath = (next: number[]) => {
    setPath(next);
    setValue(pathToWord(next));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(value);
  };

  return (
    <div
      /*
       * The wide two-column layout is for reading the solutions. While playing,
       * the grid keeps the width it has in a room: stretched across a 1150 px
       * container it is a different game to look at.
       */
      className={`mx-auto w-full max-w-xl px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] ${
        state.finished ? 'lg:max-w-6xl' : ''
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-fg-faint">
        <span>Grille du jour, {formatDay(state.day)}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onLeave} className="underline hover:text-fg-muted">
            Accueil
          </button>
          <ThemeToggle />
        </div>
      </div>

      <div className={state.finished ? 'lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-6' : ''}>
        <div className={state.finished ? 'space-y-5 lg:sticky lg:top-6' : ''}>
          {/* The clock informs and nothing else: no colour change, no urgency. */}
          <div className="w-full">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-xs tracking-wide text-fg-muted uppercase">
                {state.finished ? 'Terminée en' : 'Temps écoulé'}
              </span>
              <span className="font-mono text-2xl font-bold text-fg-muted tabular-nums">
                {formatDuration(elapsed)}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-chip" />
          </div>

          <div className={`relative ${state.finished ? '' : 'my-4'}`}>
            <BoardGrid
              cells={state.board}
              size={state.size}
              highlight={highlight}
              animateHighlight
              faintHighlight={faintTrace}
              rotated
              throwKey={state.day}
              interactive={!state.finished}
              compact={state.finished}
              path={path}
              onPathChange={applyPath}
            />
            {flash && (
              <div
                key={flash.key}
                aria-hidden="true"
                className="animate-reject pointer-events-none absolute -inset-1.5 rounded-2xl ring-1 ring-bad/25"
              />
            )}
          </div>

          {state.finished && (
            <section className="rounded-2xl border border-border bg-panel p-4">
              <p className="text-sm text-fg-muted">
                <span className="text-2xl font-black text-accent">{state.score}</span> points, {state.words.length}{' '}
                mots sur {state.solutionCount}, en {formatDuration(elapsed)}.
              </p>
            </section>
          )}

          {/* The definition follows the grid, the two being read together. The
              panel below keeps its own copy for narrow screens and hides it
              here; without this one, a definition asked for on a wide screen
              opened nowhere at all. */}
          {selected && (
            <DefinitionCard className="hidden lg:block" word={selected} onClose={() => setSelected(null)} />
          )}
        </div>

        <div className={state.finished ? 'mt-5 space-y-5 lg:mt-0' : ''}>
          {!state.finished && (
            <>
              <form onSubmit={handleSubmit} className="relative flex gap-2">
                <input
                  ref={inputRef}
                  value={value}
                  onChange={(event) => {
                    setValue(event.target.value);
                    if (path.length > 0) setPath([]);
                  }}
                  placeholder="Tapez un mot puis Entrée"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="send"
                  aria-label="Mot trouvé"
                  className="w-full min-w-0 flex-1 rounded-xl border-2 border-border-strong bg-panel-soft px-3 py-4 text-center text-2xl tracking-wider text-fg uppercase outline-none placeholder:text-base placeholder:tracking-normal placeholder:normal-case placeholder:text-fg-faint focus:border-accent"
                />
                <button
                  type="submit"
                  disabled={value.trim().length === 0}
                  aria-label="Envoyer le mot"
                  className="flex w-12 shrink-0 items-center justify-center rounded-xl border-2 border-accent bg-accent text-accent-fg transition hover:bg-accent-hover disabled:border-border-strong disabled:bg-panel-soft disabled:text-fg-faint"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    aria-hidden="true"
                    className="h-6 w-6"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h15m0 0-6-6m6 6-6 6" />
                  </svg>
                </button>
              </form>

              <p role="status" aria-live="polite" className="mt-2 h-5 text-center text-sm text-bad">
                {flash && (
                  <span key={flash.key} className="animate-flash">
                    {flash.word} : {flash.text}
                  </span>
                )}
              </p>
            </>
          )}

          <div className={state.finished ? '' : 'mt-4'}>
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold tracking-wide text-fg-muted uppercase">
                Mes mots ({state.words.length})
              </h2>
              <span className="text-sm text-fg-faint">{state.score} pts</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {state.words.map((found) => (
                <button
                  key={found.word}
                  type="button"
                  onMouseEnter={() => traceWord(found.path, 4000)}
                  onMouseLeave={() => traceWord(undefined)}
                  onClick={() => traceWord(found.path, 2000)}
                  className="rounded-lg bg-chip px-2.5 py-1.5 text-sm text-fg transition hover:bg-chip-hover"
                >
                  {found.word}
                  <span className="ml-1.5 text-xs text-fg-faint">{found.points}</span>
                </button>
              ))}
              {state.words.length === 0 && (
                <p className="text-sm text-fg-faint">Aucun mot pour l’instant, à vous de jouer !</p>
              )}
            </div>
          </div>

          {!state.finished && (
            <div className="mt-5">
              <button
                type="button"
                disabled={busy}
                onClick={() => void finish()}
                className="w-full rounded-xl bg-accent px-4 py-4 text-lg font-bold text-accent-fg transition hover:bg-accent-hover disabled:opacity-40"
              >
                Voir les solutions
              </button>
              {/* Said before the click, because there is no going back: the
                  answers are on the other side of this button. */}
              <p className="mt-1 text-center text-xs text-fg-faint">
                termine votre grille du jour et vous classe
              </p>
            </div>
          )}

          {state.finished && state.ranking && <Leaderboard ranking={state.ranking} rank={state.rank} />}

          {state.finished && (
            <SolutionPanel
              solution={asSolutionWords(state)}
              playerId={ME}
              players={[]}
              onHighlight={setHighlight}
              selected={selected}
              onSelect={setSelected}
              solo
            />
          )}
        </div>
      </div>
    </div>
  );
}
