import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { Socket } from 'node:net'
import { consola } from 'consola'
import express from 'express'
import httpProxy from 'http-proxy'
import wisp from 'wisp-server-node'
import { build } from 'vite'

const DIST = path.resolve('dist')

// --- CONFIGURATION FOR MULTIPLE PORTS ---
interface UserData {
  password: string;
  cookie?: string;
}

interface InstanceConfig {
  port: number;
  cookieName: string;
  users: Record<string, UserData>;
}

const instances: InstanceConfig[] = [
  {
    port: 3003,
    cookieName: 'auth_3003',
    users: {
      'alice': { password: 'password123' },
    }
  },
  {
    port: 3004,
    cookieName: 'auth_3004',
    users: {
      'bob': { password: 'hunter2' },
    }
  }
]


// --- SHARED UTILS ---
function parseCookies(cookieHeader: string | undefined) {
  const cookies: Record<string, string> = {}
  if (!cookieHeader) return cookies
  cookieHeader.split(';').forEach(c => {
    const [key, ...v] = c.split('=')
    cookies[key.trim()] = decodeURIComponent(v.join('='))
  })
  return cookies
}

// --- GLOBAL BUILD (Only once) ---
if (!fs.existsSync(DIST)) {
  consola.start('Building frontend...')
  await build()
  consola.success('Build complete')
}

// --- START INSTANCES ---
instances.forEach((cfg) => {
  const app = express()
  const httpServer = http.createServer(app)
  const proxy = httpProxy.createProxyServer()
  const users = cfg.users as Record<string, { password: string, cookie?: string }>

  // 1. Auth Middleware (Instance Specific)
  app.use((req, res, next) => {
    const cookies = parseCookies(req.headers.cookie)
    const token = cookies[cfg.cookieName]
    const validUser = Object.entries(users).find(([_, u]) => u.cookie === token)

    if (token && validUser) return next()

    const authHeader = req.headers.authorization
    if (authHeader) {
      const [scheme, encoded] = authHeader.split(' ')
      if (scheme === 'Basic' && encoded) {
        const decoded = Buffer.from(encoded, 'base64').toString('utf8')
        const [user, pass] = decoded.split(':')
        const userData = users[user]
        
        if (userData && userData.password === pass && !userData.cookie) {
          const newToken = Math.random().toString(36).substring(2)
          userData.cookie = newToken
          res.setHeader('Set-Cookie', `${cfg.cookieName}=${newToken}; HttpOnly; Path=/`)
          return next()
        }
      }
    }
    res.status(401).setHeader('WWW-Authenticate', `Basic realm="Port ${cfg.port}"`).send('Auth Required')
  })

  // 2. Routes (Express 5 Regex Fixes)
  app.all(/\/cdn.*/, (req, res) => {
    req.url = req.url.replace(/^\/cdn/, '')
    proxy.web(req, res, { target: 'https://assets.3kh0.net', changeOrigin: true })
  })

  app.use(express.static(DIST))

  app.get(/^(?!\/wisp\/).*/, (_req, res) => {
    res.sendFile(path.join(DIST, 'index.html'))
  })

  // 3. WebSockets (Wisp)
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/wisp/')) {
      wisp.routeRequest(req, socket as Socket, head)
    } else {
      socket.destroy()
    }
  })

  // 4. Listen
  httpServer.listen(cfg.port, () => {
    consola.success(`Port ${cfg.port} is live with cookie '${cfg.cookieName}'`)
  })
})
