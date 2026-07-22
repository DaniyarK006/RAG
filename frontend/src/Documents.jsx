import React, { useState, useEffect, useRef } from 'react'
import { upload } from '@vercel/blob/client'

const API = ''
const MAX_DOCS = 100

const TYPE_COLORS = {
  PDF:  { bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.3)',  text: '#f87171' },
  DOCX: { bg: 'rgba(79,142,255,0.12)', border: 'rgba(79,142,255,0.3)', text: '#60a5fa' },
  DOC:  { bg: 'rgba(79,142,255,0.12)', border: 'rgba(79,142,255,0.3)', text: '#60a5fa' },
  TXT:  { bg: 'rgba(63,185,80,0.12)',  border: 'rgba(63,185,80,0.3)',  text: '#3fb950' },
}

const typeStyle = (t) =>
  TYPE_COLORS[t] || { bg: 'rgba(107,114,128,0.12)', border: 'rgba(107,114,128,0.3)', text: '#9ca3af' }

const getToken = () => {
  try {
    return localStorage.getItem('authToken')
      || sessionStorage.getItem('authToken')
      || ''
  } catch { return '' }
}

const clearToken = () => {
  try {
    localStorage.removeItem('authToken')
    sessionStorage.removeItem('authToken')
  } catch {}
}

const redirectToLogin = () => {
  clearToken()
  window.location.href = '/login'
}

const withToken = (path) => {
  const token = getToken()
  return token ? `${API}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : `${API}${path}`
}

const authFetch = async (path, options = {}) => {
  const res = await fetch(withToken(path), options)
  if (res.status === 401) {
    redirectToLogin()
    throw new Error('Сессия истекла, нужно войти снова')
  }
  return res
}

function MiniBar({ label, value, max }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 12, color: 'var(--txt-2)', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>{label}</span>
        <span style={{ fontSize: 12, color: 'var(--txt-2)', fontFamily: 'monospace', marginLeft: 12, flexShrink: 0 }}>{value}</span>
      </div>
      <div style={{ height: 5, background: 'var(--bg-3)', borderRadius: 3 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, var(--accent), #60a5fa)', borderRadius: 3, transition: 'width 0.7s cubic-bezier(0.4,0,0.2,1)' }} />
      </div>
    </div>
  )
}

function DonutChart({ indexed }) {
  const typeCounts = indexed.reduce((acc, f) => { acc[f.type] = (acc[f.type] || 0) + 1; return acc }, {})
  const total = indexed.length || 1
  const palette = ['#2563eb', '#34d399', '#f59e0b', '#a78bfa', '#f87171']
  const entries = Object.entries(typeCounts)
  const segments = entries.map(([type, count], i) => ({
    type, count, pct: Math.round((count / total) * 100), color: palette[i % palette.length]
  }))
  const totalChunks = indexed.reduce((a, f) => a + (f.chunks || 0), 0)
  const r = 54, cx = 72, cy = 72, sw = 20
  const circ = 2 * Math.PI * r
  let offset = 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
      <svg width="144" height="144" viewBox="0 0 144 144" style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-3)" strokeWidth={sw} />
        {segments.map((seg, i) => {
          const dash = (seg.pct / 100) * circ
          const el = (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={seg.color} strokeWidth={sw}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          )
          offset += dash
          return el
        })}
        <text x={cx} y={cy - 7} textAnchor="middle" fontSize="22" fontWeight="500" fill="var(--txt-1)" fontFamily="monospace">{indexed.length}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="11" fill="var(--txt-3)" fontFamily="monospace">файлов</text>
      </svg>
      <div style={{ flex: 1 }}>
        {segments.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, fontFamily: 'monospace', fontSize: 13 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ color: 'var(--txt-2)', flex: 1 }}>{s.type}</span>
            <span style={{ color: 'var(--txt-1)', fontWeight: 500, minWidth: 20, textAlign: 'right' }}>{s.count}</span>
            <span style={{ color: 'var(--txt-3)', marginLeft: 8, minWidth: 36, textAlign: 'right' }}>{s.pct}%</span>
          </div>
        ))}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'monospace', fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--txt-3)' }}>всего чанков</span>
            <span style={{ color: 'var(--accent)', fontWeight: 500 }}>{totalChunks}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--txt-3)' }}>avg / файл</span>
            <span style={{ color: 'var(--accent)', fontWeight: 500 }}>{indexed.length ? Math.round(totalChunks / indexed.length) : 0}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ChunksPanel({ indexed }) {
  const max = Math.max(...indexed.map(f => f.chunks || 0), 1)
  return (
    <div>
      {indexed.map((file) => (
        <MiniBar key={file.id} label={file.name} value={file.chunks || 0} max={max} />
      ))}
      {indexed.length === 0 && <div style={{ color: 'var(--txt-3)', fontSize: 12, fontFamily: 'monospace' }}>нет документов</div>}
    </div>
  )
}

function VectorPanel({ storeInfo }) {
  const dim = storeInfo?.embedding_dim || 1024
  const cells = Array.from({ length: 256 }, (_, i) => Math.sin(i * 2.5) * 0.5 + 0.5)
  return (
    <div>
      <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--txt-3)', marginBottom: 14 }}>
        каждый текст → массив из {dim} чисел · float32
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(32, 1fr)', gap: 2.5, marginBottom: 14 }}>
        {cells.map((v, i) => (
          <div key={i} style={{
            height: 10, borderRadius: 1,
            background: v > 0.72 ? '#60a5fa' : v > 0.45 ? '#2563eb' : 'var(--bg-3)',
            opacity: 0.55 + v * 0.45,
          }} />
        ))}
      </div>
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '11px 16px', fontFamily: 'monospace', fontSize: 12 }}>
        <span style={{ color: 'var(--accent)' }}>embed</span>
        <span style={{ color: 'var(--txt-3)' }}>(</span>
        <span style={{ color: 'var(--txt-1)' }}>"текст запроса"</span>
        <span style={{ color: 'var(--txt-3)' }}>) → [</span>
        <span style={{ color: 'var(--accent)' }}>0.142, −0.837, 0.291</span>
        <span style={{ color: 'var(--txt-3)' }}>, ...]</span>
        <span style={{ color: 'var(--txt-3)' }}> × {dim}</span>
      </div>
    </div>
  )
}

function ModelPanel({ storeInfo }) {
  const rows = [
    ['model',         storeInfo?.embed_model || '-'],
    ['provider',      'Ollama · local'],
    ['embedding dim', String(storeInfo?.embedding_dim || 1024)],
    ['chunk size',    '1500 chars'],
    ['chunk overlap', '200 chars'],
    ['index type',    'cosine · pgvector'],
    ['status',        '● online'],
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {rows.map(([key, val]) => (
        <div key={key} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '11px 16px' }}>
          <div style={{ fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '0.9px', marginBottom: 6, fontFamily: 'monospace' }}>{key}</div>
          <div style={{ fontSize: 13, color: key === 'status' ? '#34d399' : 'var(--txt-1)', fontFamily: 'monospace', wordBreak: 'break-all' }}>{val}</div>
        </div>
      ))}
    </div>
  )
}

const PANELS = {
  docs:   { label: 'Документов', color: '#60a5fa', accent: '#60a5fa', hint: '→ Структура' },
  chunks: { label: 'Чанки',      color: '#60a5fa', accent: '#60a5fa', hint: '→ Распределение' },
  dim:    { label: 'Размерность', color: '#60a5fa', accent: '#60a5fa', hint: '→ Вектор' },
  model:  { label: 'Модель',     color: '#60a5fa', accent: '#60a5fa', hint: '→ Параметры' },
}

const STAGES = [
  { key: 'read',  label: 'Чтение файла' },
  { key: 'split', label: 'Разбивка на чанки' },
  { key: 'embed', label: 'Векторизация' },
  { key: 'store', label: 'Запись в pgvector' },
]

function IndexingModal({ open, onClose, target }) {
  const [stageIdx, setStageIdx] = useState(0)
  const [chunkIdx, setChunkIdx] = useState(0)
  const [logs, setLogs] = useState([])
  const timerRef = useRef(null)
  const logRef = useRef(null)

  const isEmpty  = !!target?.empty
  const fileName = target?.name || 'document.pdf'
  const fileType = target?.type || 'PDF'
  const totalChunks = target?.chunks || 24

  useEffect(() => {
    if (!open || isEmpty) return
    let cancelled = false
    setStageIdx(0); setChunkIdx(0); setLogs([`$ index ${fileName}`])

    const pushLog = (line) => !cancelled && setLogs(prev => [...prev.slice(-40), line])
    const wait = (ms) => new Promise(r => { timerRef.current = setTimeout(r, ms) })

    const run = async () => {
      pushLog(`▸ read_file("${fileName}") · ${fileType}`)
      await wait(500); if (cancelled) return

      setStageIdx(1)
      pushLog(`▸ split_text(chunk_size=1500, overlap=200)`)
      await wait(450); if (cancelled) return
      pushLog(`▸ ${totalChunks} чанков получено`)

      setStageIdx(2)
      await wait(200); if (cancelled) return
      const step = Math.max(18, Math.round(900 / totalChunks))
      for (let i = 1; i <= totalChunks; i++) {
        if (cancelled) return
        setChunkIdx(i)
        if (i % Math.max(1, Math.floor(totalChunks / 8)) === 0 || i === totalChunks) {
          const v1 = (Math.random() * 2 - 1).toFixed(3)
          const v2 = (Math.random() * 2 - 1).toFixed(3)
          pushLog(`▸ embed(chunk_${i}) → [${v1}, ${v2}, ...] × 1024`)
        }
        await wait(step)
      }
      if (cancelled) return

      setStageIdx(3)
      pushLog(`▸ upsert → pgvector (cosine)`)
      await wait(500); if (cancelled) return
      pushLog(`Готово · ${totalChunks} чанков проиндексировано`)
      setStageIdx(4)
    }
    run()
    return () => { cancelled = true; clearTimeout(timerRef.current) }
  }, [open, fileName, totalChunks, fileType])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  if (!open) return null

  if (isEmpty) {
    return (
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={onClose}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{ width: 420, maxWidth: '90vw', background: 'var(--bg-1, #0d1117)', border: '1px solid var(--border)', borderRadius: 14, padding: 30, textAlign: 'center' }}
        >
          <div style={{ color: 'var(--txt-3)', marginBottom: 14 }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto' }}>
              <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>
            </svg>
          </div>
          <div style={{ fontSize: 14, color: 'var(--txt-2)', marginBottom: 6 }}>Пока нет данных о процессе</div>
          <div style={{ fontSize: 12, color: 'var(--txt-3)', fontFamily: 'monospace' }}>Загрузите файл — и здесь появится live-визуализация индексации</div>
          <button onClick={onClose} className="btn-ghost" style={{ marginTop: 20 }}>Закрыть</button>
        </div>
      </div>
    )
  }

  const pct = stageIdx === 0 ? 12
    : stageIdx === 1 ? 30
    : stageIdx === 2 ? 35 + Math.round((chunkIdx / totalChunks) * 50)
    : stageIdx === 3 ? 92
    : 100

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: 640, maxWidth: '92vw', background: 'var(--bg-1, #0d1117)', border: '1px solid var(--border)', borderRadius: 14, padding: 26, boxShadow: '0 20px 60px rgba(0,0,0,0.55)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="fbadge" style={{ background: 'rgba(79,142,255,0.12)', border: '1px solid rgba(79,142,255,0.3)', color: '#60a5fa' }}>
              {fileType.slice(0, 4)}
            </div>
            <div>
              <div style={{ fontSize: 14, color: 'var(--txt-1)', fontWeight: 500 }}>{fileName}</div>
              <div style={{ fontSize: 11, color: 'var(--txt-3)', fontFamily: 'monospace' }}>
                {stageIdx < 4 ? `${STAGES[stageIdx].label}...` : 'готово'}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--txt-3)', cursor: 'pointer' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 22 }}>
          {STAGES.map((s, i) => (
            <React.Fragment key={s.key}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: i <= stageIdx ? 'var(--accent)' : 'var(--bg-3)',
                  boxShadow: i === stageIdx && stageIdx < 4 ? '0 0 0 4px var(--accent-dim)' : 'none',
                  transition: 'all .25s',
                }} />
                <div style={{ fontSize: 10, color: i <= stageIdx ? 'var(--accent)' : 'var(--txt-3)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{s.label}</div>
              </div>
              {i < STAGES.length - 1 && (
                <div style={{ flex: 1, height: 1, background: i < stageIdx ? 'var(--accent)' : 'var(--border)', margin: '5px 6px 0', transition: 'background .25s' }} />
              )}
            </React.Fragment>
          ))}
        </div>

        <div style={{ height: 96, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16, overflow: 'hidden', display: 'flex', alignItems: 'center', padding: '0 16px' }}>
          {stageIdx <= 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '100%' }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ height: 6, borderRadius: 3, background: 'var(--bg-3)', width: `${70 + Math.sin(i * 3) * 20}%`, opacity: stageIdx === 1 ? (i % 2 === 0 ? 0.95 : 0.4) : 0.7, transition: 'opacity .3s' }} />
              ))}
            </div>
          )}
          {stageIdx === 2 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', width: '100%', overflow: 'hidden' }}>
              {Array.from({ length: Math.min(totalChunks, 26) }).map((_, i) => {
                const shown = Math.min(totalChunks, 26)
                const active = i <= (chunkIdx / totalChunks) * shown
                return <div key={i} style={{ width: 12, height: active ? 34 : 18, borderRadius: 3, background: active ? 'var(--accent)' : 'var(--bg-3)', transition: 'all .2s', flexShrink: 0 }} />
              })}
            </div>
          )}
          {stageIdx >= 3 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(24, 1fr)', gap: 3, width: '100%' }}>
              {Array.from({ length: 96 }).map((_, i) => {
                const v = Math.sin(i * 2.3 + chunkIdx) * 0.5 + 0.5
                return <div key={i} style={{ height: 8, borderRadius: 1, background: v > 0.7 ? '#60a5fa' : v > 0.4 ? '#2563eb' : 'var(--bg-3)', opacity: 0.5 + v * 0.5 }} />
              })}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontFamily: 'monospace', fontSize: 12 }}>
            <span style={{ color: 'var(--txt-3)' }}>{stageIdx === 2 ? `чанк ${chunkIdx} / ${totalChunks}` : stageIdx < 4 ? STAGES[stageIdx].label : 'готово'}</span>
            <span style={{ color: 'var(--accent)' }}>{pct}%</span>
          </div>
          <div style={{ height: 5, background: 'var(--bg-3)', borderRadius: 3 }}>
            <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, var(--accent), #60a5fa)', borderRadius: 3, transition: 'width .2s linear' }} />
          </div>
        </div>

        <div ref={logRef} style={{ background: '#000', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', height: 120, overflowY: 'auto' }}>
          {logs.map((l, i) => (
            <div key={i} style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--txt-2)', lineHeight: 1.7, whiteSpace: 'nowrap' }}>{l}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

const LAST_OP_KEY = 'kb_last_indexing_op'

const loadLastOp = () => {
  try {
    const raw = localStorage.getItem(LAST_OP_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

const saveLastOp = (op) => {
  try { localStorage.setItem(LAST_OP_KEY, JSON.stringify(op)) } catch {}
}

export default function Documents() {
  const [indexed, setIndexed]         = useState([])
  const [queue, setQueue]             = useState([])
  const [dragging, setDragging]       = useState(false)
  const [storeInfo, setStoreInfo]     = useState(null)
  const [uploading, setUploading]     = useState(false)
  const [activePanel, setActivePanel] = useState(null)
  const [vizTarget, setVizTarget]     = useState(null)
  const [lastOp, setLastOp]           = useState(loadLastOp)
  const inputRef   = useRef(null)
  const pollTimers = useRef([])

  useEffect(() => {
    refresh()
    return () => pollTimers.current.forEach(clearInterval)
  }, [])

  useEffect(() => {
    if (!lastOp || indexed.length === 0) return
    const stillInBase = indexed.some(d => d.name === lastOp.name)
    if (!stillInBase) {
      setLastOp(null)
      try { localStorage.removeItem(LAST_OP_KEY) } catch {}
    }
  }, [indexed]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async () => {
    try {
      const [docsRes, infoRes] = await Promise.all([
        authFetch('/documents'),
        authFetch('/documents/info'),
      ])
      const docs = await docsRes.json()
      const info = await infoRes.json()
      const docsList = (docs.documents || []).map(d => ({
        id: d.filename, name: d.filename, chunks: d.chunks,
        type: d.filename.split('.').pop().toUpperCase(),
      }))
      setIndexed(docsList)
      setStoreInfo(info)
    } catch (e) {
      console.log('refresh error', e)
    }
  }

  const uploadFiles = async (files) => {
    const remaining = MAX_DOCS - indexed.length
    if (remaining <= 0) { alert(`Лимит базы знаний: ${MAX_DOCS} файлов`); return }
    const filesToUpload = Array.from(files).slice(0, remaining)
    setUploading(true)

    for (const file of filesToUpload) {
      const id   = `${file.name}-${Date.now()}-${Math.random()}`
      const type = file.name.split('.').pop().toUpperCase()
      setQueue(prev => [...prev, { id, name: file.name, type, size: file.size, status: 'uploading', error: null }])
      setVizTarget({ name: file.name, type, chunks: null, status: 'uploading' })

      try {
        if (file.size === 0) throw new Error('Файл пустой (0 байт)')

        const token = getToken()

        const blob = await upload(file.name, file, {
          access: 'public',
          handleUploadUrl: `${API}/documents/blob-upload`,
        })

        const res = await fetch(`${API}/documents/process-uploaded`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, blob_url: blob.url, token }),
        })

        if (res.status === 401) {
          redirectToLogin()
          throw new Error('Сессия истекла, нужно войти снова')
        }

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.detail || `Ошибка ${res.status}`)
        }

        const data = await res.json()

        setIndexed(prev => {
          const exists = prev.find(f => f.id === file.name)
          if (exists) return prev.map(f => f.id === file.name ? { ...f, chunks: data.chunks } : f)
          return [...prev, {
            id: file.name, name: file.name,
            chunks: data.chunks || 0,
            type: file.name.split('.').pop().toUpperCase(),
          }]
        })

        setQueue(prev => prev.map(q => q.id === id ? { ...q, status: 'done' } : q))
        setVizTarget(prev => (prev && prev.name === file.name) ? { ...prev, chunks: data.chunks || prev.chunks || 24, status: 'done' } : prev)

        const finishedOp = { name: file.name, type, chunks: data.chunks || 0, status: 'done', ts: Date.now() }
        setLastOp(finishedOp)
        saveLastOp(finishedOp)

        const t = setTimeout(() => refresh(), 2000)
        pollTimers.current.push(t)

      } catch (e) {
        console.error('Upload error:', e)
        setQueue(prev => prev.map(q => q.id === id ? { ...q, status: 'error', error: e.message } : q))
      }
    }

    setUploading(false)
  }

  const removeQueued  = (id)  => setQueue(prev => prev.filter(q => q.id !== id))
  const clearDone     = ()    => setQueue(prev => prev.filter(q => q.status !== 'done'))
  const onDrop        = (e)   => { e.preventDefault(); setDragging(false); uploadFiles(Array.from(e.dataTransfer.files)) }
  const fmtSize       = (b)   => b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`
  const togglePanel   = (key) => setActivePanel(prev => prev === key ? null : key)

  const openVizManually = () => {
    const active = queue.find(q => q.status === 'uploading')
    if (active) { setVizTarget(active); return }
    if (lastOp) { setVizTarget(lastOp); return }
    setVizTarget({ empty: true })
  }

  const removeIndexed = async (name) => {
    await authFetch(`/documents/${encodeURIComponent(name)}`, { method: 'DELETE' })
    setIndexed(prev => prev.filter(f => f.id !== name))
    await refresh()
  }

  const doneCnt   = queue.filter(q => q.status === 'done').length
  const errCnt    = queue.filter(q => q.status === 'error').length
  const activeCnt = queue.filter(q => q.status === 'uploading').length

  const totalChunks = indexed.reduce((a, f) => a + (f.chunks || 0), 0)

  const statValues = {
    docs:   indexed.length || storeInfo?.total_documents || 0,
    chunks: totalChunks || storeInfo?.total_chunks || 0,
    dim:    storeInfo?.embedding_dim || 1024,
    model:  storeInfo?.embed_model || '-',
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <style>{`
        @keyframes panelIn { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
        .dp { padding: 28px 32px; }
        .dp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
        .dp-title { font-size: 20px; font-weight: 600; color: var(--txt-1); letter-spacing: -0.4px; }
        .dp-sub { font-size: 11px; color: var(--txt-3); margin-top: 3px; font-family: monospace; }
        .dp-actions { display: flex; align-items: center; gap: 10px; }
        .btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--txt-3); padding: 8px 14px; border-radius: 8px; font-size: 12px; cursor: pointer; transition: border-color 0.15s, color 0.15s; font-family: inherit; }
        .btn-ghost:hover { border-color: var(--txt-2); color: var(--txt-2); }
        .btn-viz { background: transparent; border: 1px solid rgba(167,139,250,0.4); color: #a78bfa; padding: 9px 16px; border-radius: 9px; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 7px; transition: background 0.15s; font-weight: 500; font-family: inherit; }
        .btn-viz:hover { background: rgba(167,139,250,0.1); }
        .btn-upload { background: transparent; border: 1px solid var(--accent); color: var(--accent); padding: 9px 18px; border-radius: 9px; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 7px; transition: background 0.15s; font-weight: 500; font-family: inherit; }
        .btn-upload:hover { background: var(--accent-dim); }
        .btn-upload:disabled { opacity: 0.45; cursor: not-allowed; }
        .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 0; }
        .sc { background: var(--bg-2); border: 1px solid var(--border); border-radius: 10px; padding: 18px 20px; cursor: pointer; position: relative; overflow: hidden; transition: border-color 0.15s, background 0.15s; user-select: none; }
        .sc:hover { border-color: var(--txt-3); }
        .sc.open { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
        .sc-bar { position: absolute; top: 0; left: 0; right: 0; height: 2px; background: transparent; transition: background 0.15s; }
        .sc.active .sc-bar { background: var(--accent); }
        .sc.active { border-color: var(--accent) !important; background: var(--accent-dim); }
        .sc-val { font-size: 22px; font-weight: 500; font-family: monospace; letter-spacing: -0.5px; line-height: 1.2; }
        .sc-label { font-size: 11px; color: var(--txt-3); margin-top: 5px; text-transform: uppercase; letter-spacing: 0.8px; }
        .sc-hint { font-size: 10px; color: var(--txt-3); margin-top: 7px; font-family: monospace; transition: color 0.15s; }
        .sc.active .sc-hint { color: var(--accent); }
        .sc:hover:not(.active) .sc-hint { color: var(--txt-2); }
        .panel-wrap { grid-column: 1 / -1; background: var(--bg-2); border: 1px solid var(--border); border-top: none; border-radius: 0 0 10px 10px; padding: 20px 24px; animation: panelIn 0.18s ease; margin-bottom: 12px; }
        .drop-zone { border: 1px dashed var(--border); border-radius: 10px; padding: 38px 20px; text-align: center; cursor: pointer; transition: border-color 0.15s, background 0.15s; margin-top: 12px; margin-bottom: 20px; }
        .drop-zone:hover, .drop-zone.drag { border-color: var(--accent); background: var(--accent-dim); }
        .drop-icon { color: var(--txt-3); margin-bottom: 10px; }
        .drop-title { font-size: 14px; color: var(--txt-2); margin-bottom: 4px; }
        .drop-sub { font-size: 12px; color: var(--txt-3); }
        .section { margin-bottom: 20px; }
        .section-title { font-size: 11px; color: var(--txt-3); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; font-family: monospace; }
        .file-list { display: flex; flex-direction: column; gap: 6px; max-height: 420px; overflow-y: auto; padding-right: 4px; }
        .file-row { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: var(--bg-2); border: 1px solid var(--border); border-radius: 8px; transition: border-color 0.15s; }
        .file-row:hover { border-color: var(--txt-3); }
        .fbadge { font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px; font-family: monospace; flex-shrink: 0; letter-spacing: 0.3px; }
        .finfo { flex: 1; min-width: 0; }
        .fname { font-size: 13px; color: var(--txt-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .fmeta { font-size: 11px; color: var(--txt-3); margin-top: 2px; font-family: monospace; }
        .ferr  { font-size: 11px; color: var(--danger); margin-top: 2px; }
        .fstatus { font-size: 11px; font-family: monospace; white-space: nowrap; flex-shrink: 0; }
        .s-uploading { color: var(--accent); }
        .s-done      { color: var(--success); }
        .s-error     { color: var(--danger); }
        .fremove { background: transparent; border: none; color: var(--txt-3); cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center; flex-shrink: 0; transition: color 0.15s; }
        .fremove:hover { color: var(--txt-2); }
        .badge { font-size: 10px; padding: 2px 8px; border-radius: 4px; font-family: monospace; border: 1px solid; }
        .badge-a { background: var(--accent-dim); color: var(--accent); border-color: rgba(79,142,255,0.25); }
        .badge-e { background: rgba(248,81,73,0.08); color: var(--danger); border-color: rgba(248,81,73,0.2); }
        .badge-d { background: rgba(63,185,80,0.08); color: var(--success); border-color: rgba(63,185,80,0.2); }
        .badge-n { background: var(--accent-dim); color: var(--accent); border-color: rgba(79,142,255,0.25); }
        .empty { text-align: center; padding: 64px 20px; }
        .empty-icon { color: var(--txt-3); margin-bottom: 16px; }
        .empty-title { font-size: 15px; color: var(--txt-2); margin-bottom: 6px; }
        .empty-sub { font-size: 13px; color: var(--txt-3); }
      `}</style>

      <div className="dp">
        <div className="dp-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--accent-dim)', border: '1px solid rgba(79,142,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
              </svg>
            </div>
            <div>
              <div className="dp-title">База знаний</div>
              <div className="dp-sub">
                {storeInfo
                  ? `${indexed.length} / ${MAX_DOCS} документов · ${totalChunks} чанков · ${storeInfo.embed_model}`
                  : 'Загрузка...'}
              </div>
            </div>
          </div>
          <div className="dp-actions">
            {doneCnt > 0 && <button className="btn-ghost" onClick={clearDone}>Очистить завершённые</button>}
            <button className="btn-viz" onClick={openVizManually}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>
              </svg>
              Процесс
            </button>
            <button className="btn-upload" onClick={() => inputRef.current?.click()} disabled={uploading}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
              </svg>
              {uploading ? 'Загрузка...' : 'Загрузить файлы'}
            </button>
            <input ref={inputRef} type="file" multiple accept=".pdf,.docx,.doc,.txt,.md,.csv"
              style={{ display: 'none' }}
              onChange={e => { uploadFiles(Array.from(e.target.files)); e.target.value = '' }} />
          </div>
        </div>

        {storeInfo && (
          <div className="stats-row" style={{ gridTemplateRows: 'auto auto' }}>
            {Object.entries(PANELS).map(([key, cfg]) => (
              <div key={key} className={`sc${activePanel === key ? ' active open' : ''}`} style={{ '--accent': cfg.accent }} onClick={() => togglePanel(key)}>
                <div className="sc-bar" />
                <div className="sc-val" style={{ color: cfg.color, fontSize: key === 'model' ? 14 : 22, paddingTop: key === 'model' ? 4 : 0 }}>
                  {statValues[key] ?? '-'}
                </div>
                <div className="sc-label">{cfg.label}</div>
                <div className="sc-hint">{activePanel === key ? '▲ Свернуть' : cfg.hint}</div>
              </div>
            ))}
            {activePanel && (
              <div className="panel-wrap">
                {activePanel === 'docs'   && <DonutChart indexed={indexed} />}
                {activePanel === 'chunks' && <ChunksPanel indexed={indexed} />}
                {activePanel === 'dim'    && <VectorPanel storeInfo={storeInfo} />}
                {activePanel === 'model'  && <ModelPanel storeInfo={storeInfo} />}
              </div>
            )}
          </div>
        )}

        <div
          className={`drop-zone${dragging ? ' drag' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <div className="drop-icon">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
            </svg>
          </div>
          <div className="drop-title">Перетащите файлы или нажмите для выбора</div>
          <div className="drop-sub">PDF, DOCX, TXT · индексируются автоматически</div>
        </div>

        {queue.length > 0 && (
          <div className="section">
            <div className="section-title">
              Загрузка
              {activeCnt > 0 && <span className="badge badge-a">{activeCnt} Загружается</span>}
              {errCnt > 0    && <span className="badge badge-e">{errCnt} Ошибок</span>}
              {doneCnt > 0   && <span className="badge badge-d">{doneCnt} Готово</span>}
            </div>
            <div className="file-list">
              {queue.map(item => {
                const ts = typeStyle(item.type)
                return (
                  <div key={item.id} className="file-row">
                    <div className="fbadge" style={{ background: ts.bg, border: `1px solid ${ts.border}`, color: ts.text }}>
                      {item.type.slice(0, 4)}
                    </div>
                    <div className="finfo">
                      <div className="fname">{item.name}</div>
                      <div className="fmeta">{fmtSize(item.size)}</div>
                      {item.status === 'error' && <div className="ferr">{item.error}</div>}
                    </div>
                    <div className={`fstatus s-${item.status}`}>
                      {item.status === 'uploading' && 'Индексирование...'}
                      {item.status === 'done'      && 'Готово'}
                      {item.status === 'error'     && 'Ошибка'}
                    </div>
                    {(item.status === 'done' || item.status === 'error') && (
                      <button className="fremove" onClick={() => removeQueued(item.id)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {indexed.length > 0 && (
          <div className="section">
            <div className="section-title">
              Проиндексированные документы
              <span className="badge badge-n">{indexed.length}</span>
            </div>
            <div className="file-list">
              {indexed.map(file => {
                const ts = typeStyle(file.type)
                return (
                  <div key={file.id} className="file-row">
                    <div className="fbadge" style={{ background: ts.bg, border: `1px solid ${ts.border}`, color: ts.text }}>
                      {file.type.slice(0, 4)}
                    </div>
                    <div className="finfo">
                      <div className="fname">{file.name}</div>
                      <div className="fmeta">{file.chunks} чанков</div>
                    </div>
                    <div className="fstatus s-done">○ В базе</div>
                    <button className="fremove" onClick={() => removeIndexed(file.id)}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6L6 18M6 6l12 12"/>
                      </svg>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {indexed.length === 0 && queue.length === 0 && (
          <div className="empty">
            <div className="empty-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
              </svg>
            </div>
            <div className="empty-title">База знаний пуста</div>
            <div className="empty-sub">Загрузите PDF или DOCX, чтобы ИИ мог отвечать на вопросы</div>
          </div>
        )}
      </div>

      <IndexingModal open={!!vizTarget} onClose={() => setVizTarget(null)} target={vizTarget} />
    </div>
  )
}