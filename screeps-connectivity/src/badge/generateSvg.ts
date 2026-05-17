import type { Badge } from '../types/game.js'
import { BadgePaths } from './paths.js'
import { BadgeColors } from './colors.js'

function resolveColor(value: string | number | undefined): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') {
    const entry = BadgeColors[value]
    return entry ? entry.rgb : '#000000'
  }
  return '#000000'
}

export interface BadgeSvgOptions {
  border?: boolean
}

export function badgeToSvg(badge: Badge, options: BadgeSvgOptions = {}): string {
  const border = options.border ?? false
  const color1 = resolveColor(badge.color1)
  const color2 = resolveColor(badge.color2)
  const color3 = resolveColor(badge.color3)

  const param = badge.param ?? 0

  if (typeof badge.type === 'number') {
    const def = BadgePaths[badge.type]
    if (def) {
      def.calc(param)
    }
  }

  let rotate = 0
  if (badge.flip && typeof badge.type === 'number') {
    const def = BadgePaths[badge.type]
    if (def?.flip === 'rotate180') rotate = 180
    if (def?.flip === 'rotate90') rotate = 90
    if (def?.flip === 'rotate45') rotate = 45
  }

  let path1: string
  let path2: string

  if (typeof badge.type === 'number') {
    const def = BadgePaths[badge.type]
    path1 = def?.path1 ?? ''
    path2 = def?.path2 ?? ''
  } else {
    path1 = badge.type.path1
    path2 = badge.type.path2
  }

  const clipRadius = border ? 48 : 52

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 100 100" shape-rendering="geometricPrecision">`
  svg += `<defs><clipPath id="clip"><circle cx="50" cy="50" r="${clipRadius}"/></clipPath></defs>`
  svg += `<g transform="rotate(${rotate} 50 50)">`
  svg += `<rect x="0" y="0" width="100" height="100" fill="${color1}" clip-path="url(#clip)"/>`

  if (path1) {
    svg += `<path d="${path1}" fill="${color2}" clip-path="url(#clip)"/>`
  }

  if (path2) {
    svg += `<path d="${path2}" fill="${color3}" clip-path="url(#clip)"/>`
  }

  if (border) {
    svg += `<circle cx="50" cy="50" r="47.5" fill="transparent" stroke="#000" stroke-width="5"/>`
  }

  svg += `</g></svg>`

  return svg
}
