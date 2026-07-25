// The true aspect ratio (height / width) of an image, read from its header.
//
// Wikimedia gives dimensions through the API, but OpenLibrary covers and
// Smithsonian object photos do not — and a Tapestry image is drawn to fill its
// box, so a box whose aspect does not match the image stretches it. Reading the
// real dimensions from the bytes lets the layout size the box correctly instead
// of guessing (and squashing).

/** height / width for a PNG or JPEG buffer, or null if it is neither. */
export function imageAspect(buffer) {
  if (!buffer || buffer.length < 4) return null

  // PNG: an 8-byte signature, then the IHDR chunk carrying width and height.
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(PNG)) {
    const width = buffer.readUInt32BE(16)
    const height = buffer.readUInt32BE(20)
    return width ? height / width : null
  }

  // JPEG: SOI, then a chain of length-prefixed segments; the Start-Of-Frame
  // marker (0xC0–0xCF, excluding the non-frame 0xC4/0xC8/0xCC) holds the size.
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let i = 2
    while (i + 9 < buffer.length) {
      if (buffer[i] !== 0xff) {
        i++
        continue
      }
      const marker = buffer[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = buffer.readUInt16BE(i + 5)
        const width = buffer.readUInt16BE(i + 7)
        return width ? height / width : null
      }
      // Standalone markers (RSTn, SOI, EOI) carry no length; everything else does.
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2
        continue
      }
      i += 2 + buffer.readUInt16BE(i + 2)
    }
  }

  return null
}
