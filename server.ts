import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { Socket } from 'node:net'

// External dependencies (Auto-handled by npx or bun)
import { consola } from 'consola'
import express from 'express'
import httpProxy from 'http-proxy'
import wisp from 'wisp-server-node'
import { build } from 'vite'

const PORT = process.env.PORT || 3003
const DIST = path.resolve('dist')

// --- USERS (In-memory auth) ---
const users: Record<string, { password: string, cookie?: string }> = {
  'alice': { password: 'password123' },
  'bob': { password: 'hunter2' },
  'carol': { password: 'letmein' },
}

// --- UTILS ---
function parseCookies(cookieHeader: string | undefined) {
  const cookies: Record<string, string> = {}
  if (!cookieHeader) return cookies
  cookieHeader.split(';').forEach(c => {
    const [key, ...v] = c.split('=')
    cookies[key.trim()] = decodeURIComponent(v.join('='))
  })
  return cookies
}

// --- SERVER SETUP ---
const app = express()
const httpServer = http.createServer(app)
const proxy = httpProxy.createProxyServer()

// --- AUTO-BUILD FRONTEND ---
if (!fs.existsSync(DIST)) {
  consola.start('Building frontend (this might take a moment)...')
  await build()
  consola.success('Build complete')
}

// --- ROUTES: Logout & Reset (Bypass Auth) ---
app.get('/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie)
  const token = cookies['authToken']
  Object.values(users).forEach(u => {
    if (u.cookie === token) u.cookie = undefined
  })
  res.setHeader('Set-Cookie', 'authToken=; HttpOnly; Path=/; Max-Age=0')
  res.send('Logged out. Password is now free.')
})

app.get('/reset/:user', (req, res) => {
  const user = req.params.user
  if (users[user]) {
    users[user].cookie = undefined
    res.send(`Reset ${user}. Password is now free.`)
  } else {
    res.status(404).send('User not found.')
  }
})

// --- AUTH MIDDLEWARE ---
app.use((req, res, next) => {
  const cookies = parseCookies(req.headers.cookie)
  const token = cookies['authToken']
  const validUser = Object.entries(users).find(([_, u]) => u.cookie === token)

  if (token && validUser) return next()

  const authHeader = req.headers.authorization
  if (authHeader) {
    const [scheme, encoded] = authHeader.split(' ')
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8')
      const [user, pass] = decoded.split(':')
      const userData = users[user]
      
      if (userData && userData.password === pass) {
        if (userData.cookie) {
            return res.status(403).send('User already logged in elsewhere. Use /reset to clear.')
        }
        const newToken = Math.random().toString(36).substring(2)
        userData.cookie = newToken
        res.setHeader('Set-Cookie', `authToken=${newToken}; HttpOnly; Path=/`)
        return next()
      }
    }
  }

  res.status(401).setHeader('WWW-Authenticate', 'Basic realm="Secure Area"')
  res.send('Authentication required.')
})

// --- PROTECTED ROUTES ---

// Proxy /cdn -> assets.3kh0.net
app.all(/\/cdn.*/, (req, res) => {
  req.url = req.url.replace(/^\/cdn/, '') // Manual rewrite
  proxy.web(req, res, {
    target: 'https://assets.3kh0.net',
    changeOrigin: true,
  }, (err) => {
    consola.error('Proxy Error:', err)
    if (!res.headersSent) res.status(502).send('Proxy Error')
  })
})

// Static Files
app.use(express.static(DIST))

// SPA Fallback
app.get(/^(?!\/wisp\/).*/, (_req, res) => {
  res.sendFile(path.join(DIST, 'index.html'))
})

// --- WEBSOCKETS (WISP) ---
httpServer.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/wisp/')) {
    wisp.routeRequest(req, socket as Socket, head)
  } else {
    socket.destroy()
  }
})

// --- START ---
httpServer.listen(PORT, () => {
  consola.info(`🚀 Server ready at http://localhost:${PORT}`)
})
