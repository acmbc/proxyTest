import { consola } from 'consola'
import express from 'express'
import httpProxy from 'http-proxy'
import wisp from 'wisp-server-node'
import http from 'node:http'
import path from 'node:path'
import { build } from 'vite'
import cookieParser from 'cookie-parser'
import type { Socket } from 'node:net'

// --- CONFIG ---
const PORTS = [3003, 3004] //  add as many ports as you want

// --- INIT ---
const proxy = httpProxy.createProxyServer()
const app = express()

consola.start('Building frontend')
await build()

// --- MIDDLEWARE ---
app.use(cookieParser())

// --- USERS ---
const users: Record<string, { password: string, cookie?: string }> = {
  alice: { password: 'password123' },
  bob: { password: 'hunter2' },
  carol: { password: 'letmein' },
}

// --- AUTH ---
app.use((req, res, next) => {
  if (req.path.startsWith('/logout') || req.path.startsWith('/reset')) {
    return next()
  }

  const auth = req.headers.authorization

  //  Cookie auth
  const token = req.cookies['authToken']
  const userEntry = Object.entries(users).find(([, u]) => u.cookie === token)

  if (token && userEntry) {
    return next()
  }

  //  Basic auth fallback
  if (!auth) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Protected Site"')
    return res.status(401).send('Authentication required.')
  }

  const [scheme, encoded] = auth.split(' ')
  if (scheme !== 'Basic') return res.status(400).send('Bad request')

  const decoded = Buffer.from(encoded, 'base64').toString('utf8')
  const [username, password] = decoded.split(':')

  const user = users[username]

  if (!user || user.password !== password) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Protected Site"')
    return res.status(401).send('Authentication required.')
  }

  //  Prevent multi-device login
  if (user.cookie) {
    return res.status(403).send('This password is already in use by another device.')
  }

  //  Assign cookie
  const newToken = Math.random().toString(36).slice(2)
  user.cookie = newToken

  res.cookie('authToken', newToken, {
    httpOnly: true,
    sameSite: 'lax',
  })

  next()
})

// --- LOGOUT ---
app.get('/logout', (req, res) => {
  const token = req.cookies['authToken']

  for (const user of Object.values(users)) {
    if (user.cookie === token) {
      user.cookie = undefined
    }
  }

  res.clearCookie('authToken')
  res.send('Logged out. Password is now free.')
})

// --- RESET ---
app.get('/reset/:user', (req, res) => {
  const user = users[req.params.user]

  if (user) {
    user.cookie = undefined
    return res.send(`Reset ${req.params.user}. Password is now free.`)
  }

  res.status(404).send('User not found.')
})

// --- STATIC ---
app.use(express.static('dist'))

// --- CDN PROXY ---
app.use('/cdn', (req, res) => {
  req.url = req.url.replace(/^\/cdn/, '') //  fix path rewrite

  proxy.web(req, res, {
    target: 'https://assets.3kh0.net',
    changeOrigin: true,
  })
})

// --- SPA FALLBACK ---
app.get('*', (_req, res) => {
  res.sendFile(path.resolve('dist', 'index.html'))
})

// --- SERVER FACTORY ---
function startServer(port: number) {
  const server = http.createServer(app)

  server.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/wisp/')) {
      wisp.routeRequest(req, socket as Socket, head)
    } else {
      socket.end()
    }
  })

  server.listen(port, () => {
    consola.success(`Server running at http://localhost:${port}`)
  })
}

// --- START ALL PORTS ---
PORTS.forEach(startServer)