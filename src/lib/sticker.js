/* ───────────────────────── distance transform (Felzenszwalb) ─────────────────────────
   feature[i] = 1 → distance 0. Returns Euclidean distance (px) to the nearest feature pixel. */
function edt(feature, w, h) {
  const INF = 1e20, n = Math.max(w, h)
  const g = new Float32Array(w * h)
  for (let i = 0; i < g.length; i++) g[i] = feature[i] ? 0 : INF
  const f = new Float32Array(n), d = new Float32Array(n), v = new Int32Array(n), z = new Float32Array(n + 1)
  const dt = (len) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF
    for (let q = 1; q < len; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]) }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]] }
  }
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; dt(h); for (let y = 0; y < h; y++) g[y * w + x] = d[y] }
  for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) f[x] = g[o + x]; dt(w); for (let x = 0; x < w; x++) g[o + x] = Math.sqrt(d[x]) }
  return g
}

/* Marks every 0-pixel reachable from the canvas edge; anything else that is 0 is an inner hole. */
function fillHoles(mask, w, h) {
  const outside = new Uint8Array(w * h), stack = new Int32Array(w * h)
  let sp = 0
  const push = (i) => { if (!mask[i] && !outside[i]) { outside[i] = 1; stack[sp++] = i } }
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }
  while (sp) {
    const i = stack[--sp], x = i % w
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1)
    if (i >= w) push(i - w); if (i < w * (h - 1)) push(i + w)
  }
  for (let i = 0; i < mask.length; i++) if (!outside[i]) mask[i] = 1
}

export function capCanvas(src, maxSide) {
  const sw = src.width, sh = src.height, k = Math.min(1, maxSide / Math.max(sw, sh))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k))
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, c.width, c.height)
  return c
}

/* ───────────────────────── background removal (solid colour) ───────────────────────── */
export function removeSolidColor(src, tol) {
  const c = capCanvas(src, 4000), ctx = c.getContext('2d', { willReadFrequently: true })
  const { width: w, height: h } = c, img = ctx.getImageData(0, 0, w, h), p = img.data
  // background = median of the outer 2px ring
  const ring = []
  for (let x = 0; x < w; x += 2) ring.push(x, (h - 1) * w + x)
  for (let y = 0; y < h; y += 2) ring.push(y * w, y * w + w - 1)
  const med = (ch) => { const a = ring.map((i) => p[i * 4 + ch]).sort((x, y) => x - y); return a[a.length >> 1] }
  const br = med(0), bg = med(1), bb = med(2)
  const dist = (i) => { const o = i * 4; return Math.hypot(p[o] - br, p[o + 1] - bg, p[o + 2] - bb) }
  const seen = new Uint8Array(w * h), stack = new Int32Array(w * h); let sp = 0
  const soft = tol * 1.6
  const push = (i) => { if (!seen[i] && p[i * 4 + 3] > 0 && dist(i) <= tol) { seen[i] = 1; stack[sp++] = i } }
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }
  while (sp) {
    const i = stack[--sp], x = i % w
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1)
    if (i >= w) push(i - w); if (i < w * (h - 1)) push(i + w)
  }
  for (let i = 0; i < w * h; i++) {
    if (seen[i]) { p[i * 4 + 3] = 0; continue }
    // feather pixels that touch the removed area
    const x = i % w
    const nb = (x > 0 && seen[i - 1]) || (x < w - 1 && seen[i + 1]) || (i >= w && seen[i - w]) || (i < w * (h - 1) && seen[i + w])
    if (nb) { const d = dist(i); if (d < soft) p[i * 4 + 3] = Math.round(p[i * 4 + 3] * Math.max(0, (d - tol) / (soft - tol))) }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

/* ───────────────────────── sticker builder ───────────────────────── */
function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }

/* S = { border, smooth, color, holes, shadow } */
export function buildSticker(cutSrc, maxSide, S, { withCutline = false, cutlineOnly = false } = {}) {
  const cut = capCanvas(cutSrc, maxSide)
  const W0 = cut.width, H0 = cut.height, L = Math.max(W0, H0)
  const r = Math.round((S.border / 100) * L)
  const s = r > 0 ? Math.round((S.smooth / 100) * Math.max(r, L * 0.015) * 1.2) : 0
  const shOff = S.shadow === 'hard' ? Math.max(3, Math.round(Math.max(r, L * 0.012) * 0.45)) : S.shadow === 'soft' ? Math.round(L * 0.018) : 0
  const blur = S.shadow === 'soft' ? Math.round(L * 0.025) : 0
  const pad = r + shOff + blur * 2 + 4
  const W = W0 + pad * 2, H = H0 + pad * 2

  // alpha of the cutout on the padded canvas
  const base = document.createElement('canvas'); base.width = W; base.height = H
  const bctx = base.getContext('2d', { willReadFrequently: true }); bctx.drawImage(cut, pad, pad)
  const a = bctx.getImageData(0, 0, W, H).data
  const mask = new Uint8Array(W * H)
  let any = false
  for (let i = 0; i < mask.length; i++) if (a[i * 4 + 3] >= 128) { mask[i] = 1; any = true }
  if (!any) throw new Error('مفيش شكل واضح في الصورة بعد إزالة الخلفية. جرّب طريقة تانية أو قلّل دقة إزالة اللون.')
  if (S.holes) fillHoles(mask, W, H)

  // sticker silhouette = morphological closing: grow by r+s, then shrink by s (rounds inner corners)
  const alpha = new Float32Array(W * H)
  if (r === 0 && s === 0) {
    for (let i = 0; i < alpha.length; i++) alpha[i] = mask[i]
  } else {
    const dOut = edt(mask, W, H)
    if (s > 0) {
      const grown = new Uint8Array(W * H)
      for (let i = 0; i < grown.length; i++) grown[i] = dOut[i] <= r + s ? 1 : 0
      const notGrown = new Uint8Array(W * H)
      for (let i = 0; i < grown.length; i++) notGrown[i] = grown[i] ? 0 : 1
      const dIn = edt(notGrown, W, H)
      for (let i = 0; i < alpha.length; i++) alpha[i] = Math.min(1, Math.max(0, dIn[i] - s + 0.5))
    } else {
      for (let i = 0; i < alpha.length; i++) alpha[i] = Math.min(1, Math.max(0, r - dOut[i] + 0.5))
    }
  }

  // Growing the outline can enclose new pockets between separate parts; fill those too.
  if (S.holes && (r > 0 || s > 0)) {
    const solid = new Uint8Array(W * H)
    for (let i = 0; i < solid.length; i++) solid[i] = alpha[i] >= 0.5 ? 1 : 0
    fillHoles(solid, W, H)
    // fill the pocket plus a soft 3px rim so its anti-aliased edge doesn't leave a faint ring
    const pocket = new Uint8Array(W * H)
    let found = false
    for (let i = 0; i < solid.length; i++) if (solid[i] && alpha[i] < 0.5) { pocket[i] = 1; found = true }
    if (found) {
      const dP = edt(pocket, W, H)
      for (let i = 0; i < alpha.length; i++) { const v = Math.min(1, Math.max(0, 3.5 - dP[i])); if (v > alpha[i]) alpha[i] = v }
    }
  }

  const layer = (rgb, alphaArr) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const ctx = c.getContext('2d'), img = ctx.createImageData(W, H), d = img.data
    for (let i = 0; i < alphaArr.length; i++) { const o = i * 4; d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = Math.round(alphaArr[i] * 255) }
    ctx.putImageData(img, 0, 0); return c
  }

  let cutline = null
  if (withCutline || cutlineOnly) {
    const inside = new Uint8Array(W * H), outside = new Uint8Array(W * H)
    for (let i = 0; i < alpha.length; i++) { inside[i] = alpha[i] >= 0.5 ? 1 : 0; outside[i] = 1 - inside[i] }
    const toIn = edt(inside, W, H), toOut = edt(outside, W, H)
    const lw = Math.max(1.5, L * 0.0035)
    const line = new Float32Array(W * H)
    for (let i = 0; i < line.length; i++) { const sd = inside[i] ? toOut[i] : toIn[i]; line[i] = Math.min(1, Math.max(0, lw / 2 - sd + 1)) }
    cutline = layer(cutlineOnly ? [0, 0, 0] : [242, 92, 5], line)
    if (cutlineOnly) return cutline
  }

  const out = document.createElement('canvas'); out.width = W; out.height = H
  const ctx = out.getContext('2d')
  if (r > 0 || s > 0 || S.shadow !== 'none') {
    const ink = layer([27, 27, 27], alpha)
    if (S.shadow === 'hard') ctx.drawImage(ink, shOff, shOff)
    if (S.shadow === 'soft') { ctx.save(); ctx.filter = `blur(${blur}px)`; ctx.globalAlpha = 0.35; ctx.drawImage(ink, 0, shOff); ctx.restore() }
    if (r > 0 || s > 0) ctx.drawImage(layer(hexToRgb(S.color), alpha), 0, 0)
  }
  ctx.drawImage(cut, pad, pad)
  if (cutline) ctx.drawImage(cutline, 0, 0)
  return out
}
