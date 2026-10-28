import { capCanvas, removeSolidColor, buildSticker } from './sticker.js'
import { enhance, needsEnhance } from './enhance.js'

export const FORMATS = { png: ['png'], webp: ['webp'], both: ['png', 'webp'] }
export const FORMAT_LABEL = { png: 'PNG', webp: 'WebP', both: 'PNG + WebP' }
const WEBP_QUALITY = 0.9

/* ───────────────────────── cutouts ───────────────────────── */
let imgly = null
async function removeWithAI(file, onProgress) {
  if (!imgly) {
    onProgress('بيحمّل أداة إزالة الخلفية…', 0, '')
    imgly = await import('@imgly/background-removal')
  }
  const blob = await imgly.removeBackground(file, {
    progress: (key, cur, total) => {
      const dl = key.startsWith('fetch')
      onProgress(dl ? 'بينزّل الموديل (أول مرة بس)…' : 'بيشيل الخلفية…', total ? cur / total : 0, dl ? `${Math.round(cur / 1048576)} / ${Math.round(total / 1048576)} ميجا` : '')
    },
  })
  return capCanvas(await createImageBitmap(blob), 4000)
}
export const aiLoaded = () => !!imgly

/* Source image for removal: the AI-enhanced version when enhancement applies. Cached per item. */
async function getSource(item, S, onProgress) {
  if (!needsEnhance(item.bitmap, S.enhance)) return null
  item.enhanced ??= enhance(item.bitmap, onProgress).catch((e) => { item.enhanced = null; throw e })
  return item.enhanced
}

/* Cached per item and removal settings, since AI removal is slow. */
export async function getCutout(item, S, onProgress) {
  const enhanced = await getSource(item, S, onProgress)
  const key = `${enhanced ? 'hq:' : ''}${S.mode === 'color' ? `color:${S.tol}` : S.mode}`
  if (item.cut.has(key)) return item.cut.get(key)
  const src = enhanced || item.bitmap
  let c
  if (S.mode === 'ai') c = await removeWithAI(enhanced ? await new Promise((r) => enhanced.toBlob(r, 'image/png')) : item.file, onProgress)
  else if (S.mode === 'color') c = removeSolidColor(src, S.tol)
  else c = capCanvas(src, 4000)
  item.cut.set(key, c)
  return c
}

/* ───────────────────────── export ───────────────────────── */
export const baseName = (n) => n.replace(/\.[^.]+$/, '')

async function toBlob(c, fmt = 'png') {
  const type = `image/${fmt}`
  const blob = await new Promise((res) => c.toBlob(res, type, fmt === 'webp' ? WEBP_QUALITY : undefined))
  // Browsers without WebP encoding silently fall back to PNG.
  if (!blob || blob.type !== type) throw new Error(fmt === 'webp' ? 'المتصفح ده مش بيدعم حفظ WebP. استخدم Chrome أو Edge.' : 'مقدرتش أحفظ الصورة.')
  return blob
}

/* Returns [{ blob, name }] — one file per selected format (the cut line is always PNG). */
export async function exportItem(item, S, onProgress, cutlineOnly = false) {
  const cut = await getCutout(item, S, onProgress)
  onProgress(cutlineOnly ? 'بيجهّز خط القص…' : 'بيجهّز الاستيكر بالجودة الكاملة…', 0.6, '')
  await new Promise((r) => setTimeout(r, 30)) // let the busy overlay paint before the heavy work
  // Same canvas size as the sticker export, so the cut line lines up when layered for printing.
  const c = buildSticker(cut, S.size, S, { cutlineOnly })
  if (cutlineOnly) return [{ blob: await toBlob(c), name: `${baseName(item.name)}-cutline.png` }]
  const files = []
  for (const fmt of FORMATS[S.format]) files.push({ blob: await toBlob(c, fmt), name: `${baseName(item.name)}-sticker.${fmt}` })
  return files
}

export async function downloadFiles(files) {
  for (const f of files) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(f.blob); a.download = f.name; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    await new Promise((r) => setTimeout(r, 300))
  }
}

export async function downloadZip(items, S, onProgress) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  for (const [i, it] of items.entries()) {
    onProgress(`استيكر ${i + 1} من ${items.length}…`, i / items.length, it.name)
    for (const f of await exportItem(it, S, onProgress)) {
      // With both formats, keep them in separate folders: webp/ for the website, png/ for orders.
      zip.file(S.format === 'both' ? `${f.name.split('.').pop()}/${f.name}` : f.name, f.blob)
    }
  }
  onProgress('بيضغط الملفات…', 1, '')
  await downloadFiles([{ blob: await zip.generateAsync({ type: 'blob' }), name: 'hetta-stickers.zip' }])
}
