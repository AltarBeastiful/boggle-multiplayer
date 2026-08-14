# Backlog

Features asked for and not yet built, in the order they were raised. Each one
records what it has to do and the awkward part, so the work can be picked up
without rediscovering it.

## 1. Choose, at the buzzer, between the solutions and playing on

Today the end of a round drops straight into the solutions page. Instead the
round should end on a choice, without cluttering the screen: a "Voir les
solutions" button, and otherwise the grid stays there to keep looking.

The awkward part is that the solutions page is currently the only way out of a
round, and the server decides the phase for everyone at once. Looking at the
solutions has to become a per-player view over a round that stays open, which
means the phase can no longer be a single value shared by the room.

## 2. An untimed mode, ended by the host

A round with no clock, which the host closes with the same "Voir les solutions"
button. The end of the round then comes from an explicit event rather than from
`endsAt`.

Touches `sanitizeSettings` (where `MIN_ROUND_SECONDS` currently forbids it), the
`Timer` component, and the round lifecycle in `rooms.ts`, which today arms a
`setTimeout` on `endsAt`.

## 3. "Grille du jour" on the home page

One grid a day, the same for everyone, playable without creating a room. Its
timer only informs, it does not close anything: you play as long as you like,
and can reveal the solutions when you want.

Two decisions to make. The grid has to be reproducible from the date alone,
which the seeded generator already allows (`mulberry32`), so the day's grid is
`drawBoard(seedFromDate(day))` and needs no storage. But the day has to be
defined in a timezone, and Europe/Paris is the honest choice for a French game.

## 4. A leaderboard on the "grille du jour"

Once the solutions are revealed, see where you land among the other players of
the day, by nickname.

This is the first thing in the project that has to **outlive the process**.
Everything else lives in memory and dies with a restart, which was a deliberate
decision ([ADR 0001](adr/0001-architecture.md), decision 3). A daily leaderboard
cannot: it has to survive a deploy. The smallest thing that works is a JSON file
per day on disk, no database, along the lines of `server/data/`.

Nicknames have to be deduplicated: the same player, coming back, must not appear
twice. Keying on the `localStorage` identifier and keeping the best score is
enough, and two different people picking the same nickname stay two entries.

## 5. Identical nicknames in an ordinary game

Two players called "Batman" in the same room: the server tells them apart by
identifier, but the interface does not, and neither does anyone reading the
scores.

The graceful handling is to disambiguate on display rather than to refuse the
name: "Batman" and "Batman (2)", numbered in join order. The server already
holds everything needed, since the identifier is the real key. To be checked in
the solutions page as well, where finders are shown by name.
