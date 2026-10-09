import { useCallback, useEffect, useRef, useState } from 'react'
import { buildSticker } from './lib/sticker.js'
import { FORMAT_LABEL, aiLoaded, downloadFiles, downloadZip, exportItem, getCutout } from './lib/exporter.js'

const DEFAULTS = { mode: 'ai', tol: 40, border: 3.5, smooth: 45, color: '#FFFFFF', holes: true, shadow: 'hard', cutline: false, size: 2500, bg: 'checker', format: 'both' }

const MODE_HINT = {
  ai: 'الأحسن للصور الحقيقية والرسومات المعقدة. أول مرة بينزّل موديل (حوالي ٨٠ ميجا) ومحتاج نت، وبعد كده بيشتغل أسرع.',
  color: 'للتصميمات اللي على خلفية بيضا أو لون واحد. سريع.',
  none: 'لو الصورة PNG شفافة جاهزة، هيضيف الإطار بس.',
}
const COLORS = [['#FFFFFF', 'أبيض'], ['#FFF6E5', 'كريمي'], ['#1B1B1B', 'أسود'], ['#0B6E6D', 'تيل'], ['#FFB627', 'أصفر']]
const PREVIEW_BGS = [
  ['checker', 'شفاف', 'repeating-conic-gradient(#ece4d3 0 25%,#fff 0 50%) 0 0/12px 12px'],
  ['light', 'فاتح', '#FFF6E5'], ['dark', 'غامق', '#2A2620'], ['teal', 'تيل', '#0B6E6D'],
]

function Seg({ label, value, options, onChange }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  )
}

function Slider({ label, display, ...props }) {
  return (
    <label className="slider">
      <span className="row"><span>{label}</span><span>{display}</span></span>
      <input type="range" {...props} />
    </label>
  )
}

export default function App() {
  const [S, setS] = useState(DEFAULTS)
  const [items, setItems] = useState([]) // { id, name, file, bitmap, thumb, cut: Map }
  const [currentId, setCurrentId] = useState(null)
  const [busy, setBusy] = useState(null) // { title, frac, sub }
  const [err, setErr] = useState('')
  const [over, setOver] = useState(false)
  const [hasPreview, setHasPreview] = useState(false)
  const fileRef = useRef(null)
  const previewRef = useRef(null)
  const renderToken = useRef(0)
  const lastTol = useRef(S.tol)

  const current = items.find((it) => it.id === currentId) || null
  const set = (key) => (v) => setS((s) => ({ ...s, [key]: v }))
  const progress = useCallback((title, frac = 0, sub = '') => setBusy({ title, frac, sub }), [])

  /* ── preview ── */
  useEffect(() => {
    if (!current) { setHasPreview(false); return }
    const token = ++renderToken.current
    // Colour tolerance re-runs the whole background removal, so wait for the slider to settle.
    const delay = lastTol.current !== S.tol ? 250 : 60
    lastTol.current = S.tol
    const timer = setTimeout(async () => {
      setErr('')
      try {
        const cut = await getCutout(current, S, progress)
        if (token !== renderToken.current) return
        setBusy(null)
        const c = buildSticker(cut, 1000, S, { withCutline: S.cutline })
        const pv = previewRef.current
        pv.width = c.width; pv.height = c.height
        pv.getContext('2d').drawImage(c, 0, 0)
        setHasPreview(true)
      } catch (e) {
        setBusy(null)
        if (token !== renderToken.current) return
        console.error(e)
        setErr(S.mode === 'ai' && !aiLoaded() ? 'مقدرتش أحمّل أداة الذكاء الاصطناعي. اتأكد إن النت شغال، أو استخدم "لون سادة".' : (e.message || 'حصلت مشكلة'))
      }
    }, delay)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, S.mode, S.tol, S.border, S.smooth, S.color, S.holes, S.shadow, S.cutline, progress])

  /* ── adding / removing images ── */
  const addFiles = useCallback(async (files) => {
    const imgs = [...files].filter((f) => /^image\/(png|jpe?g|webp)$/.test(f.type))
    if (!imgs.length) return setErr('ارفع صورة PNG أو JPG أو WebP.')
    const added = []
    for (const f of imgs) {
      try {
        const bitmap = await createImageBitmap(f)
        added.push({ id: crypto.randomUUID(), name: f.name || 'sticker.png', file: f, bitmap, thumb: URL.createObjectURL(f), cut: new Map() })
      } catch { setErr(`مقدرتش أفتح ${f.name}`) }
    }
    if (!added.length) return
    setItems((list) => [...list, ...added])
    setCurrentId(added[0].id)
  }, [])

  const remove = (it) => {
    const i = items.indexOf(it)
    const next = items.filter((x) => x !== it)
    URL.revokeObjectURL(it.thumb)
    setItems(next)
    if (it.id === currentId) setCurrentId((next[i] || next[i - 1] || {}).id ?? null)
  }

  useEffect(() => {
    const onPaste = (e) => {
      const f = [...e.clipboardData.items].filter((i) => i.kind === 'file').map((i) => i.getAsFile())
      if (f.length) addFiles(f)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addFiles])

  /* ── downloads ── */
  const run = async (fn) => {
    setErr('')
    try { await fn() } catch (e) { console.error(e); setErr(e.message || 'حصلت مشكلة') } finally { setBusy(null) }
  }
  const dlCurrent = (cutlineOnly) => run(async () => {
    const files = await exportItem(current, S, progress, cutlineOnly)
    setBusy(null)
    await downloadFiles(files)
  })
  const dlAll = () => run(() => downloadZip(items, S, progress))

  const pick = () => fileRef.current.click()

  return (
    <>
      <header>
        <div className="logo">حتة <small>صانع الاستيكرات</small></div>
        <p className="hint" style={{ maxWidth: 520 }}>
          ارفع صورة، أو اسحبها هنا، أو الصقها بـ <kbd>Ctrl</kbd>+<kbd>V</kbd>. الأداة بتشيل الخلفية وتعمل إطار حوالين الشكل، وكل حاجة بتحصل على جهازك، مفيش صور بتترفع لأي سيرفر.
        </p>
      </header>

      <div className="app">
        <aside className="panel" aria-label="الإعدادات">
          <div className="group">
            <div className="title">شيل الخلفية بـ</div>
            <Seg label="طريقة إزالة الخلفية" value={S.mode} onChange={set('mode')} options={[['ai', 'ذكاء اصطناعي'], ['color', 'لون سادة'], ['none', 'شفافة أصلاً']]} />
            <p className="hint">{MODE_HINT[S.mode]}</p>
            {S.mode === 'color' && (
              <Slider label="دقة إزالة اللون" display={S.tol} min="5" max="120" value={S.tol} onChange={(e) => set('tol')(Number(e.target.value))} />
            )}
          </div>

          <div className="group">
            <div className="title">الإطار</div>
            <Slider label="السُمك" display={S.border === 0 ? 'من غير' : `${S.border}٪`} min="0" max="10" step="0.25" value={S.border} onChange={(e) => set('border')(Number(e.target.value))} />
            <Slider label="نعومة الحواف" display={`${S.smooth}٪`} min="0" max="100" value={S.smooth} onChange={(e) => set('smooth')(Number(e.target.value))} />
            <div className="swatches" role="group" aria-label="لون الإطار">
              {COLORS.map(([c, name]) => (
                <button key={c} type="button" aria-label={name} aria-pressed={S.color === c} style={{ background: c }} onClick={() => set('color')(c)} />
              ))}
              <input type="color" defaultValue="#F25C05" aria-label="لون تاني" onInput={(e) => set('color')(e.target.value.toUpperCase())} />
            </div>
            <label className="check"><input type="checkbox" checked={S.holes} onChange={(e) => set('holes')(e.target.checked)} /> اقفل الفراغات اللي جوه الشكل</label>
          </div>

          <div className="group">
            <div className="title">الظل</div>
            <Seg label="الظل" value={S.shadow} onChange={set('shadow')} options={[['none', 'من غير'], ['hard', 'صلب (حتة)'], ['soft', 'ناعم']]} />
            <p className="hint">الظل للمعاينة والبوستات. لملف الطباعة اختار "من غير".</p>
          </div>

          <div className="group">
            <div className="title">التنزيل والطباعة</div>
            <Seg label="صيغة الملف" value={S.format} onChange={set('format')} options={[['both', 'الاتنين'], ['png', 'PNG'], ['webp', 'WebP']]} />
            <p className="hint">WebP أخف بكتير ومناسب للموقع. PNG بجودة كاملة للطباعة والأوردرات.</p>
            <label className="check"><input type="checkbox" checked={S.cutline} onChange={(e) => set('cutline')(e.target.checked)} /> أظهر خط القص</label>
            <label className="slider" style={{ fontSize: 14 }}>
              <span>مقاس التنزيل</span>
              <select value={S.size} onChange={(e) => set('size')(Number(e.target.value))} style={{ minHeight: 44, border: '1px solid #CFC2A8', borderRadius: 10, padding: '0 10px', background: '#fff' }}>
                <option value="1600">عادي — ١٦٠٠ بكسل</option>
                <option value="2500">جودة عالية — ٢٥٠٠ بكسل</option>
                <option value="4000">للطباعة الكبيرة — ٤٠٠٠ بكسل</option>
              </select>
            </label>
          </div>
        </aside>

        <section className="stage" aria-label="المعاينة">
          <div className="toolbar">
            <div className="left">
              <button className="btn" type="button" onClick={pick}>ارفع صور</button>
              <button className="btn teal" type="button" disabled={!current} onClick={() => dlCurrent(false)}>نزّل الاستيكر {FORMAT_LABEL[S.format]}</button>
              <button className="btn plain" type="button" disabled={!current} onClick={() => dlCurrent(true)}>نزّل خط القص</button>
              <button className="btn plain" type="button" disabled={items.length < 2} onClick={dlAll}>نزّل الكل ZIP</button>
            </div>
            <div className="bgs" role="group" aria-label="خلفية المعاينة">
              <span>المعاينة</span>
              {PREVIEW_BGS.map(([v, name, bg]) => (
                <button key={v} type="button" aria-label={name} aria-pressed={S.bg === v} style={{ background: bg }} onClick={() => set('bg')(v)} />
              ))}
            </div>
          </div>

          <div
            className={`drop ${S.bg}${over ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true) }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files) }}
          >
            {!(current && hasPreview) && (
              <div className="empty" onClick={pick}>
                <div className="demo-sticker" aria-hidden="true">حتة</div>
                <div className="big">اسحب الصورة هنا</div>
                <p className="hint">PNG أو JPG أو WebP. تقدر ترفع كذا صورة مرة واحدة.</p>
              </div>
            )}
            <canvas id="preview" ref={previewRef} hidden={!(current && hasPreview)} aria-label="معاينة الاستيكر" />
            <div className={`busy${busy ? ' on' : ''}`} role="status" aria-live="polite">
              <div className="box">
                <strong>{busy?.title || 'بيشتغل…'}</strong>
                <div className="bar"><i style={{ width: `${Math.round((busy?.frac || 0) * 100)}%` }} /></div>
                <span className="hint">{busy?.sub}</span>
              </div>
            </div>
          </div>
          <p className="err" role="alert">{err}</p>

          <div className="strip" aria-label="الصور">
            {items.map((it) => (
              <button key={it.id} type="button" className="thumb" aria-current={it.id === currentId} aria-label={it.name} onClick={() => setCurrentId(it.id)}>
                <img src={it.thumb} alt="" />
                <span
                  className="x" role="button" tabIndex={0} aria-label={`شيل ${it.name}`}
                  onClick={(e) => { e.stopPropagation(); remove(it) }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); remove(it) } }}
                >×</span>
              </button>
            ))}
            {items.length > 0 && <button type="button" className="thumb add" aria-label="ضيف صور" onClick={pick}>+</button>}
          </div>
        </section>
      </div>

      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
    </>
  )
}
