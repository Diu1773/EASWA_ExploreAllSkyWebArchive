// Deep-sky object catalog: Messier + notable NGC/IC objects
// [ra_deg, dec_deg, type, size_arcmin, name, integrated_mag]

export type DsoType = 'OC' | 'GC' | 'EN' | 'PN' | 'GX' | 'SNR';

export interface Dso {
  n: string;
  r: number;   // RA degrees
  d: number;   // Dec degrees
  t: DsoType;
  s: number;   // size arcmin (major axis)
  m?: number;  // integrated magnitude
}

export const DSO_CATALOG: Dso[] = [
  // ── Globular clusters ──────────────────────────────────────────────────────
  { n: 'ωCen',   r: 201.70, d: -47.48, t: 'GC', s: 36.3, m: 3.9 }, // NGC 5139 — brightest GC
  { n: '47 Tuc', r:   6.02, d: -72.08, t: 'GC', s: 30.9, m: 4.0 }, // NGC 104
  { n: 'NGC 6752',r: 287.72, d: -59.99, t: 'GC', s: 20.4, m: 5.4 },
  { n: 'NGC 6397',r: 265.17, d: -53.67, t: 'GC', s: 25.7, m: 5.7 },
  { n: 'M4',     r: 245.90, d: -26.53, t: 'GC', s: 26.3, m: 5.6 },
  { n: 'M22',    r: 279.10, d: -23.90, t: 'GC', s: 24.0, m: 5.1 },
  { n: 'M5',     r: 229.64, d:   2.08, t: 'GC', s: 20.0, m: 5.7 },
  { n: 'M13',    r: 250.42, d:  36.46, t: 'GC', s: 20.0, m: 5.8 },
  { n: 'M3',     r: 205.55, d:  28.38, t: 'GC', s: 18.0, m: 6.2 },
  { n: 'M92',    r: 259.28, d:  43.14, t: 'GC', s: 11.2, m: 6.3 },
  { n: 'M15',    r: 322.49, d:  12.17, t: 'GC', s: 12.3, m: 6.2 },
  { n: 'M2',     r: 323.36, d:  -0.82, t: 'GC', s: 13.0, m: 6.5 },
  { n: 'M62',    r: 255.30, d: -30.11, t: 'GC', s: 14.1, m: 6.4 },
  { n: 'M80',    r: 244.26, d: -22.98, t: 'GC', s: 10.0, m: 7.3 },
  { n: 'M9',     r: 259.80, d: -18.52, t: 'GC', s:  9.3, m: 7.7 },
  { n: 'M10',    r: 254.29, d:  -4.10, t: 'GC', s: 15.1, m: 6.6 },
  { n: 'M12',    r: 251.80, d:  -1.95, t: 'GC', s: 14.5, m: 6.7 },
  { n: 'M14',    r: 267.99, d:  -3.24, t: 'GC', s: 11.7, m: 7.6 },
  { n: 'M28',    r: 276.14, d: -24.87, t: 'GC', s: 11.2, m: 6.8 },
  { n: 'NGC 362',r:  15.81, d: -70.85, t: 'GC', s: 12.9, m: 6.6 },
  { n: 'NGC 6231',r:253.57, d: -41.82, t: 'OC', s: 15.0, m: 2.6 }, // near Sco OB1

  // ── Open clusters ──────────────────────────────────────────────────────────
  { n: 'Pleiades',r:  56.75, d:  24.12, t: 'OC', s:120.0, m: 1.6 }, // M45
  { n: 'Hyades',  r:  66.75, d:  15.87, t: 'OC', s:330.0, m: 0.5 },
  { n: 'M44',     r: 130.05, d:  19.98, t: 'OC', s: 95.0, m: 3.1 }, // Beehive
  { n: 'M7',      r: 268.46, d: -34.83, t: 'OC', s: 80.0, m: 3.3 }, // Ptolemy
  { n: 'M6',      r: 265.08, d: -32.22, t: 'OC', s: 25.0, m: 4.2 }, // Butterfly OC
  { n: 'M41',     r: 101.50, d: -20.73, t: 'OC', s: 38.0, m: 4.5 },
  { n: 'M11',     r: 282.76, d:  -6.27, t: 'OC', s: 14.0, m: 5.8 }, // Wild Duck
  { n: 'M24',     r: 274.67, d: -18.41, t: 'OC', s: 90.0, m: 4.6 }, // Sgr Star Cloud
  { n: 'M25',     r: 277.47, d: -19.25, t: 'OC', s: 29.0, m: 4.6 },
  { n: 'M23',     r: 269.24, d: -18.98, t: 'OC', s: 29.0, m: 5.5 },
  { n: 'M21',     r: 274.94, d: -22.50, t: 'OC', s: 13.0, m: 5.9 },
  { n: 'M18',     r: 274.10, d: -17.13, t: 'OC', s:  9.0, m: 6.9 },
  { n: 'M48',     r: 123.43, d:  -5.78, t: 'OC', s: 54.0, m: 5.5 },
  { n: 'M47',     r: 114.07, d: -14.48, t: 'OC', s: 30.0, m: 4.4 },
  { n: 'IC 2602', r: 160.74, d: -64.40, t: 'OC', s: 50.0, m: 1.9 }, // S. Pleiades
  { n: 'IC 2391', r: 130.33, d: -53.07, t: 'OC', s: 50.0, m: 2.5 },
  { n: 'NGC 3532',r: 166.46, d: -58.75, t: 'OC', s: 55.0, m: 3.0 }, // Wishing Well
  { n: 'NGC 4755',r: 193.37, d: -60.33, t: 'OC', s: 10.0, m: 4.2 }, // Jewel Box
  { n: 'NGC 2516',r: 119.52, d: -60.75, t: 'OC', s: 30.0, m: 3.8 },
  { n: 'NGC 3114',r: 150.01, d: -60.12, t: 'OC', s: 35.0, m: 4.2 },
  { n: 'NGC 3766',r: 174.26, d: -61.61, t: 'OC', s: 12.0, m: 5.3 },

  // ── Emission / Reflection nebulae ──────────────────────────────────────────
  { n: 'M42',     r:  83.82, d:  -5.39, t: 'EN', s: 85.0, m: 4.0 }, // Orion
  { n: 'M43',     r:  83.89, d:  -5.27, t: 'EN', s: 20.0, m: 9.0 }, // De Mairan's
  { n: 'M78',     r:  86.68, d:   0.07, t: 'EN', s:  8.0, m: 8.3 },
  { n: 'M8',      r: 270.92, d: -24.38, t: 'EN', s: 90.0, m: 5.8 }, // Lagoon
  { n: 'M20',     r: 270.62, d: -23.03, t: 'EN', s: 28.0, m: 6.3 }, // Trifid
  { n: 'M17',     r: 275.20, d: -16.18, t: 'EN', s: 46.0, m: 6.0 }, // Omega/Swan
  { n: 'M16',     r: 274.70, d: -13.81, t: 'EN', s: 35.0, m: 6.0 }, // Eagle
  { n: 'Carina',  r: 161.27, d: -59.87, t: 'EN', s:120.0, m: 1.0 }, // NGC 3372 — Eta Car
  { n: 'NGC 6334',r: 260.27, d: -35.78, t: 'EN', s: 35.0          }, // Cat's Paw
  { n: 'NGC 6357',r: 262.03, d: -34.20, t: 'EN', s: 50.0          }, // War & Peace
  { n: 'Tarantula',r: 84.68, d: -69.10, t: 'EN', s: 40.0, m: 8.2 }, // NGC 2070 in LMC
  { n: 'NGC 3603',r: 168.83, d: -61.26, t: 'EN', s:  5.0, m: 9.1 },
  { n: 'NGC 6188',r: 248.62, d: -53.72, t: 'EN', s: 20.0          },
  { n: 'Rosette', r:  97.98, d:   4.93, t: 'EN', s: 80.0, m: 9.0 }, // NGC 2244+2237
  { n: 'Horsehead',r: 85.24, d:  -2.46, t: 'EN', s: 60.0          }, // IC 434
  { n: 'NGC 6188',r: 248.62, d: -53.72, t: 'EN', s: 20.0          },

  // ── Planetary nebulae ──────────────────────────────────────────────────────
  { n: 'Helix',   r: 337.41, d: -20.84, t: 'PN', s: 25.0, m: 7.3 }, // NGC 7293
  { n: 'M57',     r: 283.40, d:  33.03, t: 'PN', s:  3.8, m: 8.8 }, // Ring
  { n: 'Butterfly',r:258.85, d: -37.10, t: 'PN', s: 12.0, m: 9.7 }, // NGC 6302
  { n: 'M27',     r: 299.90, d:  22.72, t: 'PN', s:  8.0, m: 7.4 }, // Dumbbell
  { n: 'NGC 3132',r: 151.07, d: -40.44, t: 'PN', s:  1.4, m: 8.2 }, // Eight-Burst
  { n: 'NGC 6826',r: 298.17, d:  50.53, t: 'PN', s:  2.3, m: 8.8 }, // Blinking

  // ── Supernova remnants ─────────────────────────────────────────────────────
  { n: 'M1',      r:  83.63, d:  22.01, t: 'SNR', s:  7.0, m: 8.4 }, // Crab
  { n: 'Vela SNR',r: 128.75, d: -45.10, t: 'SNR', s:255.0          }, // huge

  // ── Galaxies ───────────────────────────────────────────────────────────────
  { n: 'LMC',     r:  80.89, d: -69.76, t: 'GX', s:646.0, m: 0.9 },
  { n: 'SMC',     r:  13.16, d: -72.80, t: 'GX', s:316.0, m: 2.7 },
  { n: 'M31',     r:  10.68, d:  41.27, t: 'GX', s:178.0, m: 3.4 }, // Andromeda
  { n: 'M33',     r:  23.46, d:  30.66, t: 'GX', s: 70.0, m: 5.7 }, // Triangulum
  { n: 'M32',     r:  10.67, d:  40.87, t: 'GX', s:  8.0, m: 8.7 }, // sat of M31
  { n: 'Cen A',   r: 201.37, d: -43.02, t: 'GX', s: 25.0, m: 6.8 }, // NGC 5128
  { n: 'M83',     r: 204.25, d: -29.87, t: 'GX', s: 13.0, m: 7.6 }, // S. Pinwheel
  { n: 'M104',    r: 189.99, d: -11.62, t: 'GX', s:  9.0, m: 8.0 }, // Sombrero
  { n: 'M87',     r: 187.71, d:  12.39, t: 'GX', s:  7.0, m: 8.6 }, // Virgo A
  { n: 'M84',     r: 186.27, d:  12.89, t: 'GX', s:  5.0, m: 9.1 },
  { n: 'M86',     r: 186.55, d:  12.95, t: 'GX', s:  7.0, m: 8.9 },
  { n: 'M64',     r: 194.18, d:  21.68, t: 'GX', s: 10.0, m: 8.5 }, // Black Eye
  { n: 'M65',     r: 169.73, d:  13.09, t: 'GX', s:  9.0, m: 9.3 },
  { n: 'M66',     r: 170.06, d:  12.99, t: 'GX', s:  9.0, m: 8.9 },
  { n: 'M81',     r: 148.89, d:  69.07, t: 'GX', s: 26.0, m: 6.9 }, // Bode
  { n: 'M82',     r: 148.97, d:  69.68, t: 'GX', s: 11.0, m: 8.4 }, // Cigar
  { n: 'M101',    r: 210.80, d:  54.35, t: 'GX', s: 28.0, m: 7.9 }, // Pinwheel
  { n: 'NGC 253', r:  11.89, d: -25.29, t: 'GX', s: 28.0, m: 7.1 }, // Sculptor
];

// Color per DSO type (for rendering)
export const DSO_COLOR: Record<DsoType, string> = {
  OC:  '#ffe580',  // warm yellow
  GC:  '#ffd4a0',  // orange-white
  EN:  '#a0d4ff',  // sky blue
  PN:  '#80ffee',  // cyan
  GX:  '#e0b0ff',  // lilac
  SNR: '#ff9090',  // pinkish red
};
