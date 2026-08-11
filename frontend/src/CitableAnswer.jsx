import React, { useState, useEffect } from 'react'

const API = ''

function FileIcon({ ext }) {
  const colors = { pdf: '#f85149', docx: '#4f8eff', txt: '#3fb950', doc: '#4f8eff' }
  const color = colors[ext?.toLowerCase()] || 'var(--txt-3)'
  return (
    <div style={{
      width: 32, height: 32, borderRadius: 8, flexShrink: 0,
      background: `${color}18`, border: `1px solid ${color}30`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
        <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
      </svg>
    </div>
  )
}

function SimilarityBar({ value }) {
  const pct = Math.round(value * 100)
  const color = pct >= 80 ? '#3fb950' : pct >= 50 ? '#d29922' : 'var(--txt-3)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 3, background: 'var(--bg-3)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.4s' }} />
      </div>
      <span style={{ fontSize: 11, color, fontVariantNumeric: 'tabular-nums', minWidth: 28, textAlign: 'right' }}>{pct}%</span>
    </div>
  )
}

export default function CitableAnswer({ answer, sources, sourceChunks }) {
  const [selected, setSelected] = useState(null)
  const [content, setContent] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!selected) { setContent(null); return }
    if (sourceChunks?.length) {
      const m = sourceChunks.find(s => s.filename === selected.filename && s.similarity === selected.similarity)
      if (m?.content) { setContent(m.content.slice(0, 2000)); return }
    }
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

  const visibleSources = expanded ? sources : sources?.slice(0, 4)

  return (
    <div>
      {/* Answer text */}
      <div style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--txt-1)' }}>
        {renderAnswer()}
      </div>

      {sources?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {/* Sources header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 8,
          }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '0.7px' }}>
              Источники · {sources.length}
            </span>
            {sources.length > 4 && (
              <button onClick={() => setExpanded(e => !e)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 11, color: 'var(--accent)', fontFamily: 'inherit',
              }}>
                {expanded ? 'Свернуть' : `Ещё ${sources.length - 4}`}
              </button>
            )}
          </div>

          {/* Source list */}
          <div style={{
            background: 'var(--bg-2)', border: '1px solid var(--border)',
            borderRadius: 12, overflow: 'hidden',
          }}>
            {visibleSources.map((src, i) => {
              const ext = src.filename?.split('.').pop()
              const isActive = selected?.filename === src.filename && selected?.chunk_index === src.chunk_index
              return (
                <div key={i}>
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
                      <div style={{
                        fontSize: 12, fontWeight: 500, color: 'var(--txt-1)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{src.filename}</div>
                      <div style={{ marginTop: 4 }}>
                        <SimilarityBar value={src.similarity} />
                      </div>
                    </div>
                    <div style={{
                      fontSize: 10, color: 'var(--txt-3)', background: 'var(--bg-3)',
                      padding: '2px 7px', borderRadius: 6, flexShrink: 0,
                    }}>
                      #{src.chunk_index}
                    </div>
                    <svg
                      width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke={isActive ? 'var(--accent)' : 'var(--txt-3)'}
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{ flexShrink: 0, transform: isActive ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}
                    >
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                  </div>

                  {/* Inline preview */}
                  {isActive && (
                    <div style={{
                      margin: '0 12px 12px', borderRadius: 8,
                      background: 'var(--bg-3)', border: '1px solid var(--border)',
                      overflow: 'hidden',
                    }}>
                      {loading ? (
                        <div style={{ padding: '16px', textAlign: 'center', fontSize: 12, color: 'var(--txt-3)' }}>
                          Загрузка...
                        </div>
                      ) : content ? (
                        <>
                          <div style={{
                            padding: '12px 14px', fontSize: 12, lineHeight: 1.65,
                            color: 'var(--txt-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            maxHeight: 240, overflowY: 'auto',
                          }}>
                            {content}
                          </div>
                          <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px' }}>
                            <button
                              onClick={() => window.open(`${API}/api/documents/download/${encodeURIComponent(src.filename)}?user_id=0`, '_blank')}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 5,
                                background: 'none', border: 'none', cursor: 'pointer',
                                fontSize: 11, color: 'var(--accent)', fontFamily: 'inherit', fontWeight: 500,
                              }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
