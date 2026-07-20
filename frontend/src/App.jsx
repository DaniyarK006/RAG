import React, { useState, useRef, useEffect } from 'react'
import './style.css'
import Login from './Login.jsx'
import Documents from './Documents.jsx'
import NumericSearch from './NumericSearch.jsx'
import GraphView from './GraphView.jsx'
import CitableAnswer from './CitableAnswer.jsx'
import folderIcon from './assets/azure_windows_blue_folder_folder_icon_250618.png'
import chatIcon from './assets/chat-31_icon-icons.com_65948.png'
import docsIcon from './assets/search_page_document_16683.png'

const API = ''

const INDEX_TYPES = [
  { id: 'auto',    label: 'Авто',     icon: folderIcon },
  { id: 'vector',  label: 'Вектор',   icon: folderIcon },
  { id: 'tree',    label: 'Дерево',   icon: folderIcon },
  { id: 'list',    label: 'Список',   icon: folderIcon },
  { id: 'keyword', label: 'Ключевые', icon: folderIcon },
]

const WELCOME = {
  id: 0,
  sender: 'Ai',
  text: 'Привет! Я ваш локальный ИИ-ассистент.\nЗадайте вопрос по загруженным документам — найду точный ответ с источниками.',
  sources: [],
}

const DEFAULT_SETTINGS = {
  topK: 5,
  temperature: 0.1,
  chunkSize: 500,
  model: 'qwen2.5:3b',
  embedModel: 'nomic-embed-text',
  theme: 'dark',
  streamMode: false,
}

// Get stored messages or start fresh
const getStoredMessages = () => {
  try {
    const stored = localStorage.getItem('chatMessages')
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {}
  return [WELCOME]
}

// Get stored query history
const getStoredHistory = () => {
  try {
    const stored = localStorage.getItem('chatQueryHistory')
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) return parsed
    }
  } catch {}
  return []
}

// Save to localStorage helper
const saveToLS = (key, data) => {
  try { localStorage.setItem(key, JSON.stringify(data)) } catch {}
}

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 100,
    background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  panel: {
    width: 480, background: 'var(--bg-1)',
    border: '1px solid var(--border)',
    borderRadius: 16, overflow: 'hidden',
    boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(79,142,255,0.08)',
  },
  header: {
    padding: '18px 24px', borderBottom: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  headerIconBox: {
    width: 32, height: 32, borderRadius: 8,
    background: 'var(--accent-dim)', border: '1px solid rgba(79,142,255,0.25)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 14, fontWeight: 600, color: 'var(--txt-1)' },
  headerSub: { fontSize: 11, color: 'var(--txt-3)', marginTop: 1 },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--txt-3)', padding: '4px 6px', borderRadius: 6,
    transition: 'color 0.15s',
  },
  body: { padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 6 },
  sectionLabel: {
    fontSize: 10, fontWeight: 600, color: 'var(--txt-3)',
    textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 4,
  },
  divider: { height: 1, background: 'var(--border)', margin: '8px 0' },
  footer: {
    padding: '14px 24px', borderTop: '1px solid var(--border)',
    display: 'flex', justifyContent: 'flex-end', gap: 8,
  },
  cancelBtn: {
    padding: '8px 16px', background: 'transparent',
    border: '1px solid var(--border)', borderRadius: 8,
    color: 'var(--txt-2)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
    transition: 'all 0.15s',
  },
  saveBtn: {
    padding: '8px 20px', background: 'var(--accent)',
    border: 'none', borderRadius: 8, color: '#fff',
    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    boxShadow: '0 2px 10px var(--accent-glow)', transition: 'all 0.15s',
  },
  row: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', background: 'var(--bg-2)',
    border: '1px solid var(--border)', borderRadius: 8, gap: 12,
  },
  rowLabel: { fontSize: 13, color: 'var(--txt-1)', fontWeight: 500 },
  rowHint: { fontSize: 11, color: 'var(--txt-3)', marginTop: 2 },
  select: {
    background: 'var(--bg-3)', border: '1px solid var(--border)',
    borderRadius: 6, padding: '5px 10px', color: 'var(--accent)',
    fontSize: 12, fontFamily: 'monospace', cursor: 'pointer', outline: 'none',
  },
  toggleOff: {
    width: 40, height: 22, borderRadius: 11, cursor: 'pointer',
    background: 'var(--bg-3)',
    border: '1px solid var(--border)',
    position: 'relative', transition: 'background 0.2s, border-color 0.2s',
    boxShadow: 'none',
  },
  toggleOn: {
    width: 40, height: 22, borderRadius: 11, cursor: 'pointer',
    background: 'var(--accent)',
    border: '1px solid rgba(79,142,255,0.5)',
    position: 'relative', transition: 'background 0.2s, border-color 0.2s',
    boxShadow: '0 0 8px var(--accent-glow)',
  },
  toggleKnob: {
    position: 'absolute', top: 2,
    width: 16, height: 16, borderRadius: '50%',
    background: '#fff', transition: 'left 0.2s',
    boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
  },
  settingsBtnSm: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '5px 12px', background: 'var(--accent-dim)',
    border: '1px solid rgba(79,142,255,0.18)', borderRadius: 8,
    color: 'var(--accent)', fontSize: 12, cursor: 'pointer',
    fontFamily: 'inherit', transition: 'all 0.15s',
  },
  historyBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '5px', background: 'transparent',
    border: '1px solid var(--border)', borderRadius: 8,
    color: 'var(--txt-3)', cursor: 'pointer',
    fontFamily: 'inherit', transition: 'all 0.15s',
  },
}

function SettingsPanel({ settings, onChange, onClose }) {
  const [local, setLocal] = useState(settings)

  const set = (key, val) => setLocal(prev => ({ ...prev, [key]: val }))

  const save = () => { onChange(local); onClose() }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={S.panel}>
        {/* header */}
        <div style={S.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={S.headerIconBox}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4f8eff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/>
              </svg>
            </div>
            <div>
              <div style={S.headerTitle}>Настройки</div>
              <div style={S.headerSub}>DocRAG · конфигурация системы</div>
            </div>
          </div>
          <button onClick={onClose} style={S.closeBtn}
            onMouseEnter={e => e.target.style.color = 'var(--txt-1)'}
            onMouseLeave={e => e.target.style.color = 'var(--txt-3)'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* body */}
        <div style={S.body}>

          {/* section: модель */}
          <div style={S.sectionLabel}>Модель</div>

          <SettRow label="LLM модель" hint="Ollama модель для генерации ответов">
            <SettSelect value={local.model} onChange={v => set('model', v)} options={[
              'qwen2.5:3b', 'qwen2.5:7b', 'qwen2.5-coder:7b', 'llama3.2:3b', 'mistral:7b',
            ]} />
          </SettRow>

          <SettRow label="Embed модель" hint="Модель для векторных эмбеддингов">
            <SettSelect value={local.embedModel} onChange={v => set('embedModel', v)} options={[
              'bge-m3:latest', 'mxbai-embed-large', 'all-minilm',
            ]} />
          </SettRow>

          <div style={S.divider} />

          {/* section: поиск */}
          <div style={S.sectionLabel}>Поиск</div>

          <SettRow label="Top-K чанков" hint="Сколько фрагментов брать для контекста">
            <SettSlider value={local.topK} min={1} max={20} onChange={v => set('topK', v)} color="var(--accent)" />
          </SettRow>

          <SettRow label="Температура" hint="Креативность ответов (0 = точно, 1 = творчески)">
            <SettSlider value={local.temperature} min={0} max={1} step={0.05} onChange={v => set('temperature', v)} color="#34d399" fmt={v => v.toFixed(2)} />
          </SettRow>

          <SettRow label="Размер чанка" hint="Символов в одном фрагменте документа">
            <SettSlider value={local.chunkSize} min={100} max={1000} step={50} onChange={v => set('chunkSize', v)} color="#a78bfa" />
          </SettRow>

          <div style={S.divider} />

          {/* section: интерфейс */}
          <div style={S.sectionLabel}>Интерфейс</div>

          <SettRow label="Стриминг ответов" hint="Ответ появляется токен за токеном">
            <SettToggle value={local.streamMode} onChange={v => set('streamMode', v)} />
          </SettRow>

          <SettRow label="Тема оформления" hint="Светлая / тёмная тема интерфейса">
            <div className="theme-switch">
              <button
                className={`theme-switch-opt ${local.theme === 'dark' ? 'active' : ''}`}
                onClick={() => set('theme', 'dark')}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
                </svg>
                Тёмная
              </button>
              <button
                className={`theme-switch-opt ${local.theme === 'light' ? 'active' : ''}`}
                onClick={() => set('theme', 'light')}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                </svg>
                Светлая
              </button>
            </div>
          </SettRow>

        </div>

        {/* footer */}
        <div style={S.footer}>
          <button onClick={onClose} style={S.cancelBtn}
            onMouseEnter={e => { e.target.style.borderColor = 'var(--txt-2)'; e.target.style.color = 'var(--txt-1)' }}
            onMouseLeave={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--txt-2)' }}
          >Отмена</button>
          <button onClick={save} style={S.saveBtn}
            onMouseEnter={e => { e.target.style.background = '#6fa3ff'; e.target.style.transform = 'translateY(-1px)' }}
            onMouseLeave={e => { e.target.style.background = 'var(--accent)'; e.target.style.transform = 'translateY(0)' }}
          >Сохранить</button>
        </div>
      </div>
    </div>
  )
}

function SettRow({ label, hint, children }) {
  return (
    <div style={S.row}>
      <div>
        <div style={S.rowLabel}>{label}</div>
        {hint && <div style={S.rowHint}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

function SettSelect({ value, onChange, options }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={S.select}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function SettSlider({ value, min, max, step = 1, onChange, color, fmt }) {
  const display = fmt ? fmt(value) : value
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value))}
        style={{ width: 100, accentColor: color, cursor: 'pointer' }}
      />
      <span style={{ fontSize: 12, fontWeight: 600, color, fontFamily: 'monospace', minWidth: 32, textAlign: 'right' }}>{display}</span>
    </div>
  )
}

function SettToggle({ value, onChange }) {
  return (
    <div onClick={() => onChange(!value)} style={value ? S.toggleOn : S.toggleOff}>
      <div style={{ ...S.toggleKnob, left: value ? 20 : 2 }} />
    </div>
  )
}

function HistoryPanel({ history, onSelect, onClear, onClose }) {
  const formatDate = (ts) => {
    const d = new Date(ts)
    const now = new Date()
    const diff = now - d
    if (diff < 60000) return 'только что'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} мин. назад`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} ч. назад`
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ ...S.panel, width: 420, maxHeight: '70vh' }}>
        <div style={S.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={S.headerIconBox}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4f8eff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="2"/><path d="M12 2a15 15 0 000 20 15 15 0 000-20z"/>
              </svg>
            </div>
            <div>
              <div style={S.headerTitle}>История запросов</div>
              <div style={S.headerSub}>{history.length} запросов</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {history.length > 0 && (
              <button onClick={onClear} style={{
                ...S.closeBtn, fontSize: 11, padding: '4px 10px', borderRadius: 6,
                color: 'var(--txt-3)', display: 'flex', alignItems: 'center', gap: 4,
                background: 'transparent', border: '1px solid var(--border)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
                onMouseEnter={e => { e.target.style.color = 'var(--danger)'; e.target.style.borderColor = 'var(--danger)' }}
                onMouseLeave={e => { e.target.style.color = 'var(--txt-3)'; e.target.style.borderColor = 'var(--border)' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                </svg>
                Очистить
              </button>
            )}
            <button onClick={onClose} style={S.closeBtn}
              onMouseEnter={e => e.target.style.color = 'var(--txt-1)'}
              onMouseLeave={e => e.target.style.color = 'var(--txt-3)'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {history.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--txt-3)', fontSize: 13 }}>
              История запросов пуста
            </div>
          )}
          {history.map((item) => (
            <div key={item.id}
              onClick={() => { onSelect(item.text); onClose() }}
              style={{
                padding: '10px 14px', background: 'var(--bg-2)',
                border: '1px solid var(--border)', borderRadius: 10,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-dim)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-2)' }}
            >
              <div style={{ fontSize: 12, color: 'var(--txt-3)', fontFamily: 'monospace', marginBottom: 4 }}>
                {formatDate(item.timestamp)}
              </div>
              <div style={{ fontSize: 13, color: 'var(--txt-1)', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                {item.text}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function getAuthToken() {
  return localStorage.getItem('authToken') || sessionStorage.getItem('authToken') || ''
}

export default function App() {
  const [user, setUser] = useState(() => {
  const stored = localStorage.getItem('currentUser') || sessionStorage.getItem('currentUser')
  if (stored) return stored
    
    if (stored && !token) {
      localStorage.removeItem('currentUser')
      sessionStorage.removeItem('currentUser')
      return null
    }
    
    if (stored) return { username: stored, token }
    
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get('token')
    if (urlToken) {
      try {
        const payload = JSON.parse(atob(urlToken.split('.')[1]))
        const name = payload.username || payload.sub
        localStorage.setItem('currentUser', name)
        localStorage.setItem('authToken', urlToken)
        window.history.replaceState({}, document.title, window.location.pathname)
        return { username: name, token: urlToken }
      } catch {}
    }
    return null
  })

  const [messages, setMessages]   = useState(getStoredMessages)
  const [history, setHistory]     = useState(getStoredHistory)
  const [showHistory, setShowHistory] = useState(false)
  const [input, setInput]         = useState('')
  const [typing, setTyping]       = useState(false)
  const [view, setViewInternal]   = useState(() => {
    try { return localStorage.getItem('currentView') || 'chat' } catch { return 'chat' }
  })
  const [indexType, setIndexType] = useState('auto')
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('docragSettings')) || DEFAULT_SETTINGS } catch { return DEFAULT_SETTINGS }
  })
  const [backendUp, setBackendUp] = useState(null)

  const bottomRef   = useRef(null)
  const textareaRef = useRef(null)


  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme)
  }, [settings.theme])


  useEffect(() => {
    const checkBackend = async () => {
      try {
        const token = getAuthToken()
        const params = token ? `?token=${encodeURIComponent(token)}` : ''
        const res = await fetch(`${API}/documents${params}`, { signal: AbortSignal.timeout(3000) })
        if (res.ok) {
          setBackendUp(true)
          
          const storedSession = localStorage.getItem('backendSession')
          const newSession = Date.now().toString()
          if (storedSession) {
          
            localStorage.setItem('backendSession', newSession)
          } else {
            
            localStorage.setItem('backendSession', newSession)
          }
        } else {
          setBackendUp(false)
        }
      } catch {
        setBackendUp(false)
      }
    }
    checkBackend()
  }, [])

  const setView = (v) => {
    setViewInternal(v)
    try { localStorage.setItem('currentView', v) } catch {}
  }

  const saveSettings = (s) => {
    setSettings(s)
    try { localStorage.setItem('docragSettings', JSON.stringify(s)) } catch {}
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, typing])

  // Save messages to localStorage whenever they change
  useEffect(() => {
    saveToLS('chatMessages', messages)
  }, [messages])

  // Save history to localStorage
  useEffect(() => {
    saveToLS('chatQueryHistory', history)
  }, [history])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'
  }, [input])

  const logout = () => {
    localStorage.removeItem('currentUser')
    sessionStorage.removeItem('currentUser')
    localStorage.removeItem('authToken')
    sessionStorage.removeItem('authToken')
    setUser(null)
  }

  const parseApiError = async (res) => {
    try {
      const data = await res.json()
      if (typeof data.detail === 'string') return data.detail
      if (Array.isArray(data.detail)) return data.detail.map(d => d.msg || JSON.stringify(d)).join('; ')
    } catch {}
    return `Ошибка сервера (${res.status})`
  }

  const authToken = user?.token || ''

 const askAssistant = async (text) => {
  const token = localStorage.getItem('authToken') 
    || sessionStorage.getItem('authToken')
    || localStorage.getItem('currentUser')
    || sessionStorage.getItem('currentUser')
    || ''
  const url = token
    ? `${API}/documents/ask?q=${encodeURIComponent(text)}&top_k=5&token=${encodeURIComponent(token)}`
    : `${API}/documents/ask?q=${encodeURIComponent(text)}&top_k=5`
  const res = await fetch(url)
  if (!res.ok) throw new Error(await parseApiError(res))
  const data = await res.json()
  if (!data.answer) throw new Error('Сервер вернул пустой ответ.')
  return data
}

  const handleHistorySelect = (text) => {
    setInput(text)
    // Focus the textarea
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  const clearHistory = () => {
    setHistory([])
    localStorage.removeItem('chatQueryHistory')
  }

  const send = async (e) => {
    e.preventDefault()
    if (!input.trim() || typing) return
    const text = input.trim()
    
    // Add user message to current chat
    setMessages(prev => [...prev, { id: Date.now(), sender: 'user', text }])
    
    // Save to history
    const historyItem = { id: Date.now(), text, timestamp: new Date().toISOString() }
    setHistory(prev => [historyItem, ...prev])
    
    setInput('')
    setTyping(true)
    try {
      const data = await askAssistant(text)
      setMessages(prev => [...prev, {
        id: Date.now() + 1, sender: 'ai',
        text: data.answer,
        sources: (data.sources || []).map(s => `${s.filename}  chunk·${s.chunk_index}  ${s.similarity}`),
        sourceChunks: data.source_chunks || [],
        meta: { index: data.index_type, latency: data.latency_ms, cosine: data.cosine_similarity, top_k: data.top_k, temp: data.temperature },
        raw: data,
      }])
    } catch (err) {
      setMessages(prev => [...prev, {
        id: Date.now() + 1, sender: 'ai',
        text: err.message || 'Нет связи с сервером. Убедитесь, что бэкенд запущен на порту 8000.',
        sources: [],
      }])
    } finally {
      setTyping(false)
    }
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e) }
  }

  const renderIcon = (icon) => {
    if (!icon) return null
    if (typeof icon === 'string' && !icon.startsWith('/') && !icon.startsWith('data')) return <span>{icon}</span>
    return <img src={icon} width={16} height={16} alt="icon" />
  }

  if (!user) return <Login onLogin={(data) => {
  if (typeof data === 'object') {
    setUser(data.username)
  } else {
    setUser(data)
  }
}} />

  const activeIndex = INDEX_TYPES.find(t => t.id === indexType)

  return (
    <div className="app">
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={saveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showHistory && (
        <HistoryPanel
          history={history}
          onSelect={handleHistorySelect}
          onClear={clearHistory}
          onClose={() => setShowHistory(false)}
        />
      )}

      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-icon">
            <img src={folderIcon} width={20} height={20} alt="brand" />
          </div>
          <div>
            <div className="brand-name">DocRAG</div>
            <div className="brand-sub">RAG · База знаний</div>
          </div>
          {/* settings button top-right of brand */}
          <button
            onClick={() => setShowSettings(true)}
            title="Настройки"
            style={{
              marginLeft: 'auto', background: 'none', border: 'none',
              cursor: 'pointer', color: 'var(--txt-3)', padding: '4px',
              borderRadius: 6, display: 'flex', alignItems: 'center',
              transition: 'color 0.15s, background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-dim)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--txt-3)'; e.currentTarget.style.background = 'none' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/>
            </svg>
          </button>
        </div>

        <button className="new-chat-btn" onClick={() => setMessages([WELCOME])}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Новый диалог
        </button>

        <div className="sidebar-body">
          <div className="sidebar-label">Навигация</div>

          <div className={`nav-item ${view === 'chat' ? 'active' : ''}`} onClick={() => setView('chat')}>
            <span className="nav-item-icon">
              <img src={chatIcon} width={16} height={16} alt="chat" />
            </span>
            Чат
          </div>

          <div className={`nav-item ${view === 'docs' ? 'active' : ''}`} onClick={() => setView('docs')}>
            <span className="nav-item-icon">
              <img src={docsIcon} width={16} height={16} alt="documents" />
            </span>
            База знаний
          </div>

          <div className="sidebar-label" style={{ marginTop: '8px' }}>Инструменты</div>

          <div className={`nav-item nav-item-tool ${view === 'numsearch' ? 'active' : ''}`} onClick={() => setView('numsearch')}>
            <span className="nav-item-icon nav-tool-icon">#</span>
            Цифровой поиск
          </div>

          <div
            className={`nav-item ${view === 'graph' ? 'active' : ''}`}
            onClick={() => setView('graph')}
            style={view === 'graph' ? { background: 'var(--accent-dim)', color: 'var(--accent)', borderColor: 'rgba(79,142,255,0.25)' } : {}}
          >
            <span className="nav-item-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={view === 'graph' ? 'var(--accent)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/>
                <path d="M7 12h10M17 7l-8 5M17 17l-8-5"/>
              </svg>
            </span>
            Граф связей
          </div>
        </div>

        <div className="sidebar-footer">
          {/* settings row */}
          <div
            onClick={() => setShowSettings(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
              marginBottom: 6, transition: 'background 0.15s',
              border: '1px solid transparent',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-dim)'; e.currentTarget.style.borderColor = 'rgba(79,142,255,0.15)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent' }}
          >
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: 'var(--accent-dim)', border: '1px solid rgba(79,142,255,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--txt-2)', fontWeight: 500 }}>Настройки</div>
              <div style={{ fontSize: 10, color: 'var(--txt-3)', marginTop: 1 }}>{settings.model} · top-{settings.topK}</div>
            </div>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--txt-3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>

          {/* user card */}
          <div className="user-card" onClick={logout}>
            <div className="user-avatar">{user.username?.[0]?.toUpperCase()}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="user-name">{user.username}</div>
              <div className="user-role">Офлайн пользователь</div>
            </div>
            <button className="logout-btn" title="Выйти">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        {view === 'numsearch' ? <NumericSearch /> :
         view === 'docs'      ? <Documents /> :
         view === 'graph'     ? <GraphView /> : (
          <>
            <div className="topbar">
              <div className="topbar-left">
                <div className="topbar-title">
                  {renderIcon(activeIndex?.icon)}&nbsp;{activeIndex?.label}
                </div>
                <div className="index-chips">
                  {INDEX_TYPES.map(t => (
                    <button
                      key={t.id}
                      className={`index-chip ${indexType === t.id ? 'active' : ''}`}
                      onClick={() => setIndexType(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* History button */}
                <button
                  onClick={() => setShowHistory(true)}
                  title="История запросов"
                  style={S.historyBtn}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(79,142,255,0.3)'; e.currentTarget.style.color = 'var(--accent)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--txt-3)' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                  </svg>
                </button>
                <button
                  onClick={() => setShowSettings(true)}
                  style={S.settingsBtnSm}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(79,142,255,0.14)'; e.currentTarget.style.borderColor = 'rgba(79,142,255,0.3)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent-dim)'; e.currentTarget.style.borderColor = 'rgba(79,142,255,0.18)' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/>
                  </svg>
                  top-{settings.topK}
                </button>
                <div className={`status-pill ${backendUp === false ? 'offline' : ''}`}>
                  <span className={`status-dot ${backendUp === false ? 'offline' : ''}`} />
                  {backendUp === null ? '...' : backendUp ? 'Онлайн' : 'Офлайн'}
                </div>
              </div>
            </div>

            <div className="messages">
              {messages.map(msg => (
                <div key={msg.id} className={`msg-row ${msg.sender}`}>
                  <div className="msg-avatar">
                    {msg.sender === 'ai'
                      ? <img src={folderIcon} width={20} height={20} alt="AI" />
                      : user.username?.[0]?.toUpperCase()
                    }
                  </div>
                  <div className="msg-body">
                    {msg.sender === 'ai' && msg.sources && msg.sources.length > 0 ? (
                      <div className="msg-bubble" style={{ padding: '14px' }}>
                        <CitableAnswer
                          answer={msg.text}
                          sources={msg.raw?.sources || []}
                          sourceChunks={msg.sourceChunks || []}
                        />
                        {msg.meta && msg.meta.cosine != null && (
                          <div className="msg-meta" style={{ marginTop: '12px' }}>
                            <span className="meta-stat">достоверность {msg.meta.cosine}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="msg-bubble" dangerouslySetInnerHTML={{
                          __html: (msg.text || '')
                            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                            .replace(/\n/g, '<br/>')
                        }} />
                        {msg.meta && msg.meta.cosine != null && (
                          <div className="msg-meta">
                            <span className="meta-stat">достоверность {msg.meta.cosine}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}

              {typing && (
                <div className="msg-row ai">
                  <div className="msg-avatar">
                    <img src={folderIcon} width={20} height={20} alt="AI" />
                  </div>
                  <div className="typing-bubble">
                    <div className="t-dot" /><div className="t-dot" /><div className="t-dot" />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <form className="input-area" onSubmit={send}>
              <div className="input-shell">
                <textarea
                  ref={textareaRef}
                  className="chat-input"
                  placeholder="Задайте вопрос по документам... (Shift+Enter для переноса)"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={onKey}
                  rows={1}
                />
                <button className="send-btn" type="submit" disabled={!input.trim() || typing}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/>
                  </svg>
                </button>
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  )
}