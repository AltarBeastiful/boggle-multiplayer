import { useCallback, useEffect, useRef, useState } from 'react';

import type { GameSettings, RoomState, RoundState, SubmitResult } from '@boggle/shared';

import { api, socket } from '../lib/socket';
import { getPlayerId, setNickname } from '../lib/storage';

export interface FoundWord {
  word: string;
  points: number;
  path: number[];
}

export interface Game {
  playerId: string;
  room: RoomState | null;
  myWords: FoundWord[];
  connected: boolean;
  /**
   * True only once a connection was established and then lost. Distinct from
   * `connected`, which is false on the very first render until the handshake
   * completes: warning at that point would flash red on every page load.
   */
  connectionLost: boolean;
  /** Server clock minus client clock, in ms, to keep the timer honest. */
  clockOffset: number;
  isHost: boolean;
  createRoom(nickname: string, settings?: Partial<GameSettings>): Promise<string>;
  joinRoom(code: string, nickname: string): Promise<void>;
  leaveRoom(): void;
  submitWord(word: string): Promise<SubmitResult>;
  updateSettings(patch: Partial<GameSettings>): Promise<void>;
  startGame(): Promise<void>;
  nextRound(): Promise<void>;
  resetGame(): Promise<void>;
}

export function useGame(): Game {
  const playerId = useRef(getPlayerId()).current;
  const [room, setRoom] = useState<RoomState | null>(null);
  const [myWords, setMyWords] = useState<FoundWord[]>([]);
  const [connected, setConnected] = useState(socket.connected);
  const [connectionLost, setConnectionLost] = useState(false);
  /** Has a first connection ever succeeded? */
  const everConnected = useRef(socket.connected);
  const lostTimer = useRef<number | undefined>(undefined);
  const [clockOffset, setClockOffset] = useState(0);
  /** Last room joined, used to rejoin automatically after a drop. */
  const lastJoin = useRef<{ code: string; nickname: string } | null>(null);

  useEffect(() => {
    const onState = (state: RoomState) => {
      setRoom(state);
      if (state.round) setClockOffset(state.round.serverNow - Date.now());
    };

    const onRoundStarted = (round: RoundState) => {
      setMyWords([]);
      setClockOffset(round.serverNow - Date.now());
    };

    const onConnect = () => {
      setConnected(true);
      everConnected.current = true;
      window.clearTimeout(lostTimer.current);
      setConnectionLost(false);
      const previous = lastJoin.current;
      if (previous) {
        api
          .joinRoom({ code: previous.code, nickname: previous.nickname, playerId })
          .then((joined) => {
            setRoom(joined.state);
            setMyWords(joined.me.words);
          })
          .catch(() => {
            // The room vanished during the outage; back to the home screen.
            lastJoin.current = null;
            setRoom(null);
          });
      }
    };

    const onDisconnect = () => {
      setConnected(false);
      // A micro-outage recovers on its own, so give Socket.IO time to
      // reconnect before worrying the player.
      if (!everConnected.current) return;
      window.clearTimeout(lostTimer.current);
      lostTimer.current = window.setTimeout(() => setConnectionLost(true), 800);
    };

    socket.on('room:state', onState);
    socket.on('round:started', onRoundStarted);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      window.clearTimeout(lostTimer.current);
      socket.off('room:state', onState);
      socket.off('round:started', onRoundStarted);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [playerId]);

  const createRoom = useCallback(
    async (nickname: string, settings?: Partial<GameSettings>) => {
      setNickname(nickname);
      const joined = await api.createRoom({ nickname, playerId, settings });
      lastJoin.current = { code: joined.state.code, nickname };
      setRoom(joined.state);
      setMyWords(joined.me.words);
      return joined.state.code;
    },
    [playerId],
  );

  const joinRoom = useCallback(
    async (code: string, nickname: string) => {
      setNickname(nickname);
      const joined = await api.joinRoom({ code, nickname, playerId });
      lastJoin.current = { code: joined.state.code, nickname };
      setRoom(joined.state);
      setMyWords(joined.me.words);
    },
    [playerId],
  );

  const leaveRoom = useCallback(() => {
    api.leaveRoom();
    lastJoin.current = null;
    setRoom(null);
    setMyWords([]);
  }, []);

  const submitWord = useCallback(async (word: string) => {
    const result = await api.submitWord(word);
    if (result.accepted) {
      setMyWords((words) => [
        { word: result.word, points: result.points ?? 0, path: result.path ?? [] },
        ...words,
      ]);
    }
    return result;
  }, []);

  const updateSettings = useCallback(async (patch: Partial<GameSettings>) => {
    const state = await api.updateSettings(patch);
    setRoom(state);
  }, []);

  const startGame = useCallback(async () => {
    await api.startGame();
  }, []);

  const nextRound = useCallback(async () => {
    await api.nextRound();
  }, []);

  const resetGame = useCallback(async () => {
    await api.resetGame();
  }, []);

  return {
    playerId,
    room,
    myWords,
    connected,
    connectionLost,
    clockOffset,
    isHost: room?.hostId === playerId,
    createRoom,
    joinRoom,
    leaveRoom,
    submitWord,
    updateSettings,
    startGame,
    nextRound,
    resetGame,
  };
}
