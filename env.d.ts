/// <reference types='astro/client' />

declare module 'virtual:standalone-assets' {
  export function asset(pathName: string): string;
}
