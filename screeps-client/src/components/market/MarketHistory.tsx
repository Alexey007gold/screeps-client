import { createSignal, onMount, For, Show } from 'solid-js'
import { RefreshCw, ChevronsLeft, ChevronsRight } from 'lucide-solid'
import type { ApiUserMoneyHistoryResponse } from 'screeps-connectivity'
import { client } from '~/stores/clientStore.js'
import { goToMarketResource } from '~/stores/routeStore.js'
import { MARKET_RESOURCES, resourceDisplayName } from '~/data/resources.js'
import { ResourceSwatch } from './ResourceSwatch.js'
import { PANEL, BORDER, TEXT, MUTED, ACCENT, POS, NEG, fmtAmount, fmtPrice } from './theme.js'
import { Card, rowBg } from './ui.js'
import { isMultiShard } from './shardState.js'

type Entry = ApiUserMoneyHistoryResponse['list'][number]

type TypeFilter = 'all' | 'market.buy' | 'market.sell' | 'market.fee'

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'market.buy', label: 'Buy' },
  { value: 'market.sell', label: 'Sell' },
  { value: 'market.fee', label: 'Fee' },
]

const MIN_FILTERED_ROWS = 20
const MAX_PAGES_PER_SCAN = 10

function tradedResource(entry: Entry): string | undefined {
  return entry.market?.resourceType ?? entry.market?.order?.resourceType
}

function matches(entry: Entry, type: TypeFilter, resource: string): boolean {
  return (type === 'all' || entry.type === type) && (!resource || tradedResource(entry) === resource)
}

function tradedAmount(entry: Entry): number | undefined {
  const m = entry.market
  return m?.amount ?? m?.order?.totalAmount ?? m?.extendOrder?.addAmount
}

// Human-readable description for a credit-ledger entry. Market transactions get
// explicit copy; anything else falls back to its dotted type made readable.
function describe(entry: Entry): string {
  switch (entry.type) {
    case 'market.buy':
      return 'Resources bought via market order'
    case 'market.sell':
      return 'Resources sold via market order'
    case 'market.fee':
      return 'Market fee'
    default:
      return entry.type.replace(/[._]/g, ' ')
  }
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString()
}

// Credit history — the account money ledger, paginated newest-first. Market
// buys/sells/fees are the headline rows but all credit movement is listed.
export function MarketHistory() {
  const [entries, setEntries] = createSignal<Entry[]>([])
  const [starts, setStarts] = createSignal<number[]>([0])
  const [nextStart, setNextStart] = createSignal(1)
  const [hasMore, setHasMore] = createSignal(false)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [typeFilter, setTypeFilter] = createSignal<TypeFilter>('all')
  const [resourceFilter, setResourceFilter] = createSignal('')

  const filtering = (): boolean => typeFilter() !== 'all' || resourceFilter() !== ''
  const currentStart = (): number => starts()[starts().length - 1]

  let loadToken = 0

  const load = async (start: number): Promise<void> => {
    const c = client()
    if (!c) return
    const token = ++loadToken
    const type = typeFilter()
    const resource = resourceFilter()
    const scanAhead = filtering()
    const found: Entry[] = []
    let p = start
    let more: boolean
    setLoading(true)
    try {
      do {
        const res = await c.http.user.moneyHistory(p)
        if (token !== loadToken) return
        found.push(...(res.list ?? []).filter((e) => matches(e, type, resource)))
        more = res.hasMore ?? false
        p++
      } while (scanAhead && more && found.length < MIN_FILTERED_ROWS && p - start < MAX_PAGES_PER_SCAN)
      setEntries(found)
      setNextStart(p)
      setHasMore(more)
      setError(null)
    } catch (err) {
      if (token === loadToken) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (token === loadToken) setLoading(false)
    }
  }

  const restart = (): void => {
    setStarts([0])
    void load(0)
  }

  const goOlder = (): void => {
    const start = nextStart()
    setStarts([...starts(), start])
    void load(start)
  }

  const goNewer = (): void => {
    const remaining = starts().slice(0, -1)
    setStarts(remaining)
    void load(remaining[remaining.length - 1])
  }

  onMount(() => void load(0))

  return (
    <Show
      when={!error()}
      fallback={
        <div style={{ background: PANEL, border: `1px solid ${BORDER}`, 'border-radius': '8px', padding: '32px', 'text-align': 'center', color: MUTED }}>
          Couldn't load your history.
        </div>
      }
    >
      <div style={{ display: 'flex', 'align-items': 'center', gap: '12px', 'margin-bottom': '12px' }}>
        <div style={{ display: 'flex', border: `1px solid ${BORDER}`, 'border-radius': '4px', overflow: 'hidden' }}>
          <For each={TYPE_FILTERS}>
            {(f, i) => (
              <button
                onClick={() => { setTypeFilter(f.value); restart() }}
                style={{
                  padding: '6px 12px',
                  border: 'none',
                  'border-left': i() > 0 ? `1px solid ${BORDER}` : 'none',
                  background: typeFilter() === f.value ? '#30363d' : '#21262d',
                  color: typeFilter() === f.value ? TEXT : MUTED,
                  'font-weight': typeFilter() === f.value ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {f.label}
              </button>
            )}
          </For>
        </div>
        <label style={{ display: 'flex', 'align-items': 'center', gap: '8px', color: MUTED, 'font-size': '13px' }}>
          Resource
          <select
            value={resourceFilter()}
            onChange={(e) => { setResourceFilter(e.currentTarget.value); restart() }}
            style={{ padding: '6px 8px', 'border-radius': '4px', border: `1px solid ${BORDER}`, background: PANEL, color: TEXT, cursor: 'pointer' }}
          >
            <option value="">All resources</option>
            <For each={MARKET_RESOURCES}>{(r) => <option value={r}>{resourceDisplayName(r)}</option>}</For>
          </select>
        </label>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => void load(currentStart())}
          title="Refresh"
          style={{ display: 'flex', 'align-items': 'center', gap: '6px', padding: '6px 10px', 'border-radius': '4px', border: `1px solid ${BORDER}`, background: '#21262d', color: TEXT, cursor: 'pointer' }}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <Show
        when={entries().length}
        fallback={
          <div style={{ background: PANEL, border: `1px solid ${BORDER}`, 'border-radius': '8px', padding: '32px', 'text-align': 'center', color: MUTED, opacity: loading() ? 0.6 : 1 }}>
            {filtering()
              ? hasMore() ? 'No matching entries in this stretch of history — try Older.' : 'No matching entries.'
              : 'Your market history is empty.'}
          </div>
        }
      >
        <Card title="Credit history">
          <table style={{ width: '100%', 'border-collapse': 'collapse', 'font-size': '13px', opacity: loading() ? 0.6 : 1 }}>
            <thead>
              <tr style={{ color: MUTED, 'text-align': 'right' }}>
                <th style={{ 'text-align': 'left', 'font-weight': 400, padding: '0 0 7px 6px', 'border-bottom': `1px solid ${BORDER}` }}>Date</th>
                <Show when={isMultiShard()}>
                  <th style={{ 'text-align': 'left', 'font-weight': 400, padding: '0 0 7px', 'border-bottom': `1px solid ${BORDER}` }}>Shard</th>
                </Show>
                <th style={{ 'font-weight': 400, padding: '0 0 7px', 'border-bottom': `1px solid ${BORDER}` }}>Tick</th>
                <th style={{ 'text-align': 'left', 'font-weight': 400, padding: '0 12px 7px', 'border-bottom': `1px solid ${BORDER}` }}>Description</th>
                <th style={{ 'text-align': 'left', 'font-weight': 400, padding: '0 0 7px', 'border-bottom': `1px solid ${BORDER}` }}>Resource</th>
                <th style={{ 'font-weight': 400, padding: '0 12px 7px 0', 'border-bottom': `1px solid ${BORDER}` }}>Amount</th>
                <th style={{ 'font-weight': 400, padding: '0 0 7px', 'border-bottom': `1px solid ${BORDER}` }}>Change</th>
                <th style={{ 'font-weight': 400, padding: '0 6px 7px 0', 'border-bottom': `1px solid ${BORDER}` }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              <For each={entries()}>
                {(e, i) => (
                  <tr style={{ background: rowBg(i()), 'text-align': 'right' }}>
                    <td style={{ 'text-align': 'left', color: MUTED, padding: '7px 0 7px 6px' }}>{fmtDate(e.date)}</td>
                    <Show when={isMultiShard()}>
                      <td style={{ 'text-align': 'left', color: MUTED, padding: '7px 0' }}>{e.shard ?? '—'}</td>
                    </Show>
                    <td style={{ color: MUTED, 'font-variant-numeric': 'tabular-nums', padding: '7px 0' }}>{e.tick}</td>
                    <td style={{ 'text-align': 'left', color: TEXT, padding: '7px 12px' }}>{describe(e)}</td>
                    <td style={{ 'text-align': 'left', padding: '7px 0' }}>
                      <Show when={tradedResource(e)} fallback={<span style={{ color: MUTED }}>—</span>}>
                        {(resourceType) => (
                          <a
                            href="#"
                            onClick={(ev) => { ev.preventDefault(); goToMarketResource(resourceType(), e.shard) }}
                            style={{ display: 'inline-flex', 'align-items': 'center', gap: '8px', color: ACCENT, 'text-decoration': 'none' }}
                          >
                            <ResourceSwatch resourceType={resourceType()} size={16} />
                            {resourceDisplayName(resourceType())}
                          </a>
                        )}
                      </Show>
                    </td>
                    <td style={{ color: tradedAmount(e) == null ? MUTED : TEXT, 'font-variant-numeric': 'tabular-nums', padding: '7px 12px 7px 0' }}>
                      {fmtAmount(tradedAmount(e))}
                    </td>
                    <td style={{ color: e.change > 0 ? POS : e.change < 0 ? NEG : MUTED, 'font-variant-numeric': 'tabular-nums', padding: '7px 0' }}>
                      {e.change > 0 ? '+' : ''}{fmtPrice(e.change)}
                    </td>
                    <td style={{ color: TEXT, 'font-variant-numeric': 'tabular-nums', padding: '7px 6px 7px 0' }}>{fmtPrice(e.balance)}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Card>
      </Show>

      <div style={{ display: 'flex', 'justify-content': 'space-between', 'margin-top': '16px' }}>
        <Show when={starts().length > 1} fallback={<span />}>
          <button
            onClick={goNewer}
            style={{ display: 'flex', 'align-items': 'center', gap: '4px', padding: '6px 12px', 'border-radius': '4px', border: `1px solid ${BORDER}`, background: '#21262d', color: TEXT, cursor: 'pointer' }}
          >
            <ChevronsLeft size={14} /> Newer
          </button>
        </Show>
        <Show when={hasMore()}>
          <button
            onClick={goOlder}
            style={{ display: 'flex', 'align-items': 'center', gap: '4px', padding: '6px 12px', 'border-radius': '4px', border: `1px solid ${BORDER}`, background: '#21262d', color: TEXT, cursor: 'pointer' }}
          >
            Older <ChevronsRight size={14} />
          </button>
        </Show>
      </div>
    </Show>
  )
}
