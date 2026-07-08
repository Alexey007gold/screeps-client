---
"screeps-client": minor
---

Code panel TypeScript support: modules can now be authored in TypeScript with full in-browser IntelliSense — completion, hover type info, and inline diagnostics for the Screeps API — powered by a TypeScript language service running in a Web Worker. When creating a module you choose `.ts` or `.js` (a branch can mix both); the module list and tab show each module's language, and a Convert to TS / Convert to JS button switches an existing module's language in place (including the protected `main` entry module).

TypeScript sources are transpiled to JavaScript on Save and pushed to the server as the runnable module, while the original `.ts` source is persisted alongside as a sibling `<name>.ts` module — hidden from the module list and never `require`d at runtime, so it survives reload without affecting the running code. The entry module still compiles to `main`. Type errors surface as squiggles but never block a Save (transpilation always emits). Each TS module also gets a read-only `<name>.js` (generated) entry that shows the transpiled output, live from the current source.

The TypeScript compiler and standard-library typings are bundled offline (no CDN) and loaded lazily in a worker only when a TS module is first opened, so pure-JavaScript branches are unaffected.
