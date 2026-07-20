import React, { useState } from 'react'

const API = ''

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
)

const GitHubIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
  </svg>
)

const FacebookIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
  </svg>
)


const CB = '/auth'

const GOOGLE_URL =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: '869066366721-3sb648oo8nl8qbfb3arr7dju01s9p7op.apps.googleusercontent.com',
    redirect_uri: CB + '/google/callback',
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
  }).toString()

const GITHUB_URL =
  'https://github.com/login/oauth/authorize?' +
  new URLSearchParams({
    client_id: 'Ov23lioPKKmqpAvLrmmk',
    redirect_uri: CB + '/github/callback',
    response_type: 'code',
    scope: 'read:user user:email',
  }).toString()

const FACEBOOK_URL =
  'https://www.facebook.com/v19.0/dialog/oauth?' +
  new URLSearchParams({
    client_id: '861090523719145',
    redirect_uri: CB + '/facebook/callback',
    response_type: 'code',
    scope: 'email public_profile',
  }).toString()

export default function Login({ onLogin }) {

  const [isRegister, setIsRegister]     = useState(false)
  const [username, setUsername]         = useState('')
  const [password, setPassword]         = useState('')
  const [remember, setRemember]         = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError]               = useState('')
  const [loading, setLoading]           = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('Пароль минимум 6 символов')
      return
    }

    try {
      const endpoint = isRegister ? `${API}/auth/register` : `${API}/auth/login`
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      if (res.ok) {
        const data = await res.json()
        if (remember) {
          localStorage.setItem('authToken', data.access_token)
          localStorage.setItem('currentUser', username)
        } else {
          sessionStorage.setItem('authToken', data.access_token)
          sessionStorage.setItem('currentUser', username)
        }
        onLogin({ username, token: data.access_token })
        return
      }

      // Backend auth failed — try old localStorage fallback
      const users = JSON.parse(localStorage.getItem('users') || '{"Admin":"Admin123"}')
      const userPass = users[username]
      if (!userPass || userPass !== password) {
        setError('Неверный логин или пароль')
        return
      }

      // Existing user found in localStorage — register on backend then login
      try {
        const regRes = await fetch(`${API}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        })
        if (regRes.ok || regRes.status === 400) {
          // User now exists in DB or already exists — try login again
          const loginRes = await fetch(`${API}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
          })
          if (loginRes.ok) {
            const loginData = await loginRes.json()
            if (remember) {
              localStorage.setItem('authToken', loginData.access_token)
              localStorage.setItem('currentUser', username)
            } else {
              sessionStorage.setItem('authToken', loginData.access_token)
              sessionStorage.setItem('currentUser', username)
            }
            onLogin({ username, token: loginData.access_token })
            return
          }
        }
      } catch {}

      // Last resort — create account on backend and get token
      try {
        const regRes = await fetch(`${API}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        })
        if (regRes.ok || regRes.status === 400) {
          const loginRes = await fetch(`${API}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
          })
          if (loginRes.ok) {
            const loginData = await loginRes.json()
            if (remember) {
              localStorage.setItem('authToken', loginData.access_token)
              localStorage.setItem('currentUser', username)
            } else {
              sessionStorage.setItem('authToken', loginData.access_token)
              sessionStorage.setItem('currentUser', username)
            }
            onLogin({ username, token: loginData.access_token })
            return
          }
        }
      } catch {}

      // If we can't get a token, show error
      setError('Не удалось войти. Проверьте логин/пароль или связь с сервером.')
      return
    } catch (err) {
      setError('Нет связи с сервером. Убедитесь, что бэкенд запущен на порту 8000.')
    }
  }

  const switchMode = () => { setIsRegister(v => !v); setError('') }

  // Listen for OAuth token from popup
  React.useEffect(() => {
    const handler = (e) => {
      if (e.origin !== window.location.origin) return
      if (e.data && e.data.token) {
        setLoading(null)
        try {
          const payload = JSON.parse(atob(e.data.token.split('.')[1]))
          const name = payload.username || payload.sub
          localStorage.setItem('authToken', e.data.token)
          localStorage.setItem('currentUser', name)
          window.location.reload()
        } catch {}
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const handleOAuth = (provider, url) => {
    const w = 500, h = 600
    const left = window.screenX + (window.outerWidth - w) / 2
    const top = window.screenY + (window.outerHeight - h) / 2
    const popup = window.open(url, `oauth-${provider}`, `width=${w},height=${h},left=${left},top=${top},popup=1`)

    if (!popup) {
      window.location.href = url
      return
    }

    setLoading(provider)

    // Also fallback if popup doesn't return in reasonable time
    const checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed)
        setLoading(null)
      }
    }, 1000)
    setTimeout(() => { clearInterval(checkClosed); if (!popup.closed) popup.close(); setLoading(null) }, 60000)
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon">⬡</div>
          <div className="login-title">DocRAG</div>
          <div className="login-sub">{isRegister ? 'Создайте аккаунт' : 'Войдите в систему'}</div>
        </div>

        <form className="login-form" onSubmit={submit}>
          <div className="field-wrap">
            <label className="field-label">Логин</label>
            <input
              className="field-input"
              type="text"
              placeholder="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="field-wrap">
            <label className="field-label">Пароль</label>
            <div className="field-pw">
              <input
                className="field-input"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
              <button type="button" className="pw-toggle" onClick={() => setShowPassword(v => !v)}>
                {showPassword ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 11-4.243-4.243m4.242 4.242L9.88 9.88"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div className="remember-row" onClick={() => setRemember(v => !v)}>
            <div className={`check-box ${remember ? 'on' : ''}`} />
            <span className="remember-label">Оставаться в системе</span>
          </div>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-submit">
            {isRegister ? 'Зарегистрироваться' : 'Войти'}
          </button>
        </form>

        {!isRegister && (
          <>
            <div className="login-divider"><span>или</span></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                className="oauth-link oauth-google"
                onClick={() => handleOAuth('google', GOOGLE_URL)}
                disabled={loading === 'google'}
              >
                {loading === 'google' ? <div className="oauth-spinner" /> : <GoogleIcon />}
                Войти через Google
              </button>
              <button
                className="oauth-link oauth-github"
                onClick={() => handleOAuth('github', GITHUB_URL)}
                disabled={loading === 'github'}
              >
                {loading === 'github' ? <div className="oauth-spinner" /> : <GitHubIcon />}
                Войти через GitHub
              </button>
              <button
                className="oauth-link oauth-facebook"
                onClick={() => handleOAuth('facebook', FACEBOOK_URL)}
                disabled={loading === 'facebook'}
              >
                {loading === 'facebook' ? <div className="oauth-spinner" /> : <FacebookIcon />}
                Войти через Facebook
              </button>
            </div>
          </>
        )}

        <div className="login-switch">
          {isRegister ? 'Уже есть аккаунт?' : 'Нет аккаунта?'}
          <span onClick={switchMode}>{isRegister ? 'Войти' : 'Зарегистрироваться'}</span>
        </div>
      </div>
    </div>
  )
}