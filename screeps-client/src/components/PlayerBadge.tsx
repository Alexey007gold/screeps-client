import { Show } from 'solid-js'
import { badgeToSvg } from 'screeps-connectivity'
import type { Badge } from 'screeps-connectivity'

// Renders a player badge as an inline SVG data-URI image (same approach as the
// UserMenu badge preview), shared by the Overview and Profile pages.
export function PlayerBadge(props: { badge: Badge | undefined; size?: number }) {
  const src = () => (props.badge ? `data:image/svg+xml,${encodeURIComponent(badgeToSvg(props.badge))}` : null)
  return (
    <Show when={src()}>
      <img src={src()!} width={props.size ?? 24} height={props.size ?? 24} alt="" style={{ display: 'block', 'border-radius': '3px', 'flex-shrink': '0' }} />
    </Show>
  )
}
