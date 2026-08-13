import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { Server as SocketServer, type Socket } from 'socket.io';

import {
  isValidRoomCode,
  normalizeRoomCode,
  sanitizeNickname,
  type ClientToServerEvents,
  type GameSettings,
  type JoinedPayload,
  type ServerToClientEvents,
} from '@boggle/shared';

import { getDictionary } from './dictionary.js';
import { RoomManager, type Room, type RoomBroadcaster } from './rooms.js';

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

// Le dictionnaire est chargé au démarrage : la première partie ne doit pas attendre.
const dictionary = getDictionary();

const io = new SocketServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
  app.server,
  {
    cors: isProduction ? undefined : { origin: true, credentials: true },
    // Une manche dure 3 minutes : mieux vaut tolérer une coupure réseau brève.
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
  uptime: Math.round(process.uptime()),
}));

/** Permet à l'écran d'accueil de vérifier un code avant de demander un pseudo. */
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
  // SPA : toute autre route sert index.html (les liens /r/CODE doivent fonctionner).
  app.setNotFoundHandler((request, reply) => {
    if (request.method !== 'GET' || request.url.startsWith('/api')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });
} else {
  console.log('[serveur] client/dist absent, mode développement (client servi par Vite)');
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

/** Retrouve la salle et le joueur attachés à cette socket. */
function context(socket: GameSocket): { room: Room; playerId: string } {
  const { code, playerId } = socket.data;
  if (!code || !playerId) throw new Error("Vous n'êtes pas dans une salle");
  const room = rooms.get(code);
  if (!room) throw new Error("Cette salle n'existe plus");
  return { room, playerId };
}

/** Exécute une action d'hôte et renvoie l'erreur au client plutôt que de couper la socket. */
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
  if (removed > 0) console.log(`[serveur] ${removed} salle(s) expirée(s) supprimée(s)`);
}, 60_000).unref();

await app.listen({ port: PORT, host: HOST });
console.log(`[serveur] Boggle multijoueur sur http://localhost:${PORT}`);
