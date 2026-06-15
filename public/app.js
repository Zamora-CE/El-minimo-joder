const form = document.querySelector('#todo-form');
const input = document.querySelector('#todo-input');
const list = document.querySelector('#todo-list');
const statusLabel = document.querySelector('#status');

function setStatus(text) {
  statusLabel.textContent = text;
}

async function request(url, options) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Error inesperado.' }));
    throw new Error(payload.error || 'Error de conexión.');
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

function renderTodos(todos) {
  list.innerHTML = '';
  if (!todos.length) {
    const li = document.createElement('li');
    li.textContent = 'No hay tareas todavía.';
    li.className = 'status';
    list.append(li);
    return;
  }

  for (const todo of todos) {
    const item = document.createElement('li');
    item.className = `todo-item ${todo.completed ? 'done' : ''}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = todo.completed;
    checkbox.addEventListener('change', () => updateTodo(todo.id, { completed: checkbox.checked }));

    const text = document.createElement('span');
    text.className = 'todo-text';
    text.textContent = todo.text;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Eliminar';
    remove.addEventListener('click', () => deleteTodo(todo.id));

    item.append(checkbox, text, remove);
    list.append(item);
  }
}

async function loadTodos() {
  const todos = await request('/api/todos');
  renderTodos(todos);
}

async function addTodo(text) {
  await request('/api/todos', {
    method: 'POST',
    body: JSON.stringify({ text })
  });
}

async function updateTodo(id, payload) {
  await request(`/api/todos/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

async function deleteTodo(id) {
  await request(`/api/todos/${id}`, {
    method: 'DELETE'
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  try {
    await addTodo(text);
    input.value = '';
  } catch (error) {
    setStatus(error.message);
  }
});

const stream = new EventSource('/api/stream');
stream.addEventListener('connected', () => {
  setStatus('Conectado y sincronizado.');
});
stream.addEventListener('todos-updated', async () => {
  try {
    await loadTodos();
  } catch (error) {
    setStatus(error.message);
  }
});
stream.addEventListener('error', () => {
  setStatus('Reconectando al servidor...');
});

loadTodos().catch((error) => {
  setStatus(error.message);
});
