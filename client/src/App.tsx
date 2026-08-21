import { useEffect, useState } from 'react';

import { normalizeRoomCode } from '@boggle/shared';

import { Daily } from './components/Daily';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { Playing } from './components/Playing';
import { Results } from './components/Results';
import { useGame } from './hooks/useGame';
import { useRoundAlert } from './hooks/useRoundAlert';
import { askAboutRounds } from './lib/notify';

/** Reads the room code from the URL (/r/ABCD), for invitation links. */
function codeFromUrl(): string {
  const match = /^\/r\/([A-Za-z0-9]{4,6})\/?$/.exec(location.pathname);
  return match?.[1] ? normalizeRoomCode(match[1]) : '';
}

/** The only other address the app answers on. */
const DAILY_PATH = '/jour';

export function App() {
  const game = useGame();
  // A round can start while this tab is in the background; the tab says so.
  useRoundAlert(game.room);
  const [initialCode] = useState(codeFromUrl);
  /*
   * Each player leaves the grid for the solutions when they want to. The room
   * has one phase for everyone, but looking at the answers is a private act:
   * one player reads them while another is still staring at the letters.
   */
  const [showSolutions, setShowSolutions] = useState(false);
  const roundNumber = game.room?.results?.roundNumber ?? game.room?.round?.number;
  const [onDaily, setOnDaily] = useState(() => location.pathname === DAILY_PATH);

  // Two addresses, so the back button behaves and the grid can be linked to.
  useEffect(() => {
    const follow = () => setOnDaily(location.pathname === DAILY_PATH);
    window.addEventListener('popstate', follow);
    return () => window.removeEventListener('popstate', follow);
  }, []);

  const goDaily = () => {
    history.pushState(null, '', DAILY_PATH);
    setOnDaily(true);
  };

  const goHome = () => {
    history.pushState(null, '', '/');
    setOnDaily(false);
  };

  // A new round takes the question back: the buzzer has to ask again.
  useEffect(() => {
    if (game.room?.phase !== 'results') setShowSolutions(false);
  }, [game.room?.phase, roundNumber]);

  // The URL follows the room once joined. Before that the invitation address is
  // left alone, so a refresh does not lose the code.
  useEffect(() => {
    if (!game.room) return;
    const target = `/r/${game.room.code}`;
    if (location.pathname !== target) history.replaceState(null, '', target);
  }, [game.room?.code]);

  const handleLeave = () => {
    game.leaveRoom();
    history.replaceState(null, '', '/');
  };

  const banner = game.connectionLost && (
    <div className="sticky top-0 z-10 bg-danger-banner px-4 py-1.5 text-center text-sm text-danger-banner-fg backdrop-blur">
      Connexion perdue, reconnexion en cours…
    </div>
  );

  // The daily grid needs no room, and the socket is left alone while it is open.
  if (onDaily && !game.room) return <Daily onLeave={goHome} />;

  if (!game.room) {
    return (
      <>
        {banner}
        <Home
          connected={game.connected}
          initialCode={initialCode}
          onCreate={(nickname) => {
            askAboutRounds();
            return game.createRoom(nickname);
          }}
          onJoin={(code, nickname) => {
            askAboutRounds();
            return game.joinRoom(code, nickname);
          }}
          onDaily={goDaily}
        />
      </>
    );
  }

  const { room } = game;
  const playing = room.phase === 'playing' && room.round !== null;
  // The round is over, but the grid stays until this player asks for the answers.
  const lingering = room.phase === 'results' && room.results !== null && !showSolutions;

  return (
    <>
      {banner}
      {playing || lingering ? (
        <Playing
          room={room}
          myWords={game.myWords}
          clockOffset={game.clockOffset}
          playerId={game.playerId}
          onSubmit={game.submitWord}
          onPractice={game.practiceWord}
          onEndRound={game.endRound}
          onShowSolutions={() => setShowSolutions(true)}
        />
      ) : room.phase === 'results' && room.results ? (
        <Results
          room={room}
          results={room.results}
          isHost={game.isHost}
          playerId={game.playerId}
          onNext={game.nextRound}
          onReset={game.resetGame}
          onLeave={handleLeave}
        />
      ) : (
        <Lobby
          room={room}
          isHost={game.isHost}
          playerId={game.playerId}
          onStart={game.startGame}
          onSettings={game.updateSettings}
          onLeave={handleLeave}
        />
      )}
    </>
  );
}
