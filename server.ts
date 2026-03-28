// server.ts - fully ready for bundling and one-click start

// --- IMPORTS ---
// @ts-ignore
import express from 'express'
// @ts-ignore
import cookieParser from 'cookie-parser'
// @ts-ignore
import httpProxy from 'http-proxy'
// @ts-ignore
import wisp from 'wisp-server-node'
// @ts-ignore
import { consola } from 'consola'
import http from 'node:http'
import path from 'node:path'
import type { Socket } from 'node:net'

// --- CONFIG ---
const PORT = process.env.PORT || 3003

// --- EXPRESS APP ---
const app = express()
const httpServer = http.createServer(app)
const proxy = httpProxy.createProxyServer()

// --- LOGGING ---
consola.start('Server starting...')

// --- COOKIE PARSER ---
app.use(cookieParser())

// --- USERS (in-memory auth) ---
const users: Record<string, { password: string, cookie?: string }> = {
  'alice': { password: 'password123' },
  'bob': { password: 'hunter2' },
  'carol': { password: 'letmein' },
}

// --- AUTH MIDDLEWARE ---
app.use((req, res, next) => {
  // Allow logout/reset routes without auth
  if (req.path.startsWith('/logout') || req.path.startsWith('/reset')) return next()

  const auth = req.headers.authorization

  // Check cookie first
  const cookieToken = req.cookies['authToken']
  const validUser = Object.values(users).find(u => u.cookie === cookieToken)
  if (cookieToken && validUser) return next()

  if (!auth) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Protected Site"')
    return res.status(401).send('Authentication required.')
  }

  const [scheme, encoded] = auth.split(' ')
  if (scheme !== 'Basic') return res.status(400).send('Bad request')

  const decoded = Buffer.from(encoded, 'base64').toString('utf8')
  const [user, pass] = decoded.split(':')

  const userData = users[user]
  if (!userData || userData.password !== pass) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Protected Site"')
    return res.status(401).send('Authentication required.')
  }

  if (userData.cookie) {
    return res.status(403).send('This password is already in use by another device.')
  }

  // Assign cookie
  const token = Math.random().toString(36).substring(2)
  userData.cookie = token

  res.cookie('authToken', token, { httpOnly: true })
  next()
})

// --- LOGOUT ROUTE ---
app.get('/logout', (req, res) => {
  const token = req.cookies['authToken']
  for (const user of Object.values(users)) {
    if (user.cookie === token) user.cookie = undefined
  }
  res.clearCookie('authToken')
  res.send('Logged out. Password is now free.')
})

// --- RESET ROUTE ---
app.get('/reset/:user', (req, res) => {
  const user = req.params.user
  if (users[user]) {
    users[user].cookie = undefined
    return res.send(`Reset ${user}. Password is now free.`)
  }
  res.status(404).send('User not found.')
})

// --- STATIC FILES ---
app.use(express.static(path.resolve('dist')))

// --- CDN PROXY ---
app.use('/cdn', (req, res) => {
  proxy.web(req, res, {
    target: 'https://assets.3kh0.net',
    changeOrigin: true,
    // @ts-ignore
    rewritePath: { '^/cdn': '' }
  })
})

// --- SPA FALLBACK ---
app.get('*', (_req, res) => {
  res.sendFile(path.resolve('dist', 'index.html'))
})

// --- WEBSOCKETS (WISP) ---
httpServer.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/wisp/')) {
    wisp.routeRequest(req, socket as Socket, head)
  } else {
    socket.end()
  }
})

// --- START SERVER ---
httpServer.listen(PORT, () => {
  consola.success(`Server listening on http://localhost:${PORT}`)
})