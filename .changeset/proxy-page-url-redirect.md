---
"screeps-client-proxy": patch
---

Only proxy the backend paths the client actually requests (`/api`, `/socket`, `/room-history`). Navigating to a wrapped page URL like `/(https://screeps.com)/` no longer serves the backend's website — it redirects to the client, whose login screen picks the server. The startup log now prints the plain `http://host:port/` URL, and SPA deep links work in pinned-backend mode instead of being forwarded to the backend.
