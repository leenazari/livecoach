import { inflateSync } from "zlib";

export const LANDING_ACCENT = "#155dfc";
export const LANDING_ON = "#ffffff";

type Rgb = { r: number; g: number; b: number };

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const diagonal = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= diagonal) return left;
  if (upDistance <= diagonal) return up;
  return upLeft;
}

function hex(pixel: Rgb): string {
  return `#${[pixel.r, pixel.g, pixel.b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function accentFromSamples(pixels: Rgb[]): { accent: string; on: string } {
  let best: Rgb & { score: number } = { score: 0, r: 21, g: 93, b: 252 };
  for (const pixel of pixels) {
    const max = Math.max(pixel.r, pixel.g, pixel.b);
    const min = Math.min(pixel.r, pixel.g, pixel.b);
    const saturation = max - min;
    const light = (max + min) / 2;
    if (light > 214 || light < 28 || saturation < 36) continue;
    const score = saturation * (1 - Math.abs(light - 130) / 200);
    if (score > best.score) best = { score, ...pixel };
  }
  if (best.score <= 0) return { accent: LANDING_ACCENT, on: LANDING_ON };
  const luminance = (0.2126 * best.r) + (0.7152 * best.g) + (0.0722 * best.b);
  return { accent: hex(best), on: luminance > 170 ? "#101828" : LANDING_ON };
}

export function accentFromPng(bytes: Buffer): { accent: string; on: string } {
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return accentFromSamples([]);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const chunks: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR" && data.length >= 13) {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") chunks.push(Buffer.from(data));
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!width || !height || bitDepth !== 8 || !channels || interlace !== 0 || width > 8000 || height > 8000) {
    return accentFromSamples([]);
  }
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(chunks));
  } catch {
    return accentFromSamples([]);
  }
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) return accentFromSamples([]);
  const rows = Buffer.alloc(height * stride);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source];
    source += 1;
    const start = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? rows[start + x - channels] : 0;
      const up = y > 0 ? rows[start - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? rows[start - stride + x - channels] : 0;
      const value = raw[source];
      source += 1;
      let next = value;
      if (filter === 1) next = (value + left) & 255;
      else if (filter === 2) next = (value + up) & 255;
      else if (filter === 3) next = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) next = (value + paeth(left, up, upLeft)) & 255;
      rows[start + x] = next;
    }
  }
  const stepX = Math.max(1, Math.floor(width / 24));
  const stepY = Math.max(1, Math.floor(height / 24));
  const samples: Rgb[] = [];
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const index = (y * stride) + (x * channels);
      samples.push({ r: rows[index], g: rows[index + 1], b: rows[index + 2] });
    }
  }
  return accentFromSamples(samples);
}
