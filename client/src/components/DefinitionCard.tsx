import { useEffect, useState } from 'react';

import type { DefinitionEntry, DefinitionResult } from '@boggle/shared';

/** Definitions already received are not asked for again between rounds. */
const cache = new Map<string, DefinitionEntry[]>();
/** In-flight requests, so a word already asked for is not asked again. */
const inFlight = new Map<string, Promise<DefinitionEntry[]>>();

function load(word: string): Promise<DefinitionEntry[]> {
  const known = cache.get(word);
  if (known) return Promise.resolve(known);

  const running = inFlight.get(word);
  if (running) return running;

  const task = fetch(`/api/definition/${encodeURIComponent(word)}`)
    .then((response) => (response.ok ? (response.json() as Promise<DefinitionResult>) : null))
    .then((result) => {
      const found = result?.entries ?? [];
      cache.set(word, found);
      return found;
    })
    .finally(() => inFlight.delete(word));

  inFlight.set(word, task);
  return task;
}

/**
 * Loads the definition ahead of time, on hover. A cold lookup takes one to
 * three seconds since it queries Wiktionary live, so starting it as the mouse
 * settles usually makes the click feel instant.
 */
export function prefetchDefinition(word: string): void {
  if (cache.has(word) || inFlight.has(word)) return;
  void load(word).catch(() => undefined);
}

type Status = 'loading' | 'done' | 'error';

export function DefinitionCard({
  word,
  onClose,
  className = '',
}: {
  word: string;
  onClose(): void;
  className?: string;
}) {
  const [status, setStatus] = useState<Status>(() => (cache.has(word) ? 'done' : 'loading'));
  const [entries, setEntries] = useState<DefinitionEntry[]>(() => cache.get(word) ?? []);

  useEffect(() => {
    const known = cache.get(word);
    if (known) {
      setEntries(known);
      setStatus('done');
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setEntries([]);

    load(word)
      .then((found) => {
        if (cancelled) return;
        setEntries(found);
        setStatus('done');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [word]);

  return (
    <div className={`rounded-xl border border-border bg-panel-soft p-3 ${className}`} aria-live="polite">
      <div className="mb-1.5 flex items-start justify-between gap-3">
        <h3 className="font-semibold text-fg">{word}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer la définition"
          className="-mt-1 -mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-faint transition hover:bg-chip hover:text-fg"
        >
          ×
        </button>
      </div>

      {status === 'loading' && <p className="text-sm text-fg-faint">Recherche de la définition…</p>}

      {status === 'error' && <p className="text-sm text-fg-faint">Définition indisponible pour le moment.</p>}

      {status === 'done' && entries.length === 0 && (
        <p className="text-sm text-fg-faint">
          Aucune définition trouvée.{' '}
          <a
            href={`https://fr.wiktionary.org/wiki/${encodeURIComponent(word.toLowerCase())}`}
            target="_blank"
            rel="noreferrer noopener"
            className="underline hover:text-fg-muted"
          >
            Chercher sur le Wiktionnaire
          </a>
        </p>
      )}

      {status === 'done' && entries.length > 0 && (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={`${entry.spelling}-${entry.partOfSpeech}`} className="text-sm">
              <span className="font-medium text-fg">{entry.spelling}</span>{' '}
              <span className="text-xs text-fg-faint">{entry.partOfSpeech.toLowerCase()}</span>
              {entry.lemma && <span className="text-xs text-fg-faint">, de « {entry.lemma} »</span>}
              {entry.definitions.length === 1 ? (
                <p className="mt-0.5 text-fg-muted">{entry.definitions[0]}</p>
              ) : (
                // A polysemous word: number its senses rather than pick one.
                <ol className="mt-1 ml-4 list-decimal space-y-1 text-fg-muted marker:text-fg-faint">
                  {entry.definitions.map((definition) => (
                    <li key={definition}>{definition}</li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-xs text-fg-faint">
        Source :{' '}
        <a
          href={`https://fr.wiktionary.org/wiki/${encodeURIComponent(word.toLowerCase())}`}
          target="_blank"
          rel="noreferrer noopener"
          className="underline hover:text-fg-muted"
        >
          Wiktionnaire
        </a>
      </p>
    </div>
  );
}
