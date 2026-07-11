---
"screeps-client": minor
"screepsmod-client-new": patch
"xxscreeps-mod-client": patch
---

Console improvements: the Log pane pause button now actually stops the feed (incoming messages are buffered while paused and flushed on resume, instead of just pausing the scroll), error lines are shown inline in arrival order at the bottom next to surrounding logs (previously every error was pinned above all log output), and a new regex filter button hides log/error lines that don't match the entered pattern.
