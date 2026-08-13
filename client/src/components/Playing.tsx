import { useEffect, useRef, useState, type FormEvent } from 'react';

import type { RoomState, SubmitResult } from '@boggle/shared';

import type { FoundWord } from '../hooks/useGame';
import { rejectionMessage } from '../lib/labels';
import { BoardGrid } from './BoardGrid';
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

  const round = room.round;

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(id);
  }, [flash]);

  // Le clavier doit rester actif d'une manche à l'autre sur ordinateur.
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  }, [round?.number]);

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
        setHighlight(result.path);
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
      <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
        <span>
          Manche {round.number}
          {room.settings.endCondition.type === 'rounds' && ` / ${room.settings.endCondition.rounds}`}
        </span>
        <span className="font-mono tracking-widest">{room.code}</span>
      </div>

      <Timer endsAt={round.endsAt} clockOffset={clockOffset} totalSeconds={room.settings.roundSeconds} />

      <div className="my-4">
        <BoardGrid
          cells={round.board}
          size={room.settings.boardSize}
          highlight={highlight}
          qEqualsQu={room.settings.qEqualsQu}
        />
      </div>

      <form onSubmit={(event) => void handleSubmit(event)} className="relative">
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Tapez un mot puis Entrée"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="send"
          aria-label="Mot trouvé"
          className="w-full rounded-xl border-2 border-slate-700 bg-slate-900 px-4 py-4 text-center text-2xl tracking-wider text-slate-100 uppercase outline-none placeholder:text-base placeholder:tracking-normal placeholder:normal-case placeholder:text-slate-600 focus:border-amber-400"
        />
        {flash && (
          <div
            key={flash.key}
            role="status"
            className={[
              'pointer-events-none absolute inset-x-0 -top-9 mx-auto w-fit rounded-full px-3 py-1 text-sm font-semibold',
              flash.ok ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300',
            ].join(' ')}
          >
            {flash.word} : {flash.text}
          </div>
        )}
      </form>

      <div className="mt-4 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-slate-400 uppercase">
          Mes mots ({myWords.length})
        </h2>
        <span className="text-sm text-slate-500">
          {hidesScores ? 'points révélés à la fin' : `${myScore} pts`}
        </span>
      </div>

      <div className="mt-2 flex flex-1 flex-wrap content-start gap-1.5 overflow-y-auto">
        {myWords.map((found) => (
          <button
            key={found.word}
            type="button"
            onMouseEnter={() => setHighlight(found.path)}
            onFocus={() => setHighlight(found.path)}
            onClick={() => setHighlight(found.path)}
            className="rounded-lg bg-slate-800 px-2.5 py-1 text-sm text-slate-200 transition hover:bg-slate-700"
          >
            {found.word}
            <span className="ml-1.5 text-xs text-slate-500">{found.points}</span>
          </button>
        ))}
        {myWords.length === 0 && (
          <p className="text-sm text-slate-600">Aucun mot pour l’instant, à vous de jouer !</p>
        )}
      </div>

      {others.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-800 pt-3 text-sm">
          {others.map((player) => (
            <span key={player.id} className={player.connected ? 'text-slate-400' : 'text-slate-600 line-through'}>
              {player.nickname}{' '}
              <span className="font-semibold text-slate-200">{player.wordCount}</span> mot
              {player.wordCount > 1 ? 's' : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
