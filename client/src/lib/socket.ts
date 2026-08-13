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

/** En développement, Vite relaie /socket.io vers le serveur (voir vite.config.ts). */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  autoConnect: true,
  transports: ['websocket', 'polling'],
});

/** Transforme un événement à accusé de réception en promesse. */
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
  nextRound: () => request<null>('round:next'),
  resetGame: () => request<null>('game:reset'),
  submitWord: (word: string) => request<SubmitResult>('word:submit', word),
  leaveRoom: () => socket.emit('room:leave'),
};
