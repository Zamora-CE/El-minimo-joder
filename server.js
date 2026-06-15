const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'todos.json');

const clients = new Set();

function ensureDataStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([]), 'utf8');
  }
}

function readTodos() {
  ensureDataStore();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeTodos(todos) {
  ensureDataStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(todos, null, 2), 'utf8');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function sendEvent(res, type, payload) {
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcastTodos() {
  const payload = { updatedAt: Date.now() };
  for (const client of clients) {
    sendEvent(client, 'todos-updated', payload);
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const requestPath = req.url === '/' ? '/index.html' : req.url;
  const safePath = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8'
    };
    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/todos') {
    sendJson(res, 200, readTodos());
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    clients.add(res);
    sendEvent(res, 'connected', { ok: true });

    req.on('close', () => {
      clients.delete(res);
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/todos') {
    const body = await parseBody(req);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      sendJson(res, 400, { error: 'El texto es obligatorio.' });
      return true;
    }

    const todos = readTodos();
    const todo = {
      id: randomUUID(),
      text,
      completed: false,
      createdAt: Date.now()
    };
    todos.unshift(todo);
    writeTodos(todos);
    broadcastTodos();
    sendJson(res, 201, todo);
    return true;
  }

  if (req.method === 'PATCH' && pathname.startsWith('/api/todos/')) {
    const todoId = pathname.replace('/api/todos/', '');
    const body = await parseBody(req);
    const todos = readTodos();
    const todo = todos.find((item) => item.id === todoId);
    if (!todo) {
      sendJson(res, 404, { error: 'Tarea no encontrada.' });
      return true;
    }

    if (typeof body.text === 'string') {
      const cleanText = body.text.trim();
      if (!cleanText) {
        sendJson(res, 400, { error: 'El texto no puede estar vacío.' });
        return true;
      }
      todo.text = cleanText;
    }

    if (typeof body.completed === 'boolean') {
      todo.completed = body.completed;
    }

    writeTodos(todos);
    broadcastTodos();
    sendJson(res, 200, todo);
    return true;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/todos/')) {
    const todoId = pathname.replace('/api/todos/', '');
    const todos = readTodos();
    const nextTodos = todos.filter((item) => item.id !== todoId);
    if (nextTodos.length === todos.length) {
      sendJson(res, 404, { error: 'Tarea no encontrada.' });
      return true;
    }

    writeTodos(nextTodos);
    broadcastTodos();
    sendJson(res, 204, {});
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      const handled = await handleApi(req, res);
      if (!handled) {
        sendJson(res, 404, { error: 'Ruta no encontrada.' });
      }
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 400, { error: error.message || 'Solicitud inválida.' });
  }
});

server.listen(PORT, () => {
  ensureDataStore();
  console.log(`Servidor activo en http://localhost:${PORT}`);
});
