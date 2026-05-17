import { describe, it, expect } from 'vitest'
import { badgeToSvg } from '../../src/badge/generateSvg.js'
import type { Badge } from '../../src/types/game.js'

describe('badgeToSvg', () => {
  it('generates an SVG for a numeric badge type', () => {
    const badge: Badge = {
      type: 24,
      color1: '#000077',
      color2: '#5555dd',
      color3: '#9999ff',
      param: 0,
      flip: false,
    }

    const svg = badgeToSvg(badge)
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('fill="#000077"')
    expect(svg).toContain('fill="#5555dd"')
    expect(svg).toContain('fill="#9999ff"')
  })

  it('generates an SVG for a custom path badge type', () => {
    const badge: Badge = {
      type: {
        path1: 'M 0 0 L 50 100 L 100 0 Z',
        path2: 'M 0 100 L 50 0 L 100 100 Z',
      },
      color1: '#ff0000',
      color2: '#00ff00',
      color3: '#0000ff',
      flip: false,
    }

    const svg = badgeToSvg(badge)
    expect(svg).toContain('d="M 0 0 L 50 100 L 100 0 Z"')
    expect(svg).toContain('d="M 0 100 L 50 0 L 100 100 Z"')
    expect(svg).toContain('fill="#ff0000"')
    expect(svg).toContain('fill="#00ff00"')
    expect(svg).toContain('fill="#0000ff"')
  })

  it('resolves numeric color indices', () => {
    const badge: Badge = {
      type: 1,
      color1: 0,
      color2: 20,
      color3: 40,
      param: 0,
      flip: false,
    }

    const svg = badgeToSvg(badge)
    expect(svg).toContain('fill="#cccccc"')
    expect(svg).toContain('fill="#808080"')
    expect(svg).toContain('fill="#4d4d4d"')
  })

  it('applies rotation when flip is true for badges with flip property', () => {
    const badge: Badge = {
      type: 3,
      color1: '#ffffff',
      color2: '#000000',
      color3: '#ff0000',
      param: 0,
      flip: true,
    }

    const svg = badgeToSvg(badge)
    expect(svg).toContain('rotate(180 50 50)')
  })

  it('does not rotate when flip is false', () => {
    const badge: Badge = {
      type: 3,
      color1: '#ffffff',
      color2: '#000000',
      color3: '#ff0000',
      param: 0,
      flip: false,
    }

    const svg = badgeToSvg(badge)
    expect(svg).toContain('rotate(0 50 50)')
  })

  it('renders a border when requested', () => {
    const badge: Badge = {
      type: 1,
      color1: '#ffffff',
      color2: '#000000',
      color3: '#ff0000',
      param: 0,
      flip: false,
    }

    const svgWithBorder = badgeToSvg(badge, { border: true })
    expect(svgWithBorder).toContain('stroke="#000"')
    expect(svgWithBorder).toContain('r="47.5"')
    expect(svgWithBorder).toContain('r="48"')

    const svgWithoutBorder = badgeToSvg(badge)
    expect(svgWithoutBorder).not.toContain('stroke="#000"')
    expect(svgWithoutBorder).toContain('r="52"')
  })

  it('handles badges without path2', () => {
    const badge: Badge = {
      type: 4,
      color1: '#ffffff',
      color2: '#000000',
      color3: '#ff0000',
      param: -100,
      flip: false,
    }

    const svg = badgeToSvg(badge)
    // type 4 with param -100 produces empty path2
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
  })

  it('falls back to black for missing colors', () => {
    const badge: Badge = {
      type: 1,
      color1: undefined as unknown as string,
      color2: undefined as unknown as string,
      color3: undefined as unknown as string,
      flip: false,
    }

    const svg = badgeToSvg(badge)
    expect(svg).toContain('fill="#000000"')
  })

  it('generates all 24 badge types without throwing', () => {
    for (let type = 1; type <= 24; type++) {
      const badge: Badge = {
        type,
        color1: '#111111',
        color2: '#222222',
        color3: '#333333',
        param: 0,
        flip: false,
      }
      expect(() => badgeToSvg(badge)).not.toThrow()
    }
  })

  it('generates all 24 badge types with param=-100 without throwing', () => {
    for (let type = 1; type <= 24; type++) {
      const badge: Badge = {
        type,
        color1: '#111111',
        color2: '#222222',
        color3: '#333333',
        param: -100,
        flip: false,
      }
      expect(() => badgeToSvg(badge)).not.toThrow()
    }
  })

  it('generates all 24 badge types with param=100 without throwing', () => {
    for (let type = 1; type <= 24; type++) {
      const badge: Badge = {
        type,
        color1: '#111111',
        color2: '#222222',
        color3: '#333333',
        param: 100,
        flip: false,
      }
      expect(() => badgeToSvg(badge)).not.toThrow()
    }
  })
})
