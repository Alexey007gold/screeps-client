---
"screeps-client": minor
---

Add a "Smooth animations" toggle in Settings → Room View. When turned off, tick-driven animations snap to their new state instantly instead of interpolating between game ticks: creep movement, structure fill tweens (extensions, towers, storage, links, etc.), build glows, controller progress flashes, say bubbles, and the lab/terminal cooldown pulse. This reuses the renderer's existing instant mode (previously only engaged while scrubbing history). Wall-clock ambient effects that are not tied to tick timing — the source glow, tower barrel sweep, and keeper-lair pulse — keep animating.
