import { createHash } from 'node:crypto';

const BASE36_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function generateBase36Hash(
  data: string | Uint8Array,
  length: number,
): string {
  const chars: string[] = [];
  let n = BigInt(`0x${createHash('sha512').update(data).digest('hex')}`);

  while (chars.length < length) {
    chars.unshift(BASE36_ALPHABET[Number(n % 36n)] ?? '');
    n /= 36n;
  }

  return chars.join('');
}
