import { consola } from 'consola'
import express from 'express'
import httpProxy from 'http-proxy'
import wisp from 'wisp-server-node'
import http from 'node:http'
import path from 'node:path'
import { build } from 'vite'
import cookieParser from 'cookie-parser'
import type { Socket } from 'node:net'

const httpServer = http.createServer()
const proxy = httpProxy.createProxyServer()

const app = express()
const port = process.env.PORT || 3003

consola.start('Building frontend')
await build()

// --- COOKIE PARSER ---
app.use(cookieParser())

// --- USERS ---
const users: Record<string, { password: string, cookie?: string }> = {
  'alice': { password: 'password123' },
  'bob': { password: 'hunter2' },
  'carol': { password: 'letmein' },
}

// --- AUTH MIDDLEWARE ---
app.use((req, res, next) => {
  // Allow logout/reset routes without auth
  if (req.path.startsWith('/logout') || req.path.startsWith('/reset')) {
    return next()
  }

  const auth = req.headers.authorization

  // Check cookie first
  const cookieToken = req.cookies['authToken']
  const validUser = Object.values(users).find(u => u.cookie === cookieToken)
  if (cookieToken && validUser) {
    return next()
  }

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

  // Already in use
  if (userData.cookie) {
    return res.status(403).send('This password is already in use by another device.')
  }

  // Assign cookie
  const token = Math.random().toString(36).substring(2)
  userData.cookie = token

  res.cookie('authToken', token, { httpOnly: true })
  next()
})

// --- LOGOUT ROUTE (current device) ---
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

// --- RESET ROUTE (manual override) ---
// Example: /reset/alice
app.get('/reset/:user', (req, res) => {
  const user = req.params.user

  if (users[user]) {
    users[user].cookie = undefined
    return res.send(`Reset ${user}. Password is now free.`)
  }

  res.status(404).send('User not found.')
})

// --- STATIC FILES ---
app.use(express.static('dist'))

// --- CDN PROXY ---
app.use('/cdn', (req, res) => {
  proxy.web(req, res, {
    target: 'https://assets.3kh0.net',
    changeOrigin: true,
    // @ts-ignore
    rewritePath: {
      '^/cdn': ''
    }
  })
})

// --- SPA FALLBACK ---
app.get('*', (_req, res) => {
  res.sendFile(path.resolve('dist', 'index.html'))
})

// --- SERVER ---
httpServer.on('request', (req, res) => {
  app(req, res)
})

httpServer.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/wisp/')) {
    wisp.routeRequest(req, socket as Socket, head)
  } else {
    socket.end()
  }
})

httpServer.on('listening', () => {
  consola.info(`Listening on http://localhost:${port}`)
})

httpServer.listen({
  port
})