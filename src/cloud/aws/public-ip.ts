import { request } from 'node:https';

export type IpFetcher = () => Promise<string>;

const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

export async function detectPublicIp(fetcher?: IpFetcher): Promise<string> {
  const fetch = fetcher ?? defaultFetcher;
  const ip = (await fetch()).trim();
  if (!IPV4_REGEX.test(ip)) {
    throw new Error(`invalid IP returned by detector: "${ip}"`);
  }
  return `${ip}/32`;
}

const defaultFetcher: IpFetcher = () =>
  new Promise((resolve, reject) => {
    const req = request(
      { hostname: 'checkip.amazonaws.com', port: 443, method: 'GET' },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => resolve(data));
      },
    );
    req.on('error', reject);
    req.end();
  });
