import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { ConnectionStatus } from '~/components/ConnectionStatus.js'
import { RoomViewer } from '~/components/RoomViewer.js'
import { MapViewer } from '~/components/MapViewer.js'
import { ToastContainer } from '~/components/ToastContainer.js'
import type { RoomInfo } from '~/components/MapViewer.js'
import { ConsolePanel } from '~/components/ConsolePanel.js'
import { Sidebar } from '~/components/Sidebar.js'
import { StatsBar } from '~/components/StatsBar.js'
import { SettingsPanel } from '~/components/SettingsPanel.js'
import { client, disconnect, isGuest } from '~/stores/clientStore.js'
import { widescreenMode } from '~/stores/settingsStore.js'
import { toggleShowLog, toggleShowConsole } from '~/stores/consoleStore.js'
import { setRoomViewMode } from '~/stores/roomViewStore.js'

import { parseRoomName } from '~/utils/roomName.js'

function parseRoomUrl(): { room: string | null; shard: string | null } {
  const match = window.location.pathname.match(/^\/room\/([A-Za-z0-9]+)/)
  if (!match) return { room: null, shard: null }
  const room = match[1].toUpperCase()
  if (!parseRoomName(room)) return { room: null, shard: null }
  const shard = new URLSearchParams(window.location.search).get('shard')
  return { room, shard }
}

function buildRoomUrl(room: string, shard: string | null): string {
  return `/room/${room}${shard ? `?shard=${encodeURIComponent(shard)}` : ''}`
}

function buildMapUrl(shard: string | null): string {
  return `/map${shard ? `?shard=${encodeURIComponent(shard)}` : ''}`
}

function parseMapUrl(): { shard: string | null } | null {
  if (!window.location.pathname.startsWith('/map')) return null
  const shard = new URLSearchParams(window.location.search).get('shard')
  return { shard }
}

export function Dashboard() {
  const urlState = parseRoomUrl()
  const [room, setRoom] = createSignal(urlState.room ?? localStorage.getItem('screeps:room') ?? 'W1N1')
  const [shard, setShard] = createSignal<string | null>(urlState.shard ?? localStorage.getItem('screeps:shard'))
  const [mapMode, setMapMode] = createSignal(parseMapUrl() !== null)

  const [showSettings, setShowSettings] = createSignal(false)
  const [mapOriginRoom, setMapOriginRoom] = createSignal<string | undefined>(undefined)
  const [hoveredRoomInfo, setHoveredRoomInfo] = createSignal<RoomInfo | null>(null)
  const [selectedRoomInfo, setSelectedRoomInfo] = createSignal<RoomInfo | null>(null)
  const savedMapZoom = localStorage.getItem('screeps:mapZoom')
  const [mapZoom, setMapZoom] = createSignal<number | null>(savedMapZoom ? Number(savedMapZoom) : null)
  const [mapSubsActive, setMapSubsActive] = createSignal<boolean | null>(null)
  const [canBack, setCanBack] = createSignal(false)
  const [canForward, setCanForward] = createSignal(false)

  const [sidebarWidth, setSidebarWidth] = createSignal(Number(localStorage.getItem('screeps:sidebarWidth')) || 260)
  const [sidebarPrevWidth, setSidebarPrevWidth] = createSignal(Number(localStorage.getItem('screeps:sidebarWidth')) || 260)
  const [consoleHeight, setConsoleHeight] = createSignal(Number(localStorage.getItem('screeps:consoleHeight')) || 220)
  const [consolePrevHeight, setConsolePrevHeight] = createSignal(Number(localStorage.getItem('screeps:consoleHeight')) || 220)
  const [sidebarDragging, setSidebarDragging] = createSignal(false)
  const [consoleDragging, setConsoleDragging] = createSignal(false)

  const sidebarCollapsed = () => sidebarWidth() <= 32
  const consoleCollapsed = () => consoleHeight() <= 32

  const toggleSidebar = () => {
    if (sidebarWidth() > 32) {
      setSidebarPrevWidth(sidebarWidth())
      setSidebarWidth(32)
    } else {
      setSidebarWidth(sidebarPrevWidth())
    }
  }

  const toggleConsole = () => {
    if (consoleHeight() > 32) {
      setConsolePrevHeight(consoleHeight())
      setConsoleHeight(32)
    } else {
      setConsoleHeight(consolePrevHeight())
    }
  }

  const startSidebarDrag = (e: PointerEvent) => {
    e.preventDefault()
    setSidebarDragging(true)
    const startX = e.clientX
    const startWidth = sidebarWidth()

    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX
      setSidebarWidth(Math.max(32, Math.min(500, startWidth - delta)))
    }

    const onUp = () => {
      setSidebarDragging(false)
      localStorage.setItem('screeps:sidebarWidth', String(sidebarWidth()))
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const startConsoleDrag = (e: PointerEvent) => {
    e.preventDefault()
    setConsoleDragging(true)
    const startY = e.clientY
    const startHeight = consoleHeight()

    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientY - startY
      setConsoleHeight(Math.max(32, Math.min(500, startHeight - delta)))
    }

    const onUp = () => {
      setConsoleDragging(false)
      localStorage.setItem('screeps:consoleHeight', String(consoleHeight()))
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const handleNavigate = (r: string, s: string | null) => {
    client()?.stores.navigation.navigateTo(r, s)
  }

  const openMap = (originRoom: string) => {
    setMapOriginRoom(originRoom)
    setMapMode(true)
    history.pushState(null, '', buildMapUrl(shard()))
  }

  const toggleMap = () => {
    if (mapMode()) {
      setMapMode(false)
      setHoveredRoomInfo(null)
      setSelectedRoomInfo(null)
      history.pushState(null, '', buildRoomUrl(room(), shard()))
    } else {
      openMap(room())
    }
  }

  onMount(() => {
    // Ensure URL reflects the active view even when loaded without a path
    if (!parseRoomUrl().room && !parseMapUrl()) {
      history.replaceState(null, '', buildRoomUrl(room(), shard()))
    }

    const onPopState = () => {
      const mapState = parseMapUrl()
      if (mapState) {
        setMapMode(true)
        if (mapState.shard !== null) setShard(mapState.shard)
        return
      }
      const { room: r, shard: s } = parseRoomUrl()
      if (r) {
        setRoom(r)
        setShard(s)
        setMapMode(false)
      }
    }
    window.addEventListener('popstate', onPopState)
    onCleanup(() => window.removeEventListener('popstate', onPopState))

    const nav = client()?.stores.navigation
    if (nav) {
      const navSub = nav.on('navigation:change', (state) => {
        if (state.room === null) return
        setRoom(state.room)
        setShard(state.shard)
        setMapMode(false)
        setHoveredRoomInfo(null)
        setSelectedRoomInfo(null)
        setCanBack(nav.canBack())
        setCanForward(nav.canForward())
        localStorage.setItem('screeps:room', state.room)
        if (state.shard) localStorage.setItem('screeps:shard', state.shard)
        else localStorage.removeItem('screeps:shard')
        history.pushState(null, '', buildRoomUrl(state.room, state.shard))
      })
      onCleanup(() => navSub.dispose())
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? ''
      const editable = (e.target as HTMLElement | null)?.isContentEditable ?? false
      if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return
      if (e.key === 'l' || e.key === 'L') {
        toggleShowLog()
      }
      if (e.key === 'c' || e.key === 'C') {
        toggleShowConsole()
      }
      if (!mapMode()) {
        if (e.key === '1') setRoomViewMode('view')
        if (e.key === '2') setRoomViewMode('flag')
        if (e.key === '3') setRoomViewMode('build')
        if (e.key === 'm') openMap(room())
      }
    }
    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => window.removeEventListener('keydown', onKeyDown))
  })

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        'flex-direction': 'column',
        overflow: 'hidden',
        background: '#0d1117',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', 'border-bottom': '1px solid #30363d', 'align-items': 'center' }}>
        <ConnectionStatus />
        <Show when={!isGuest() || mapMode()}>
          <StatsBar
            mapZoom={mapMode() ? mapZoom() : null}
            mapSubsActive={mapMode() ? mapSubsActive() : null}
          />
        </Show>
        <div style={{ flex: 1 }} />
        <button
          disabled={!canBack()}
          onClick={() => client()?.stores.navigation.back()}
          style={{
            padding: '6px 10px',
            'border-radius': '4px',
            border: '1px solid #30363d',
            background: '#21262d',
            color: canBack() ? '#c9d1d9' : '#484f58',
            'font-size': '14px',
            cursor: canBack() ? 'pointer' : 'default',
            margin: '0 2px',
          }}
        >
          ←
        </button>
        <button
          disabled={!canForward()}
          onClick={() => client()?.stores.navigation.forward()}
          style={{
            padding: '6px 10px',
            'border-radius': '4px',
            border: '1px solid #30363d',
            background: '#21262d',
            color: canForward() ? '#c9d1d9' : '#484f58',
            'font-size': '14px',
            cursor: canForward() ? 'pointer' : 'default',
            margin: '0 2px',
          }}
        >
          →
        </button>
        <button
          onClick={toggleMap}
          style={{
            padding: '6px 14px',
            'border-radius': '4px',
            border: `1px solid ${mapMode() ? '#388bfd' : '#30363d'}`,
            background: mapMode() ? '#1f3158' : '#21262d',
            color: mapMode() ? '#58a6ff' : '#c9d1d9',
            'font-size': '13px',
            cursor: 'pointer',
            margin: '0 4px',
          }}
        >
          {mapMode() ? 'Room View' : 'Map'}
        </button>
        <button
          onClick={() => setShowSettings((v) => !v)}
          style={{
            padding: '6px 14px',
            'border-radius': '4px',
            border: `1px solid ${showSettings() ? '#388bfd' : '#30363d'}`,
            background: showSettings() ? '#1f3158' : '#21262d',
            color: showSettings() ? '#58a6ff' : '#c9d1d9',
            'font-size': '13px',
            cursor: 'pointer',
            margin: '0 4px',
          }}
        >
          Settings
        </button>
        <button
          onClick={disconnect}
          style={{
            padding: '6px 14px',
            'border-radius': '4px',
            border: 'none',
            background: '#da3633',
            color: '#fff',
            'font-size': '13px',
            cursor: 'pointer',
            margin: '0 16px 0 8px',
          }}
        >
          Logout
        </button>
      </div>

      {/* Main body — layout depends on widescreenMode setting */}
      <Show
        when={widescreenMode()}
        fallback={
          /* Normal mode: console spans full width below canvas+sidebar */
          <div style={{ display: 'flex', 'flex-direction': 'column', flex: 1, overflow: 'hidden' }}>
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {/* Canvas */}
              <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                <Show when={showSettings()}>
                  <SettingsPanel onClose={() => setShowSettings(false)} />
                </Show>
                <Show
                  when={!mapMode()}
                  fallback={
                    <MapViewer
                      shard={shard()}
                      originRoom={mapOriginRoom()}
                      initialZoom={mapZoom() ?? undefined}
                      onNavigateToRoom={(r) => handleNavigate(r, shard())}
                      onHoveredRoomChanged={setHoveredRoomInfo}
                      onSelectedRoomChanged={setSelectedRoomInfo}
                      onZoomChanged={(z) => {
                        setMapZoom(z)
                        localStorage.setItem('screeps:mapZoom', String(z))
                      }}
                      onSubscriptionStateChanged={setMapSubsActive}
                    />
                  }
                >
                  <RoomViewer room={room()} shard={shard()} onNavigate={handleNavigate} />
                </Show>
              </div>
              {/* Sidebar */}
              <div
                style={{
                  width: `${sidebarWidth()}px`,
                  'border-left': '1px solid #30363d',
                  transition: sidebarDragging() ? 'none' : 'width 0.15s ease',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <div
                  onPointerDown={startSidebarDrag}
                  style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', cursor: 'col-resize', 'z-index': 10, background: '#21262d' }}
                />
                <Sidebar
                  isCollapsed={sidebarCollapsed()}
                  onToggle={toggleSidebar}
                  mapMode={mapMode()}
                  hoveredRoomInfo={hoveredRoomInfo()}
                  selectedRoomInfo={selectedRoomInfo()}
                  room={room()}
                  shard={shard()}
                  mapZoom={mapZoom()}
                  mapSubsActive={mapSubsActive()}
                />
              </div>
            </div>
            {/* Console — full width */}
            <Show when={!isGuest()}>
              <div
                style={{
                  height: `${consoleHeight()}px`,
                  'border-top': '1px solid #30363d',
                  transition: consoleDragging() ? 'none' : 'height 0.15s ease',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <div
                  onPointerDown={startConsoleDrag}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '4px', cursor: 'row-resize', 'z-index': 10, background: '#21262d' }}
                />
                <ConsolePanel shard={shard()} isCollapsed={consoleCollapsed()} onToggle={toggleConsole} />
              </div>
            </Show>
          </div>
        }
      >
        {/* Widescreen mode: sidebar spans full height, console below canvas only */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <div style={{ display: 'flex', 'flex-direction': 'column', flex: 1, overflow: 'hidden' }}>
            {/* Canvas */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <Show when={showSettings()}>
                <SettingsPanel onClose={() => setShowSettings(false)} />
              </Show>
              <Show
                when={!mapMode()}
                fallback={
                  <MapViewer
                    shard={shard()}
                    originRoom={mapOriginRoom()}
                    initialZoom={mapZoom() ?? undefined}
                    onNavigateToRoom={(r) => handleNavigate(r, shard())}
                    onHoveredRoomChanged={setHoveredRoomInfo}
                    onSelectedRoomChanged={setSelectedRoomInfo}
                    onZoomChanged={(z) => {
                      setMapZoom(z)
                      localStorage.setItem('screeps:mapZoom', String(z))
                    }}
                    onSubscriptionStateChanged={setMapSubsActive}
                  />
                }
              >
                <RoomViewer room={room()} shard={shard()} onNavigate={handleNavigate} />
              </Show>
            </div>
            {/* Console — limited to canvas column width */}
            <Show when={!isGuest()}>
              <div
                style={{
                  height: `${consoleHeight()}px`,
                  'border-top': '1px solid #30363d',
                  transition: consoleDragging() ? 'none' : 'height 0.15s ease',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <div
                  onPointerDown={startConsoleDrag}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '4px', cursor: 'row-resize', 'z-index': 10, background: '#21262d' }}
                />
                <ConsolePanel shard={shard()} isCollapsed={consoleCollapsed()} onToggle={toggleConsole} />
              </div>
            </Show>
          </div>
          {/* Sidebar — full height */}
          <div
            style={{
              width: `${sidebarWidth()}px`,
              'border-left': '1px solid #30363d',
              transition: sidebarDragging() ? 'none' : 'width 0.15s ease',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <div
              onPointerDown={startSidebarDrag}
              style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', cursor: 'col-resize', 'z-index': 10, background: '#21262d' }}
            />
            <Sidebar
              isCollapsed={sidebarCollapsed()}
              onToggle={toggleSidebar}
              mapMode={mapMode()}
              hoveredRoomInfo={hoveredRoomInfo()}
              selectedRoomInfo={selectedRoomInfo()}
              room={room()}
              shard={shard()}
              mapZoom={mapZoom()}
              mapSubsActive={mapSubsActive()}
            />
          </div>
        </div>
      </Show>
      <ToastContainer />
    </div>
  )
}
