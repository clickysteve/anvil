/**
 * Versioned algorithm identifiers.
 *
 * Where ANVIL had to approximate behaviour that could not be read from documentation or
 * observed exactly, the approximation is an algorithm with a stable id. Projects store the
 * id of every algorithm they use. A later, better approximation ships under a new id
 * (".v2"), and projects saved with ".v1" keep sounding as they did.
 *
 * Evidence: DOC documented, OBS observed, INF inferred. See docs/BEHAVIOUR.md.
 */

export type Evidence = 'DOC' | 'OBS' | 'INF' | 'DOC+OBS' | 'OBS+INF' | 'DOC+INF' | 'DOC+OBS+INF';

export interface AlgorithmInfo {
  id: string;
  role: string;
  evidence: Evidence;
  summary: string;
}

/** Every algorithm id this build knows, by role. The first entry of each role is current. */
export const ALGORITHMS: AlgorithmInfo[] = [
  {
    id: 'classic.rhythm.cell.v1',
    role: 'rhythmCell',
    evidence: 'OBS+INF',
    summary:
      'Microrhythm cell builder: onset/hold/rest per microbeat with pulse-dependent rest and hold odds; accent odds per algorithm tuned to observed distributions; rest-probability mapping inferred.',
  },
  {
    id: 'classic.rhythm.secondorder.v1',
    role: 'rhythmSecondOrder',
    evidence: 'DOC+INF',
    summary: 'Second Order A/B: up to Variant distinct pulse-multiple cells strung by a cell-like higher-level pattern.',
  },
  {
    id: 'classic.rhythm.single.v1',
    role: 'rhythmSingle',
    evidence: 'OBS',
    summary: 'Single A/B: one cell of Variant x Pulse microbeats looped and truncated.',
  },
  {
    id: 'classic.rhythm.preset.v1',
    role: 'rhythmPreset',
    evidence: 'OBS+INF',
    summary: '1/1 and 3/1 Presets: base/varied cell ordering observed; varied-cell derivation inferred.',
  },
  {
    id: 'classic.pitch.v1',
    role: 'pitch',
    evidence: 'DOC+OBS',
    summary: 'Weighted degree choice within High/Low, Step/Leap rule, First Note, Pitch Loop, fallback that keeps range and weights.',
  },
  {
    id: 'classic.pitch.repeats.v1',
    role: 'pitchRepeats',
    evidence: 'DOC+INF',
    summary: 'Max Repeats as the documented limit on successive identical pitches (run length <= N). Deliberate interpretation; not a verified reproduction.',
  },
  {
    id: 'classic.variation.pitch.v1',
    role: 'variationPitch',
    evidence: 'DOC+INF',
    summary: 'Pitch variations 1-4 per documented labels; inversion pivot and pair choice inferred.',
  },
  {
    id: 'classic.variation.rhythm.v1',
    role: 'variationRhythm',
    evidence: 'DOC+INF',
    summary: 'Rhythm variations 1-5 per documented labels; cell choice inferred.',
  },
  {
    id: 'classic.scales.v1',
    role: 'scales',
    evidence: 'DOC+INF',
    summary: '38 preset scales generated as the 7-note step necklaces with steps of 1-3 semitones; ANVIL names, rotation and order.',
  },
  {
    id: 'classic.acc.rhythm.v1',
    role: 'accRhythm',
    evidence: 'DOC+OBS+INF',
    summary: 'Accompaniment rhythms 1-12 as documented/observed; lengths and velocities of rest/microbeat/pulse-triggered notes inferred.',
  },
  {
    id: 'classic.acc.divide.v1',
    role: 'accDivide',
    evidence: 'DOC+INF',
    summary: 'Divide: every nth note, half (double time), negative n = keep each note with probability 1/n (documented "about one in n").',
  },
  {
    id: 'classic.harmony.v1',
    role: 'harmony',
    evidence: 'DOC+OBS',
    summary: 'Parallel, Partial, Random harmony, Random notes, Fixed, Partial fixed as observed.',
  },
  {
    id: 'classic.harmony.inversion.v1',
    role: 'harmonyInversion',
    evidence: 'OBS',
    summary: 'Inversion: degree d -> 7*floor(d/7) + 2*(d mod 7), then Tran-1 degrees down. Observed on one theme; medium confidence.',
  },
  {
    id: 'classic.harmony.contrary.v1',
    role: 'harmonyContrary',
    evidence: 'INF',
    summary: 'Contrary motion: mirror each theme interval from the voice\'s previous pitch, folded into an octave window around the parallel pitch; state carries across passes.',
  },
  {
    id: 'classic.harmony.arpeggio.v1',
    role: 'harmonyArpeggio',
    evidence: 'OBS+INF',
    summary: 'Arpeggios over the tonic triad spanning Tran octaves; restart at each pass from the octave of the first theme note.',
  },
  {
    id: 'classic.harmony.drums.v1',
    role: 'harmonyDrums',
    evidence: 'DOC+INF',
    summary: 'Drum algorithms D1-D5 over the 7-entry drum table: random, weighted random, follow theme degree, cyclic, alternating cyclic.',
  },
  {
    id: 'classic.articulation.v1',
    role: 'articulation',
    evidence: 'OBS',
    summary: 'Eight articulations: staccato = half, legato = value-1 clock, long staccato = value-microbeat (min half), long legato = to next note.',
  },
  {
    id: 'classic.feel.v1',
    role: 'feel',
    evidence: 'INF',
    summary: 'Feel (off by default): accented/de-accented velocities move toward the base by 0-3 x floor(|Accent|/8).',
  },
];

export const CURRENT_ALGORITHMS: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const a of ALGORITHMS) if (!(a.role in out)) out[a.role] = a.id;
  return out;
})();

export function knownAlgorithm(id: string): AlgorithmInfo | undefined {
  return ALGORITHMS.find((a) => a.id === id);
}

/**
 * Bring a project's algorithm table up to date with this build: unknown ids are replaced by the
 * current id for that role (with a warning), missing roles are filled in.
 */
export function repairAlgorithms(table: unknown): { table: Record<string, string>; warnings: string[] } {
  const warnings: string[] = [];
  const src = table && typeof table === 'object' && !Array.isArray(table) ? (table as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const [role, current] of Object.entries(CURRENT_ALGORITHMS)) {
    const v = src[role];
    if (typeof v === 'string') {
      const info = knownAlgorithm(v);
      if (info && info.role === role) {
        out[role] = v;
        continue;
      }
      warnings.push(`Algorithm "${v}" is not known to this version of ANVIL; using ${current} instead.`);
    }
    out[role] = current;
  }
  return { table: out, warnings };
}
