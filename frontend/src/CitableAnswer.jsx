import React, { useState, useEffect } from 'react'

const API = 'http://localhost:8000'

const styles = {
  container: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '20px',
    marginTop: '12px',
  },
  answerText: {
    fontSize: '14px',
    lineHeight: 1.7,
    color: 'var(--txt-1)',
  },
  sourcesPanel: {
    marginTop: '16px',
    borderTop: '1px solid var(--border)',
    paddingTop: '12px',
  },
  sourcesTitle: {
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--txt-3)',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    marginBottom: '8px',
  },
  sourceItem: {
    padding: '10px 12px',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.15s',
    border: '1px solid var(--border)',
    marginBottom: '6px',
    background: 'var(--bg-2)',
  },
  sourceItemActive: {
    padding: '10px 12px',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.15s',
    border: '1px solid var(--accent)',
    marginBottom: '6px',
    background: 'var(--accent-dim)',
  },
  sourceFilename: {
    color: '#60a5fa',
    fontSize: '13px',
    fontWeight: 500,
  },
  sourceMeta: {
    fontSize: '11px',
    color: 'var(--txt-3)',
    marginTop: '2px',
  },
  previewPanel: {
    border: '1px solid var(--border)',
    borderRadius: '10px',
    padding: '14px',
    background: 'var(--bg-2)',
    maxHeight: '500px',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  previewHeader: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--txt-1)',
    marginBottom: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  previewMeta: {
    fontSize: '11px',
    color: 'var(--txt-3)',
    marginBottom: '10px',
  },
  previewContent: {
    background: 'var(--bg-3)',
    padding: '14px',
    borderRadius: '8px',
    fontFamily: 'monospace',
    fontSize: '12px',
    lineHeight: 1.6,
    maxHeight: '320px',
    overflowY: 'auto',
    color: 'var(--txt-1)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  highlight: {
    background: '#fbbf24',
    color: '#1e1b4b',
    padding: '2px 4px',
    borderRadius: '3px',
  },
  openBtn: {
    marginTop: '12px',
    padding: '8px 16px',
    background: 'var(--accent)',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
    boxShadow: '0 2px 8px var(--accent-glow)',
  },
  noPreview: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '200px',
    color: 'var(--txt-3)',
    fontSize: '13px',
  },
  similarityBadge: {
    fontSize: '11px',
    color: 'var(--txt-3)',
    background: 'var(--bg-3)',
    padding: '2px 8px',
    borderRadius: '4px',
    display: 'inline-block',
  },
}

export default function CitableAnswer({ answer, sources, sourceChunks }) {
  const [selectedSource, setSelectedSource] = useState(null)
  const [chunkContent, setChunkContent] = useState(null)
  const [loading, setLoading] = useState(false)

  // When a source is selected, fetch its chunk content
  useEffect(() => {
    if (!selectedSource) {
      setChunkContent(null)
      return
    }

    // If we have source chunks with content, use them directly
    if (sourceChunks && Array.isArray(sourceChunks)) {
      const match = sourceChunks.find(
        sc => sc.filename === selectedSource.filename &&
              sc.similarity === selectedSource.similarity
      )
      if (match && match.content) {
        setChunkContent(match.content.slice(0, 2000))
        return
      }
    }

    // Otherwise fetch from API
    setLoading(true)
    fetch(`${API}/api/documents/view/${encodeURIComponent(selectedSource.filename)}?chunk_index=${selectedSource.chunk_index}&user_id=0`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && data.content) {
          setChunkContent(data.content.slice(0, 2000))
        } else {
          setChunkContent('(Содержимое недоступно)')
        }
      })
      .catch(() => setChunkContent('(Ошибка загрузки)'))
      .finally(() => setLoading(false))
  }, [selectedSource, sourceChunks])

  if (!sources || sources.length === 0) {
    return (
      <div style={{ ...styles.answerText, gridColumn: '1 / -1' }}>
        <p>{answer}</p>
      </div>
    )
  }

  // Create highlighted answer by marking source references
  const renderHighlightedAnswer = () => {
    let text = answer || ''
    return text.split('\n').map((line, i) => (
      <React.Fragment key={i}>
        {i > 0 && <br />}
        {line}
      </React.Fragment>
    ))
  }

  const confLevelLabel = (level) => {
    const labels = { 0: '📖 Public', 1: '🔐 Internal', 2: '🔒 Confidential', 3: '🛡️ Top Secret' }
    return labels[level] || '📖 Public'
  }

  return (
    <div>
      <div style={styles.answerText}>
        <p>{renderHighlightedAnswer()}</p>
      </div>

      <div style={styles.sourcesPanel}>
        <div style={styles.sourcesTitle}>📚 Источники ({sources.length})</div>
        {sources.map((source, idx) => (
          <div
            key={idx}
            style={selectedSource?.filename === source.filename &&
                   selectedSource?.chunk_index === source.chunk_index
                   ? styles.sourceItemActive : styles.sourceItem}
            onClick={() => setSelectedSource(source)}
            onMouseEnter={e => {
              if (selectedSource?.filename !== source.filename ||
                  selectedSource?.chunk_index !== source.chunk_index) {
                e.currentTarget.style.borderColor = 'rgba(79,142,255,0.3)'
              }
            }}
            onMouseLeave={e => {
              if (selectedSource?.filename !== source.filename ||
                  selectedSource?.chunk_index !== source.chunk_index) {
                e.currentTarget.style.borderColor = 'var(--border)'
              }
            }}
          >
            <div style={styles.sourceFilename}>
              📄 {source.filename}
            </div>
            <div style={styles.sourceMeta}>
              Чанк {source.chunk_index}
              <span style={{ marginLeft: '8px' }}>
                Совпадение {(source.similarity * 100).toFixed(0)}%
              </span>
              {source.rerank_score && (
                <span style={{ marginLeft: '8px' }}>
                  · Ранк {source.rerank_score}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Preview panel */}
      {selectedSource && (
        <div style={styles.previewPanel}>
          <div style={styles.previewHeader}>
            <span>📄 {selectedSource.filename}</span>
          </div>
          <div style={styles.previewMeta}>
            Чанк {selectedSource.chunk_index} · Совпадение {(selectedSource.similarity * 100).toFixed(0)}%
          </div>

          {loading ? (
            <div style={styles.noPreview}>Загрузка...</div>
          ) : chunkContent ? (
            <div style={styles.previewContent}>
              <mark style={styles.highlight}>
                {chunkContent}
              </mark>
            </div>
          ) : (
            <div style={styles.noPreview}>Выберите источник для просмотра</div>
          )}

          <button
            style={styles.openBtn}
            onClick={() => window.open(`${API}/api/documents/download/${encodeURIComponent(selectedSource.filename)}?user_id=0`, '_blank')}
            onMouseEnter={e => { e.target.style.background = '#6fa3ff'; e.target.style.transform = 'translateY(-1px)' }}
            onMouseLeave={e => { e.target.style.background = 'var(--accent)'; e.target.style.transform = 'translateY(0)' }}
          >
            🔗 Открыть полный файл
          </button>
        </div>
      )}
    </div>
  )
}