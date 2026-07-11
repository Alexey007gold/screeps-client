---
"screeps-client": minor
---

Add a multi-room grid view — a zoomable/pannable grid of rooms that renders low-detail overlays when zoomed out and swaps the closest rooms to full object detail (clickable, selectable, inspectable) when zoomed in, mirroring the single-room view's rendering for up to 12 simultaneous rooms.

Full-detail rooms now use a server-aware subscription strategy so the 12-room cap is actually reachable: on the official server (where the room-subscription limit is enforced per WebSocket connection) it pools up to 6 connections, while on private servers (where the limit is account-wide) it stays on a single connection and expects the operator to raise the server's subscription limit to match. Pooled connections self-heal on transient drops and are re-placed onto a healthy connection if one fails permanently.
