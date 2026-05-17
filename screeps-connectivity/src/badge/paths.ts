export interface BadgePathDef {
  calc(param?: number): void
  path1?: string
  path2?: string
  flip?: 'rotate180' | 'rotate90' | 'rotate45'
}

export const BadgePaths: Record<number, BadgePathDef> = {
  1: {
    calc(param = 0) {
      let vert = 0
      let hor = 0
      if (param > 0) {
        vert = param * 30 / 100
      }
      if (param < 0) {
        hor = -param * 30 / 100
      }
      this.path1 = `M 50 ${100 - vert} L ${hor} 50 H ${100 - hor} Z`
      this.path2 = `M ${hor} 50 H ${100 - hor} L 50 ${vert} Z`
    },
  },

  2: {
    calc(param = 0) {
      let x = 0
      let y = 0
      if (param > 0) {
        x = param * 30 / 100
      }
      if (param < 0) {
        y = -param * 30 / 100
      }
      this.path1 = `M ${x} ${y} L 50 50 L ${100 - x} ${y} V -1 H -1 Z`
      this.path2 = `M ${x} ${100 - y} L 50 50 L ${100 - x} ${100 - y} V 101 H -1 Z`
    },
  },

  3: {
    calc(param = 0) {
      const angle = Math.PI / 4 + Math.PI / 4 * (param + 100) / 200
      const angle1 = -Math.PI / 2
      const angle2 = Math.PI / 2 + Math.PI / 3
      const angle3 = Math.PI / 2 - Math.PI / 3

      this.path1 = `M 50 50 L ${50 + 100 * Math.cos(angle1 - angle / 2)} ${50 + 100 * Math.sin(angle1 - angle / 2)} L ${50 + 100 * Math.cos(angle1 + angle / 2)} ${50 + 100 * Math.sin(angle1 + angle / 2)} Z`
      this.path2 = `M 50 50 L ${50 + 100 * Math.cos(angle2 - angle / 2)} ${50 + 100 * Math.sin(angle2 - angle / 2)} L ${50 + 100 * Math.cos(angle2 + angle / 2)} ${50 + 100 * Math.sin(angle2 + angle / 2)} Z M 50 50 L ${50 + 100 * Math.cos(angle3 - angle / 2)} ${50 + 100 * Math.sin(angle3 - angle / 2)} L ${50 + 100 * Math.cos(angle3 + angle / 2)} ${50 + 100 * Math.sin(angle3 + angle / 2)}`
    },
    flip: 'rotate180',
  },

  4: {
    calc(param = 0) {
      param += 100
      const y1 = 50 - param * 30 / 200
      const y2 = 50 + param * 30 / 200

      this.path1 = `M 0 ${y2} H 100 V 100 H 0 Z`
      this.path2 = param > 0 ? `M 0 ${y1} H 100 V ${y2} H 0 Z` : ''
    },
    flip: 'rotate90',
  },

  5: {
    calc(param = 0) {
      param += 100
      const x1 = 50 - param * 10 / 200 - 10
      const x2 = 50 + param * 10 / 200 + 10

      this.path1 = `M ${x1} 0 H ${x2} V 100 H ${x1} Z`
      this.path2 = `M 0 ${x1} H 100 V ${x2} H 0 Z`
    },
    flip: 'rotate45',
  },

  6: {
    calc(param = 0) {
      const width = 5 + (param + 100) * 8 / 200
      const x1 = 50
      const x2 = 20
      const x3 = 80

      this.path1 = `M ${x1 - width} 0 H ${x1 + width} V 100 H ${x1 - width}`
      this.path2 = `M ${x2 - width} 0 H ${x2 + width} V 100 H ${x2 - width} Z M ${x3 - width} 0 H ${x3 + width} V 100 H ${x3 - width} Z`
    },
    flip: 'rotate90',
  },

  7: {
    calc(param = 0) {
      const w = 20 + param * 10 / 100

      this.path1 = `M 0 50 Q 25 30 50 50 T 100 50 V 100 H 0 Z`
      this.path2 = `M 0 ${50 - w} Q 25 ${30 - w} 50 ${50 - w} T 100 ${50 - w} V ${50 + w} Q 75 ${70 + w} 50 ${50 + w} T 0 ${50 + w} Z`
    },
    flip: 'rotate90',
  },

  8: {
    calc(param = 0) {
      const y = param * 20 / 100

      this.path1 = `M 0 50 H 100 V 100 H 0 Z`
      this.path2 = `M 0 50 Q 50 ${y} 100 50 Q 50 ${100 - y} 0 50 Z`
    },
    flip: 'rotate90',
  },

  9: {
    calc(param = 0) {
      let y1 = 0
      let y2 = 50
      const h = 70
      if (param > 0) y1 += param / 100 * 20
      if (param < 0) y2 += param / 100 * 30

      this.path1 = `M 50 ${y1} L 100 ${y1 + h} V 101 H 0 V ${y1 + h} Z`
      this.path2 = `M 50 ${y1 + y2} L 100 ${y1 + y2 + h} V 101 H 0 V ${y1 + y2 + h} Z`
    },
    flip: 'rotate180',
  },

  10: {
    calc(param = 0) {
      let r = 30
      let d = 7

      if (param > 0) r += param * 50 / 100
      if (param < 0) d -= param * 20 / 100

      this.path1 = `M ${50 + d + r} ${50 - r} A ${r} ${r} 0 0 0 ${50 + d + r} ${50 + r} H 101 V ${50 - r} Z`
      this.path2 = `M ${50 - d - r} ${50 - r} A ${r} ${r} 0 0 1 ${50 - d - r} ${50 + r} H -1 V ${50 - r} Z`
    },
    flip: 'rotate90',
  },

  11: {
    calc(param = 0) {
      let a1 = 30
      let a2 = 30
      const x = 50 - 50 * Math.cos(Math.PI / 4)
      const y = 50 - 50 * Math.sin(Math.PI / 4)

      if (param > 0) {
        a1 += param * 25 / 100
        a2 += param * 25 / 100
      }
      if (param < 0) {
        a2 -= param * 50 / 100
      }

      this.path1 = `M ${x} ${y} Q ${a1} 50 ${x} ${100 - y} H 0 V ${y} Z M ${100 - x} ${y} Q ${100 - a1} 50 ${100 - x} ${100 - y} H 100 V ${y} Z`
      this.path2 = `M ${x} ${y} Q 50 ${a2} ${100 - x} ${y} V 0 H ${x} Z M ${x} ${100 - y} Q 50 ${100 - a2} ${100 - x} ${100 - y} V 100 H ${x} Z`
    },
    flip: 'rotate90',
  },

  12: {
    calc(param = 0) {
      let a1 = 30
      let a2 = 35

      if (param > 0) a1 += param * 30 / 100
      if (param < 0) a2 += param * 15 / 100

      this.path1 = `M 0 ${a1} H 100 V 100 H 0 Z`
      this.path2 = `M 0 ${a1} H ${a2} V 100 H 0 Z M 100 ${a1} H ${100 - a2} V 100 H 100 Z`
    },
    flip: 'rotate180',
  },

  13: {
    calc(param = 0) {
      let r = 30
      let d = 0

      if (param > 0) r += param * 50 / 100
      if (param < 0) d -= param * 20 / 100

      this.path1 = `M 0 0 H 50 V 100 H 0 Z`
      this.path2 = `M ${50 - r} ${50 - d - r} A ${r} ${r} 0 0 0 ${50 + r} ${50 - r - d} V 0 H ${50 - r} Z`
    },
    flip: 'rotate180',
  },

  14: {
    calc(param = 0) {
      let a = Math.PI / 4
      const d = 0

      a += param * Math.PI / 4 / 100

      this.path1 = `M 50 0 Q 50 ${50 + d} ${50 + 50 * Math.cos(a)} ${50 + 50 * Math.sin(a)} H 100 V 0 H 50 Z`
      this.path2 = `M 50 0 Q 50 ${50 + d} ${50 - 50 * Math.cos(a)} ${50 + 50 * Math.sin(a)} H 0 V 0 H 50 Z`
    },
    flip: 'rotate180',
  },

  15: {
    calc(param = 0) {
      const w = 13 + param * 6 / 100
      const r1 = 80
      const r2 = 45
      const d = 10

      this.path1 = `M ${50 - r1 - w} ${100 + d} A ${r1 + w} ${r1 + w} 0 0 1 ${50 + r1 + w} ${100 + d} H ${50 + r1 - w} A ${r1 - w} ${r1 - w} 0 1 0 ${50 - r1 + w} ${100 + d}`
      this.path2 = `M ${50 - r2 - w} ${100 + d} A ${r2 + w} ${r2 + w} 0 0 1 ${50 + r2 + w} ${100 + d} H ${50 + r2 - w} A ${r2 - w} ${r2 - w} 0 1 0 ${50 - r2 + w} ${100 + d}`
    },
    flip: 'rotate180',
  },

  16: {
    calc(param = 0) {
      let a = 30 * Math.PI / 180
      let d = 25

      if (param > 0) {
        a += 30 * Math.PI / 180 * param / 100
      }
      if (param < 0) {
        d += param * 25 / 100
      }

      this.path1 = ''
      for (let i = 0; i < 3; i++) {
        const angle1 = i * Math.PI * 2 / 3 + a / 2 - Math.PI / 2
        const angle2 = i * Math.PI * 2 / 3 - a / 2 - Math.PI / 2

        this.path1 += `M ${50 + 100 * Math.cos(angle1)} ${50 + 100 * Math.sin(angle1)} L ${50 + 100 * Math.cos(angle2)} ${50 + 100 * Math.sin(angle2)} L ${50 + d * Math.cos(angle2)} ${50 + d * Math.sin(angle2)} A ${d} ${d} 0 0 1 ${50 + d * Math.cos(angle1)} ${50 + d * Math.sin(angle1)} Z`
      }

      this.path2 = ''
      for (let i = 0; i < 3; i++) {
        const angle1 = i * Math.PI * 2 / 3 + a / 2 + Math.PI / 2
        const angle2 = i * Math.PI * 2 / 3 - a / 2 + Math.PI / 2

        this.path2 += `M ${50 + 100 * Math.cos(angle1)} ${50 + 100 * Math.sin(angle1)} L ${50 + 100 * Math.cos(angle2)} ${50 + 100 * Math.sin(angle2)} L ${50 + d * Math.cos(angle2)} ${50 + d * Math.sin(angle2)} A ${d} ${d} 0 0 1 ${50 + d * Math.cos(angle1)} ${50 + d * Math.sin(angle1)} Z`
      }
    },
  },

  17: {
    calc(param = 0) {
      let w = 35
      let h = 45

      if (param > 0) {
        w += param * 20 / 100
      }
      if (param < 0) {
        h -= param * 30 / 100
      }

      this.path1 = `M 50 45 L ${50 - w} ${h + 45} H ${50 + w} Z`
      this.path2 = `M 50 0 L ${50 - w} ${h} H ${50 + w} Z`
    },
  },

  18: {
    calc(param = 0) {
      let a = 90 * Math.PI / 180
      let d = 10

      if (param > 0) {
        a -= 60 / 180 * Math.PI * param / 100
      }
      if (param < 0) {
        d -= param * 15 / 100
      }

      this.path1 = ''
      this.path2 = ''
      for (let i = 0; i < 3; i++) {
        const angle1 = Math.PI * 2 / 3 * i + a / 2 - Math.PI / 2
        const angle2 = Math.PI * 2 / 3 * i - a / 2 - Math.PI / 2
        const path = `M ${50 + 100 * Math.cos(angle1)} ${50 + 100 * Math.sin(angle1)} L ${50 + 100 * Math.cos(angle2)} ${50 + 100 * Math.sin(angle2)} L ${50 + d * Math.cos((angle1 + angle2) / 2)} ${50 + d * Math.sin((angle1 + angle2) / 2)} Z`

        if (!i) {
          this.path1 += path
        } else {
          this.path2 += path
        }
      }
    },
    flip: 'rotate180',
  },

  19: {
    calc(param = 0) {
      let w2 = 20
      let w1 = 60

      w1 += param * 20 / 100
      w2 += param * 20 / 100

      this.path1 = `M 50 -10 L ${50 - w1} 100 H ${50 + w1} Z`
      this.path2 = ''
      if (w2 > 0) {
        this.path2 = `M 50 0 L ${50 - w2} 100 H ${50 + w2} Z`
      }
    },
    flip: 'rotate180',
  },

  20: {
    calc(param = 0) {
      let w = 10
      let h = 20

      if (param > 0) w += param * 20 / 100
      if (param < 0) h += param * 40 / 100

      this.path1 = `M 0 ${50 - h} H ${50 - w} V 100 H 0 Z`
      this.path2 = `M ${50 + w} 0 V ${50 + h} H 100 V 0 Z`
    },
    flip: 'rotate90',
  },

  21: {
    calc(param = 0) {
      let w = 40
      let h = 50

      if (param > 0) w -= param * 20 / 100
      if (param < 0) h += param * 20 / 100

      this.path1 = `M 50 ${h} Q ${50 + w} 0 50 0 T 50 ${h} Z M 50 ${100 - h} Q ${50 + w} 100 50 100 T 50 ${100 - h} Z`
      this.path2 = `M ${h} 50 Q 0 ${50 + w} 0 50 T ${h} 50 Z M ${100 - h} 50 Q 100 ${50 + w} 100 50 T ${100 - h} 50 Z`
    },
    flip: 'rotate45',
  },

  22: {
    calc(param = 0) {
      let w = 20

      w += param * 10 / 100

      this.path1 = `M ${50 - w} ${50 - w} H ${50 + w} V ${50 + w} H ${50 - w} Z`
      this.path2 = ''

      for (let i = -4; i < 4; i++) {
        for (let j = -4; j < 4; j++) {
          const a = (i + j) % 2
          this.path2 += `M ${50 - w - w * 2 * i} ${50 - w - w * 2 * (j + a)} h ${-w * 2} v ${w * 2} h ${w * 2} Z`
        }
      }
    },
    flip: 'rotate45',
  },

  23: {
    calc(param = 0) {
      let w = 17
      let h = 25

      if (param > 0) w += param * 35 / 100
      if (param < 0) h -= param * 23 / 100

      this.path1 = ''
      for (let i = -4; i <= 4; i++) {
        this.path1 += `M ${50 - w * i * 2} ${50 - h} l ${-w} ${-h} l ${-w} ${h} l ${w} ${h} Z`
      }
      this.path2 = ''
      for (let i = -4; i <= 4; i++) {
        this.path2 += `M ${50 - w * i * 2} ${50 + h} l ${-w} ${-h} l ${-w} ${h} l ${w} ${h} Z`
      }
    },
    flip: 'rotate90',
  },

  24: {
    calc(param = 0) {
      let w = 50
      let h = 45

      if (param > 0) w += param * 60 / 100
      if (param < 0) h += param * 30 / 100

      this.path1 = `M 0 ${h} L 50 70 L 100 ${h} V 100 H 0 Z`
      this.path2 = `M 50 0 L ${50 + w} 100 H 100 V ${h} L 50 70 L 0 ${h} V 100 H ${50 - w} Z`
    },
    flip: 'rotate180',
  },
}
