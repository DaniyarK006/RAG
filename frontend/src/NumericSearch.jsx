import React, { useState, useRef, useEffect } from 'react'

const API = 'http://localhost:8000'

const getToken = () => {
  try { return localStorage.getItem('authToken') || sessionStorage.getItem('authToken') || '' } catch { return '' }
}

const INDEX_TYPES = [
  { id: 'auto', label: 'Авто', color: '#60a5fa', grad: 'linear-gradient(135deg,#1d4ed8,#60a5fa)', desc: 'Умный выбор стратегии' },
  { id: 'vector', label: 'Вектор', color: '#a3e635', grad: 'linear-gradient(135deg,#4d7c0f,#a3e635)', desc: 'Поиск по смыслу (cosine)' },
  { id: 'tree', label: 'Дерево', color: '#fb923c', grad: 'linear-gradient(135deg,#c2410c,#fb923c)', desc: 'Иерархический поиск' },
  { id: 'list', label: 'Список', color: '#a78bfa', grad: 'linear-gradient(135deg,#6d28d9,#a78bfa)', desc: 'Линейный обход' },
  { id: 'keyword', label: 'Ключевые', color: '#f87171', grad: 'linear-gradient(135deg,#b91c1c,#f87171)', desc: 'Точное совпадение слов' },
]

export default function NumericSearch() {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState('auto')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState([])
  const [expanded, setExpanded] = useState({})
  const [expandedSources, setExpandedSources] = useState({})
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const idxConf = INDEX_TYPES.find(x => x.id === index) || INDEX_TYPES[0]

  const search = async () => {
    if (!query.trim() || loading) return
    const q = query.trim()
    setLoading(true)
    setQuery('')
    const t0 = Date.now()

    try {
      const token = getToken()
      const params = token ? `&token=${encodeURIComponent(token)}` : ''
      let data
      if (index === 'auto') {
        const res = await fetch(`${API}/index/query?q=${encodeURIComponent(q)}&index=vector&top_k=5${params}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        data = await res.json()
      } else {
        const res = await fetch(`${API}/index/query?q=${encodeURIComponent(q)}&index=${index}&top_k=5${params}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        data = await res.json()
      }

      const ms = Date.now() - t0
      const sources = (data.sources || data.results || []).map(s => ({
        filename: s.filename,
        chunk: s.chunk_index ?? s.chunk ?? 0,
        similarity: s.similarity ?? s.score ?? 0,
        rerank: s.rerank_score ?? null,
        content: s.content ?? '',
      }))

      setResults(prev => [{
        id: Date.now(),
        query: q,
        index: index,
        answer: data.answer || '—',
        sources,
        cosine: data.cosine_similarity ?? null,
        latency: data.latency_ms || ms,
        topK: data.top_k || sources.length,
      }, ...prev.slice(0, 29)])

      setExpanded(prev => ({ ...prev, 0: true }))
    } catch (e) {
      setResults(prev => [{
        id: Date.now(),
        query: q,
        index,
        answer: `Ошибка: ${e.message}`,
        sources: [],
        cosine: null,
        latency: Date.now() - t0,
        topK: 0,
      }, ...prev.slice(0, 29)])
    }
    setLoading(false)
    inputRef.current?.focus()
  }

  const onKey = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); search() }
  }

  const toggle = i => setExpanded(p => ({ ...p, [i]: !p[i] }))
  const toggleSource = (resIdx, srcIdx) => {
    const key = `${resIdx}-${srcIdx}`
    setExpandedSources(p => ({ ...p, [key]: !p[key] }))
  }

  const simColor = v => {
    const p = Math.round((v || 0) * 100)
    if (p >= 70) return '#a3e635'
    if (p >= 45) return '#60a5fa'
    if (p >= 25) return '#fb923c'
    return 'var(--txt-3)'
  }

  const simBar = v => Math.min(100, Math.round((v || 0) * 100))

  return (
    <>
      <style>{`
        .ns { display: flex; flex-direction: column; height: 100%; background: var(--bg-0); overflow: hidden; font-family: 'Inter', -apple-system, sans-serif; }

        .ns-top { padding: 18px 28px 14px; border-bottom: 1px solid var(--border); background: var(--bg-1); backdrop-filter: blur(16px); flex-shrink: 0; }
        .ns-top-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .ns-logo { display: flex; align-items: center; gap: 12px; }
        .ns-logo-icon { width: 40px; height: 40px; border-radius: 12px; background: var(--accent-dim); border: 1px solid rgba(210, 153, 34, 0.3); display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 900; color: var(--warning); }
        .ns-logo-title { font-size: 17px; font-weight: 700; color: var(--txt-1); letter-spacing: -0.3px; }
        .ns-logo-sub { font-size: 11px; color: var(--txt-3); margin-top: 1px; }
        .ns-badge-online { display: flex; align-items: center; gap: 6px; padding: 5px 14px; border-radius: 20px; background: rgba(63, 185, 80, 0.08); border: 1px solid rgba(63, 185, 80, 0.2); font-size: 11px; color: var(--success); font-weight: 500; }
        .ns-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); animation: nspulse 2s infinite; }
        @keyframes nspulse { 0%, 100% { opacity: 1; transform: scale(1) } 50% { opacity: 0.4; transform: scale(0.7) } }

        .ns-body { flex: 1; overflow-y: auto; padding: 20px 28px 32px; display: flex; flex-direction: column; gap: 16px; }
        .ns-body::-webkit-scrollbar { width: 6px; }
        .ns-body::-webkit-scrollbar-thumb { background: var(--bg-3); border-radius: 3px; }
        .ns-body::-webkit-scrollbar-track { background: transparent; }

        .ns-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
        .ns-card { padding: 12px 14px; border-radius: 10px; background: var(--bg-2); border: 1px solid var(--border); cursor: pointer; transition: all 0.15s; text-align: left; position: relative; overflow: hidden; }
        .ns-card:hover { transform: translateY(-1px); border-color: var(--txt-3); }
        .ns-card.active { border-color: var(--c); background: var(--accent-dim); box-shadow: 0 0 0 1px var(--c), 0 4px 20px rgba(0, 0, 0, 0.4); }
        .ns-card-bar { height: 2px; border-radius: 2px; margin-bottom: 10px; opacity: 0.4; transition: opacity 0.15s; }
        .ns-card.active .ns-card-bar { opacity: 1; }
        .ns-card-label { font-size: 13px; font-weight: 700; color: var(--txt-1); transition: color 0.15s; }
        .ns-card.active .ns-card-label { color: var(--c); }
        .ns-card-desc { font-size: 10px; color: var(--txt-3); margin-top: 3px; line-height: 1.4; }

        .ns-search { display: flex; gap: 10px; }
        .ns-input-wrap { flex: 1; position: relative; }
        .ns-input { width: 100%; padding: 13px 16px 13px 46px; background: var(--bg-2); border: 1px solid var(--border); border-radius: 12px; font-size: 14px; color: var(--txt-1); outline: none; font-family: inherit; transition: all 0.15s; }
        .ns-input::placeholder { color: var(--txt-3); }
        .ns-input:focus { border-color: var(--border-focus); box-shadow: 0 0 0 3px rgba(79, 142, 255, 0.07); }
        .ns-search-ico { position: absolute; left: 15px; top: 50%; transform: translateY(-50%); color: var(--txt-3); pointer-events: none; }
        .ns-run { padding: 13px 24px; border: none; border-radius: 12px; background: var(--accent); color: #fff; font-size: 13px; font-weight: 700; font-family: inherit; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.15s; box-shadow: 0 2px 16px var(--accent-glow); white-space: nowrap; }
        .ns-run:hover:not(:disabled) { background: #6fa3ff; transform: translateY(-1px); box-shadow: 0 4px 24px var(--accent-glow); }
        .ns-run:disabled { opacity: 0.45; cursor: not-allowed; }
        .ns-spinner { width: 15px; height: 15px; border: 2px solid rgba(255, 255, 255, 0.25); border-top-color: #fff; border-radius: 50%; animation: nsspin 0.6s linear infinite; }
        @keyframes nsspin { to { transform: rotate(360deg) } }

        .ns-section-title { font-size: 10px; font-weight: 700; color: var(--txt-3); text-transform: uppercase; letter-spacing: 0.6px; display: flex; align-items: center; gap: 8px; }
        .ns-section-title span { color: var(--accent); }

        .ns-res { background: var(--bg-2); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; transition: border-color 0.15s; }
        .ns-res:hover { border-color: var(--txt-3); }
        .ns-res-head { padding: 12px 16px; display: flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; background: rgba(255, 255, 255, 0.02); }
        .ns-res-tag { font-size: 9px; font-weight: 800; padding: 3px 9px; border-radius: 5px; letter-spacing: 0.5px; color: #000; flex-shrink: 0; }
        .ns-res-num { font-size: 10px; color: var(--txt-3); font-family: monospace; }
        .ns-res-stats { display: flex; gap: 10px; margin-left: auto; font-size: 10px; font-family: monospace; }
        .ns-res-chevron { color: var(--txt-3); transition: transform 0.2s; flex-shrink: 0; }
        .ns-res-chevron.open { transform: rotate(180deg); }

        .ns-res-body { padding: 12px 16px 14px; display: flex; flex-direction: column; gap: 14px; max-height: none;  }

        .ns-label { font-size: 9px; font-weight: 700; color: var(--txt-3); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 5px; }
        .ns-query-text { font-size: 13px; color: var(--txt-2); line-height: 1.5; }

        .ns-answer-box { background: var(--accent-dim); border: 1px solid rgba(79, 142, 255, 0.1); border-radius: 10px; padding: 12px 14px; max-height: 300px; overflow-y: auto; }
        .ns-answer-box::-webkit-scrollbar { width: 4px; }
        .ns-answer-box::-webkit-scrollbar-track { background: transparent; }
        .ns-answer-box::-webkit-scrollbar-thumb { background: var(--bg-3); border-radius: 3px; }
        .ns-answer-text { font-size: 13px; color: var(--txt-1); line-height: 1.75; white-space: pre-wrap; word-break: break-word; }

        .ns-sources-wrap { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
        .ns-sources-header { padding: 10px 14px; background: rgba(255, 255, 255, 0.02); border-bottom: 1px solid var(--border); font-size: 9px; font-weight: 700; color: var(--txt-3); text-transform: uppercase; letter-spacing: 0.8px; }
        .ns-sources-list { display: flex; flex-direction: column; gap: 8px; max-height: none; overflow-y: visible; padding: 10px; background: rgba(255, 255, 255, 0.005); }
        .ns-sources-list::-webkit-scrollbar { width: 4px; }
        .ns-sources-list::-webkit-scrollbar-track { background: transparent; }
        .ns-sources-list::-webkit-scrollbar-thumb { background: var(--bg-3); border-radius: 3px; }

        .ns-src { background: var(--bg-3); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; transition: all 0.15s; cursor: pointer; }
        .ns-src:hover { border-color: var(--txt-3); }
        .ns-src-head { padding: 10px 12px; display: flex; align-items: center; gap: 10px; user-select: none; }
        .ns-src-info { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; }
        .ns-src-file { font-size: 11px; font-weight: 700; color: var(--accent); font-family: monospace; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ns-src-chunk { font-size: 10px; color: var(--txt-3); flex-shrink: 0; font-family: monospace; }
        .ns-src-sim { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .ns-src-bar-wrap { width: 40px; height: 3px; background: var(--bg-2); border-radius: 2px; }
        .ns-src-bar { height: 100%; border-radius: 2px; transition: width 0.4s; }
        .ns-src-pct { font-size: 10px; font-weight: 700; min-width: 32px; text-align: right; }
        .ns-src-chevron { color: var(--txt-3); transition: transform 0.2s; flex-shrink: 0; }
        .ns-src-chevron.open { transform: rotate(180deg); }

        .ns-src-content { padding: 10px 12px; border-top: 1px solid var(--border); background: rgba(255, 255, 255, 0.01); font-size: 12px; color: var(--txt-2); line-height: 1.6; white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow-y: auto; }
        .ns-src-content::-webkit-scrollbar { width: 3px; }
        .ns-src-content::-webkit-scrollbar-track { background: transparent; }
        .ns-src-content::-webkit-scrollbar-thumb { background: var(--bg-3); border-radius: 3px; }

        .ns-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 40px; }
        .ns-empty-icon { font-size: 44px; opacity: 0.1; }
        .ns-empty-title { font-size: 15px; font-weight: 600; color: var(--txt-2); }
        .ns-empty-hint { font-size: 12px; color: var(--txt-3); }

        @media(max-width: 768px) {
          .ns-grid { grid-template-columns: repeat(3, 1fr); }
          .ns-body, .ns-top { padding-left: 16px; padding-right: 16px; }
          .ns-search { flex-direction: column; }
        }
      `}</style>

      <div className="ns">
        <div className="ns-top">
          <div className="ns-top-row">
            <div className="ns-logo">
              <div className="ns-logo-icon">#</div>
              <div>
                <div className="ns-logo-title">Цифровой поиск</div>
                <div className="ns-logo-sub">Векторный RAG · pgvector · bge-m3</div>
              </div>
            </div>
            <div className="ns-badge-online">
              <span className="ns-dot" />
              Готов к работе
            </div>
          </div>
        </div>

        <div className="ns-body">
          <div className="ns-grid">
            {INDEX_TYPES.map(x => (
              <button
                key={x.id}
                className={`ns-card${index === x.id ? ' active' : ''}`}
                style={{ '--c': x.color, '--g': x.grad }}
                onClick={() => setIndex(x.id)}
              >
                <div className="ns-card-bar" style={{ background: x.grad }} />
                <div className="ns-card-label">{x.label}</div>
                <div className="ns-card-desc">{x.desc}</div>
              </button>
            ))}
          </div>

          <div className="ns-search">
            <div className="ns-input-wrap">
              <input
                ref={inputRef}
                className="ns-input"
                placeholder={`${idxConf.label} · ${idxConf.desc} · нажмите Enter`}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={onKey}
                disabled={loading}
              />
              <svg className="ns-search-ico" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
              </svg>
            </div>
            <button className="ns-run" onClick={search} disabled={loading || !query.trim()}>
              {loading
                ? <><span className="ns-spinner" /> Поиск...</>
                : <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg> Найти</>
              }
            </button>
          </div>

          {results.length > 0 ? (
            <>
              <div className="ns-section-title">
                История запросов <span>· {results.length}</span>
              </div>
              {results.map((r, i) => {
                const cfg = INDEX_TYPES.find(x => x.id === r.index) || INDEX_TYPES[0]
                const open = !!expanded[i]
                return (
                  <div key={r.id} className="ns-res">
                    <div className="ns-res-head" onClick={() => toggle(i)}>
                      <span className="ns-res-tag" style={{ background: cfg.color }}>{cfg.label.toUpperCase()}</span>
                      <span className="ns-res-num">запрос #{results.length - i}</span>
                      <div className="ns-res-stats">
                        <span style={{ color: 'var(--txt-3)' }}>{r.latency}ms</span>
                        {r.cosine != null && (
                          <span style={{ color: simColor(r.cosine) }}>cos·{(+r.cosine).toFixed(3)}</span>
                        )}
                        <span style={{ color: 'var(--txt-3)' }}>{r.sources.length} источн.</span>
                      </div>
                      <svg className={`ns-res-chevron${open ? ' open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </div>

                    {open && (
                      <div className="ns-res-body">

                        <div>
                          <div className="ns-label">запрос</div>
                          <div className="ns-query-text">{r.query}</div>
                        </div>

                        <div>
                          <div className="ns-label">ответ ИИ</div>
                          <div className="ns-answer-box">
                            <div className="ns-answer-text"
                              dangerouslySetInnerHTML={{
                                __html: (r.answer || '')
                                  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                                  .replace(/### (.+)/g, '<h3 style="font-size:13px;font-weight:700;color:var(--txt-1);margin:8px 0 4px">$1</h3>')
                                  .replace(/## (.+)/g, '<h2 style="font-size:14px;font-weight:700;color:var(--txt-1);margin:10px 0 5px">$1</h2>')
                                  .replace(/^- (.+)/gm, '<div style="display:flex;gap:6px;margin:2px 0"><span style="color:var(--accent);flex-shrink:0">•</span><span>$1</span></div>')
                                  .replace(/\n/g, '<br/>')
                              }}
                            />
                          </div>
                        </div>

                        {r.sources.length > 0 && (
                          <div className="ns-sources-wrap">
                            <div className="ns-sources-header">
                              ИСТОЧНИКИ · {r.sources.length}
                            </div>
                            <div className="ns-sources-list">
                              {r.sources.map((s, si) => {
                                const srcKey = `${i}-${si}`
                                const srcOpen = !!expandedSources[srcKey]
                                return (
                                  <div key={si} className="ns-src">
                                    <div className="ns-src-head" onClick={() => toggleSource(i, si)}>
                                      <div className="ns-src-info">
                                        <div className="ns-src-file">{s.filename}</div>
                                        <div className="ns-src-chunk">chunk·{s.chunk}</div>
                                      </div>
                                      <div className="ns-src-sim">
                                        <div className="ns-src-bar-wrap">
                                          <div className="ns-src-bar" style={{ width: `${simBar(s.similarity)}%`, background: simColor(s.similarity) }} />
                                        </div>
                                        <span className="ns-src-pct" style={{ color: simColor(s.similarity) }}>
                                          {simBar(s.similarity)}%
                                        </span>
                                      </div>
                                      <svg className={`ns-src-chevron${srcOpen ? ' open' : ''}`} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M6 9l6 6 6-6" />
                                      </svg>
                                    </div>
                                    {srcOpen && s.content && (
                                      <div className="ns-src-content">
                                        {s.content}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}

                      </div>
                    )}
                  </div>
                )
              })}
            </>
          ) : (
            <div className="ns-empty">
              <div className="ns-empty-icon">🔍</div>
              <div className="ns-empty-title">Введи запрос для поиска</div>
              <div className="ns-empty-hint">Выбери индекс | Введи вопрос | Смотри источники</div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
