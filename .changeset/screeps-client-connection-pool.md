---
"screeps-connectivity": minor
---

Expose the connect URL as a public `ScreepsClient.url` field, so app code can construct additional same-server client instances (e.g. a connection pool) without re-deriving or re-storing the URL separately.
