import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'

const API = ''

const getToken = () => {
  try { return localStorage.getItem('authToken') || sessionStorage.getItem('authToken') || '' } catch { return '' }
}

const FILE_COLORS = {
  pdf: { node: '#f87171', glow: 'rgba(248,113,113,0.4)', ring: 'rgba(248,113,113,0.15)' },
  txt: { node: '#a3e635', glow: 'rgba(163,230,53,0.4)', ring: 'rgba(163,230,53,0.15)' },
  docx: { node: '#60a5fa', glow: 'rgba(96,165,250,0.4)', ring: 'rgba(96,165,250,0.15)' },
  xlsx: { node: '#fb923c', glow: 'rgba(251,146,60,0.4)', ring: 'rgba(251,146,60,0.15)' },
  default: { node: '#a78bfa', glow: 'rgba(167,139,250,0.4)', ring: 'rgba(167,139,250,0.15)' },
}

const getExt = name => (name || '').split('.').pop().toLowerCase()
const getColor = name => FILE_COLORS[getExt(name)] || FILE_COLORS.default
const safeId = id => id.replace(/[^a-z0-9]/gi, '')

function tokenize(name) {
  const base = name.toLowerCase().replace(/\.[a-z0-9]+$/, '')
  return base.split(/[\s._\-]+/).filter(Boolean)
}

function bigrams(str) {
  const s = str.toLowerCase()
  const set = new Set()
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
  return set
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 0
  let inter = 0
  a.forEach(x => { if (b.has(x)) inter++ })
  const union = a.size + b.size - inter
  return union ? inter / union : 0
}

function similarity(nameA, nameB) {
  const tokensA = new Set(tokenize(nameA))
  const tokensB = new Set(tokenize(nameB))
  const tokenSim = jaccard(tokensA, tokensB)

  const grA = bigrams(tokenize(nameA).join(' '))
  const grB = bigrams(tokenize(nameB).join(' '))
  const bigramSim = jaccard(grA, grB)

  const sameExt = getExt(nameA) === getExt(nameB) ? 0.12 : 0

  return Math.min(1, tokenSim * 0.55 + bigramSim * 0.4 + sameExt)
}

function buildFallbackEdges(list) {
  const edges = []
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const weight = Math.min(1, similarity(list[i].id, list[j].id) + 0.08)
      edges.push({ source: list[i].id, target: list[j].id, weight })
    }
  }
  return edges
}

function useSize(ref) {
  const [size, setSize] = useState({ w: 800, h: 600 })
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => {
      setSize({ w: e.contentRect.width, h: e.contentRect.height })
    })
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return size
}

function useCircleLayout(nodes, w, h) {
  return useMemo(() => {
    const positions = {}
    if (!nodes.length || !w || !h) return positions

    const cx = w / 2
    const cy = h / 2
    const radius = Math.min(w, h) * 0.36
    const startAngle = -Math.PI / 2

    nodes.forEach((n, i) => {
      const angle = startAngle + (2 * Math.PI * i) / nodes.length
      positions[n.id] = {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      }
    })

    return positions
  }, [nodes, w, h])
}

function ChunksModal({ doc, onClose }) {
  const [chunks, setChunks] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const c = getColor(doc.id)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const token = getToken()
        const params = token ? `?token=${encodeURIComponent(token)}` : ''
        const res = await fetch(`${API}/documents/${encodeURIComponent(doc.id)}/chunks${params}`)
        if (res.ok) {
          const data = await res.json()
          setChunks(data.chunks || [])
        }
      } catch {}
      setLoading(false)
    }
    load()
  }, [doc.id])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 680, maxHeight: '82vh', background: 'var(--bg-1)',
        border: `1px solid ${c.node}`,
        borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: `0 0 40px ${c.glow}, 0 24px 64px rgba(0,0,0,0.6)`,
        animation: 'gvfadein 0.18s ease',
      }}>
        <div style={{
          padding: '18px 22px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0,
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: c.ring, border: `1px solid ${c.node}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 800, fontFamily: 'monospace', color: c.node,
          }}>
            {getExt(doc.id).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt-1)', wordBreak: 'break-all', lineHeight: 1.4 }}>{doc.id}</div>
            <div style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 2, fontFamily: 'monospace' }}>
              {doc.chunks} чанков · {getExt(doc.id).toUpperCase()}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--txt-3)', padding: '6px', borderRadius: 6,
            display: 'flex', alignItems: 'center', flexShrink: 0,
            transition: 'color 0.15s',
          }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--txt-1)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--txt-3)'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--txt-3)', fontSize: 13 }}>
              Загрузка чанков...
            </div>
          )}
          {!loading && chunks.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--txt-3)', fontSize: 13 }}>
              Чанки не найдены
            </div>
          )}
          {!loading && chunks.map((chunk, i) => (
            <div key={i}
              onClick={() => setExpanded(expanded === i ? null : i)}
              style={{
                background: expanded === i ? c.ring : 'var(--bg-2)',
                border: `1px solid ${expanded === i ? c.node : 'var(--border)'}`,
                borderRadius: 10, padding: '10px 14px', cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: expanded === i ? 10 : 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: c.node, fontFamily: 'monospace' }}>
                  Чанк #{(chunk.chunk_index ?? i) + 1}
                </span>
                <span style={{ fontSize: 10, color: 'var(--txt-3)' }}>
                  {expanded === i ? '▲ Свернуть' : '▼ Развернуть'}
                </span>
              </div>
              {expanded !== i && (
                <div style={{ fontSize: 12, color: 'var(--txt-3)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {chunk.content?.slice(0, 140)}...
                </div>
              )}
              {expanded === i && (
                <div style={{ fontSize: 13, color: 'var(--txt-1)', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {chunk.content}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function GraphView() {
  const [docs, setDocs] = useState([])
  const [edges, setEdges] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [hovered, setHovered] = useState(null)
  const [selected, setSelected] = useState(null)
  const [threshold, setThreshold] = useState(0.12)
  const svgRef = useRef(null)
  const wrapRef = useRef(null)
  const { w, h } = useSize(wrapRef)
  const [openDoc, setOpenDoc] = useState(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true); setError(null)
      try {
        const token = getToken()
        const params = token ? `?token=${encodeURIComponent(token)}` : ''
        const res = await fetch(`${API}/documents${params}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const list = (data.documents || []).map(d => ({ id: d.filename, label: d.filename, chunks: d.chunks }))
        setDocs(list)

        let computedEdges = buildFallbackEdges(list)

        try {
          const embRes = await fetch(`${API}/graph/similarities${params}`)
          if (embRes.ok) {
            const simData = await embRes.json()
            if (Array.isArray(simData.edges) && simData.edges.length) {
              computedEdges = simData.edges
            }
          }
        } catch {}

        setEdges(computedEdges)
      } catch (e) {
        setError(e.message)
      }
      setLoading(false)
    }
    load()
  }, [])

  const nodes = docs
  const filteredEdges = useMemo(
    () => edges.filter(e => e.weight >= threshold),
    [edges, threshold]
  )
  const positions = useCircleLayout(nodes, w, h)

  const pos = useCallback((id) => ({
    x: positions[id]?.x ?? w / 2,
    y: positions[id]?.y ?? h / 2,
  }), [positions, w, h])

  const selectedDoc = docs.find(d => d.id === selected)
  const selectedEdges = selected
    ? filteredEdges.filter(e => e.source === selected || e.target === selected)
        .sort((a, b) => b.weight - a.weight)
    : []

  const simColor = v => {
    if (v >= 0.7) return '#a3e635'
    if (v >= 0.4) return '#60a5fa'
    if (v >= 0.2) return '#fb923c'
    return 'var(--txt-3)'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-0)', fontFamily: "'Inter',-apple-system,sans-serif", overflow: 'hidden' }}>

      {openDoc && <ChunksModal doc={openDoc} onClose={() => setOpenDoc(null)} />}

      <div style={{ padding: '16px 28px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-1)', backdropFilter: 'blur(16px)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--accent-dim)', border: '1px solid rgba(96,165,250,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/>
              <path d="M7 12h10M17 7l-8 5M17 17l-8-5"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--txt-1)', letterSpacing: -0.3 }}>Граф связей</div>
            <div style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 1 }}>Семантическая близость документов</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--txt-3)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>Порог связей</span>
            <input type="range" min="0" max="0.9" step="0.05" value={threshold}
              onChange={e => setThreshold(+e.target.value)}
              style={{ width: 100, accentColor: '#60a5fa', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', fontFamily: 'monospace', minWidth: 32 }}>{threshold.toFixed(2)}</span>
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            {[
              ['узлов', docs.length, '#a3e635'],
              ['связей', filteredEdges.length, '#60a5fa'],
            ].map(([label, val, color]) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: 'monospace', lineHeight: 1 }}>{val}</div>
                <div style={{ fontSize: 10, color: 'var(--txt-3)', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px', borderRadius: 20, background: 'rgba(63,185,80,0.08)', border: '1px solid rgba(63,185,80,0.2)', fontSize: 11, color: '#3fb950', fontWeight: 500 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3fb950', animation: 'gvpulse 2s infinite' }} />
            Готов
          </div>
        </div>
      </div>

      <style>{`
        @keyframes gvpulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes gvfadein { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes gvflow { to { stroke-dashoffset: -24; } }
        .gv-node { cursor: pointer; transition: filter 0.15s; }
        .gv-edge-active { animation: gvflow 0.6s linear infinite; }
      `}</style>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div ref={wrapRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

          {loading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: 'var(--txt-3)' }}>
              <div style={{ width: 36, height: 36, border: '3px solid rgba(96,165,250,0.2)', borderTopColor: '#60a5fa', borderRadius: '50%', animation: 'gvpulse 0.8s linear infinite' }} />
              <div style={{ fontSize: 13 }}>Загрузка графа...</div>
            </div>
          )}

          {error && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f87171', fontSize: 13 }}>
              Ошибка: {error}
            </div>
          )}

          {!loading && !error && w > 0 && (
            <svg ref={svgRef} width={w} height={h} style={{ display: 'block' }}>
              <defs>
                <filter id="glow-green"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                <filter id="glow-blue"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                {docs.map(n => {
                  const c = getColor(n.id)
                  return (
                    <radialGradient key={n.id} id={`ng-${safeId(n.id)}`} cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor={c.node} stopOpacity="0.9"/>
                      <stop offset="100%" stopColor={c.node} stopOpacity="0.4"/>
                    </radialGradient>
                  )
                })}
              </defs>

              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--border)" strokeWidth="1"/>
              </pattern>
              <rect width={w} height={h} fill="url(#grid)" />

              {filteredEdges.map((e, i) => {
                const a = pos(e.source), b = pos(e.target)
                if (!a || !b) return null
                const isActive = selected && (e.source === selected || e.target === selected)
                const isHov = hovered && (e.source === hovered || e.target === hovered)
                const opacity = isActive ? 0.95 : isHov ? 0.65 : 0.12 + e.weight * 0.28
                const stroke = simColor(e.weight)
                const sw = isActive ? 2.2 : 1 + e.weight * 1.4

                const cx = w / 2
                const cy = h / 2
                const mx = (a.x + b.x) / 2
                const my = (a.y + b.y) / 2
                const bend = 0.18
                const qx = mx + (cx - mx) * bend
                const qy = my + (cy - my) * bend

                return (
                  <g key={`${e.source}-${e.target}-${i}`}>
                    <path
                      d={`M ${a.x} ${a.y} Q ${qx} ${qy} ${b.x} ${b.y}`}
                      fill="none"
                      stroke={stroke} strokeWidth={sw} strokeOpacity={opacity}
                      strokeLinecap="round"
                      strokeDasharray={isActive || isHov ? '6 6' : 'none'}
                      className={isActive || isHov ? 'gv-edge-active' : ''}
                    />
                    {(isActive || isHov) && (
                      <text x={qx} y={qy - 4} textAnchor="middle" fontSize="10"
                        fill={stroke} fillOpacity="0.9" fontFamily="monospace" fontWeight="700">
                        {(e.weight * 100).toFixed(0)}%
                      </text>
                    )}
                  </g>
                )
              })}

              {nodes.map(n => {
                const p = pos(n.id)
                if (!p) return null
                const c = getColor(n.id)
                const isSel = selected === n.id
                const isHov = hovered === n.id
                const isConn = selected && filteredEdges.some(e => (e.source === selected || e.target === selected) && (e.source === n.id || e.target === n.id))
                const isDim = selected && !isSel && !isConn
                const r = 14 + Math.min(n.chunks || 0, 20) * 0.4
                const label = n.label.length > 22 ? n.label.slice(0, 20) + '…' : n.label
                const ext = getExt(n.id).toUpperCase()

                return (
                  <g key={n.id} className="gv-node"
                    opacity={isDim ? 0.25 : 1}
                    onMouseEnter={() => setHovered(n.id)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => setSelected(isSel ? null : n.id)}
                    style={{ filter: (isSel || isHov) ? `drop-shadow(0 0 8px ${c.node})` : 'none', transition: 'opacity 0.2s, filter 0.2s' }}
                  >
                    <circle cx={p.x} cy={p.y} r={r + 10}
                      fill={c.ring} stroke={c.node}
                      strokeWidth={isSel ? 1.5 : 0.5}
                      strokeOpacity={isSel ? 0.8 : 0.3}
                    />
                    <circle cx={p.x} cy={p.y} r={r}
                      fill={`url(#ng-${safeId(n.id)})`}
                      stroke={c.node} strokeWidth={isSel ? 2 : 1}
                    />
                    <text x={p.x} y={p.y + 4} textAnchor="middle"
                      fontSize="9" fontWeight="800" fontFamily="monospace"
                      fill="#000" letterSpacing="0.5">
                      {ext}
                    </text>
                    <text x={p.x} y={p.y + r + 16} textAnchor="middle"
                      fontSize="11" fontWeight={isSel ? '700' : '400'}
                      fill={isSel ? c.node : 'var(--txt-2)'}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}>
                      {label}
                    </text>
                    {(isSel || isHov) && (
                      <text x={p.x} y={p.y + r + 28} textAnchor="middle"
                        fontSize="10" fill={c.node} fontFamily="monospace" fillOpacity="0.7">
                        {n.chunks} Чанков
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>
          )}

          {!loading && !error && docs.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--txt-3)' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
                <circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/>
                <path d="M7 12h10M17 7l-8 5M17 17l-8-5"/>
              </svg>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--txt-2)' }}>База знаний пуста</div>
              <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>Загрузите документы чтобы увидеть граф</div>
            </div>
          )}
        </div>

        <div style={{ width: 280, flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--bg-1)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {selected && selectedDoc ? (
            <div style={{ flex: 1, overflow: 'auto', padding: 20, animation: 'gvfadein 0.2s ease', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>выбранный документ</div>
                <div style={{ background: getColor(selectedDoc.id).ring, border: `1px solid ${getColor(selectedDoc.id).node}`, borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: getColor(selectedDoc.id).node, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.5 }}>
                    {selectedDoc.label}
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--txt-1)', fontFamily: 'monospace' }}>{selectedDoc.chunks}</div>
                      <div style={{ fontSize: 10, color: 'var(--txt-3)' }}>Чанков</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--txt-1)', fontFamily: 'monospace' }}>{selectedEdges.length}</div>
                      <div style={{ fontSize: 10, color: 'var(--txt-3)' }}>Связей</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: getColor(selectedDoc.id).node, fontFamily: 'monospace' }}>{getExt(selectedDoc.id).toUpperCase()}</div>
                      <div style={{ fontSize: 10, color: 'var(--txt-3)' }}>Формат</div>
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setOpenDoc(selectedDoc)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '11px 0', width: '100%',
                  background: getColor(selectedDoc.id).node,
                  border: 'none', borderRadius: 10, cursor: 'pointer',
                  fontSize: 13, fontWeight: 700, color: '#000',
                  boxShadow: `0 4px 16px ${getColor(selectedDoc.id).glow}`,
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = `0 6px 24px ${getColor(selectedDoc.id).glow}` }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = `0 4px 16px ${getColor(selectedDoc.id).glow}` }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                  <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
                </svg>
                Открыть файл
              </button>

              {selectedEdges.length > 0 && (
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
                    Связанные документы
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {selectedEdges.map((e, i) => {
                      const otherId = e.source === selected ? e.target : e.source
                      const c = getColor(otherId)
                      const pct = Math.round(e.weight * 100)
                      return (
                        <div key={i}
                          onClick={() => setSelected(otherId)}
                          style={{ padding: '9px 12px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', transition: 'border-color 0.15s' }}
                          onMouseEnter={ev => ev.currentTarget.style.borderColor = c.node}
                          onMouseLeave={ev => ev.currentTarget.style.borderColor = 'var(--border)'}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: c.node, flexShrink: 0 }} />
                            <div style={{ fontSize: 11, color: 'var(--txt-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                              {otherId.length > 28 ? otherId.slice(0, 26) + '…' : otherId}
                            </div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: simColor(e.weight), fontFamily: 'monospace', flexShrink: 0 }}>
                              {pct}%
                            </div>
                          </div>
                          <div style={{ height: 3, background: 'var(--bg-3)', borderRadius: 2 }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: simColor(e.weight), borderRadius: 2, transition: 'width 0.4s' }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <button onClick={() => setSelected(null)}
                style={{ marginTop: 'auto', width: '100%', padding: '8px 0', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--txt-3)', fontSize: 12, cursor: 'pointer', transition: 'border-color 0.15s, color 0.15s', fontFamily: 'inherit' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--txt-2)'; e.currentTarget.style.color = 'var(--txt-2)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--txt-3)' }}
              >
                Снять выделение
              </button>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, gap: 16 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>легенда</div>
              {Object.entries(FILE_COLORS).filter(([k]) => k !== 'default').map(([ext, c]) => (
                <div key={ext} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: c.node, boxShadow: `0 0 6px ${c.glow}` }} />
                  <span style={{ fontSize: 12, color: 'var(--txt-2)', fontFamily: 'monospace' }}>.{ext}</span>
                </div>
              ))}

              <div style={{ marginTop: 8, fontSize: 9, fontWeight: 700, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>схожесть</div>
              {[['≥ 70%', '#a3e635', 'высокая'], ['≥ 40%', '#60a5fa', 'средняя'], ['≥ 20%', '#fb923c', 'низкая'], ['< 20%', 'var(--txt-3)', 'слабая']].map(([pct, color, label]) => (
                <div key={pct} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 20, height: 2, background: color, borderRadius: 1 }} />
                  <span style={{ fontSize: 11, color: 'var(--txt-3)', fontFamily: 'monospace' }}>{pct}</span>
                  <span style={{ fontSize: 11, color: 'var(--txt-3)' }}>{label}</span>
                </div>
              ))}

              <div style={{ marginTop: 'auto', padding: '12px', background: 'var(--accent-dim)', border: '1px solid rgba(79,142,255,0.1)', borderRadius: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--txt-2)', lineHeight: 1.6 }}>
                  Нажми на узел чтобы увидеть связи и открыть содержимое файла
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
