/**
 * Seeded pseudo-random numbers. ANVIL never calls Math.random() in the engine: every random
 * decision draws from an Rng created from an explicit seed, so the same seed and the same
 * parameters always give the same music.
 *
 * Generator: sfc32 (small fast counter), seeded through splitmix32. Both are public-domain
 * textbook algorithms, implemented here from their published descriptions.
 */

/** A 32-bit unsigned seed. */
export type Seed = number;

function splitmix32(a: number): () => number {
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** Mix any number of integers or strings into one 32-bit seed (FNV-1a style, then avalanche). */
export function deriveSeed(...parts: (number | string)[]): Seed {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= n & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (n >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (n >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (n >>> 24) & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  for (const p of parts) {
    if (typeof p === 'number') mix(Math.floor(p) >>> 0);
    else for (let i = 0; i < p.length; i++) mix(p.charCodeAt(i));
    mix(0x5f); // separator so ('ab', 'c') differs from ('a', 'bc')
  }
  return splitmix32(h)() >>> 0;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  readonly seed: Seed;

  constructor(seed: Seed) {
    this.seed = seed >>> 0;
    const s = splitmix32(this.seed);
    this.a = s();
    this.b = s();
    this.c = s();
    this.d = s();
    for (let i = 0; i < 12; i++) this.u32();
  }

  /** Uniform 32-bit unsigned integer. */
  u32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.u32() / 4294967296;
  }

  /** Uniform integer in [0, n). n <= 0 gives 0. */
  int(n: number): number {
    if (n <= 1) return 0;
    return Math.floor(this.next() * n);
  }

  /** Uniform integer in [lo, hi] inclusive. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /** Index chosen in proportion to non-negative weights; -1 if all weights are zero. */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w > 0 ? w : 0;
    if (total <= 0) return -1;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] > 0 ? weights[i] : 0;
      if (r < w) return i;
      r -= w;
    }
    for (let i = weights.length - 1; i >= 0; i--) if (weights[i] > 0) return i;
    return -1;
  }

  /** A child generator with an independent stream, derived deterministically. */
  fork(label: string | number): Rng {
    return new Rng(deriveSeed(this.seed, label));
  }
}

/** A fresh seed for user-initiated generation. Only the app layer calls this. */
export function randomSeed(): Seed {
  const c = globalThis.crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0] >>> 0;
  return (Date.now() ^ (performance.now() * 1000)) >>> 0;
}
