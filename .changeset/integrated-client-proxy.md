---
"screeps-client": minor
---

Add `screeps-client-proxy`: a standalone local proxy that serves the browser client and forwards `/api` + `/socket` (including the game WebSocket) to any Screeps server, bypassing browser CORS — the same idea as the steamless client, but for the new client. Open `http://localhost:8080/` and the client shows the desktop-style server-list login; the selected backend is embedded in the request path (`/(https://server)/…`) so no library changes are needed. Content-hashed assets are served immutable and stable-URL assets revalidate (`304`), so caching is correct. In proxy mode the client persists its server list, token and saved credentials in `localStorage` so logins survive a restart.
