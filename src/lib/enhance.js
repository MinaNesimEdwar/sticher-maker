/* AI quality enhancement: Real-ESRGAN General x4v3 (BSD-3, Qualcomm AI Hub ONNX export).
   Upscales 4× and cleans blur / JPEG artifacts. The model takes fixed 128×128 tiles, so the image
   is processed in overlapping tiles and each tile's inner part is stitched into the result. */

// ORT's runtime as standalone files: its worker threads load the glue script by URL, and the copy
// Vite inlines into our chunk drags in app code that touches `document`, which crashes the workers.
import ortGlue from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url'
import ortWasm from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url'

const MODEL = `${import.meta.env.BASE_URL}models/real_esrgan_general_x4v3.onnx`
const DATA = `${import.meta.env.BASE_URL}models/real_esrgan_general_x4v3.data`
const T = 128          // model input tile
const O = 16           // overlap between tiles (input px); half is discarded on each side
const SCALE = 4
const MAX_INPUT = 1024 // longest side fed to the model → output up to 4096px

/* Images at or above this size are already sharp enough in 'auto' mode. */
export const AUTO_LIMIT = 2000

let sessionPromise = null
function getSession() {
  sessionPromise ??= (async () => {
    const ort = await import('onnxruntime-web/webgpu')
    ort.env.wasm.wasmPaths = { mjs: ortGlue, wasm: ortWasm }
    ort.env.logLevel = 'error' // hides the harmless "some nodes were not assigned to the preferred EP" warning
    const opts = { logSeverityLevel: 3, externalData: [{ path: 'real_esrgan_general_x4v3.data', data: DATA }] }
    try {
      if (!navigator.gpu) throw new Error('no WebGPU')
      return await ort.InferenceSession.create(MODEL, { ...opts, executionProviders: ['webgpu'] })
    } catch {
      return await ort.InferenceSession.create(MODEL, { ...opts, executionProviders: ['wasm'] })
    }
  })().catch((e) => { sessionPromise = null; throw e })
  return sessionPromise
}

export function needsEnhance(src, mode) {
  return mode === 'always' || (mode === 'auto' && Math.max(src.width, src.height) < AUTO_LIMIT)
}

/* Tile start positions covering 0..len with stride T-O; the last tile is clamped to the edge. */
function starts(len) {
  if (len <= T) return [0]
  const out = []
  for (let p = 0; p + T < len; p += T - O) out.push(p)
  out.push(len - T)
  return out
}

export async function enhance(src, onProgress) {
  onProgress('بيحمّل أداة تحسين الجودة…', 0, '')
  const session = await getSession()
  const ort = await import('onnxruntime-web/webgpu')

  // Model input: capped size, flattened on white (transparent pixels carry no usable colour).
  const k = Math.min(1, MAX_INPUT / Math.max(src.width, src.height))
  const W = Math.max(1, Math.round(src.width * k)), H = Math.max(1, Math.round(src.height * k))
  const inC = document.createElement('canvas'); inC.width = W; inC.height = H
  const ictx = inC.getContext('2d', { willReadFrequently: true })
  ictx.imageSmoothingQuality = 'high'; ictx.drawImage(src, 0, 0, W, H)
  const alphaSrc = ictx.getImageData(0, 0, W, H).data
  let hasAlpha = false
  for (let i = 3; i < alphaSrc.length; i += 4) if (alphaSrc[i] < 255) { hasAlpha = true; break }
  ictx.globalCompositeOperation = 'destination-over'; ictx.fillStyle = '#fff'; ictx.fillRect(0, 0, W, H)
  const px = ictx.getImageData(0, 0, W, H).data

  const OW = W * SCALE, OH = H * SCALE
  const outC = document.createElement('canvas'); outC.width = OW; outC.height = OH
  const octx = outC.getContext('2d')
  const out = octx.createImageData(OW, OH), od = out.data

  const xs = starts(W), ys = starts(H), total = xs.length * ys.length
  const input = new Float32Array(3 * T * T), plane = T * T
  let n = 0
  for (const [yi, y0] of ys.entries()) {
    for (const [xi, x0] of xs.entries()) {
      // read the tile (edge pixels replicated when the image is smaller than a tile)
      for (let ty = 0; ty < T; ty++) {
        const sy = Math.min(H - 1, y0 + ty)
        for (let tx = 0; tx < T; tx++) {
          const s = (sy * W + Math.min(W - 1, x0 + tx)) * 4, d = ty * T + tx
          input[d] = px[s] / 255; input[plane + d] = px[s + 1] / 255; input[2 * plane + d] = px[s + 2] / 255
        }
      }
      const res = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, T, T]) })
      const o = res[session.outputNames[0]]
      const r = o.data ?? (await o.getData()), OT = T * SCALE, oplane = OT * OT
      // keep the tile minus half the overlap on sides that touch another tile
      const kx0 = xi > 0 ? x0 + O / 2 : 0, kx1 = xi < xs.length - 1 ? x0 + T - O / 2 : Math.min(W, x0 + T)
      const ky0 = yi > 0 ? y0 + O / 2 : 0, ky1 = yi < ys.length - 1 ? y0 + T - O / 2 : Math.min(H, y0 + T)
      for (let oy = ky0 * SCALE; oy < ky1 * SCALE; oy++) {
        const ry = (oy - y0 * SCALE) * OT
        for (let ox = kx0 * SCALE; ox < kx1 * SCALE; ox++) {
          const ri = ry + (ox - x0 * SCALE), di = (oy * OW + ox) * 4
          od[di] = r[ri] * 255; od[di + 1] = r[oplane + ri] * 255; od[di + 2] = r[2 * oplane + ri] * 255; od[di + 3] = 255
        }
      }
      onProgress('بيحسّن جودة الصورة…', ++n / total, `${n} / ${total}`)
    }
  }
  octx.putImageData(out, 0, 0) // Uint8ClampedArray clamps the model's slight over/undershoot

  if (hasAlpha) {
    // Restore transparency: smooth-upscaled alpha from the original.
    const a = document.createElement('canvas'); a.width = OW; a.height = OH
    const actx = a.getContext('2d', { willReadFrequently: true }); actx.imageSmoothingQuality = 'high'; actx.drawImage(src, 0, 0, OW, OH)
    const ad = actx.getImageData(0, 0, OW, OH).data, fin = octx.getImageData(0, 0, OW, OH)
    for (let i = 3; i < ad.length; i += 4) fin.data[i] = ad[i]
    octx.putImageData(fin, 0, 0)
  }
  return outC
}
