/**
 * Image generation.
 *
 * Always requests `b64_json`. xAI's docs say plainly that returned URLs are
 * temporary — "download or process promptly" — and Golf's ghosts have to render
 * a full day later. Taking the bytes at generation time is the only thing that
 * survives; a stored URL is a broken image tomorrow.
 */

import { createHash, randomUUID } from "node:crypto";

import { hasKey, MODELS, withRetry, xaiFetch, XaiError } from "./xai";

const GENERATE_TIMEOUT_MS = 120_000;

export interface GeneratedImage {
  id: string;
  bytes: Buffer;
  mime: string;
}

interface ImageResponse {
  data?: { b64_json?: string; url?: string }[];
}

/** Identify by magic bytes; xAI does not always say what it returned. */
function sniff(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "application/octet-stream";
}

/**
 * A deterministic placeholder used whenever no key is configured.
 *
 * Not a blank square: it is a 512x512 PNG whose colours are derived from a hash
 * of the prompt, so two different prompts visibly differ and the jury mock can
 * score them consistently. That makes the entire Golf flow — generate, judge,
 * ghost — exercisable offline and for free.
 */
function mockImage(prompt: string): GeneratedImage {
  const hash = createHash("sha256").update(prompt).digest();
  const size = 64;
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size * 3 + 1);
    for (let x = 0; x < size; x++) {
      const i = 1 + x * 3;
      row[i] = hash[(x + y) % hash.length]!;
      row[i + 1] = hash[(x * 2 + y) % hash.length]!;
      row[i + 2] = hash[(x + y * 3) % hash.length]!;
    }
    rows.push(row);
  }
  return { id: randomUUID(), bytes: encodePng(size, size, Buffer.concat(rows)), mime: "image/png" };
}

/** Minimal PNG encoder — avoids a dependency just to make a mock. */
function encodePng(width: number, height: number, raw: Buffer): Buffer {
  const { deflateSync } = require("node:zlib") as typeof import("node:zlib");
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, checksum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export interface GenerateOptions {
  /** The daily target pays for the higher-quality model; attempts do not. */
  quality?: boolean;
}

export async function generateImage(prompt: string, options: GenerateOptions = {}): Promise<GeneratedImage> {
  if (!hasKey()) {
    await new Promise((resolve) => setTimeout(resolve, 600)); // keep the spinner honest
    return mockImage(prompt);
  }

  const model = options.quality ? MODELS.targetImage : MODELS.image;
  const response = await withRetry("generate", 2, () =>
    xaiFetch<ImageResponse>(
      "/images/generations",
      {
        model,
        prompt: prompt.slice(0, 2048),
        n: 1,
        aspect_ratio: "1:1",
        resolution: "1k",
        response_format: "b64_json",
      },
      GENERATE_TIMEOUT_MS,
    ),
  );

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new XaiError(502, "xAI returned no image bytes", false);

  const bytes = Buffer.from(b64, "base64");
  return { id: randomUUID(), bytes, mime: sniff(bytes) };
}
