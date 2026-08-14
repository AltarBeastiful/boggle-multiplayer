import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { Server as SocketServer, type Socket } from 'socket.io';

import {
  isValidRoomCode,
  normalizeRoomCode,
  normalizeWord,
  sanitizeNickname,
  type ClientToServerEvents,
  type GameSettings,
  type JoinedPayload,
  type ServerToClientEvents,
} from '@boggle/shared';

import { DailyManager } from './daily.js';
import { hasLocalDefinitions, localDefinitionCount } from './definitions-local.js';
import { definitionCacheSize, getDefinition } from './definitions.js';
import { getDictionary } from './dictionary.js';
import { RoomManager, type Room, type RoomBroadcaster } from './rooms.js';
import { flushWrites } from './store.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production';

interface SocketData {
  playerId?: string;
  code?: string;
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const app = Fastify({ logger: false });

// The dictionary loads at startup, so the first game never waits for it.
const dictionary = getDictionary();

const io = new SocketServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
  app.server,
  {
    cors: isProduction ? undefined : { origin: true, credentials: true },
    // A round lasts 3 minutes, so a brief network drop is worth tolerating.
    pingTimeout: 30_000,
    connectionStateRecovery: { maxDisconnectionDuration: 60_000 },
  },
);

const broadcaster: RoomBroadcaster = {
  state(room) {
    io.to(room.code).emit('room:state', room.toState());
  },
  roundStarted(room) {
    const state = room.toState();
    if (state.round) io.to(room.code).emit('round:started', state.round);
    io.to(room.code).emit('room:state', state);
  },
  roundEnded(room, results) {
    io.to(room.code).emit('round:ended', results);
    io.to(room.code).emit('room:state', room.toState());
  },
};

const rooms = new RoomManager(dictionary, broadcaster);

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

app.get('/api/health', async () => ({
  status: 'ok',
  words: dictionary.size,
  rooms: rooms.size,
  definitionsEmbedded: hasLocalDefinitions() ? localDefinitionCount() : false,
  definitionsCached: definitionCacheSize(),
  uptime: Math.round(process.uptime()),
}));

// Wiktionary is a free service, so bound what a single client can draw from it.
const DEFINITION_RATE_LIMIT = 90;
const DEFINITION_WINDOW_MS = 60_000;
const definitionHits = new Map<string, { count: number; resets: number }>();

app.get<{ Params: { word: string } }>('/api/definition/:word', async (request, reply) => {
  const now = Date.now();
  const seen = definitionHits.get(request.ip);
  if (!seen || seen.resets < now) {
    definitionHits.set(request.ip, { count: 1, resets: now + DEFINITION_WINDOW_MS });
  } else if (++seen.count > DEFINITION_RATE_LIMIT) {
    return reply.code(429).send({ word: '', entries: [] });
  }

  const word = normalizeWord(request.params.word);
  if (word.length < 2 || word.length > 30) return { word, entries: [] };
  // getDefinition never rejects; no definition simply means an empty list.
  return getDefinition(word);
});

// ---------------------------------------------------------------------------
// Grille du jour: one grid a day, played alone, over plain HTTP. No room, no
// other players to keep in step, so nothing here needs a socket.
// ---------------------------------------------------------------------------

const daily = new DailyManager(dictionary);

/**
 * The player identifier comes from the browser's localStorage, exactly as it
 * does for a room. It is not proof of anything, and the leaderboard is trusting
 * by design, at the scale of a server among friends. What the server does not
 * trust is the words: every one is checked against the day's grid, so a score
 * cannot be invented, only attributed to a made-up name.
 */
function playerFrom(body: unknown): string {
  const id = (body as { playerId?: unknown } | null)?.playerId;
  if (typeof id !== 'string' || id.length < 8 || id.length > 64) throw new Error('Joueur inconnu');
  return id;
}

app.get<{ Querystring: { playerId?: string } }>('/api/daily', async (request) =>
  daily.teaser(request.query.playerId ?? ''),
);

app.post('/api/daily/start', async (request, reply) => {
  try {
    const body = request.body as { nickname?: unknown };
    return daily.start(playerFrom(request.body), sanitizeNickname(body?.nickname));
  } catch (cause) {
    return reply.code(400).send({ error: cause instanceof Error ? cause.message : 'Requête invalide' });
  }
});

app.post('/api/daily/word', async (request, reply) => {
  try {
    const body = request.body as { word?: unknown };
    if (typeof body?.word !== 'string' || body.word.length > 40) throw new Error('Mot invalide');
    return daily.submit(playerFrom(request.body), body.word);
  } catch (cause) {
    return reply.code(400).send({ error: cause instanceof Error ? cause.message : 'Requête invalide' });
  }
});

app.post('/api/daily/finish', async (request, reply) => {
  try {
    return daily.finish(playerFrom(request.body));
  } catch (cause) {
    return reply.code(400).send({ error: cause instanceof Error ? cause.message : 'Requête invalide' });
  }
});

/** Lets the home screen check a room code before asking for a nickname. */
app.get<{ Params: { code: string } }>('/api/rooms/:code', async (request) => {
  const code = normalizeRoomCode(request.params.code);
  const room = rooms.get(code);
  if (!room) return { exists: false };
  return {
    exists: true,
    code: room.code,
    phase: room.phase,
    players: room.players.size,
    settings: room.settings,
  };
});

const clientDist = resolve(here, '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  await app.register(fastifyStatic, { root: clientDist });
  // Single-page app: any other route serves index.html, so /r/CODE links work.
  app.setNotFoundHandler((request, reply) => {
    if (request.method !== 'GET' || request.url.startsWith('/api')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });
} else {
  console.log('[server] client/dist missing, development mode with the client served by Vite');
}

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

function fail(message: string) {
  return { ok: false as const, error: message };
}

function succeed<T>(data: T) {
  return { ok: true as const, data };
}

function joinedPayload(room: Room, playerId: string): JoinedPayload {
  return { state: room.toState(), me: room.myState(playerId), playerId };
}

/** Finds the room and player attached to this socket. */
function context(socket: GameSocket): { room: Room; playerId: string } {
  const { code, playerId } = socket.data;
  if (!code || !playerId) throw new Error("Vous n'êtes pas dans une salle");
  const room = rooms.get(code);
  if (!room) throw new Error("Cette salle n'existe plus");
  return { room, playerId };
}

/** Runs a host action and reports the error back rather than killing the socket. */
function guard<T>(ack: ((res: { ok: true; data: T } | { ok: false; error: string }) => void) | undefined, run: () => T): void {
  try {
    const data = run();
    ack?.(succeed(data));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue';
    ack?.(fail(message));
  }
}

function isValidPlayerId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 64;
}

io.on('connection', (socket: GameSocket) => {
  socket.on('room:create', (payload, ack) => {
    guard(ack, () => {
      if (!isValidPlayerId(payload?.playerId)) throw new Error('Identifiant de joueur invalide');
      const room = rooms.create(payload.settings);
      room.addPlayer(payload.playerId, sanitizeNickname(payload.nickname), socket.id);
      socket.data.code = room.code;
      socket.data.playerId = payload.playerId;
      void socket.join(room.code);
      broadcaster.state(room);
      return joinedPayload(room, payload.playerId);
    });
  });

  socket.on('room:join', (payload, ack) => {
    guard(ack, () => {
      if (!isValidPlayerId(payload?.playerId)) throw new Error('Identifiant de joueur invalide');
      const code = normalizeRoomCode(payload?.code ?? '');
      if (!isValidRoomCode(code)) throw new Error('Code de salle invalide');
      const room = rooms.get(code);
      if (!room) throw new Error("Cette salle n'existe pas");

      room.addPlayer(payload.playerId, sanitizeNickname(payload.nickname), socket.id);
      socket.data.code = room.code;
      socket.data.playerId = payload.playerId;
      void socket.join(room.code);
      broadcaster.state(room);
      return joinedPayload(room, payload.playerId);
    });
  });

  socket.on('room:leave', () => {
    const { code, playerId } = socket.data;
    if (!code || !playerId) return;
    const room = rooms.get(code);
    socket.data.code = undefined;
    socket.data.playerId = undefined;
    void socket.leave(code);
    if (!room) return;
    room.removePlayer(playerId);
    if (room.players.size === 0) rooms.delete(code);
    else broadcaster.state(room);
  });

  socket.on('settings:update', (settings: Partial<GameSettings>, ack) => {
    guard(ack, () => {
      const { room, playerId } = context(socket);
      room.updateSettings(playerId, settings ?? {});
      return room.toState();
    });
  });

  socket.on('game:start', (ack) => {
    guard(ack, () => {
      const { room, playerId } = context(socket);
      room.startGame(playerId);
      return null;
    });
  });

  socket.on('round:end', (ack) => {
    guard(ack, () => {
      const { room, playerId } = context(socket);
      room.endRoundNow(playerId);
      return null;
    });
  });

  socket.on('round:next', (ack) => {
    guard(ack, () => {
      const { room, playerId } = context(socket);
      room.nextRound(playerId);
      return null;
    });
  });

  socket.on('game:reset', (ack) => {
    guard(ack, () => {
      const { room, playerId } = context(socket);
      room.resetGame(playerId);
      return null;
    });
  });

  socket.on('word:submit', (word, ack) => {
    guard(ack, () => {
      const { room, playerId } = context(socket);
      if (typeof word !== 'string' || word.length > 40) throw new Error('Mot invalide');
      return room.submitWord(playerId, word);
    });
  });

  socket.on('disconnect', () => {
    const { code, playerId } = socket.data;
    if (!code || !playerId) return;
    const room = rooms.get(code);
    if (!room) return;
    room.markDisconnected(playerId);
    broadcaster.state(room);
  });
});

setInterval(() => {
  const removed = rooms.sweep();
  if (removed > 0) console.log(`[server] removed ${removed} expired room(s)`);
  const now = Date.now();
  for (const [ip, seen] of definitionHits) if (seen.resets < now) definitionHits.delete(ip);
}, 60_000).unref();

// A deploy stops the container: the daily grid's pending write goes out first,
// otherwise the last couple of seconds of play are lost.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    flushWrites();
    process.exit(0);
  });
}

await app.listen({ port: PORT, host: HOST });
console.log(`[server] Boggle multiplayer on http://localhost:${PORT}`);
