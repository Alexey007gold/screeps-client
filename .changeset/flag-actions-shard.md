---
"screeps-connectivity": patch
"screeps-client": patch
---

Fix flag removal and color changes failing with "invalid shard" on multi-shard servers. `removeFlag` and `changeFlagColor` now accept and forward the current shard, matching the other room-scoped game endpoints.
