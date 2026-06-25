// Mirrors the vanilla client's `round` number filter used on the Overview stat
// tiles: integers below 10k print verbatim; larger magnitudes collapse to three
// significant figures with a K / M / B suffix (12000 → "12.0K", 1234567 → "1.23M").
export function formatStat(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '0'
  const rounded = Math.round(value)
  const abs = Math.abs(rounded)
  if (abs < 10_000) return String(rounded)
  if (abs < 1_000_000) return `${(rounded / 1_000).toPrecision(3)}K`
  if (abs < 1_000_000_000) return `${(rounded / 1_000_000).toPrecision(3)}M`
  return `${(rounded / 1_000_000_000).toPrecision(3)}B`
}
