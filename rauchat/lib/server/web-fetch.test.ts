import { describe, expect, it } from 'vitest';
import { isPublicAddress, validateWebUrl } from './web-fetch';

describe('web fetch destinations', () => {
  it.each(['127.0.0.1','10.1.2.3','169.254.169.254','172.16.0.1','192.168.1.2','100.64.0.1','0.0.0.0','198.18.0.1','::1','fe80::1','fc00::1','::ffff:127.0.0.1','2002:7f00:1::'])('rejects non-public %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
  it.each(['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])('accepts public %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
  it.each(['file:///etc/passwd','http://user:password@example.com','https://example.com:8080'])('rejects unsupported URL %s', (url) => {
    expect(() => validateWebUrl(url)).toThrow();
  });
});
