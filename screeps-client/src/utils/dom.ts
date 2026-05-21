// Returns true if the user is typing in an input-like element and global
// keyboard shortcuts should be ignored.
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName ?? ''
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  return el.isContentEditable === true
}
