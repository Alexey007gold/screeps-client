---
"screeps-connectivity": minor
"screeps-client": patch
"screepsmod-client-new": patch
"xxscreeps-mod-client": patch
---

Fix creep details sometimes showing no body. History playback merged each tick's diff with a shallow spread, so a positional `body` diff (`{ "0": { hits: 0 } }`, sent whenever a part is damaged, healed or boosted) replaced the array with a plain object, and a nested `store` diff dropped every other resource. History now applies diffs with the same protocol-aware merge the live room store uses, exported from `screeps-connectivity` as `mergeRoomObjectDiff`. The selection panel also stops writing tick updates back into the room objects it was created from, which was corrupting cached history chunks so creeps lost their body even on earlier ticks.
