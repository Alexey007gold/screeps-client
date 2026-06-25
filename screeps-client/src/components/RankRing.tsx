// GCL/GPL rank donut, shared by the Overview (self) and Profile (public) pages.
// Stroke + inner-number colors encode the rank type (GCL teal / GPL red); these
// are data colors, not app chrome.
export const GCL_RING = '#4DB6AC'
export const GCL_TEXT = '#A7FFEB'
export const GPL_RING = '#C54444'
export const GPL_TEXT = '#FF9A9A'

export function RankRing(props: { value: number; label: string; ring: string; text: string; fraction: number; tooltip: string }) {
  const size = 84
  const stroke = 8
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const dash = () => `${Math.max(0, Math.min(1, props.fraction)) * circ} ${circ}`
  return (
    <div title={props.tooltip} style={{ position: 'relative', width: `${size}px`, height: `${size}px`, 'flex-shrink': '0' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={props.ring} stroke-width={stroke} opacity={0.2} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={props.ring} stroke-width={stroke} stroke-linecap="round" stroke-dasharray={dash()} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', 'flex-direction': 'column', 'align-items': 'center', 'justify-content': 'center', color: props.text }}>
        <div style={{ 'font-size': '26px', 'font-weight': 700, 'line-height': '1' }}>{props.value}</div>
        <div style={{ 'font-size': '10px', 'font-weight': 300, 'letter-spacing': '0.5px' }}>{props.label}</div>
      </div>
    </div>
  )
}
