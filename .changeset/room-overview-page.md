---
"screeps-client": minor
"screeps-connectivity": patch
---

Add a read-only per-room overview page at `/room-overview/<shard>/<room>` (or
`/room-overview/<room>` on single-shard servers):

- Header with the room name, owner (badge + profile link, or "Unclaimed room"),
  and a room minimap thumbnail that opens the live room view.
- The same seven stat tiles as the account Overview, summed over a selectable
  interval (1 hour / 24 hours / 7 days).
- A history graph rendering the six per-bucket metrics (energy harvested,
  construction, control, energy on creeps, creeps produced/lost) as
  opacity-scaled dot strips.
- Entry points: a chart button next to each room name on the self Overview and
  public Profile pages, plus a button in the in-game room view's left toolbar
  (between the World Map and History buttons).
- `screeps-connectivity`: the existing `game.roomOverview` endpoint is now typed
  with the new exported `ApiRoomOverviewResponse` (was `unknown`).
