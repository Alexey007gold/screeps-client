declare module 'virtual:screeps-ts-libs' {
  /** TypeScript stdlib `.d.ts` files, keyed by their vfs path (e.g. `/lib.es2019.d.ts`). */
  export const libFiles: Record<string, string>
  /** The `@types/screeps` global declarations (single `index.d.ts`). */
  export const screepsTypes: string
}
