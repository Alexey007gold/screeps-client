import { Switch, Match } from 'solid-js'
import type { PowerCreepClass } from '~/data/powerCreeps.js'

// Original, clean-room class glyphs (our own geometry — not copied from the
// official client). Each is a simple emblem evoking the class: operator = an
// upward support triangle, commander = stacked rank chevrons, executor = a
// four-point blade star. Stroke uses currentColor so callers set the tint.
export function PowerClassIcon(props: { class: PowerCreepClass; size?: number; color?: string }) {
  const size = () => props.size ?? 24
  const stroke = () => props.color ?? 'currentColor'
  return (
    <svg
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke()}
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      style={{ display: 'block', 'flex-shrink': 0 }}
    >
      <Switch>
        <Match when={props.class === 'operator'}>
          <circle cx="12" cy="12" r="9.5" />
          <path d="M12 6.5 L17 16 L7 16 Z" fill={stroke()} stroke="none" />
        </Match>
        <Match when={props.class === 'commander'}>
          <path d="M5 8 L12 4 L19 8" />
          <path d="M5 13 L12 9 L19 13" />
          <path d="M5 18 L12 14 L19 18" />
        </Match>
        <Match when={props.class === 'executor'}>
          <path d="M12 2.5 L15 9 L21.5 12 L15 15 L12 21.5 L9 15 L2.5 12 L9 9 Z" />
        </Match>
      </Switch>
    </svg>
  )
}
