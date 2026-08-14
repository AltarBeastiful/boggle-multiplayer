/**
 * The smallest thing that outlives the process: one JSON file per record, in a
 * directory outside the repository.
 *
 * ADR 0001 decision 3 keeps the game in memory, and that stays true of rooms in
 * progress. A leaderboard is different in kind: it is the only thing here meant
 * to be read tomorrow, so it has to survive a deploy. A database would bring a
 * container, migrations and backups for a few kilobytes a day.
 *
 * Writes are atomic (write to a temporary file, then rename) so a restart in
 * the middle of one cannot leave half a file behind, and coalesced, so a
 * hundred words submitted in a minute do not mean a hundred writes.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Overridden in the image, where the directory is a mounted volume: the
 * container is rebuilt on every deploy and anything inside it is lost.
 */
export const STATE_DIR = process.env.BOGGLE_STATE_DIR ?? resolve(here, '..', '.state');

let ready = false;

function ensureDir(): boolean {
  if (ready) return true;
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    ready = true;
  } catch (cause) {
    console.log(`[store] ${STATE_DIR} is not writable, nothing will be kept: ${String(cause)}`);
  }
  return ready;
}

function fileFor(name: string): string {
  // The name comes from our own code, never from a request, but a traversal
  // would be a nasty way to find that out.
  if (!/^[\w.-]+$/.test(name)) throw new Error(`invalid record name: ${name}`);
  return join(STATE_DIR, `${name}.json`);
}

/**
 * Can anything be kept at all? Reported by the health endpoint, because a
 * directory the container cannot write to fails silently otherwise, and the
 * first sign would be a leaderboard that empties itself on every deploy.
 */
export function stateWritable(): boolean {
  return ensureDir();
}

export function readRecord<T>(name: string): T | null {
  try {
    const path = fileFor(name);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (cause) {
    // A corrupt file must not stop the server: the day starts again empty.
    console.log(`[store] ${name} unreadable, ignored: ${String(cause)}`);
    return null;
  }
}

/** Names of the records stored under a prefix, without their extension. */
export function listRecords(prefix: string): string[] {
  try {
    if (!existsSync(STATE_DIR)) return [];
    return readdirSync(STATE_DIR)
      .filter((file) => file.startsWith(prefix) && file.endsWith('.json'))
      .map((file) => file.slice(0, -'.json'.length));
  } catch {
    return [];
  }
}

export function deleteRecord(name: string): void {
  clearTimeout(pending.get(name)?.timer);
  pending.delete(name);
  try {
    rmSync(fileFor(name), { force: true });
  } catch (cause) {
    console.log(`[store] ${name} could not be removed: ${String(cause)}`);
  }
}

export function writeRecord(name: string, value: unknown): void {
  if (!ensureDir()) return;
  try {
    const path = fileFor(name);
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), 'utf8');
    renameSync(temporary, path);
  } catch (cause) {
    console.log(`[store] ${name} could not be written: ${String(cause)}`);
  }
}

const pending = new Map<string, { timer: NodeJS.Timeout; snapshot: () => unknown }>();
const WRITE_DELAY_MS = 2000;

/** Writes soon rather than now, and once rather than per change. */
export function scheduleWrite(name: string, snapshot: () => unknown): void {
  clearTimeout(pending.get(name)?.timer);
  const timer = setTimeout(() => {
    pending.delete(name);
    writeRecord(name, snapshot());
  }, WRITE_DELAY_MS);
  // A pending write must not hold the process open on shutdown.
  timer.unref?.();
  pending.set(name, { timer, snapshot });
}

/** Writes what is still waiting, on the way out. */
export function flushWrites(): void {
  for (const [name, { timer, snapshot }] of pending) {
    clearTimeout(timer);
    writeRecord(name, snapshot());
  }
  pending.clear();
}
