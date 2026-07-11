---
"screeps-client": minor
---

Add a multi-room grid view — a zoomable/pannable grid of rooms that renders low-detail overlays when zoomed out and swaps the closest rooms to full object detail (clickable, selectable, inspectable) when zoomed in, mirroring the single-room view's rendering for up to 12 simultaneous rooms.

Full-detail rooms now use a server-aware subscription strategy so the 12-room cap is actually reachable: on the official server (where the room-subscription limit is enforced per connection, and connections are randomly load-balanced across backend processes) it opens up to 6 dedicated connections, while on private servers (where the limit is account-wide) it opens a single dedicated connection and expects the operator to raise the server's subscription limit to match. The primary app connection is never used for these subscriptions — dedicated connections can be freely disconnected and reconnected to recover, which would not be safe to do to the user's actual login session. They self-heal on transient drops, are re-placed onto a healthy connection if one fails permanently, and are proactively reconnected if one shows a sustained pattern of subscribe-limit errors (a sign it landed on a backend process shared with another of our own connections).
