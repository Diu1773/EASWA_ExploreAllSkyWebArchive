/**
 * Stellarium-style ground observer view for KMTNet.
 * Observer stands on Earth (CTIO / SAAO / SSO), looks up at the sky.
 * Horizon at bottom, zenith at top, stars in real Alt-Az positions.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Target } from '../../types/target';
import { DSO_CATALOG, DSO_COLOR } from '../../data/nebulae';

// ── Observer sites ────────────────────────────────────────────────────────────

const SITE_COORDS: Record<string, { lat: number; lon: number }> = {
  ctio: { lat: -30.17, lon: -70.81  },
  saao: { lat: -32.38, lon:  20.81  },
  sso:  { lat: -31.27, lon: 149.06  },
};

// ── Astronomy helpers ─────────────────────────────────────────────────────────

function getLST(date: Date, lonDeg: number): number {
  const JD = date.getTime() / 86_400_000 + 2_440_587.5;
  const GMST = (18.697_374_558 + 24.065_709_824_419 * (JD - 2_451_545.0)) % 24;
  return ((GMST + lonDeg / 15) % 24 + 24) % 24;
}

function raDecToAltAz(
  raDeg: number, decDeg: number,
  latDeg: number, lstH: number,
): [number, number] {
  const ha  = ((lstH * 15 - raDeg) * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const sinAlt = Math.sin(lat)*Math.sin(dec) + Math.cos(lat)*Math.cos(dec)*Math.cos(ha);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const cosAz = (Math.sin(dec) - Math.sin(alt)*Math.sin(lat)) / (Math.cos(alt)*Math.cos(lat) + 1e-12);
  const sinAz = -Math.cos(dec)*Math.sin(ha) / (Math.cos(alt) + 1e-12);
  const az = (Math.atan2(sinAz, cosAz) * 180) / Math.PI;
  return [(alt * 180) / Math.PI, (az % 360 + 360) % 360];
}

// ── Fish-eye-style azimuthal projection in Alt-Az space ───────────────────────
// Face azimuth az0, tilt altitude alt0. East at az=90 → RIGHT on screen when
// facing North (observer inside the celestial sphere).

function project(
  alt: number, az: number,
  alt0: number, az0: number,
  scale: number, cx: number, cy: number,
): [number, number] | null {
  const da  = ((az - az0) * Math.PI) / 180;
  const a   = (alt  * Math.PI) / 180;
  const a0  = (alt0 * Math.PI) / 180;
  const cosC = Math.sin(a0)*Math.sin(a) + Math.cos(a0)*Math.cos(a)*Math.cos(da);
  const c = Math.acos(Math.max(-1, Math.min(1, cosC)));
  if (c > Math.PI - 0.02) return null;
  const sinC = Math.sin(c);
  const k = sinC < 1e-6 ? 1 : c / sinC;
  const px = Math.cos(a) * Math.sin(da) * scale * k;
  const py = (Math.cos(a0)*Math.sin(a) - Math.sin(a0)*Math.cos(a)*Math.cos(da)) * scale * k;
  return [cx + px, cy - py];
}

function currentUtcMinutes() {
  const now = new Date();
  return now.getUTCHours() * 60 + now.getUTCMinutes();
}

function buildSimulationDate(utcMinutes: number) {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  now.setUTCMinutes(utcMinutes);
  return now;
}

function formatUtcClock(utcMinutes: number) {
  const hours = Math.floor(utcMinutes / 60) % 24;
  const minutes = utcMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function prepareHiDPICanvas(canvas: HTMLCanvasElement, w: number, h: number, dprOverride?: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dpr = dprOverride ?? Math.min(window.devicePixelRatio ?? 1, 2);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

// ── Procedural noise helpers (Milky Way texture) ──────────────────────────────

type AllSkyTexture = { width: number; height: number; data: Uint8ClampedArray };

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function hash2D(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise2DWrapped(x: number, y: number, periodX: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const wx0 = ((xi % periodX) + periodX) % periodX;
  const wx1 = (wx0 + 1) % periodX;
  const v00 = hash2D(wx0, yi);
  const v10 = hash2D(wx1, yi);
  const v01 = hash2D(wx0, yi + 1);
  const v11 = hash2D(wx1, yi + 1);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return (v00 * (1 - u) + v10 * u) * (1 - v) + (v01 * (1 - u) + v11 * u) * v;
}

function fbmWrapped(x: number, y: number, periodX: number, octaves: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += amp * valueNoise2DWrapped(x * freq, y * freq, periodX);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}


interface SkyGlState {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  positionBuffer: WebGLBuffer;
  texture: WebGLTexture;
  attribs: {
    position: number;
  };
  uniforms: {
    resolution: WebGLUniformLocation | null;
    center: WebGLUniformLocation | null;
    scale: WebGLUniformLocation | null;
    alt0: WebGLUniformLocation | null;
    az0: WebGLUniformLocation | null;
    lat: WebGLUniformLocation | null;
    lst: WebGLUniformLocation | null;
    textureOpacity: WebGLUniformLocation | null;
    sky: WebGLUniformLocation | null;
  };
}

const SKY_VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const SKY_FRAGMENT_SHADER = `
precision highp float;

varying vec2 v_uv;

uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_scale;
uniform float u_alt0;
uniform float u_az0;
uniform float u_lat;
uniform float u_lst;
uniform float u_textureOpacity;
uniform sampler2D u_sky;

vec3 toneMapSky(vec3 color) {
  vec3 lifted = pow(clamp(color, 0.0, 1.0), vec3(0.82)) * 1.08;
  return clamp(lifted, 0.0, 1.0);
}

vec2 unprojectAltAz(vec2 screen, out float visible) {
  float nx = (screen.x - u_center.x) / u_scale;
  float ny = (u_center.y - screen.y) / u_scale;
  float rhoSq = nx * nx + ny * ny;
  float rho = sqrt(rhoSq);
  float c = rho;

  if (c > 3.12159265) {
    visible = 0.0;
    return vec2(0.0);
  }
  if (rhoSq < 1e-12) {
    visible = 1.0;
    return vec2(u_alt0, u_az0);
  }

  float a0 = radians(u_alt0);
  float az0 = radians(u_az0);
  float sinC = sin(c);
  float cosC = cos(c);
  float alt = asin(clamp(cosC * sin(a0) + (ny * sinC * cos(a0)) / rho, -1.0, 1.0));
  float az = az0 + atan(nx * sinC, rho * cos(a0) * cosC - ny * sin(a0) * sinC);

  visible = 1.0;
  return vec2(degrees(alt), mod(degrees(az) + 360.0, 360.0));
}

vec2 altAzToRaDec(vec2 altAz) {
  float alt = radians(altAz.x);
  float az = radians(altAz.y);
  float lat = radians(u_lat);
  float sinDec = sin(alt) * sin(lat) + cos(alt) * cos(lat) * cos(az);
  float dec = asin(clamp(sinDec, -1.0, 1.0));
  float cosDec = max(cos(dec), 1e-6);
  float sinHa = -sin(az) * cos(alt) / cosDec;
  float cosHa = (sin(alt) - sin(lat) * sin(dec)) / max(cos(lat) * cosDec, 1e-6);
  float haDeg = degrees(atan(sinHa, cosHa));
  float raDeg = mod(u_lst * 15.0 - haDeg + 360.0, 360.0);
  return vec2(raDeg, degrees(dec));
}

// All-sky background colour as a function of true altitude (deg).
// Above the horizon: warm horizon haze → mid sky → deep zenith blue.
// Below the horizon: a slightly darker continuation, so the user can still
// see the Milky Way and stars there (we are an all-sky simulator, not a
// landscape view — the ground is intentionally absent).
vec3 atmosphereColor(float altDeg) {
  float t = clamp((altDeg + 90.0) / 180.0, 0.0, 1.0);   // 0 at nadir, 0.5 at horizon, 1 at zenith
  vec3 nadirDeep   = vec3(0.5, 1.5, 6.0) / 255.0;
  vec3 belowSky    = vec3(2.0, 5.0, 14.0) / 255.0;
  vec3 horizonBand = vec3(22.0, 38.0, 70.0) / 255.0;
  vec3 lowSky      = vec3(14.0, 26.0, 56.0) / 255.0;
  vec3 midSky      = vec3(6.0, 14.0, 36.0) / 255.0;
  vec3 zenithDeep  = vec3(1.0, 3.0, 12.0) / 255.0;

  if (t < 0.5) {
    // Below horizon: nadir → just under horizon
    float u = t / 0.5;
    return mix(nadirDeep, belowSky, smoothstep(0.0, 0.7, u));
  }
  // Above horizon
  float u = (t - 0.5) / 0.5;
  vec3 c = mix(horizonBand, lowSky, smoothstep(0.0, 0.10, u));
  c = mix(c, midSky, smoothstep(0.10, 0.45, u));
  c = mix(c, zenithDeep, smoothstep(0.45, 0.95, u));
  return c;
}

void main() {
  vec2 screen = vec2(v_uv.x * u_resolution.x, (1.0 - v_uv.y) * u_resolution.y);

  float visible = 0.0;
  vec2 altAz = unprojectAltAz(screen, visible);
  vec3 color;

  if (visible < 0.5) {
    color = vec3(0.002, 0.005, 0.018);
  } else {
    float alt = altAz.x;
    color = atmosphereColor(alt);

    vec2 raDec = altAzToRaDec(altAz);
    vec2 texCoord = vec2(fract(raDec.x / 360.0), clamp((90.0 - raDec.y) / 180.0, 0.0, 1.0));
    vec3 sky = toneMapSky(texture2D(u_sky, texCoord).rgb);

    // Mild atmospheric extinction: full strength well above horizon, gentle
    // dimming as we approach and cross it. Below horizon stays at ~55% so
    // the Milky Way is still clearly visible there.
    float airmass = clamp((alt + 25.0) / 45.0, 0.55, 1.0);
    sky *= airmass;
    // Slight reddening near and below horizon.
    sky.b *= mix(0.7, 1.0, airmass);
    sky.g *= mix(0.85, 1.0, airmass);

    // Additive blend keeps the Milky Way reading as light on top of sky.
    color += sky * u_textureOpacity * 0.95;
  }

  // Centred vignette — soft edge.
  float vignetteDist = distance(screen, u_center);
  float vignetteRadius = max(u_resolution.x, u_resolution.y) * 0.80;
  float vignette = smoothstep(vignetteRadius * 0.72, vignetteRadius, vignetteDist);
  color *= 1.0 - vignette * 0.16;

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

function createSkyShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create WebGL shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? 'Unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(info);
  }
  return shader;
}

function createSkyGlState(canvas: HTMLCanvasElement): SkyGlState | null {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: true, preserveDrawingBuffer: false });
  if (!gl) return null;

  const vertexShader = createSkyShader(gl, gl.VERTEX_SHADER, SKY_VERTEX_SHADER);
  const fragmentShader = createSkyShader(gl, gl.FRAGMENT_SHADER, SKY_FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create WebGL program.');
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? 'Unknown shader link error';
    gl.deleteProgram(program);
    throw new Error(info);
  }

  const positionBuffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (!positionBuffer || !texture) throw new Error('Failed to create WebGL buffers.');

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]),
    gl.STATIC_DRAW,
  );

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  return {
    gl,
    program,
    positionBuffer,
    texture,
    attribs: {
      position: gl.getAttribLocation(program, 'a_position'),
    },
    uniforms: {
      resolution: gl.getUniformLocation(program, 'u_resolution'),
      center: gl.getUniformLocation(program, 'u_center'),
      scale: gl.getUniformLocation(program, 'u_scale'),
      alt0: gl.getUniformLocation(program, 'u_alt0'),
      az0: gl.getUniformLocation(program, 'u_az0'),
      lat: gl.getUniformLocation(program, 'u_lat'),
      lst: gl.getUniformLocation(program, 'u_lst'),
      textureOpacity: gl.getUniformLocation(program, 'u_textureOpacity'),
      sky: gl.getUniformLocation(program, 'u_sky'),
    },
  };
}

function destroySkyGlState(state: SkyGlState | null) {
  if (!state) return;
  const { gl } = state;
  gl.deleteBuffer(state.positionBuffer);
  gl.deleteTexture(state.texture);
  gl.deleteProgram(state.program);
}


const EQ_TO_GAL = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
] as const;

function equatorialToGalactic(raDeg: number, decDeg: number): [number, number] {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const ex = Math.cos(dec) * Math.cos(ra);
  const ey = Math.cos(dec) * Math.sin(ra);
  const ez = Math.sin(dec);
  const gx = EQ_TO_GAL[0][0] * ex + EQ_TO_GAL[0][1] * ey + EQ_TO_GAL[0][2] * ez;
  const gy = EQ_TO_GAL[1][0] * ex + EQ_TO_GAL[1][1] * ey + EQ_TO_GAL[1][2] * ez;
  const gz = EQ_TO_GAL[2][0] * ex + EQ_TO_GAL[2][1] * ey + EQ_TO_GAL[2][2] * ez;
  let l = (Math.atan2(gy, gx) * 180) / Math.PI;
  if (l < 0) l += 360;
  const b = (Math.asin(Math.max(-1, Math.min(1, gz))) * 180) / Math.PI;
  return [l, b];
}


function galacticAngularDistance(lDeg: number, bDeg: number, l0Deg: number, b0Deg: number) {
  const l = (lDeg * Math.PI) / 180;
  const b = (bDeg * Math.PI) / 180;
  const l0 = (l0Deg * Math.PI) / 180;
  const b0 = (b0Deg * Math.PI) / 180;
  const cosD = Math.sin(b) * Math.sin(b0) + Math.cos(b) * Math.cos(b0) * Math.cos(l - l0);
  return (Math.acos(Math.max(-1, Math.min(1, cosD))) * 180) / Math.PI;
}

let proceduralSkyTexturePromise: Promise<AllSkyTexture> | null = null;

function buildProceduralSkyTexture(): Promise<AllSkyTexture> {
  if (proceduralSkyTexturePromise) return proceduralSkyTexturePromise;

  proceduralSkyTexturePromise = Promise.resolve().then(() => {
    const width = 1280;
    const height = 640;
    const data = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y += 1) {
      const dec = 90 - ((y + 0.5) / height) * 180;
      const vRow = (dec + 90) / 180;

      for (let x = 0; x < width; x += 1) {
        const ra = ((x + 0.5) / width) * 360;
        const [l, b] = equatorialToGalactic(ra, dec);
        const lNorm = l / 360;
        const bAbs = Math.abs(b);

        // Disk components ------------------------------------------------------
        const thinDisk = Math.exp(-Math.pow(bAbs / 4.5, 1.55));   // dense star sheet
        const widePlane = Math.exp(-Math.pow(bAbs / 17, 1.10));   // halo / thick
        const haloFade = Math.exp(-Math.pow(bAbs / 32, 1.0));     // very thin halo

        // Bulge (Sagittarius region toward the Galactic Centre) ---------------
        const dGC = galacticAngularDistance(l, b, 0, 0);
        const bulge = Math.exp(-Math.pow(dGC / 11, 1.7));
        const bulgeWide = Math.exp(-Math.pow(dGC / 24, 1.25));

        // Star clouds ---------------------------------------------------------
        const sgrCloud = Math.exp(-Math.pow(galacticAngularDistance(l, b, 7, -3) / 8.5, 1.7));
        const scutumCloud = Math.exp(-Math.pow(galacticAngularDistance(l, b, 27, -1) / 10, 1.6));
        const cygnusCloud = Math.exp(-Math.pow(galacticAngularDistance(l, b, 78, 1) / 16, 1.5));
        const carinaCloud = Math.exp(-Math.pow(galacticAngularDistance(l, b, 287, -1) / 16, 1.5));
        const normaCloud = Math.exp(-Math.pow(galacticAngularDistance(l, b, 328, 0) / 11, 1.6));
        const cassClumps = Math.exp(-Math.pow(galacticAngularDistance(l, b, 120, 0) / 18, 1.6));

        // Procedural fluctuations ---------------------------------------------
        const clumps = fbmWrapped(lNorm * 9, vRow * 7, 360, 4);
        const filaments = fbmWrapped(lNorm * 22 + 7.1, vRow * 12 + 3.8, 360, 3);
        const fineGrain = fbmWrapped(lNorm * 48 + 11.5, vRow * 28 + 5.5, 360, 3);

        // Dark dust lanes ------------------------------------------------------
        // Great Rift: dark band offset slightly south of plane (b ≈ -1)
        const greatRift = Math.exp(-Math.pow((b + 1.0) / 1.7, 2))
                        * Math.exp(-Math.pow(bAbs / 14, 1.2))
                        * smoothstep(360, 280, l) * smoothstep(0, 70, l) * 0.0  // disabled portion
                        + Math.exp(-Math.pow((b + 1.0) / 1.7, 2))
                          * Math.exp(-Math.pow(bAbs / 14, 1.2));
        // Cygnus rift centred near l~50, splits the Milky Way through Cygnus
        const cygnusRift = Math.exp(-Math.pow(galacticAngularDistance(l, b, 50, 0) / 16, 1.5))
                         * Math.exp(-Math.pow((b + 0.4) / 2.4, 2));
        // Coalsack near Crux (l~303, b~0) — a very dark patch
        const coalsack = Math.exp(-Math.pow(galacticAngularDistance(l, b, 303, 0) / 4.5, 2));
        // Aquila/Pipe/Ophiuchus complex (~l 28..36, b +3..+6)
        const aquilaRift = Math.exp(-Math.pow(galacticAngularDistance(l, b, 32, 4) / 6.5, 1.6));
        // Procedural broken dust (mottled along plane)
        const dustNoise = fbmWrapped(lNorm * 14 + 19, vRow * 16 + 6, 360, 4);
        const dustMottle = smoothstep(0.40, 0.78, dustNoise) * Math.pow(thinDisk, 0.9);

        const totalDust =
          greatRift * 0.78 +
          cygnusRift * 0.55 +
          coalsack * 1.10 +
          aquilaRift * 0.45 +
          dustMottle * 0.45;

        // Sparkle (very subtle — bright stars are drawn separately)
        const sparkle = Math.pow(hash2D(x, y), 38) * (0.005 + 0.02 * widePlane);

        // Luminance ------------------------------------------------------------
        let luminance =
          0.012 +
          0.030 * haloFade +
          0.085 * widePlane +
          0.34 * thinDisk * (0.55 + 0.45 * clumps) +
          0.46 * bulge * (0.72 + 0.28 * filaments) +
          0.20 * bulgeWide +
          0.18 * sgrCloud * (0.7 + 0.3 * fineGrain) +
          0.13 * scutumCloud +
          0.16 * cygnusCloud * (0.7 + 0.3 * fineGrain) +
          0.14 * carinaCloud +
          0.10 * normaCloud +
          0.05 * cassClumps +
          sparkle;

        // Multiplicative dust extinction
        luminance *= Math.max(0.04, 1 - 0.85 * totalDust);
        luminance = Math.max(0, Math.min(1, luminance));

        // Color: warm bulge/clouds (K/M giants), cool blue arms (OB associations)
        const warmth =
          bulge * 0.95 +
          bulgeWide * 0.45 +
          sgrCloud * 0.55 +
          scutumCloud * 0.30 +
          carinaCloud * 0.30 +
          normaCloud * 0.25;
        const coolness =
          cygnusCloud * 0.45 +
          cassClumps * 0.18 +
          (1 - smoothstep(40, 200, Math.abs(l - 180))) * 0.05;

        const baseR = 0.66 + 0.40 * warmth - 0.10 * coolness;
        const baseG = 0.74 + 0.20 * warmth - 0.02 * coolness;
        const baseB = 0.94 - 0.22 * warmth + 0.22 * coolness;

        // Pedestal sky (very dim deep blue so even off-plane has tint)
        const pedR = 5;
        const pedG = 8;
        const pedB = 16;

        const lumScaled = Math.pow(luminance, 0.88) * 340;

        const r = Math.max(0, Math.min(255, pedR + lumScaled * baseR));
        const g = Math.max(0, Math.min(255, pedG + lumScaled * baseG));
        const bCh = Math.max(0, Math.min(255, pedB + lumScaled * baseB));

        const idx = (y * width + x) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = bCh;
        data[idx + 3] = 255;
      }
    }

    return { width, height, data };
  });

  return proceduralSkyTexturePromise;
}

// Star catalog: [ra_deg, dec_deg, magnitude, B-V_color_index]
// Loaded async from HYG v3.8 (real Hipparcos/Yale/Gliese data, mag < 7.5)
type StarRow = [number, number, number, number];

function ciToColor(ci: number): string {
  if (ci < -0.1) return '#b8d4ff';       // O/B — blue
  if (ci <  0.3) return '#e8eeff';       // A/F — blue-white
  if (ci <  0.6) return '#fff7e8';       // G   — white-yellow
  if (ci <  1.0) return '#ffd490';       // K   — orange
  return '#ff9868';                       // M   — red-orange
}

function magToRadius(mag: number, scaleFactor: number): number {
  // Apparent size: brighter → larger dot
  const base = mag < 1 ? 3.2 : mag < 2 ? 2.5 : mag < 3 ? 2.0
             : mag < 4 ? 1.55 : mag < 5 ? 1.2 : mag < 6 ? 0.85
             : mag < 7 ? 0.6 : 0.45;
  return base * Math.min(1.4, scaleFactor / 220);
}

function magToAlpha(mag: number): number {
  if (mag < 1) return 1.0;
  if (mag < 2) return 0.95;
  if (mag < 3) return 0.88;
  if (mag < 4) return 0.80;
  if (mag < 5) return 0.70;
  if (mag < 6) return 0.58;
  if (mag < 7) return 0.45;
  return 0.30;
}

// Galactic plane path in RA/Dec
const GAL_RA_DEC: [number, number][] = (() => {
  const G2E = [
    [-0.0548755604, 0.4941094279, -0.8676661490],
    [-0.8734370902, -0.4448296300, -0.1980763734],
    [-0.4838350155, 0.7469822445, 0.4559837762],
  ];
  return Array.from({ length: 720 }, (_, i) => {
    const l = i * 0.5;
    const lr = (l * Math.PI)/180;
    const gx = Math.cos(lr), gy = Math.sin(lr), gz = 0;
    const ex = G2E[0][0]*gx+G2E[0][1]*gy+G2E[0][2]*gz;
    const ey = G2E[1][0]*gx+G2E[1][1]*gy+G2E[1][2]*gz;
    const ez = G2E[2][0]*gx+G2E[2][1]*gy+G2E[2][2]*gz;
    let ra = (Math.atan2(ey, ex)*180)/Math.PI; if (ra < 0) ra += 360;
    const dec = (Math.asin(Math.max(-1, Math.min(1, ez)))*180)/Math.PI;
    return [ra, dec] as [number, number];
  });
})();

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<string, string> = { 'ML': '#60a5fa', 'ML-HM': '#fb923c', 'ML-P': '#4ade80' };
const TYPE_LABEL: Record<string, string> = { 'ML': 'ML 단일 렌즈', 'ML-HM': 'ML-HM 고증폭', 'ML-P': 'ML-P 행성' };

const SITE_WINDOWS: Record<string, { label: string; start: number; end: number; color: string }> = {
  ctio: { label: 'CTIO (칠레)',       start: 0,  end: 8,  color: '#fb923c' },
  saao: { label: 'SAAO (남아프리카)', start: 18, end: 26, color: '#60a5fa' },
  sso:  { label: 'SSO (호주)',        start: 10, end: 18, color: '#4ade80' },
};

const COMPASS = [
  { az: 0,   label: 'N' },
  { az: 90,  label: 'E' },
  { az: 180, label: 'S' },
  { az: 270, label: 'W' },
];

const DEFAULT_FOV = 84;
const SKY_VIEW_CENTER_Y = 0.66;
// Mode-dependent vertical tilt limits:
// - Ground mode (default): you're standing on Earth, so tilting below the
//   horizon is not allowed. Keep ~5° margin so the horizon stays in view.
// - Open-sky mode: free to look around the full celestial sphere.
const MIN_VIEW_ALT_GROUND = 5;
const MIN_VIEW_ALT_OPEN = -45;
const MAX_VIEW_ALT = 89;
const INITIAL_VIEW_ALT = 80;

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  events: Target[];
  siteId: string;
  selectedEvent: Target | null;
  focusTarget: Target | null;
  onEventClick: (e: Target) => void;
}

export function KmtnetSkyMap({ events, siteId, selectedEvent, focusTarget, onEventClick }: Props) {
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Real star catalog (HYG v3.8, loaded async in two passes)
  const starCatalogRef    = useRef<StarRow[]>([]);   // combined bright+faint
  const starAltAzCacheRef = useRef<[number, number][]>([]);
  const cacheKeyRef       = useRef('');   // "<lst>|<lat>"

  const skyTextureRef = useRef<AllSkyTexture | null>(null);
  const skyGlRef = useRef<SkyGlState | null>(null);
  const skyGlTextureSourceRef = useRef<AllSkyTexture | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const interactionSettleRef = useRef<number | null>(null);
  const isInteractingRef = useRef(false);

  const [dims, setDims] = useState({ w: 800, h: 460 });
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set(Object.keys(TYPE_COLOR)));
  const [isLiveTime, setIsLiveTime] = useState(true);
  const [simMinutes, setSimMinutes] = useState(currentUtcMinutes);
  const [skyTextureStatus, setSkyTextureStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  // Default: hide everything below horizon (Stellarium-like ground). Toggle on
  // to peek through the Earth and see the entire celestial sphere.
  const [showBelowHorizon, setShowBelowHorizon] = useState(false);

  // View centre in Alt-Az (panning, GoTo)
  const viewRef  = useRef({ az: 180, alt: INITIAL_VIEW_ALT }); // start near zenith, looking south
  const fovRef   = useRef(DEFAULT_FOV);         // Stellarium-like default
  const animRef  = useRef<number | null>(null);
  const dragRef  = useRef<{ x: number; y: number; az: number; alt: number } | null>(null);
  // Mirror state into refs so non-React callbacks (drag, wheel) read the
  // current toggle without needing to be re-bound through deps.
  const showBelowHorizonRef = useRef(showBelowHorizon);
  useEffect(() => { showBelowHorizonRef.current = showBelowHorizon; }, [showBelowHorizon]);

  // LST + site for the simulation clock
  const [lstSite, setLstSite] = useState<{ lst: number; lat: number; lon: number }>(() => {
    const site = SITE_COORDS[siteId] ?? SITE_COORDS.ctio;
    return { lst: getLST(buildSimulationDate(currentUtcMinutes()), site.lon), ...site };
  });

  const [viewVer, setViewVer] = useState(0);

  const requestRender = useCallback(() => {
    if (renderFrameRef.current !== null) return;
    renderFrameRef.current = requestAnimationFrame(() => {
      renderFrameRef.current = null;
      setViewVer((v) => v + 1);
    });
  }, []);

  const startInteractiveRender = useCallback((settleMs = 140) => {
    isInteractingRef.current = true;
    if (interactionSettleRef.current !== null) {
      window.clearTimeout(interactionSettleRef.current);
    }
    interactionSettleRef.current = window.setTimeout(() => {
      isInteractingRef.current = false;
      requestRender();
      interactionSettleRef.current = null;
    }, settleMs);
    requestRender();
  }, [requestRender]);

  const finishInteractiveRender = useCallback(() => {
    isInteractingRef.current = false;
    if (interactionSettleRef.current !== null) {
      window.clearTimeout(interactionSettleRef.current);
      interactionSettleRef.current = null;
    }
    requestRender();
  }, [requestRender]);

  useEffect(() => {
    let cancelled = false;
    setSkyTextureStatus('loading');
    buildProceduralSkyTexture()
      .then((texture) => {
        if (cancelled) return;
        skyTextureRef.current = texture;
        setSkyTextureStatus('ready');
        requestRender();
      })
      .catch((error) => {
        console.error(error);
        if (cancelled) return;
        setSkyTextureStatus('error');
      });
    return () => { cancelled = true; };
  }, [requestRender]);

  // Load real star catalog: bright pass first, then faint pass
  useEffect(() => {
    import('../../data/stars_catalog.json').then((m) => {
      starCatalogRef.current = m.default as StarRow[];
      cacheKeyRef.current = '';
      requestRender();
      // Second pass: mag 7.5–9 (larger chunk, lower priority)
      return import('../../data/stars_faint.json');
    }).then((m) => {
      starCatalogRef.current = [...starCatalogRef.current, ...(m.default as StarRow[])];
      cacheKeyRef.current = '';
      requestRender();
    }).catch(() => {});
  }, [requestRender]);

  useEffect(() => {
    if (!isLiveTime) return;
    const syncToNow = () => setSimMinutes(currentUtcMinutes());
    syncToNow();
    const id = setInterval(syncToNow, 60_000);
    return () => clearInterval(id);
  }, [isLiveTime]);

  useEffect(() => {
    const site = SITE_COORDS[siteId] ?? SITE_COORDS.ctio;
    const lst = getLST(buildSimulationDate(simMinutes), site.lon);
    setLstSite({ lst, ...site });
    requestRender();
  }, [siteId, simMinutes, requestRender]);

  // Re-centre the view when the SITE itself changes — but not when the user
  // is only scrubbing the time slider. Aiming uses the *current* simMinutes
  // read via a ref so this effect depends only on siteId.
  const simMinutesRef = useRef(simMinutes);
  useEffect(() => { simMinutesRef.current = simMinutes; }, [simMinutes]);

  useEffect(() => {
    const site = SITE_COORDS[siteId] ?? SITE_COORDS.ctio;
    const lst  = getLST(buildSimulationDate(simMinutesRef.current), site.lon);
    const [, gcAz] = raDecToAltAz(266.4, -28.9, site.lat, lst);
    // Aim azimuth toward Galactic Centre, tilt near zenith so the user starts
    // with a wide-open sky rather than craning toward the horizon.
    viewRef.current = { az: gcAz, alt: INITIAL_VIEW_ALT };
    fovRef.current = DEFAULT_FOV;
    requestRender();
  }, [siteId, requestRender]);

  // Responsive size
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.floor(e.contentRect.width);
      setDims({ w, h: Math.max(340, Math.floor(w * 0.52)) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // GoTo animation
  useEffect(() => {
    if (!focusTarget) return;
    const { lat, lon } = lstSite;
    const lst = getLST(buildSimulationDate(simMinutes), lon);
    const [tAlt, tAz] = raDecToAltAz(focusTarget.ra, focusTarget.dec, lat, lst);

    const startAlt = viewRef.current.alt, startAz = viewRef.current.az;
    const startFov = fovRef.current;
    const endFov   = 36;

    // Shortest az delta
    let dAz = tAz - startAz;
    if (dAz > 180) dAz -= 360;
    if (dAz < -180) dAz += 360;

    if (animRef.current) cancelAnimationFrame(animRef.current);
    const SLEW = 900, ZD = 700, ZDur = 700;
    const t0 = performance.now();

    const tick = (now: number) => {
      const el = now - t0;
      if (el <= SLEW) {
        const t = el / SLEW;
        const e = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
        const minAlt = showBelowHorizonRef.current ? MIN_VIEW_ALT_OPEN : MIN_VIEW_ALT_GROUND;
        viewRef.current = {
          az:  ((startAz + dAz*e) % 360 + 360) % 360,
          alt: Math.max(minAlt, Math.min(MAX_VIEW_ALT, startAlt + (tAlt - startAlt)*e)),
        };
      }
      if (el >= ZD) {
        const t = Math.min((el - ZD) / ZDur, 1);
        const e = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
        fovRef.current = startFov + (endFov - startFov)*e;
      }
      requestRender();
      if (el < ZD + ZDur) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        animRef.current = null;
      }
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [focusTarget?.id, lstSite, simMinutes, requestRender]); // eslint-disable-line react-hooks/exhaustive-deps

  const getScale = useCallback(() => {
    // Azimuthal equidistant: r = c, where c is the angular distance from the view centre.
    const half   = Math.min(dims.w, dims.h) * 0.5;
    const fovRad = (fovRef.current * Math.PI) / 180;
    return half / Math.max(fovRad / 2, 1e-6);
  }, [dims]);

  const visibleEvents = events.filter((e) => activeTypes.has(e.type));

  // ── Canvas draw ─────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (renderFrameRef.current !== null) cancelAnimationFrame(renderFrameRef.current);
      if (interactionSettleRef.current !== null) window.clearTimeout(interactionSettleRef.current);
      destroySkyGlState(skyGlRef.current);
      skyGlRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = backgroundCanvasRef.current;
    if (!canvas) return;
    let state = skyGlRef.current;
    if (!state || state.gl.canvas !== canvas) {
      destroySkyGlState(state);
      try {
        state = createSkyGlState(canvas);
      } catch (error) {
        console.error(error);
        state = null;
      }
      skyGlRef.current = state;
      skyGlTextureSourceRef.current = null;
    }
    if (!state) return;

    const isInteractiveFrame = isInteractingRef.current || animRef.current !== null;
    // Drop to DPR=1 during pan/zoom/animation: the shader does heavy per-pixel
    // trig (sin/cos/atan/asin), so halving pixel count on hi-DPI screens is the
    // single biggest win when the view is wide and the user is actively dragging.
    const baseDpr = Math.min(window.devicePixelRatio ?? 1, 2);
    const dpr = isInteractiveFrame ? Math.min(baseDpr, 1) : baseDpr;
    const { w, h } = dims;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const { lat, lst } = lstSite;
    const scale = getScale();
    const { az: az0, alt: alt0 } = viewRef.current;
    const cx = w / 2;
    const cy = h * SKY_VIEW_CENTER_Y;
    const { gl } = state;
    const skyTexture = skyTextureRef.current;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    gl.useProgram(state.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.positionBuffer);
    gl.enableVertexAttribArray(state.attribs.position);
    gl.vertexAttribPointer(state.attribs.position, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.texture);
    if (skyTexture && skyGlTextureSourceRef.current !== skyTexture) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        skyTexture.width,
        skyTexture.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        skyTexture.data,
      );
      gl.generateMipmap(gl.TEXTURE_2D);
      skyGlTextureSourceRef.current = skyTexture;
    }

    gl.uniform1i(state.uniforms.sky, 0);
    gl.uniform2f(state.uniforms.resolution, canvas.width, canvas.height);
    gl.uniform2f(state.uniforms.center, cx * dpr, cy * dpr);
    gl.uniform1f(state.uniforms.scale, scale * dpr);
    gl.uniform1f(state.uniforms.alt0, alt0);
    gl.uniform1f(state.uniforms.az0, az0);
    gl.uniform1f(state.uniforms.lat, lat);
    gl.uniform1f(state.uniforms.lst, lst);
    gl.uniform1f(state.uniforms.textureOpacity, skyTexture ? (isInteractiveFrame ? 0.94 : 0.98) : 0.0);

    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims, lstSite, viewVer, getScale, skyTextureStatus]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = dims;
    const isInteractiveFrame = isInteractingRef.current || animRef.current !== null;
    // Same DPR-drop trick as the WebGL layer: thousands of star arcs cost a lot
    // of fill bandwidth on hi-DPI screens, especially at full-wide FOV.
    const baseDpr = Math.min(window.devicePixelRatio ?? 1, 2);
    const dpr = isInteractiveFrame ? Math.min(baseDpr, 1) : baseDpr;
    const ctx = prepareHiDPICanvas(canvas, w, h, dpr);
    if (!ctx) return;

    const { lat, lon, lst } = lstSite;
    const scale = getScale();
    const { az: az0, alt: alt0 } = viewRef.current;
    const cx = w / 2;
    const cy = h * SKY_VIEW_CENTER_Y;
    // Drop very faint stars during interaction — keeps panning fluid even at
    // full wide FOV where the entire HYG catalog is on-screen at once.
    const maxStarMag = isInteractiveFrame ? 6.0 : 99;

    const drawSegmentPath = (segments: [number, number][][]) => {
      for (const seg of segments) {
        if (seg.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(seg[0][0], seg[0][1]);
        for (let i = 1; i < seg.length; i += 1) ctx.lineTo(seg[i][0], seg[i][1]);
        ctx.stroke();
      }
    };

    const drawClosedLoop = (points: [number, number][]) => {
      if (points.length < 2) return;
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
      ctx.closePath();
    };

    const horizonSamples: ([number, number] | null)[] = [];
    const horizonSegments: [number, number][][] = [];
    let horizonSeg: [number, number][] = [];
    const jumpLimit = Math.max(w, h) * 0.18;

    for (let az = 0; az <= 360; az += 1) {
      const pt = project(0, az % 360, alt0, az0, scale, cx, cy);
      horizonSamples.push(pt);
      if (!pt) {
        if (horizonSeg.length > 1) horizonSegments.push(horizonSeg);
        horizonSeg = [];
        continue;
      }
      const prev = horizonSeg[horizonSeg.length - 1];
      if (prev && Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) > jumpLimit) {
        if (horizonSeg.length > 1) horizonSegments.push(horizonSeg);
        horizonSeg = [pt];
        continue;
      }
      horizonSeg.push(pt);
    }
    if (horizonSeg.length > 1) horizonSegments.push(horizonSeg);

    if (horizonSegments.length > 1) {
      const firstSeg = horizonSegments[0];
      const lastSeg = horizonSegments[horizonSegments.length - 1];
      const firstPt = firstSeg[0];
      const lastPt = lastSeg[lastSeg.length - 1];
      if (Math.hypot(firstPt[0] - lastPt[0], firstPt[1] - lastPt[1]) < jumpLimit * 0.6) {
        horizonSegments[0] = [...lastSeg, ...firstSeg];
        horizonSegments.pop();
      }
    }

    const visibleHorizonCount = horizonSamples.reduce((count, pt) => count + (pt ? 1 : 0), 0);
    const primaryHorizon = horizonSegments.reduce<[number, number][]>((best, seg) => (
      seg.length > best.length ? seg : best
    ), []);
    const hasClosedHorizon = visibleHorizonCount > 300 && primaryHorizon.length > 120;
    let traceSkyRegionForClip: (() => void) | null = null;

    if (primaryHorizon.length > 2) {
      const horizonLoop = primaryHorizon[0][0] <= primaryHorizon[primaryHorizon.length - 1][0]
        ? primaryHorizon
        : [...primaryHorizon].reverse();

      const traceGroundRegion = () => {
        if (hasClosedHorizon) {
          ctx.rect(-24, -24, w + 48, h + 48);
          drawClosedLoop(horizonLoop);
          return;
        }
        ctx.moveTo(-24, h + 24);
        ctx.lineTo(horizonLoop[0][0], horizonLoop[0][1]);
        for (let i = 1; i < horizonLoop.length; i += 1) ctx.lineTo(horizonLoop[i][0], horizonLoop[i][1]);
        ctx.lineTo(w + 24, h + 24);
        ctx.closePath();
      };

      const traceSkyRegion = () => {
        if (hasClosedHorizon) {
          drawClosedLoop(horizonLoop);
          return;
        }
        ctx.moveTo(-24, -24);
        ctx.lineTo(w + 24, -24);
        ctx.lineTo(horizonLoop[horizonLoop.length - 1][0], horizonLoop[horizonLoop.length - 1][1]);
        for (let i = horizonLoop.length - 2; i >= 0; i -= 1) ctx.lineTo(horizonLoop[i][0], horizonLoop[i][1]);
        ctx.closePath();
      };

      if (!showBelowHorizon) {
        // Stellarium-like ground: simple near-black fill below horizon.
        ctx.save();
        ctx.beginPath();
        traceGroundRegion();
        ctx.fillStyle = 'rgba(6, 8, 12, 0.96)';
        if (hasClosedHorizon) {
          ctx.fill('evenodd');
        } else {
          ctx.fill();
        }
        ctx.restore();
        // Clip later draws (stars, DSO, grid, MW line) to the sky region.
        traceSkyRegionForClip = traceSkyRegion;
      }

      // Subtle horizon glow on the sky side.
      ctx.save();
      if (!showBelowHorizon) {
        ctx.beginPath();
        traceSkyRegion();
        ctx.clip();
      }
      ctx.globalCompositeOperation = 'screen';
      ctx.filter = `blur(${isInteractiveFrame ? 3 : 6}px)`;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(120, 160, 220, 0.18)';
      ctx.lineWidth = Math.max(isInteractiveFrame ? 4 : 6, Math.min(w, h) * (isInteractiveFrame ? 0.010 : 0.016));
      drawSegmentPath(horizonSegments);
      ctx.restore();

      // Dashed horizon line — visible reference even in all-sky mode.
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(255, 215, 150, 0.55)';
      ctx.lineWidth = 1;
      drawSegmentPath(horizonSegments);
      ctx.restore();
    }

    if (traceSkyRegionForClip) {
      ctx.save();
      ctx.beginPath();
      traceSkyRegionForClip();
      ctx.clip();
    }

    // ── Real star catalog (HYG v3.8) ────────────────────────────────────────
    const catalog = starCatalogRef.current;
    const cacheKey = `${lst.toFixed(4)}|${lat}`;
    if (cacheKey !== cacheKeyRef.current) {
      // Recompute alt/az for all stars (only when LST / site changes)
      const cache = new Array<[number, number]>(catalog.length);
      for (let i = 0; i < catalog.length; i++) {
        cache[i] = raDecToAltAz(catalog[i][0], catalog[i][1], lat, lst);
      }
      starAltAzCacheRef.current = cache;
      cacheKeyRef.current = cacheKey;
    }
    const altAzCache = starAltAzCacheRef.current;

    ctx.shadowBlur = 0;
    for (let i = 0; i < catalog.length; i++) {
      const [,, mag, ci] = catalog[i];
      if (mag > maxStarMag) continue;
      const [sAlt, sAz] = altAzCache[i];
      // All-sky: render below-horizon stars too, but dimmed.
      const pt = project(sAlt, sAz, alt0, az0, scale, cx, cy);
      if (!pt) continue;
      const color = ciToColor(ci);
      const r = magToRadius(mag, scale);
      // Stellarium-like extinction near horizon, plus a softer floor for
      // below-horizon stars (visible but clearly subdued).
      const horizonFade = sAlt >= 0
        ? Math.max(0.35, Math.min(1, (sAlt + 4) / 18))
        : Math.max(0.30, 0.70 + sAlt / 90 * 0.40);  // 0.70 at horizon → 0.30 at nadir
      ctx.globalAlpha = magToAlpha(mag) * horizonFade;
      ctx.fillStyle = color;
      if (!isInteractiveFrame && mag < 3 && sAlt >= 0) {
        ctx.shadowColor = color; ctx.shadowBlur = 6;
      }
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 0.6;

    const altCircleStep = isInteractiveFrame ? 4 : 3;
    for (const altLine of [15, 30, 45, 60, 75, 90]) {
      ctx.beginPath();
      let first = true;
      for (let azL = 0; azL <= 360; azL += altCircleStep) {
        const pt = project(altLine, azL, alt0, az0, scale, cx, cy);
        if (!pt) { first = true; continue; }
        first ? ctx.moveTo(pt[0], pt[1]) : ctx.lineTo(pt[0], pt[1]);
        first = false;
      }
      ctx.stroke();
    }

    const azLineStep = isInteractiveFrame ? 3 : 2;
    for (let azL = 0; azL < 360; azL += 30) {
      ctx.beginPath();
      let first = true;
      for (let altL = 0; altL <= 75; altL += azLineStep) {
        const pt = project(altL, azL, alt0, az0, scale, cx, cy);
        if (!pt) { first = true; continue; }
        first ? ctx.moveTo(pt[0], pt[1]) : ctx.lineTo(pt[0], pt[1]);
        first = false;
      }
      ctx.stroke();
    }

    // Galactic plane — drawn full-circle, dimmer below horizon.
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 5]);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    let gf = true;
    let lastBelow = false;
    for (const [ra, dec] of GAL_RA_DEC) {
      const [alt, az] = raDecToAltAz(ra, dec, lat, lst);
      const pt = project(alt, az, alt0, az0, scale, cx, cy);
      if (!pt) { gf = true; continue; }
      const below = alt < 0;
      if (below !== lastBelow) {
        // Stroke the segment in its current colour, then start a new path.
        ctx.strokeStyle = lastBelow ? 'rgba(125,211,252,0.18)' : 'rgba(125,211,252,0.42)';
        ctx.stroke();
        ctx.beginPath();
        gf = true;
        lastBelow = below;
      }
      gf ? ctx.moveTo(pt[0], pt[1]) : ctx.lineTo(pt[0], pt[1]);
      gf = false;
    }
    ctx.strokeStyle = lastBelow ? 'rgba(125,211,252,0.18)' : 'rgba(125,211,252,0.42)';
    ctx.stroke();
    ctx.setLineDash([]);

    const [gcAlt, gcAz] = raDecToAltAz(266.4, -28.9, lat, lst);
    const gcPt = project(gcAlt, gcAz, alt0, az0, scale, cx, cy);
    if (gcPt && gcAlt < 0) ctx.globalAlpha = 0.45;
    if (gcPt) {
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(gcPt[0], gcPt[1], 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(gcPt[0] - 10, gcPt[1]);
      ctx.lineTo(gcPt[0] + 10, gcPt[1]);
      ctx.moveTo(gcPt[0], gcPt[1] - 10);
      ctx.lineTo(gcPt[0], gcPt[1] + 10);
      ctx.stroke();
      ctx.fillStyle = 'rgba(251,191,36,0.8)';
      ctx.font = '9px IBM Plex Mono,monospace';
      ctx.fillText('GC', gcPt[0] + 9, gcPt[1] - 7);
    }

    // ── Deep-sky objects ─────────────────────────────────────────────────────
    for (const dso of DSO_CATALOG) {
      const [dAlt, dAz] = raDecToAltAz(dso.r, dso.d, lat, lst);
      const pt = project(dAlt, dAz, alt0, az0, scale, cx, cy);
      if (!pt) continue;
      const color = DSO_COLOR[dso.t];
      const sizeRad = (dso.s / 60) * (Math.PI / 180);
      const pr = Math.max(3, scale * sizeRad * 0.5);
      const fade = dAlt >= 0
        ? Math.max(0.30, Math.min(1, (dAlt + 6) / 15))
        : 0.30;
      ctx.globalAlpha = 0.65 * fade;
      ctx.strokeStyle = color;
      ctx.fillStyle = color + '22';
      ctx.lineWidth = 1;
      ctx.shadowColor = color;
      ctx.shadowBlur = isInteractiveFrame ? 0 : 6;
      ctx.beginPath();
      if (dso.t === 'GX') {
        ctx.save(); ctx.translate(pt[0], pt[1]); ctx.rotate(Math.PI / 5);
        ctx.ellipse(0, 0, pr, pr * 0.45, 0, 0, Math.PI * 2);
        ctx.restore();
      } else {
        ctx.arc(pt[0], pt[1], pr, 0, Math.PI * 2);
      }
      ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      if ((dso.m ?? 99) < 7 || dso.s >= 30) {
        ctx.globalAlpha = 0.7 * fade;
        ctx.fillStyle = color;
        ctx.font = '9px IBM Plex Mono,monospace';
        ctx.textAlign = 'left';
        ctx.fillText(dso.n, pt[0] + pr + 3, pt[1] + 3);
      }
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;

    for (const ev of visibleEvents) {
      const [alt, az] = raDecToAltAz(ev.ra, ev.dec, lat, lst);
      if (alt < 0) continue;
      const pt = project(alt, az, alt0, az0, scale, cx, cy);
      if (!pt) continue;
      const color = TYPE_COLOR[ev.type] ?? '#94a3b8';
      const isSel = selectedEvent?.id === ev.id;
      const radius = isSel ? 8 : 5;
      if (isSel) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.shadowColor = color;
      ctx.shadowBlur = isSel ? 20 : 8;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.font = 'bold 11px IBM Plex Mono,monospace';
    ctx.textAlign = 'center';
    for (const { az, label } of COMPASS) {
      const pt = project(0, az, alt0, az0, scale, cx, cy);
      if (!pt) continue;
      ctx.fillStyle = 'rgba(148,163,184,0.7)';
      ctx.fillText(label, pt[0], pt[1] - 8);
    }

    if (traceSkyRegionForClip) ctx.restore();

    const simClock = formatUtcClock(simMinutes);
    const lstH = Math.floor(lst);
    const lstM = Math.floor((lst % 1) * 60);
    ctx.textAlign = 'left';
    ctx.font = '9.5px IBM Plex Mono,monospace';
    ctx.fillStyle = 'rgba(148,163,184,0.45)';
    ctx.fillText(
      `LST ${String(lstH).padStart(2,'0')}h${String(lstM).padStart(2,'0')}m · ${isLiveTime ? 'LIVE' : 'SIM'} UT ${simClock} · lat ${lat > 0 ? '+' : ''}${lat.toFixed(1)}° · lon ${lon > 0 ? '+' : ''}${lon.toFixed(1)}°`,
      10, h - 8,
    );
    ctx.textAlign = 'left';
  }, [dims, visibleEvents, selectedEvent, lstSite, viewVer, getScale, simMinutes, isLiveTime, showBelowHorizon]);

  // ── Hit test ────────────────────────────────────────────────────────────────
  const hitTest = useCallback((mx: number, my: number): Target | null => {
    const { lat, lst } = lstSite;
    const scale = getScale();
    const { az: az0, alt: alt0 } = viewRef.current;
    const cx = dims.w / 2, cy = dims.h * SKY_VIEW_CENTER_Y;
    for (const ev of visibleEvents) {
      const [alt, az] = raDecToAltAz(ev.ra, ev.dec, lat, lst);
      if (alt < 0) continue;
      const pt = project(alt, az, alt0, az0, scale, cx, cy);
      if (!pt) continue;
      if (Math.hypot(mx - pt[0], my - pt[1]) < 11) return ev;
    }
    return null;
  }, [dims, visibleEvents, lstSite, getScale]);

  // ── Pointer handlers ─────────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, az: viewRef.current.az, alt: viewRef.current.alt };
    startInteractiveRender();
  }, [startInteractiveRender]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;

    if (dragRef.current && e.buttons === 1) {
      const scale = getScale();
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      const alt0r = (dragRef.current.alt * Math.PI) / 180;
      // Drag-with convention (Stellarium / Google Maps): view follows the hand
      const dAz  = -(dx / scale) * (180 / Math.PI) / Math.cos(alt0r + 1e-9);
      const dAlt =  (dy / scale) * (180 / Math.PI);
      const minAlt = showBelowHorizonRef.current ? MIN_VIEW_ALT_OPEN : MIN_VIEW_ALT_GROUND;
      viewRef.current = {
        az:  ((dragRef.current.az  + dAz)  % 360 + 360) % 360,
        alt: Math.max(minAlt, Math.min(MAX_VIEW_ALT, dragRef.current.alt + dAlt)),
      };
      if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
      startInteractiveRender();
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
      return;
    }
    const found = hitTest(mx, my);
    if (canvasRef.current) canvasRef.current.style.cursor = found ? 'pointer' : 'grab';
  }, [hitTest, getScale, startInteractiveRender]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !dragRef.current) return;
    const moved = Math.hypot(e.clientX - dragRef.current.x, e.clientY - dragRef.current.y);
    dragRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
    finishInteractiveRender();
    if (moved < 4) {
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const found = hitTest(mx, my);
      if (found) onEventClick(found);
    }
  }, [finishInteractiveRender, hitTest, onEventClick]);

  // Must use native addEventListener with passive:false to call preventDefault()
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      fovRef.current = Math.max(18, Math.min(170, fovRef.current * (e.deltaY > 0 ? 1.12 : 0.88)));
      if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
      startInteractiveRender(180);
    };
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, [startInteractiveRender]);

  const toggleType = (t: string) =>
    setActiveTypes((prev) => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });

  const typeCounts = Object.keys(TYPE_COLOR).reduce<Record<string, number>>((acc, t) => {
    acc[t] = events.filter((e) => e.type === t).length; return acc;
  }, {});

  const nowHour = simMinutes / 60;

  return (
    <div className="kmt-skymap-wrap">

      <div className="kmt-skymap-filter">
        <span className="kmt-skymap-filter-label">이벤트 유형</span>
        {Object.entries(TYPE_LABEL).map(([type, label]) => (
          <button
            key={type} type="button"
            className={`kmt-type-chip${activeTypes.has(type) ? ' active' : ''}`}
            style={{ '--chip-color': TYPE_COLOR[type] } as React.CSSProperties}
            onClick={() => toggleType(type)}
          >
            <span className="kmt-type-chip-dot" />{label}
            <span className="kmt-type-chip-count">{typeCounts[type]}</span>
          </button>
        ))}
        <div className="kmt-time-controls">
          <span className="kmt-skymap-filter-label">시뮬레이션 UT</span>
          <button
            type="button"
            className={`kmt-live-toggle${isLiveTime ? ' active' : ''}`}
            onClick={() => {
              setIsLiveTime(true);
              setSimMinutes(currentUtcMinutes());
            }}
          >
            실시간
          </button>
          <input
            type="range"
            min={0}
            max={1439}
            step={1}
          className="kmt-time-slider"
          value={simMinutes}
          onChange={(e) => {
            setIsLiveTime(false);
            setSimMinutes(Number(e.target.value));
            startInteractiveRender(180);
          }}
        />
          <span className="kmt-time-readout">{formatUtcClock(simMinutes)} UT</span>
        </div>
        <button
          type="button"
          className={`kmt-ground-toggle${showBelowHorizon ? ' active' : ''}`}
          onClick={() => {
            setShowBelowHorizon((v) => {
              const next = !v;
              // Switching back to ground mode: snap the view above the
              // horizon so the ground polygon doesn't fill the entire screen.
              if (!next && viewRef.current.alt < MIN_VIEW_ALT_GROUND) {
                viewRef.current = { ...viewRef.current, alt: MIN_VIEW_ALT_GROUND };
              }
              return next;
            });
            requestRender();
          }}
          title={showBelowHorizon ? '지평선 아래 가리기' : '지평선 아래도 보기 (지구 투과)'}
        >
          {showBelowHorizon ? '전천 보기' : '땅 가리기'}
        </button>
        <span className="kmt-skymap-hint">스크롤 줌 · 드래그 이동 · 마커 클릭</span>
      </div>

      <div ref={containerRef} className="kmt-skymap-container" style={{ height: `${dims.h}px` }}>
        <canvas
          ref={backgroundCanvasRef}
          className="kmt-cel-canvas kmt-cel-canvas-bg"
          aria-hidden="true"
        />
        <canvas
          ref={canvasRef}
          className="kmt-cel-canvas"
          style={{ cursor: 'grab' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            dragRef.current = null;
            finishInteractiveRender();
          }}
        />
        {skyTextureStatus === 'loading' && (
          <div className="kmt-skymap-loading">하늘 배경 생성 중…</div>
        )}
        {skyTextureStatus === 'error' && (
          <div className="kmt-skymap-loading">하늘 배경 생성에 실패했습니다.</div>
        )}
        <div
          className="kmt-skymap-site"
          style={{ '--site-color': SITE_WINDOWS[siteId]?.color ?? '#94a3b8' } as React.CSSProperties}
        >
          <span className="kmt-skymap-site-dot" />
          <div className="kmt-skymap-site-text">
            <strong>{SITE_WINDOWS[siteId]?.label ?? siteId.toUpperCase()}</strong>
            <span>
              위도 {lstSite.lat > 0 ? '+' : ''}{lstSite.lat.toFixed(2)}° · 경도 {lstSite.lon > 0 ? '+' : ''}{lstSite.lon.toFixed(2)}°
            </span>
          </div>
        </div>
        <div className="kmt-skymap-badge">
          {skyTextureStatus === 'ready' ? 'procedural Milky Way · fish-eye sky' : 'sky renderer fallback'}
        </div>
      </div>

      <div className="kmt-coverage-bar">
        <div className="kmt-coverage-title">KMTNet 24시간 연속 감시 — 벌지 가시성 (UT 기준, 벌지 시즌)</div>
        <div className="kmt-coverage-tracks">
          {Object.entries(SITE_WINDOWS).map(([id, info]) => {
            const endW = info.end > 24 ? info.end - 24 : info.end;
            const inWindow = info.end > 24
              ? nowHour >= info.start || nowHour < endW
              : nowHour >= info.start && nowHour < info.end;
            return (
              <div key={id} className={`kmt-coverage-row${id === siteId ? ' selected' : ''}`}>
                <span className="kmt-coverage-site" style={{ color: info.color }}>{info.label}</span>
                <div className="kmt-coverage-timeline">
                  {info.end > 24 ? (
                    <>
                      <div className="kmt-cov-window" style={{ left: `${(info.start/24)*100}%`, width: `${((24-info.start)/24)*100}%`, background: info.color+'55', border: `1px solid ${info.color}88` }} />
                      <div className="kmt-cov-window" style={{ left: '0%', width: `${((info.end-24)/24)*100}%`, background: info.color+'55', border: `1px solid ${info.color}88` }} />
                    </>
                  ) : (
                    <div className="kmt-cov-window" style={{ left: `${(info.start/24)*100}%`, width: `${((info.end-info.start)/24)*100}%`, background: info.color+'55', border: `1px solid ${info.color}88` }} />
                  )}
                  <div className="kmt-cov-now" style={{ left: `${(nowHour/24)*100}%` }} />
                </div>
                <span className={`kmt-coverage-status${inWindow ? ' obs' : ''}`}>{inWindow ? '관측 중' : '낮 시간'}</span>
              </div>
            );
          })}
        </div>
        <div className="kmt-coverage-xaxis">
          {[0,3,6,9,12,15,18,21,24].map((h) => <span key={h}>{h}h</span>)}
        </div>
        <p className="kmt-coverage-note">
          {isLiveTime ? '현재' : '시뮬레이션'} UT {formatUtcClock(simMinutes)} · 세 관측소가 ~120° 간격으로 배치되어 낮 시간 공백을 서로 메웁니다.
        </p>
      </div>
    </div>
  );
}
