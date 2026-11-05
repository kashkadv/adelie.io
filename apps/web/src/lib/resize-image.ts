/**
 * Center-crops an image file to a square and scales it to `size`×`size` in the browser
 * (ADR-0010: avatars are resized on the client, the API only checks type and size).
 * WebP where the browser can encode it, JPEG otherwise. Returns a data URL.
 */
export async function resizeToSquare(file: File, size = 256): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  bitmap.close();

  const webp = canvas.toDataURL('image/webp', 0.85);
  // Browsers without a WebP encoder (older Safari) silently return PNG — use JPEG then.
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85);
}
