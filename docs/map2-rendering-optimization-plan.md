# Map2 Rendering Optimization Plan

## Background
In `MapRenderer.ts`, the `setRoomMap2` function is responsible for rendering the Map2 data (Radar/Minimap overlay). It does this by creating a large number of shapes (rectangles for walls and roads, and circles for sources, controllers, minerals, power banks, and user objects) using `PIXI.Graphics` for each room.

## Problem
While `PIXI.Graphics` is convenient and easy to use, drawing thousands of individual shapes directly with methods like `circle()` and `rect()` every time Map2 data updates creates significant overhead. `PIXI.Graphics` works by triangulating all of these shapes on the CPU before sending them to the GPU. In a scenario with a high density of objects spread across many visible rooms, this rapid recreation of geometry results in poor performance (high CPU load and low frame rates), especially when panning the map.

## Proposed Optimization

To improve performance, we need to minimize CPU triangulation and efficiently batch geometry uploads to the GPU. Two main approaches are recommended:

### Option 1: Instanced Meshes (Advanced / Best Performance)
Using custom instanced meshes via PIXI's WebGL or WebGPU renderers, we can send a single small geometry (e.g., a quad for rectangles, or a polygon for a circle) to the GPU and instanciate it thousands of times with different positions and colors.
*   **Pros**: Lowest possible memory and CPU overhead. Perfect for hundreds of thousands of static or semi-static dots/rectangles.
*   **Cons**: Requires writing custom shaders and handling geometry buffers directly.

### Option 2: ParticleContainer or Batched Sprites (Recommended)
Instead of drawing vectors, we can represent each object type (wall, road, mineral, creep) as a tiny pre-rendered `PIXI.Sprite` (using a small texture or simply a colored dot). We then group these sprites within a high-performance container like `PIXI.ParticleContainer`.
*   **Pros**: Significantly faster than `PIXI.Graphics` for high node counts. Avoids CPU triangulation entirely. Easier to implement than custom shaders.
*   **Implementation Steps**:
    1.  Generate small textures for circles and rectangles during initialization (e.g., using `app.renderer.generateTexture(graphics)`).
    2.  In `RoomEntry`, replace `map2Graphics` with a `PIXI.ParticleContainer` (or a regular `Container` if using PixiJS v8's advanced batching).
    3.  When `setRoomMap2` is called, instead of calling `.rect()` and `.circle()`, maintain a pool of Sprites inside the container.
    4.  Iterate over the incoming data, assign coordinates, colors (via `sprite.tint`), and textures to the active sprites, and hide the unused ones.

### Option 3: Offscreen Canvas / Render Texture (Hybrid)
If the Map2 data updates infrequently but panning is the main issue, we can draw the room's map2 data *once* to an offscreen canvas or a PIXI `RenderTexture` and apply it as a single sprite per room.
*   **Pros**: Panning performance is near perfect (one quad per room).
*   **Cons**: Higher memory usage (one texture per room) and sudden spikes in CPU when an update *does* happen.

## Conclusion
For immediate impact with manageable complexity, transitioning away from `PIXI.Graphics` towards **Option 2 (Sprite Batching / Particle Containers)** is the most viable path. It leverages PIXI's built-in optimized rendering pipelines to draw large amounts of identical elements rapidly.
