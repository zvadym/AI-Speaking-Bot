export async function authTelegram(apiBase, initData) {
  const resp = await fetch(`${apiBase}/auth/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData })
  });

  if (!resp.ok) {
    const payload = await resp.json().catch(() => ({}));
    const reason = payload?.error || 'auth_failed';
    const err = new Error(reason);
    err.code = reason;
    throw err;
  }

  return await resp.json();
}

export async function apiJson(apiBase, path, { token, method = 'GET', body, query } = {}) {
  const url = new URL(`${apiBase}${path}`);
  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      url.searchParams.set(key, String(value));
    });
  }

  const resp = await fetch(url.toString(), {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  if (!resp.ok) {
    const payload = await resp.json().catch(() => ({}));
    const err = new Error(payload?.error || 'request_failed');
    err.status = resp.status;
    err.payload = payload;
    throw err;
  }

  return await resp.json();
}

