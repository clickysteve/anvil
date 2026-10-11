/** File-name helpers: short, predictable, safe on every operating system. */

/** Lower-case letters, digits and single hyphens, at most `max` characters ('' if nothing is left). */
export function slug(s: string, max = 24): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** Join name parts with underscores, dropping empty ones. */
export function fileName(parts: string[], ext: string): string {
  return `${parts.filter(Boolean).join('_')}.${ext}`;
}

/** Make names unique by appending -2, -3... before the extension. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const c = (seen.get(n) ?? 0) + 1;
    seen.set(n, c);
    if (c === 1) return n;
    const dot = n.lastIndexOf('.');
    return dot > 0 ? `${n.slice(0, dot)}-${c}${n.slice(dot)}` : `${n}-${c}`;
  });
}
