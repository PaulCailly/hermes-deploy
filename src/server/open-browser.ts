import { spawn } from 'node:child_process';
import { platform } from 'node:os';

export function openBrowser(url: string): void {
  const os = platform();
  let cmd: string;
  let args: string[];

  if (os === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (os === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }

  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {
    // Browser opener binary missing — silently ignore; the URL
    // is printed to the console so the user can open it manually.
  });
  child.unref();
}
