import type { PreparedImage } from '../../guildApi'
import { FULL_IMAGE_MAX_BYTES, IMAGE_EXTENSIONS, MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE, THUMB_IMAGE_MAX_BYTES, THUMB_WIDTH } from '../../shared/game/zoneArt'

// Getting a picture ready in the browser: the file stays as it is (it is uploaded unchanged), and a small JPEG copy is drawn from it for the lists and the dropdown.
// A file that is not a JPEG, PNG or WebP, is too big, or cannot be read as a picture is refused here with a sentence about that file, before anything is uploaded.

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const extension = IMAGE_EXTENSIONS[file.type]
  if (!extension) throw new Error(`${file.name} is not a JPEG, PNG or WebP picture.`)
  if (file.size > FULL_IMAGE_MAX_BYTES) throw new Error(`${file.name} is ${megabytes(file.size)}; pictures can be up to ${megabytes(FULL_IMAGE_MAX_BYTES)}.`)
  if (file.size === 0) throw new Error(`${file.name} is empty.`)
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(`${file.name} could not be read as a picture.`)
  }
  try {
    // A small file can still be a huge picture (a flat color compresses to nothing), and every member's browser decodes the whole of it to draw the banner.
    if (bitmap.width > MAX_IMAGE_SIDE || bitmap.height > MAX_IMAGE_SIDE || bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
      throw new Error(`${file.name} is ${bitmap.width} \u00d7 ${bitmap.height} pixels; a side can be at most ${MAX_IMAGE_SIDE.toLocaleString('en-US')} and the whole picture at most ${MAX_IMAGE_PIXELS / 1_000_000} million pixels.`)
    }
    const width = Math.min(THUMB_WIDTH, bitmap.width)
    const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot make the small copy of a picture.')
    context.fillStyle = '#ffffff' // a transparent PNG becomes a white-backed copy; a JPEG has no transparency
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    for (const quality of [0.82, 0.7, 0.55, 0.4]) {
      const thumb = await canvasBlob(canvas, quality)
      if (thumb && thumb.size <= THUMB_IMAGE_MAX_BYTES) return { blob: file, type: file.type, extension, thumb, width: bitmap.width, height: bitmap.height }
    }
    throw new Error(`The small copy of ${file.name} came out too big.`)
  } finally {
    bitmap.close()
  }
}
