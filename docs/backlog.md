# Backlog

Features asked for and not yet built, in the order they were raised. Each one
records what it has to do and the awkward part, so the work can be picked up
without rediscovering it.

Two of them are done and kept here, struck through, because what they turned out
to need is worth remembering.

## ~~Choose, at the buzzer, between the solutions and playing on~~ (done)

The buzzer no longer takes the grid away: it is replaced by a "Voir les
solutions" button, and each player leaves when they choose.

The fear that the room phase would have to stop being a single value proved
unfounded. The server still ends the round for everyone at once, which is right,
since scoring must be simultaneous. Only the *view* is private, and a view is
client state. One `useState` in `App` did it.

## ~~An untimed mode, ended by the host~~ (done)

`roundSeconds: null` rather than a very large number, so "there is no clock"
cannot be read as "the clock is long", and the type checker points at every
place that has to handle it. `endsAt` is null to match, and no timer is armed.

## 1. "Grille du jour" on the home page

One grid a day, the same for everyone, playable without creating a room. Its
timer only informs, it does not close anything: you play as long as you like,
and can reveal the solutions when you want.

Two decisions to make. The grid has to be reproducible from the date alone,
which the seeded generator already allows (`mulberry32`), so the day's grid is
`drawBoard(seedFromDate(day))` and needs no storage. But the day has to be
defined in a timezone, and Europe/Paris is the honest choice for a French game.

## 2. A leaderboard on the "grille du jour"

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

## 3. Save the room in progress, so a deploy does not end it

Rooms live in the process ([ADR 0001](adr/0001-architecture.md), decision 3), so
every deploy cuts short whatever is being played. A round lasts three minutes
and a deploy takes seconds, which was the reasoning; it stops being true the
moment somebody is actually playing.

What has to survive is small: the room code, the settings, the players with
their scores and their words, and the current round with its board and its
`endsAt`. The solution map does not, since solving a grid again takes one or two
milliseconds.

The awkward part is the clock. A round saved with three seconds left and
restored forty seconds later has to end at once rather than resume, so the
restore has to compare `endsAt` with the present and close the round when it has
passed. Same for the pre-round countdown.

A plain JSON file written on every state change is enough at this scale, and
keeps the "no database" decision intact. SQLite would only earn its place
alongside the daily leaderboard.

## 4. Identical nicknames in an ordinary game

Two players called "Batman" in the same room: the server tells them apart by
identifier, but the interface does not, and neither does anyone reading the
scores.

The graceful handling is to disambiguate on display rather than to refuse the
name: "Batman" and "Batman (2)", numbered in join order. The server already
holds everything needed, since the identifier is the real key. To be checked in
the solutions page as well, where finders are shown by name.
