// server.ts - Node-only, no npm needed
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
const PORT = process.env.PORT || 3003;
const DIST = path.resolve('dist');
// --- USERS (in-memory auth) ---
const users = {
    'alice': { password: 'password123' },
    'bob': { password: 'hunter2' },
    'carol': { password: 'letmein' },
};
// --- COOKIE UTIL ---
function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader)
        return cookies;
    cookieHeader.split(';').forEach(c => {
        const [key, ...v] = c.split('=');
        cookies[key.trim()] = decodeURIComponent(v.join('='));
    });
    return cookies;
}
function serializeCookie(name, value) {
    return `${name}=${encodeURIComponent(value)}; HttpOnly`;
}
// --- AUTH CHECK ---
function checkAuth(req) {
    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies['authToken'];
    const validUser = Object.entries(users).find(([_, u]) => u.cookie === cookieToken);
    if (cookieToken && validUser)
        return { valid: true, user: validUser[0] };
    const authHeader = req.headers.authorization;
    if (!authHeader)
        return { valid: false };
    const [scheme, encoded] = authHeader.split(' ');
    if (scheme !== 'Basic' || !encoded)
        return { valid: false };
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const [user, pass] = decoded.split(':');
    const userData = users[user];
    if (!userData || userData.password !== pass)
        return { valid: false };
    if (userData.cookie)
        return { valid: false }; // already in use
    // assign cookie
    const token = Math.random().toString(36).substring(2);
    userData.cookie = token;
    return { valid: true, user };
}
// --- SERVER ---
const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url ?? '/', `http://${req.headers.host}`);
    // Logout route
    if (reqUrl.pathname.startsWith('/logout')) {
        const cookies = parseCookies(req.headers.cookie);
        const token = cookies['authToken'];
        Object.values(users).forEach(u => {
            if (u.cookie === token)
                u.cookie = undefined;
        });
        res.setHeader('Set-Cookie', 'authToken=; HttpOnly; Max-Age=0');
        res.end('Logged out. Password is now free.');
        return;
    }
    // Reset route
    if (reqUrl.pathname.startsWith('/reset/')) {
        const user = reqUrl.pathname.replace('/reset/', '');
        if (users[user]) {
            users[user].cookie = undefined;
            res.end(`Reset ${user}. Password is now free.`);
        }
        else {
            res.statusCode = 404;
            res.end('User not found.');
        }
        return;
    }
    // Auth middleware
    const auth = checkAuth(req);
    if (!auth.valid) {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="Protected Site"');
        res.end('Authentication required.');
        return;
    }
    // Serve static files
    const pathname = reqUrl.pathname ?? '/';
    let filePath = path.join(DIST, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(DIST, 'index.html'); // fallback
    }
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.statusCode = 500;
            res.end('Server error');
            return;
        }
        res.end(data);
    });
});
// --- START ---
server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});
