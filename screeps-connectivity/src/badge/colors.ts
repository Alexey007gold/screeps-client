function pad(v: number): string {
  const hex = Math.round(v).toString(16)
  return hex.length < 2 ? '0' + hex : hex
}

function hsl2rgb(H: number, S: number, L: number): string {
  const C = (1 - Math.abs(2 * L - 1)) * S
  const H_ = H / 60
  const X = C * (1 - Math.abs((H_ % 2) - 1))

  let R1 = 0
  let G1 = 0
  let B1 = 0

  if (!Number.isNaN(H) && H !== null && H !== undefined) {
    if (H_ >= 0 && H_ < 1) {
      R1 = C
      G1 = X
      B1 = 0
    } else if (H_ >= 1 && H_ < 2) {
      R1 = X
      G1 = C
      B1 = 0
    } else if (H_ >= 2 && H_ < 3) {
      R1 = 0
      G1 = C
      B1 = X
    } else if (H_ >= 3 && H_ < 4) {
      R1 = 0
      G1 = X
      B1 = C
    } else if (H_ >= 4 && H_ < 5) {
      R1 = X
      G1 = 0
      B1 = C
    } else if (H_ >= 5 && H_ < 6) {
      R1 = C
      G1 = 0
      B1 = X
    }
  }

  const m = L - C / 2
  const R = (R1 + m) * 255
  const G = (G1 + m) * 255
  const B = (B1 + m) * 255

  return '#' + pad(R) + pad(G) + pad(B)
}

export interface ColorEntry {
  index: number
  rgb: string
}

function buildPalette(): ColorEntry[] {
  const colors: ColorEntry[] = []
  let index = 0

  colors.push({ index: index++, rgb: hsl2rgb(0, 0, 0.8) })
  for (let i = 0; i < 19; i++) {
    colors.push({ index: index++, rgb: hsl2rgb(i * 360 / 19, 0.6, 0.8) })
  }

  colors.push({ index: index++, rgb: hsl2rgb(0, 0, 0.5) })
  for (let i = 0; i < 19; i++) {
    colors.push({ index: index++, rgb: hsl2rgb(i * 360 / 19, 0.7, 0.5) })
  }

  colors.push({ index: index++, rgb: hsl2rgb(0, 0, 0.3) })
  for (let i = 0; i < 19; i++) {
    colors.push({ index: index++, rgb: hsl2rgb(i * 360 / 19, 0.4, 0.3) })
  }

  colors.push({ index: index++, rgb: hsl2rgb(0, 0, 0.1) })
  for (let i = 0; i < 19; i++) {
    colors.push({ index: index++, rgb: hsl2rgb(i * 360 / 19, 0.5, 0.1) })
  }

  return colors
}

export const BadgeColors = buildPalette()
