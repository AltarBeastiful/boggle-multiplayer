import { io, type Socket } from 'socket.io-client';

import type {
  Ack,
  ClientToServerEvents,
  CreateRoomPayload,
  GameSettings,
  JoinRoomPayload,
  JoinedPayload,
  RoomState,
  ServerToClientEvents,
  SubmitResult,
} from '@boggle/shared';

/** In development Vite proxies /socket.io to the server, see vite.config.ts. */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  autoConnect: true,
  // No `transports` forced: keep Socket.IO's default order, which opens a
  // long-polling link first then upgrades to WebSocket. Forcing WebSocket from
  // the start left WebKit unconnected, the link opening but the handshake
  // never completing.
});

/** Turns an acknowledged event into a promise. */
function request<T>(event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Le serveur ne répond pas')), 10_000);
    const handle = (response: Ack<T>) => {
      clearTimeout(timeout);
      if (response?.ok) resolve(response.data);
      else reject(new Error(response?.error ?? 'Erreur inconnue'));
    };
    const emitter = socket as unknown as {
      emit(event: string, ...args: unknown[]): void;
    };
    if (payload === undefined) emitter.emit(event, handle);
    else emitter.emit(event, payload, handle);
  });
}

export const api = {
  createRoom: (payload: CreateRoomPayload) => request<JoinedPayload>('room:create', payload),
  joinRoom: (payload: JoinRoomPayload) => request<JoinedPayload>('room:join', payload),
  updateSettings: (patch: Partial<GameSettings>) => request<RoomState>('settings:update', patch),
  startGame: () => request<null>('game:start'),
  endRound: () => request<null>('round:end'),
  nextRound: () => request<null>('round:next'),
  resetGame: () => request<null>('game:reset'),
  submitWord: (word: string) => request<SubmitResult>('word:submit', word),
  practiceWord: (word: string) => request<SubmitResult>('word:practice', word),
  leaveRoom: () => socket.emit('room:leave'),
};
