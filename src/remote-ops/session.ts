import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';

export interface SshSessionConfig {
  host: string;
  username: string;
  privateKey: string | Buffer; // contents, not a path
  port?: number;
  readyTimeoutMs?: number;
}

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface ExecStreamUntilResult {
  aborted: boolean;
  exitCode: number | null;
}

export interface SshSession {
  exec(command: string): Promise<ExecResult>;
  execStream(
    command: string,
    onLine: (stream: 'stdout' | 'stderr', line: string) => void,
  ): Promise<ExecResult>;
  /**
   * Like execStream, but runs until either the remote command exits OR
   * the provided AbortSignal fires. On abort, the remote stream is
   * signaled with TERM and ended; the returned promise resolves with
   * `{aborted: true}`. Used for indefinite-duration commands like
   * `journalctl -f` where the user terminates with Ctrl-C.
   */
  execStreamUntil(
    command: string,
    signal: AbortSignal,
    onLine: (stream: 'stdout' | 'stderr', line: string) => void,
  ): Promise<ExecStreamUntilResult>;
  uploadFile(remotePath: string, contents: Buffer | string, mode?: number): Promise<void>;
  dispose(): Promise<void>;
}

export async function createSshSession(
  config: SshSessionConfig,
  clientImpl?: Client,
): Promise<SshSession> {
  const client = clientImpl ?? new Client();
  const connectConfig: ConnectConfig = {
    host: config.host,
    port: config.port ?? 22,
    username: config.username,
    privateKey: config.privateKey,
    readyTimeout: config.readyTimeoutMs ?? 30_000,
  };

  await new Promise<void>((resolve, reject) => {
    client.on('ready', () => resolve());
    client.on('error', (err: Error) => reject(err));
    if (typeof (client as any).connect === 'function' && clientImpl === undefined) {
      client.connect(connectConfig);
    }
  });

  const exec = (command: string): Promise<ExecResult> =>
    new Promise((resolve, reject) => {
      client.exec(command, (err: Error | undefined, stream: ClientChannel) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        let exitCode: number | null = null;
        stream.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
        stream.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
        stream.on('exit', (code: number) => { exitCode = code; });
        stream.on('close', (code?: number) => {
          if (exitCode === null && code !== undefined) exitCode = code;
          resolve({ exitCode, stdout, stderr });
        });
      });
    });

  const execStream = (
    command: string,
    onLine: (stream: 'stdout' | 'stderr', line: string) => void,
  ): Promise<ExecResult> =>
    new Promise((resolve, reject) => {
      client.exec(command, (err: Error | undefined, stream: ClientChannel) => {
        if (err) return reject(err);
        let stdoutBuf = '';
        let stderrBuf = '';
        let stdoutAll = '';
        let stderrAll = '';
        let exitCode: number | null = null;

        const flush = (which: 'stdout' | 'stderr') => {
          const buf = which === 'stdout' ? stdoutBuf : stderrBuf;
          const lines = buf.split('\n');
          for (let i = 0; i < lines.length - 1; i++) onLine(which, lines[i]!);
          if (which === 'stdout') stdoutBuf = lines[lines.length - 1]!;
          else stderrBuf = lines[lines.length - 1]!;
        };

        stream.on('data', (chunk: Buffer) => {
          stdoutAll += chunk.toString();
          stdoutBuf += chunk.toString();
          flush('stdout');
        });
        stream.stderr.on('data', (chunk: Buffer) => {
          stderrAll += chunk.toString();
          stderrBuf += chunk.toString();
          flush('stderr');
        });
        stream.on('exit', (code: number) => { exitCode = code; });
        stream.on('close', () => {
          if (stdoutBuf) onLine('stdout', stdoutBuf);
          if (stderrBuf) onLine('stderr', stderrBuf);
          resolve({ exitCode, stdout: stdoutAll, stderr: stderrAll });
        });
      });
    });

  const execStreamUntil = (
    command: string,
    signal: AbortSignal,
    onLine: (stream: 'stdout' | 'stderr', line: string) => void,
  ): Promise<ExecStreamUntilResult> =>
    new Promise((resolve, reject) => {
      client.exec(command, (err: Error | undefined, stream: ClientChannel) => {
        if (err) return reject(err);
        let exitCode: number | null = null;
        let stdoutBuf = '';
        let stderrBuf = '';
        let aborted = false;

        const flush = (which: 'stdout' | 'stderr') => {
          const buf = which === 'stdout' ? stdoutBuf : stderrBuf;
          const lines = buf.split('\n');
          for (let i = 0; i < lines.length - 1; i++) onLine(which, lines[i]!);
          if (which === 'stdout') stdoutBuf = lines[lines.length - 1]!;
          else stderrBuf = lines[lines.length - 1]!;
        };

        stream.on('data', (chunk: Buffer) => {
          stdoutBuf += chunk.toString();
          flush('stdout');
        });
        stream.stderr.on('data', (chunk: Buffer) => {
          stderrBuf += chunk.toString();
          flush('stderr');
        });
        stream.on('exit', (code: number) => { exitCode = code; });
        stream.on('close', (code?: number) => {
          if (exitCode === null && code !== undefined) exitCode = code;
          if (stdoutBuf) onLine('stdout', stdoutBuf);
          if (stderrBuf) onLine('stderr', stderrBuf);
          resolve({ aborted, exitCode });
        });

        const onAbort = () => {
          aborted = true;
          try {
            stream.signal('TERM');
          } catch {
            // stream may already be closed; ignore
          }
          try {
            stream.end();
          } catch {
            // same
          }
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      });
    });

  const uploadFile = (remotePath: string, contents: Buffer | string, mode = 0o644): Promise<void> =>
    new Promise((resolve, reject) => {
      client.sftp((err: Error | undefined, sftp) => {
        if (err) return reject(err);
        const stream = sftp.createWriteStream(remotePath, { mode });
        stream.on('error', reject);
        stream.on('close', () => resolve());
        stream.end(typeof contents === 'string' ? Buffer.from(contents) : contents);
      });
    });

  const dispose = (): Promise<void> => {
    client.end();
    return Promise.resolve();
  };

  return { exec, execStream, execStreamUntil, uploadFile, dispose };
}
