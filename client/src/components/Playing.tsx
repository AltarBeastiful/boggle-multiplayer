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
}

interface Flash {
  word: string;
  ok: boolean;
  text: string;
  key: number;
}

export function Playing({ room, myWords, clockOffset, playerId, onSubmit }: PlayingProps) {
  const [value, setValue] = useState('');
  const [flash, setFlash] = useState<Flash | null>(null);
  const [highlight, setHighlight] = useState<number[] | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  const flashCounter = useRef(0);
  const traceTimer = useRef<number | undefined>(undefined);

  /**
   * Le tracé ne persiste pas : il s'affiche brièvement puis s'efface, sinon la
   * grille reste barbouillée du dernier mot pendant toute la manche.
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
  // Vrai tant que le décompte d'avant-manche n'est pas écoulé.
  const [pending, setPending] = useState(
    () => round !== null && Date.now() + clockOffset < round.startsAt,
  );

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
    const id = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(id);
  }, [flash]);

  // Le clavier doit reprendre la main dès la fin du décompte, sur ordinateur.
  useEffect(() => {
    if (!pending && window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  }, [round?.number, pending]);

  if (!round) return null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const word = value.trim();
    if (word.length === 0) return;
    setValue('');
    try {
      const result = await onSubmit(word);
      flashCounter.current += 1;
      if (result.accepted) {
        setFlash({ word: result.word, ok: true, text: `+${result.points}`, key: flashCounter.current });
        if (TRACE_FOUND_WORD) traceWord(result.path);
      } else {
        setFlash({
          word: result.word,
          ok: false,
          text: rejectionMessage(result.reason, room.settings.minWordLength),
          key: flashCounter.current,
        });
      }
    } catch {
      flashCounter.current += 1;
      setFlash({ word, ok: false, text: 'connexion perdue', key: flashCounter.current });
    }
  };

  const others = room.players.filter((player) => player.id !== playerId);
  const myScore = myWords.reduce((sum, word) => sum + word.points, 0);
  const hidesScores = room.settings.duplicateMode === 'cancel';

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-fg-faint">
        <span>
          Manche {round.number}
          {room.settings.endCondition.type === 'rounds' && ` / ${room.settings.endCondition.rounds}`}
        </span>
        <div className="flex items-center gap-2">
          <span className="font-mono tracking-widest">{room.code}</span>
          <ThemeToggle />
        </div>
      </div>

      <Timer
        startsAt={round.startsAt}
        endsAt={round.endsAt}
        clockOffset={clockOffset}
        totalSeconds={room.settings.roundSeconds}
      />

      <div className="relative my-4">
        <div
          className={[
            'transition duration-500 ease-out',
            pending ? 'scale-[0.97] blur-[7px]' : 'scale-100 blur-0',
          ].join(' ')}
          aria-hidden={pending}
        >
          <BoardGrid
            cells={round.board}
            size={room.settings.boardSize}
            highlight={highlight}
            qEqualsQu={room.settings.qEqualsQu}
            animateHighlight
          />
        </div>
        {pending && <RoundCountdown startsAt={round.startsAt} clockOffset={clockOffset} />}
      </div>

      <form onSubmit={(event) => void handleSubmit(event)} className="relative">
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={pending}
          placeholder={pending ? 'La manche va commencer…' : 'Tapez un mot puis Entrée'}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="send"
          aria-label="Mot trouvé"
          className="w-full rounded-xl border-2 border-border-strong bg-panel-soft px-4 py-4 text-center text-2xl tracking-wider text-fg uppercase outline-none placeholder:text-base placeholder:tracking-normal placeholder:normal-case placeholder:text-fg-faint focus:border-accent"
        />
        {flash && (
          <div
            key={flash.key}
            role="status"
            className={[
              // Fond opaque et ombre portée : par-dessus les dés ivoire, un fond
              // translucide était illisible.
              'pointer-events-none absolute inset-x-0 -top-11 mx-auto w-fit max-w-full truncate',
              'rounded-full px-4 py-2 text-sm font-semibold shadow-lg',
              flash.ok ? 'bg-flash-ok text-flash-fg' : 'bg-flash-bad text-flash-fg',
            ].join(' ')}
          >
            {flash.word} : {flash.text}
          </div>
        )}
      </form>

      <div className="mt-4 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-fg-muted uppercase">
          {round.solutionCount === null
            ? `Mes mots (${myWords.length})`
            : `Mes mots : ${myWords.length} sur ${round.solutionCount}`}
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
          <p className="text-sm text-fg-faint">Aucun mot pour l’instant, à vous de jouer !</p>
        )}
      </div>

      {others.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
          {others.map((player) => (
            <span key={player.id} className={player.connected ? 'text-fg-muted' : 'text-fg-faint line-through'}>
              {player.nickname}{' '}
              <span className="font-semibold text-fg">{player.wordCount}</span> mot
              {player.wordCount > 1 ? 's' : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
