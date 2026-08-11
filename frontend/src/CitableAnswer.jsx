import React, { useState, useEffect } from 'react'

const API = ''

function FileIcon({ ext }) {
  const map = { pdf: '#f85149', docx: '#4f8eff', doc: '#4f8eff', txt: '#3fb950' }
  const color = map[ext?.toLowerCase()] || 'var(--txt-3)'
  return (
    <div style={{
      width: 34, height: 34, borderRadius: 9, flexShrink: 0,
      background: `${color}15`, border: `1px solid ${color}28`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
        <path d="M14 2v6h6"/>
      </svg>
    </div>
  )
}

// Deduplicate sources — keep best chunk per file
function dedup(sources) {
  const map = {}
  for (const s of (sources || [])) {
    if (!map[s.filename] || s.similarity > map[s.filename].similarity) {
      map[s.filename] = s
    }
  }
  return Object.values(map).sort((a, b) => b.similarity - a.similarity)
}

export default function CitableAnswer({ answer, sources, sourceChunks }) {
  const [selected, setSelected] = useState(null)
  const [content, setContent]   = useState(null)
  const [loading, setLoading]   = useState(false)
  const [expanded, setExpanded] = useState(false)

  const unique = dedup(sources)
  const visible = expanded ? unique : unique.slice(0, 5)

  useEffect(() => {
    if (!selected) { setContent(null); return }
    const m = sourceChunks?.find(s => s.filename === selected.filename)
    if (m?.content) { setContent(m.content.slice(0, 2000)); return }
    setLoading(true)
    fetch(`${API}/api/documents/view/${encodeURIComponent(selected.filename)}?chunk_index=${selected.chunk_index}&user_id=0`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setContent(d?.content?.slice(0, 2000) || '(Содержимое недоступно)'))
      .catch(() => setContent('(Ошибка загрузки)'))
      .finally(() => setLoading(false))
  }, [selected, sourceChunks])

  const renderAnswer = () =>
    (answer || '').split('\n').map((line, i) => (
      <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>
    ))

  return (
    <div>
      {/* Answer */}
      <div style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--txt-1)' }}>
        {renderAnswer()}
      </div>

      {unique.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '0.7px' }}>
              Источники · {unique.length} {unique.length !== sources?.length ? `(из ${sources?.length} фрагментов)` : ''}
            </span>
            {unique.length > 5 && (
              <button onClick={() => setExpanded(e => !e)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 11, color: 'var(--accent)', fontFamily: 'inherit', fontWeight: 500,
              }}>
                {expanded ? 'Свернуть' : `Ещё ${unique.length - 5}`}
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            {visible.map((src, i) => {
              const ext = src.filename?.split('.').pop()
              const pct = Math.round((src.similarity || 0) * 100)
              const barColor = pct >= 80 ? '#3fb950' : pct >= 50 ? '#d29922' : 'var(--txt-3)'
              const isActive = selected?.filename === src.filename

              return (
                <div key={src.filename}>
                  {i > 0 && <div style={{ height: 1, background: 'var(--border)', margin: '0 12px' }} />}

                  <div
                    onClick={() => setSelected(isActive ? null : src)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', cursor: 'pointer',
                      background: isActive ? 'var(--accent-dim)' : 'transparent',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-3)' }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                  >
                    <FileIcon ext={ext} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--txt-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {src.filename}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
                        <div style={{ flex: 1, height: 3, background: 'var(--bg-3)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 10, color: barColor, minWidth: 26, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
                      </div>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke={isActive ? 'var(--accent)' : 'var(--txt-3)'}
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{ flexShrink: 0, transform: isActive ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}
                    >
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                  </div>

                  {/* Inline preview */}
                  {isActive && (
                    <div style={{ margin: '0 12px 12px', borderRadius: 8, background: 'var(--bg-3)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                      {loading ? (
                        <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--txt-3)' }}>Загрузка...</div>
                      ) : content ? (
                        <>
                          <div style={{ padding: '12px 14px', fontSize: 12, lineHeight: 1.65, color: 'var(--txt-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 220, overflowY: 'auto' }}>
                            {content}
                          </div>
                          <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px' }}>
                            <button
                              onClick={() => window.open(`${API}/api/documents/download/${encodeURIComponent(src.filename)}?user_id=0`, '_blank')}
                              style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--accent)', fontFamily: 'inherit', fontWeight: 500 }}
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>
                              </svg>
                              Открыть файл
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
