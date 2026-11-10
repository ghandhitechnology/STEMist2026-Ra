import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const MAX_BYTES = 1_048_576;

/** Only public destinations are valid for server-side, model-selected URLs. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && c === 0))) ||
      (a === 198 && (b === 18 || b === 19)));
  }
  // Restrict IPv6 to global unicast. This also excludes mapped IPv4 addresses.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) &&
    !/^2001:(?:0:|db8:)/i.test(address) && !/^2002:/i.test(address);
}

export function validateWebUrl(raw: string): URL {
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("Use a public HTTP or HTTPS URL without embedded credentials.");
  }
  if (url.port && !['80', '443'].includes(url.port)) {
    throw new Error("Only standard HTTP and HTTPS ports are supported.");
  }
  return url;
}

async function load(url: URL, signal: AbortSignal): Promise<{
  status: number; location?: string; contentType: string; body: string; truncated: boolean;
}> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("The URL must resolve to a public internet address.");
  }
  const destination = addresses[0];
  return new Promise((resolve, reject) => {
    // Pin the checked address; a second DNS lookup could resolve somewhere else.
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      signal,
      headers: { 'User-Agent': 'RauChat/1.0', Accept: 'text/html,text/plain,application/json', 'Accept-Encoding': 'identity' },
      lookup: (_host, options, callback) => {
        if (options.all) callback(null, [destination]);
        else callback(null, destination.address, destination.family);
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      let settled = false;
      const finish = (truncated: boolean) => {
        if (settled) return;
        settled = true;
        resolve({ status: response.statusCode ?? 0,
          location: response.headers.location,
          contentType: String(response.headers['content-type'] ?? ''),
          body: Buffer.concat(chunks).toString('utf8'), truncated });
      };
      response.on('data', (chunk: Buffer) => {
        const remaining = MAX_BYTES - bytes;
        chunks.push(chunk.subarray(0, remaining));
        bytes += chunk.length;
        if (bytes >= MAX_BYTES) { finish(true); response.destroy(); }
      });
      response.on('end', () => finish(false));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

export async function webFetch(raw: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(20_000);
  const bounded = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let url = validateWebUrl(raw);
  for (let redirects = 0; redirects <= 5; redirects++) {
    bounded.throwIfAborted();
    const response = await load(url, bounded);
    if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
      url = validateWebUrl(new URL(response.location, url).href);
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`Web fetch failed (${response.status}).`);
    if (!/text\/|json|xml|xhtml/.test(response.contentType)) throw new Error("This URL does not contain a readable text document.");
    const content = /html/i.test(response.contentType) ? response.body
      .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/(p|div|h[1-6]|li|tr|section)>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim() : response.body;
    return { url: url.href, content: content.slice(0, 40_000), truncated: response.truncated || content.length > 40_000 };
  }
  throw new Error("Too many redirects.");
}
