/**
 * GET /api/image/[id]            -> the original bytes (browser fallback)
 * GET /api/image/[id]?w=48&h=24  -> raw RGB24, resized to exactly w x h
 *
 * The raw variant exists so the CLI never has to decode an image.
 *
 * The Kitty graphics protocol accepts PNG (f=100) or raw RGB/RGBA (f=24/f=32)
 * — but *not* JPEG, which is what xAI returns. Decoding JPEG in the client
 * would mean shipping an image codec inside a terminal game. Doing the decode
 * here with sharp, which the server already has, keeps the CLI dumb: it asks
 * for pixels at the exact size it wants and blits them, and the identical bytes
 * drive the ASCII fallback via luminance.
 *
 * Public and unauthenticated: ids are opaque uuids, and both the daily target
 * and every scored attempt are meant to be looked at.
 */

import sharp from "sharp";

import { getStore } from "@/lib/store";

/** Bounded so nobody can ask for a 10000x10000 resize and pin a function. */
const MAX_DIMENSION = 4096;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const image = await getStore().getImage(id);
  if (!image) return new Response("not found", { status: 404 });

  const params = new URL(request.url).searchParams;
  const width = Number.parseInt(params.get("w") ?? "", 10);
  const height = Number.parseInt(params.get("h") ?? "", 10);

  // Immutable: an id is minted per generation, so the bytes never change.
  const cache = { "cache-control": "public, max-age=31536000, immutable" };

  if (Number.isFinite(width) && width > 0 && width <= MAX_DIMENSION) {
    const target = Number.isFinite(height) && height > 0 && height <= MAX_DIMENSION ? height : width;

    // Kitty takes PNG directly (f=100) and it is an order of magnitude smaller
    // on the wire than raw RGB — a 320x320 image is ~90KB as PNG against
    // ~410KB of base64 raw, and that difference is visible as a slow paint.
    if (params.get("fmt") === "png") {
      const png = await sharp(image.bytes).resize(width, target, { fit: "fill" }).png({ quality: 90 }).toBuffer();
      return new Response(new Uint8Array(png), { headers: { ...cache, "content-type": "image/png" } });
    }
    // `fit: fill` on purpose: the caller has already worked out the aspect it
    // wants in character cells, and letterboxing here would fight that.
    const raw = await sharp(image.bytes)
      .resize(width, target, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer();

    return new Response(new Uint8Array(raw), {
      headers: {
        ...cache,
        "content-type": "application/octet-stream",
        "x-image-width": String(width),
        "x-image-height": String(target),
      },
    });
  }

  return new Response(new Uint8Array(image.bytes), {
    headers: { ...cache, "content-type": image.mime },
  });
}
