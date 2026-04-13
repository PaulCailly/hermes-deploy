import { getToken } from './token';

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  // Only set Content-Type when there's a body to send
  if (init?.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  // Handle 204 No Content and empty responses
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return null as T;
  }
  return res.json();
}
