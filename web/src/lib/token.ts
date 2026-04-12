const TOKEN_KEY = 'hermes-deploy-token';

export function initToken(): void {
  const hash = window.location.hash;
  const match = hash.match(/^#token=([a-f0-9]+)/);
  if (match?.[1]) {
    sessionStorage.setItem(TOKEN_KEY, match[1]);
    // Strip token from URL to keep it out of history
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

export function getToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) ?? '';
}
