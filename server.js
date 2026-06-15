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

async function ensureDataStore() {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.promises.access(DATA_FILE);
  } catch {
    await fs.promises.writeFile(DATA_FILE, JSON.stringify([]), 'utf8');
  }
}

async function readTodos() {
  await ensureDataStore();
  const raw = await fs.promises.readFile(DATA_FILE, 'utf8');
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writeTodos(todos) {
  await ensureDataStore();
  await fs.promises.writeFile(DATA_FILE, JSON.stringify(todos, null, 2), 'utf8');
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
    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > 1_000_000) {
      reject(new Error('Body too large'));
      return;
    }

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

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${decodeURIComponent(requestPath)}`);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let data;
  try {
    data = await fs.promises.readFile(filePath);
  } catch {
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
}

function getTodoId(pathname) {
  const todoId = pathname.split('/').pop();
  return typeof todoId === 'string' ? decodeURIComponent(todoId) : '';
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/todos') {
    sendJson(res, 200, await readTodos());
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

    const todos = await readTodos();
    const todo = {
      id: randomUUID(),
      text,
      completed: false,
      createdAt: Date.now()
    };
    todos.unshift(todo);
    await writeTodos(todos);
    broadcastTodos();
    sendJson(res, 201, todo);
    return true;
  }

  if (req.method === 'PATCH' && pathname.startsWith('/api/todos/')) {
    const todoId = getTodoId(pathname);
    if (!todoId) {
      sendJson(res, 400, { error: 'ID de tarea inválido.' });
      return true;
    }
    const body = await parseBody(req);
    const todos = await readTodos();
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

    await writeTodos(todos);
    broadcastTodos();
    sendJson(res, 200, todo);
    return true;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/todos/')) {
    const todoId = getTodoId(pathname);
    if (!todoId) {
      sendJson(res, 400, { error: 'ID de tarea inválido.' });
      return true;
    }
    const todos = await readTodos();
    const nextTodos = todos.filter((item) => item.id !== todoId);
    if (nextTodos.length === todos.length) {
      sendJson(res, 404, { error: 'Tarea no encontrada.' });
      return true;
    }

    await writeTodos(nextTodos);
    broadcastTodos();
    res.writeHead(204);
    res.end();
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

    await serveStatic(req, res);
  } catch (error) {
    console.error('Request error:', error);
    sendJson(res, 400, { error: 'Solicitud inválida.' });
  }
});

server.listen(PORT, () => {
  ensureDataStore().catch((error) => {
    console.error('Error al inicializar almacenamiento:', error);
  });
  console.log(`Servidor activo en http://localhost:${PORT}`);
});
