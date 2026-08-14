import { useEffect, useRef, useState, type FormEvent } from 'react';

import type { RoomState, SubmitResult } from '@boggle/shared';

import type { FoundWord } from '../hooks/useGame';
import { TRACE_DURATION_MS, TRACE_FOUND_WORD } from '../lib/config';
import { rejectionMessage } from '../lib/labels';
import { BoardGrid } from './BoardGrid';
import { RoundCountdown } from './RoundCountdown';
import { ThemeToggle } from './ThemeToggle';
import { Timer } from './Timer';

interface PlayingProps {
  room: RoomState;
  myWords: FoundWord[];
  clockOffset: number;
  playerId: string;
  onSubmit(word: string): Promise<SubmitResult>;
  /** Host only, and the only way out of an untimed round. */
  onEndRound(): Promise<void>;
  /** Leaves the grid for the solutions page, one player at a time. */
  onShowSolutions(): void;
}

/** An accepted word no longer shows a message; only a refusal does. */
interface Flash {
  word: string;
  text: string;
  key: number;
}

export function Playing({
  room,
  myWords,
  clockOffset,
  playerId,
  onSubmit,
  onEndRound,
  onShowSolutions,
}: PlayingProps) {
  const [value, setValue] = useState('');
  const [ending, setEnding] = useState(false);
  /** Tiles making up the current word, when built on the grid. */
  const [path, setPath] = useState<number[]>([]);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [highlight, setHighlight] = useState<number[] | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  const flashCounter = useRef(0);
  const traceTimer = useRef<number | undefined>(undefined);

  /**
   * The trace does not persist: it shows briefly then clears, otherwise the
   * grid stays smeared with the last word for the whole round.
   */
  const traceWord = (path: number[] | undefined, duration = TRACE_DURATION_MS) => {
    window.clearTimeout(traceTimer.current);
    if (!path) {
      setHighlight(undefined);
      return;
    }
    setHighlight(path);
    traceTimer.current = window.setTimeout(() => setHighlight(undefined), duration);
  };

  useEffect(() => () => window.clearTimeout(traceTimer.current), []);

  const round = room.round;
  /*
   * The buzzer does not take the grid away. The round is scored and the
   * results are in, but the player stays in front of the letters until they
   * ask for the solutions: what you did not find is usually still there to be
   * seen, and it is the moment you most want to look.
   */
  const over = room.phase === 'results' && room.results !== null;
  const board = round?.board ?? room.results?.board;
  const untimed = room.settings.roundSeconds === null;
  const isHost = room.hostId === playerId;

  // True until the pre-round countdown has elapsed.
  const [pending, setPending] = useState(() => round !== null && Date.now() + clockOffset < round.startsAt);

  useEffect(() => {
    if (!round) return;
    const delay = round.startsAt - (Date.now() + clockOffset);
    if (delay <= 0) {
      setPending(false);
      return;
    }
    setPending(true);
    const id = setTimeout(() => setPending(false), delay);
    return () => clearTimeout(id);
  }, [round?.startsAt, clockOffset]);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(id);
  }, [flash]);

  // On a desktop the keyboard takes over as soon as the countdown ends.
  useEffect(() => {
    if (!pending && !over && window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  }, [round?.number, pending, over]);

  if (!board) return null;

  const roundNumber = round?.number ?? room.results?.roundNumber ?? 0;
  /* The hint keeps the setting it was given: a round played without it does
     not reveal the count at the buzzer. */
  const solutionCount = round
    ? round.solutionCount
    : room.settings.showSolutionCount
      ? (room.results?.solutionCount ?? null)
      : null;

  const send = async (raw: string) => {
    const word = raw.trim();
    if (word.length === 0) return;
    // The path the player built themselves, before it gets cleared.
    const composed = path;
    setValue('');
    setPath([]);
    try {
      const result = await onSubmit(word);
      if (result.accepted) {
        // The word joins the list and its path flashes, which is enough.
        // We retrace the player's own tiles rather than the server's: one word
        // can be read in several places, and seeing dice light up that you
        // never touched is confusing. The server only returns a valid path, not
        // necessarily the one you had in front of you.
        if (TRACE_FOUND_WORD) traceWord(composed.length > 0 ? composed : result.path);
        return;
      }
      flashCounter.current += 1;
      setFlash({
        word: result.word,
        text: rejectionMessage(result.reason, room.settings.minWordLength),
        key: flashCounter.current,
      });
    } catch {
      flashCounter.current += 1;
      setFlash({ word, text: 'connexion perdue', key: flashCounter.current });
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(value);
  };

  /** Untimed round: the host closes it, and lands on the solutions. */
  const endRound = async () => {
    setEnding(true);
    try {
      await onEndRound();
      onShowSolutions();
    } finally {
      setEnding(false);
    }
  };

  /** The letters of a traced path. A Q tile counts as QU under the variant. */
  const pathToWord = (path: number[]) =>
    path
      .map((index) => {
        const letter = board[index] ?? '';
        return letter === 'Q' && room.settings.qEqualsQu ? 'QU' : letter;
      })
      .join('');

  /** The word built on the grid feeds the field, which stays editable. */
  const applyPath = (next: number[]) => {
    setPath(next);
    setValue(pathToWord(next));
  };

  const others = room.players.filter((player) => player.id !== playerId);
  const myScore = myWords.reduce((sum, word) => sum + word.points, 0);
  const hidesScores = room.settings.duplicateMode === 'cancel';

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-fg-faint">
        <span>
          Manche {roundNumber}
          {room.settings.endCondition.type === 'rounds' && ` / ${room.settings.endCondition.rounds}`}
        </span>
        <div className="flex items-center gap-2">
          <span className="font-mono tracking-widest">{room.code}</span>
          <ThemeToggle />
        </div>
      </div>

      {/* The clock and the closing banner take the same room, so the grid does
          not move when the buzzer goes. */}
      {round ? (
        <Timer startsAt={round.startsAt} endsAt={round.endsAt} clockOffset={clockOffset} />
      ) : (
        <div className="w-full">
          {/* One line of the same height as the clock it replaces. The round
              number is already in the header, so it is not repeated. */}
          <p className="mb-1 text-2xl font-bold text-accent">Manche terminée</p>
          <div className="h-2 w-full rounded-full bg-chip" />
        </div>
      )}

      <div className="relative my-4">
        <div
          className={[
            'transition duration-500 ease-out',
            pending ? 'scale-[0.97] blur-[7px]' : 'scale-100 blur-0',
          ].join(' ')}
          aria-hidden={pending}
        >
          <BoardGrid
            cells={board}
            size={room.settings.boardSize}
            highlight={highlight}
            qEqualsQu={room.settings.qEqualsQu}
            animateHighlight
            interactive={!pending && !over}
            path={path}
            onPathChange={applyPath}
          />
        </div>
        {pending && round && <RoundCountdown startsAt={round.startsAt} clockOffset={clockOffset} />}

        {/* Refusal halo: around the grid, never over the letters. */}
        {flash && (
          <div
            key={flash.key}
            aria-hidden="true"
            className="animate-reject pointer-events-none absolute -inset-1.5 rounded-2xl ring-1 ring-bad/25"
          />
        )}
      </div>

      {/* The field has nothing left to take, so the way on takes its place. */}
      {over ? (
        <button
          type="button"
          onClick={onShowSolutions}
          className="w-full rounded-xl bg-accent px-4 py-4 text-lg font-bold text-accent-fg transition hover:bg-accent-hover"
        >
          Voir les solutions
        </button>
      ) : (
      <form onSubmit={handleSubmit} className="relative flex gap-2">
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            // Once typing, the path on the grid no longer matches the word.
            if (path.length > 0) setPath([]);
          }}
          disabled={pending}
          placeholder={pending ? 'La manche va commencer…' : 'Tapez un mot puis Entrée'}
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
          disabled={pending || value.trim().length === 0}
          title="Envoyer le mot"
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
      )}

      {/*
        Below the field, never over the dice: the message no longer has to hide
        anything, and a fixed height keeps the grid from jumping when it
        appears. Only the colour of the text marks the refusal.
      */}
      <p role="status" aria-live="polite" className="mt-2 h-5 text-center text-sm text-bad">
        {flash && (
          <span key={flash.key} className="animate-flash">
            {flash.word} : {flash.text}
          </span>
        )}
      </p>

      <div className="mt-4 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-fg-muted uppercase">
          {solutionCount === null
            ? `Mes mots (${myWords.length})`
            : `Mes mots : ${myWords.length} sur ${solutionCount}`}
        </h2>
        <span className="text-sm text-fg-faint">
          {hidesScores ? 'points révélés à la fin' : `${myScore} pts`}
        </span>
      </div>

      <div className="mt-2 flex flex-1 flex-wrap content-start gap-1.5 overflow-y-auto">
        {myWords.map((found) => (
          <button
            key={found.word}
            type="button"
            onMouseEnter={() => traceWord(found.path, 4000)}
            onMouseLeave={() => traceWord(undefined)}
            onFocus={() => traceWord(found.path, 4000)}
            onBlur={() => traceWord(undefined)}
            onClick={() => traceWord(found.path, 2000)}
            className="rounded-lg bg-chip px-2.5 py-1 text-sm text-fg transition hover:bg-chip-hover"
          >
            {found.word}
            <span className="ml-1.5 text-xs text-fg-faint">{found.points}</span>
          </button>
        ))}
        {myWords.length === 0 && (
          <p className="text-sm text-fg-faint">
            {over ? 'Aucun mot trouvé cette manche.' : 'Aucun mot pour l’instant, à vous de jouer !'}
          </p>
        )}
      </div>

      {/*
        Untimed round: nothing stops it but the host. The button sits at the
        bottom, out of the way of play, and says what it costs the others,
        because it ends their round too and there is no undoing that.
      */}
      {untimed && !over && !pending && isHost && (
        <div className="mt-4">
          <button
            type="button"
            disabled={ending}
            onClick={() => void endRound()}
            className="w-full rounded-xl border-2 border-border-strong px-4 py-3 font-semibold text-fg-muted transition hover:border-accent hover:text-accent disabled:opacity-40"
          >
            Voir les solutions
          </button>
          <p className="mt-1 text-center text-xs text-fg-faint">termine la manche pour tout le monde</p>
        </div>
      )}

      {others.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
          {others.map((player) => (
            <span
              key={player.id}
              className={player.connected ? 'text-fg-muted' : 'text-fg-faint line-through'}
            >
              {player.nickname} <span className="font-semibold text-fg">{player.wordCount}</span> mot
              {player.wordCount > 1 ? 's' : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
