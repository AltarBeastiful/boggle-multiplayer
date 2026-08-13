import { useEffect, useState } from 'react';

import { normalizeRoomCode } from '@boggle/shared';

import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { Playing } from './components/Playing';
import { Results } from './components/Results';
import { useGame } from './hooks/useGame';

/** Lit le code de salle dans l'URL (/r/ABCD) pour les liens d'invitation. */
function codeFromUrl(): string {
  const match = /^\/r\/([A-Za-z0-9]{4,6})\/?$/.exec(location.pathname);
  return match?.[1] ? normalizeRoomCode(match[1]) : '';
}

export function App() {
  const game = useGame();
  const [initialCode] = useState(codeFromUrl);

  // L'URL suit la salle rejointe. Tant qu'on ne l'a pas rejointe, on laisse
  // l'adresse d'invitation intacte : un rafraîchissement ne doit pas perdre le code.
  useEffect(() => {
    if (!game.room) return;
    const target = `/r/${game.room.code}`;
    if (location.pathname !== target) history.replaceState(null, '', target);
  }, [game.room?.code]);

  const handleLeave = () => {
    game.leaveRoom();
    history.replaceState(null, '', '/');
  };

  const banner = !game.connected && (
    <div className="sticky top-0 z-10 bg-red-900/80 px-4 py-1.5 text-center text-sm text-red-100 backdrop-blur">
      Connexion perdue, reconnexion en cours…
    </div>
  );

  if (!game.room) {
    return (
      <>
        {banner}
        <Home
          connected={game.connected}
          initialCode={initialCode}
          onCreate={(nickname) => game.createRoom(nickname)}
          onJoin={(code, nickname) => game.joinRoom(code, nickname)}
        />
      </>
    );
  }

  const { room } = game;

  return (
    <>
      {banner}
      {room.phase === 'playing' && room.round ? (
        <Playing
          room={room}
          myWords={game.myWords}
          clockOffset={game.clockOffset}
          playerId={game.playerId}
          onSubmit={game.submitWord}
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
