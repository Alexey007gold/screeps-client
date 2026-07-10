---
"screeps-client": minor
---

Memory segment editor: a new "Segments" button in the console bar (next to Memory) opens a full-canvas overlay — like the code editor — for viewing and editing raw memory segments. Pick any of the 100 segments from the list (loaded sizes are shown alongside), switch shards on multi-shard servers, and edit the content in a CodeMirror editor with JSON highlighting. Header buttons pretty-print or minify the content as JSON and compress/decompress it with lz-string (`compressToUTF16`, with a raw-`compress` fallback on decompress). A live character counter tracks the 100 KB segment limit and blocks saving oversized content; switching segments or reloading with unsaved changes asks for confirmation.
