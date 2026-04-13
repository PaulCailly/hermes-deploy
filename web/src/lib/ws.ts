import { getToken } from './token';

export function createWs(path: string): WebSocket {
  const token = getToken();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL(path, `${protocol}//${window.location.host}`);
  if (token) {
    url.searchParams.set('token', token);
  }
  return new WebSocket(url.toString());
}
