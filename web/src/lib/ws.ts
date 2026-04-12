import { getToken } from './token';

export function createWs(path: string): WebSocket {
  const token = getToken();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}${path}${token ? `?token=${token}` : ''}`;
  return new WebSocket(url);
}
