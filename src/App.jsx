import { useEffect, useMemo, useRef, useState } from 'react'
import { toBlob } from 'html-to-image'
import {
  Archive, ArrowLeftRight, Camera, Check, Download, Film, FolderOpen, ImagePlus,
  Layers3, Maximize2, Move, Redo2, RotateCcw, RotateCw, Save, Settings2,
  Sparkles, Trash2, Undo2, Upload, X, ZoomIn,
} from 'lucide-react'
import './App.css'

const defaultTransform = { zoom: 1, x: 0, rotate: 0 }
const withoutVerticalTransform = (transform = defaultTransform) => ({
  zoom: Math.max(1, Number(transform.zoom) || 1),
  x: Number(transform.x) || 0,
  rotate: Number(transform.rotate) || 0,
})

const defaultFilm = {
  brightness: 100, contrast: 105, saturation: 100, sepia: 0,
  warmth: 8, fade: 5, grain: 12, vignette: 12, blur: 0,
}

const builtInPresets = [
  { id: 'clean', name: 'Clean Scan', film: { ...defaultFilm, warmth: 0, fade: 0, grain: 0, vignette: 0 } },
  { id: 'daylight', name: 'Daylight 35', film: { brightness: 104, contrast: 108, saturation: 112, sepia: 8, warmth: 12, fade: 4, grain: 13, vignette: 8, blur: 0 } },
  { id: 'disposable', name: 'Disposable', film: { brightness: 108, contrast: 116, saturation: 120, sepia: 10, warmth: 18, fade: 6, grain: 26, vignette: 20, blur: 0.2 } },
  { id: 'faded', name: 'Faded Print', film: { brightness: 106, contrast: 92, saturation: 82, sepia: 18, warmth: 14, fade: 28, grain: 18, vignette: 7, blur: 0.15 } },
  { id: 'chrome', name: 'Chrome Slide', film: { brightness: 98, contrast: 126, saturation: 128, sepia: 0, warmth: -7, fade: 0, grain: 8, vignette: 14, blur: 0 } },
  { id: 'noir', name: 'Noir 800', film: { brightness: 98, contrast: 132, saturation: 0, sepia: 0, warmth: 0, fade: 8, grain: 30, vignette: 28, blur: 0 } },
]

const layoutOptions = [
  { id: 'instant', name: 'Instant', hint: 'Classic portrait print' },
  { id: 'square', name: 'Square', hint: 'Compact memory card' },
  { id: 'film', name: '35mm', hint: 'Film-frame treatment' },
  { id: 'postcard', name: 'Postcard', hint: 'Landscape keepsake' },
  { id: 'editorial', name: 'Editorial', hint: 'Magazine-style cover' },
]

const layoutCropRatios = {
  instant: 0.92,
  square: 1.11,
  film: 1.55,
  postcard: 0.95,
  editorial: 0.75,
}

const initialProject = {
  id: '',
  projectName: 'Untitled memory roll',
  title: 'A small moment',
  date: '',
  location: '',
  note: 'Write what you want to remember about this moment.',
  layout: 'instant',
  side: 'front',
  view: 'card',
  frameColor: '#f3eee2',
  inkColor: '#2b2926',
  accentColor: '#b56446',
  transform: { ...defaultTransform },
  film: { ...defaultFilm },
}

const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = reject
  reader.readAsDataURL(blob)
})

const dataUrlToBlob = (dataUrl) => {
  const [header, encoded = ''] = dataUrl.split(',', 2)
  const mime = header.match(/^data:([^;,]+)/)?.[1] || 'application/octet-stream'
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mime })
}

const isObjectUrl = (url) => typeof url === 'string' && url.startsWith('blob:')

const getImageSize = (url) => new Promise((resolve) => {
  const image = new Image()
  const finish = (size) => {
    image.onload = null
    image.onerror = null
    resolve(size)
  }
  image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight })
  image.onerror = () => finish({ width: 0, height: 0 })
  image.src = url
})

const hydratePhoto = async (photo) => {
  let blob = photo?.blob instanceof Blob ? photo.blob : null
  if (!blob && typeof photo?.url === 'string' && photo.url.startsWith('data:')) {
    blob = dataUrlToBlob(photo.url)
  }

  if (!blob) return { ...photo, transform: withoutVerticalTransform(photo?.transform) }

  const url = URL.createObjectURL(blob)
  const size = photo.width && photo.height ? { width: photo.width, height: photo.height } : await getImageSize(url)
  return {
    ...photo,
    ...size,
    blob,
    url,
    transform: withoutVerticalTransform(photo?.transform),
  }
}

const revokePhotoUrls = (items) => {
  for (const photo of items || []) {
    if (isObjectUrl(photo?.url)) URL.revokeObjectURL(photo.url)
  }
}

const openDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('retro-memory-studio', 1)
  request.onupgradeneeded = () => {
    const db = request.result
    if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' })
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

const dbAction = async (mode, action) => {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', mode)
    const store = tx.objectStore('projects')
    const request = action(store)
    let settled = false

    const closeDb = () => {
      try { db.close() } catch { /* already closed */ }
    }

    request.onsuccess = () => {
      if (settled) return
      settled = true
      resolve(request.result)
    }
    request.onerror = () => {
      if (settled) return
      settled = true
      reject(request.error)
    }
    tx.oncomplete = closeDb
    tx.onabort = closeDb
    tx.onerror = closeDb
  })
}

const saveProjectToDb = (payload) => dbAction('readwrite', (store) => store.put(payload))
const deleteProjectFromDb = (id) => dbAction('readwrite', (store) => store.delete(id))
const loadProjectFromDb = (id) => dbAction('readonly', (store) => store.get(id))

const listProjectSummariesFromDb = async () => {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readonly')
    const request = tx.objectStore('projects').openCursor()
    const summaries = []
    let settled = false

    const closeDb = () => {
      try { db.close() } catch { /* already closed */ }
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        if (!settled) {
          settled = true
          resolve(summaries)
        }
        return
      }
      const item = cursor.value
      summaries.push({
        id: item.id,
        projectName: item.project?.projectName || 'Untitled project',
        photoCount: Array.isArray(item.photos) ? item.photos.length : 0,
        updatedAt: item.updatedAt || '',
      })
      cursor.continue()
    }
    request.onerror = () => fail(request.error)
    tx.oncomplete = closeDb
    tx.onabort = () => {
      closeDb()
      fail(tx.error)
    }
    tx.onerror = () => {
      closeDb()
      fail(tx.error)
    }
  })
}

const Slider = ({ label, value, min, max, step = 1, unit = '', onChange }) => {
  const [draftValue, setDraftValue] = useState(null)
  const rangeFrameRef = useRef(null)
  const pendingRangeValueRef = useRef(null)

  useEffect(() => () => {
    if (rangeFrameRef.current) window.cancelAnimationFrame(rangeFrameRef.current)
  }, [])

  const scheduleRangeValue = (nextValue) => {
    pendingRangeValueRef.current = nextValue
    if (rangeFrameRef.current) return
    rangeFrameRef.current = window.requestAnimationFrame(() => {
      rangeFrameRef.current = null
      const pending = pendingRangeValueRef.current
      pendingRangeValueRef.current = null
      if (pending !== null) onChange(pending)
    })
  }

  const flushRangeValue = () => {
    if (rangeFrameRef.current) {
      window.cancelAnimationFrame(rangeFrameRef.current)
      rangeFrameRef.current = null
    }
    const pending = pendingRangeValueRef.current
    pendingRangeValueRef.current = null
    if (pending !== null) onChange(pending)
  }

  const commitDraftValue = () => {
    if (draftValue === null) return
    const parsed = Number(draftValue)
    if (!Number.isFinite(parsed)) {
      setDraftValue(null)
      return
    }

    const clamped = Math.max(min, Math.min(max, parsed))
    const precision = String(step).includes('.') ? String(step).split('.')[1].length : 0
    const normalized = precision > 0 ? Number(clamped.toFixed(precision)) : Math.round(clamped)
    onChange(normalized)
    setDraftValue(null)
  }

  return (
    <label className="slider-row">
      <div className="slider-heading">
        <span>{label}</span>
        <span className="slider-value-editor">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={draftValue ?? String(value)}
            onFocus={() => setDraftValue(String(value))}
            onChange={(event) => setDraftValue(event.target.value)}
            onBlur={commitDraftValue}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.blur()
              }
              if (event.key === 'Escape') {
                setDraftValue(null)
                event.currentTarget.blur()
              }
            }}
            aria-label={`${label} value`}
          />
          {unit && <strong>{unit}</strong>}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => scheduleRangeValue(Number(event.target.value))}
        onPointerUp={flushRangeValue}
        onPointerCancel={flushRangeValue}
        onBlur={flushRangeValue}
      />
    </label>
  )
}

function App() {
  const [project, setProject] = useState({ ...initialProject, id: makeId() })
  const [photos, setPhotos] = useState([])
  const [selectedPhotoId, setSelectedPhotoId] = useState(null)
  const [activePanel, setActivePanel] = useState('compose')
  const [savedProjects, setSavedProjects] = useState([])
  const [customPresets, setCustomPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('retro-memory-presets') || '[]') } catch { return [] }
  })
  const [past, setPast] = useState([])
  const [future, setFuture] = useState([])
  const [notice, setNotice] = useState('')
  const [dragState, setDragState] = useState(null)
  const [positionEditor, setPositionEditor] = useState(null)
  const [editorDrag, setEditorDrag] = useState(null)
  const [editorResize, setEditorResize] = useState(null)
  const [isExporting, setIsExporting] = useState(false)
  const cardRef = useRef(null)
  const rollRef = useRef(null)
  const importRef = useRef(null)
  const noticeTimeoutRef = useRef(null)
  const exportUrlRef = useRef(null)
  const exportInProgressRef = useRef(false)
  const photosRef = useRef([])
  const photoTransformFrameRef = useRef(null)
  const pendingPhotoTransformRef = useRef(null)
  const editorTransformFrameRef = useRef(null)
  const pendingEditorTransformRef = useRef(null)

  const selectedPhoto = photos.find((photo) => photo.id === selectedPhotoId) || photos[0] || null
  const selectedTransform = withoutVerticalTransform(selectedPhoto?.transform || project.transform)
  const allPresets = useMemo(() => [...builtInPresets, ...customPresets], [customPresets])

  useEffect(() => {
    if (!selectedPhotoId && photos[0]) setSelectedPhotoId(photos[0].id)
  }, [photos, selectedPhotoId])

  useEffect(() => { refreshProjects() }, [])
  useEffect(() => { localStorage.setItem('retro-memory-presets', JSON.stringify(customPresets)) }, [customPresets])
  useEffect(() => { photosRef.current = photos }, [photos])
  useEffect(() => () => {
    if (noticeTimeoutRef.current) window.clearTimeout(noticeTimeoutRef.current)
    if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current)
    if (photoTransformFrameRef.current) window.cancelAnimationFrame(photoTransformFrameRef.current)
    if (editorTransformFrameRef.current) window.cancelAnimationFrame(editorTransformFrameRef.current)
    revokePhotoUrls(photosRef.current)
  }, [])

  const flash = (message) => {
    setNotice(message)
    if (noticeTimeoutRef.current) window.clearTimeout(noticeTimeoutRef.current)
    noticeTimeoutRef.current = window.setTimeout(() => {
      setNotice('')
      noticeTimeoutRef.current = null
    }, 2200)
  }

  const commitProject = (next) => {
    setPast((items) => [...items.slice(-39), project])
    setFuture([])
    setProject(next)
  }

  const patchProject = (patch) => commitProject({ ...project, ...patch })
  const patchFilm = (patch) => commitProject({ ...project, film: { ...project.film, ...patch } })

  const normalizeTransform = (currentTransform, patch) => {
    const next = { ...(currentTransform || defaultTransform), ...patch }
    next.zoom = Math.max(1, next.zoom || 1)
    delete next.y
    next.zoom = Number(Math.min(5, next.zoom).toFixed(2))
    return next
  }

  const patchPhotoTransform = (photoId, patch) => {
    if (!photoId) return
    setPhotos((items) => items.map((photo) => (
      photo.id === photoId
        ? {
          ...photo,
          transform: normalizeTransform(
            photo.transform || project.transform || defaultTransform,
            patch,
          ),
        }
        : photo
    )))
  }

  const schedulePhotoTransform = (photoId, patch) => {
    const pending = pendingPhotoTransformRef.current
    pendingPhotoTransformRef.current = pending?.photoId === photoId
      ? { photoId, patch: { ...pending.patch, ...patch } }
      : { photoId, patch }

    if (photoTransformFrameRef.current) return
    photoTransformFrameRef.current = window.requestAnimationFrame(() => {
      photoTransformFrameRef.current = null
      const next = pendingPhotoTransformRef.current
      pendingPhotoTransformRef.current = null
      if (next) patchPhotoTransform(next.photoId, next.patch)
    })
  }

  const flushPhotoTransform = () => {
    if (photoTransformFrameRef.current) {
      window.cancelAnimationFrame(photoTransformFrameRef.current)
      photoTransformFrameRef.current = null
    }
    const next = pendingPhotoTransformRef.current
    pendingPhotoTransformRef.current = null
    if (next) patchPhotoTransform(next.photoId, next.patch)
  }

  const patchSelectedTransform = (patch) => patchPhotoTransform(selectedPhoto?.id, patch)

  const undo = () => {
    if (!past.length) return
    const previous = past[past.length - 1]
    setPast((items) => items.slice(0, -1))
    setFuture((items) => [project, ...items].slice(0, 40))
    setProject(previous)
  }

  const redo = () => {
    if (!future.length) return
    const next = future[0]
    setFuture((items) => items.slice(1))
    setPast((items) => [...items, project].slice(-40))
    setProject(next)
  }

  const refreshProjects = async () => {
    try {
      const summaries = await listProjectSummariesFromDb()
      setSavedProjects(summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
    } catch { setSavedProjects([]) }
  }

  const handleFiles = async (event) => {
    const files = [...(event.target.files || [])]
    if (!files.length) return
    const nextPhotos = []
    for (const file of files) {
      const url = URL.createObjectURL(file)
      const size = await getImageSize(url)
      nextPhotos.push({
        id: makeId(), url, blob: file, name: file.name, type: file.type, bytes: file.size,
        lastModified: file.lastModified, ...size, transform: { ...defaultTransform },
      })
    }
    setPhotos((items) => [...items, ...nextPhotos])
    setSelectedPhotoId((current) => current || nextPhotos[0]?.id)
    event.target.value = ''
    flash(`${nextPhotos.length} photo${nextPhotos.length > 1 ? 's' : ''} added to the roll`)
  }

  const removePhoto = (id) => {
    const removed = photos.find((photo) => photo.id === id)
    if (removed && isObjectUrl(removed.url)) URL.revokeObjectURL(removed.url)
    const remaining = photos.filter((photo) => photo.id !== id)
    setPhotos(remaining)
    if (selectedPhotoId === id) setSelectedPhotoId(remaining[0]?.id || null)
  }

  const applyPreset = (preset) => commitProject({ ...project, film: { ...preset.film } })

  const saveCustomPreset = () => {
    const name = window.prompt('Name this film recipe', 'My film recipe')
    if (!name?.trim()) return
    setCustomPresets((items) => [...items, { id: makeId(), name: name.trim(), film: { ...project.film }, custom: true }])
    flash('Film recipe saved locally')
  }

  const saveCurrentProject = async () => {
    const id = project.id || makeId()
    const normalized = { ...project, id }
    const cleanPhotos = photos.map((photo) => ({ ...photo, transform: withoutVerticalTransform(photo.transform) }))
    const storedPhotos = cleanPhotos.map((photo) => {
      const stored = { ...photo }
      delete stored.url
      return stored
    })
    const payload = { id, project: normalized, photos: storedPhotos, selectedPhotoId, updatedAt: new Date().toISOString() }
    setPhotos(cleanPhotos)
    setProject(normalized)
    await saveProjectToDb(payload)
    await refreshProjects()
    flash('Project saved on this device')
  }

  const openSavedProject = async (id) => {
    const payload = await loadProjectFromDb(id)
    if (!payload) return
    const hydratedPhotos = await Promise.all((payload.photos || []).map((photo) => hydratePhoto({
      ...photo,
      transform: photo.transform || payload.project?.transform,
    })))
    revokePhotoUrls(photos)
    setProject(payload.project)
    setPhotos(hydratedPhotos)
    setSelectedPhotoId(payload.selectedPhotoId || hydratedPhotos[0]?.id || null)
    setPast([])
    setFuture([])
    flash('Project loaded')
  }

  const deleteSavedProject = async (id) => {
    await deleteProjectFromDb(id)
    await refreshProjects()
    flash('Saved project removed')
  }

  const newProject = () => {
    revokePhotoUrls(photos)
    setProject({ ...initialProject, id: makeId() })
    setPhotos([])
    setSelectedPhotoId(null)
    setPast([])
    setFuture([])
    flash('New blank roll created')
  }

  const exportJson = async () => {
    const portablePhotos = await Promise.all(photos.map(async ({ blob: sourceBlob, url, ...photo }) => ({
      ...photo,
      url: sourceBlob ? await blobToDataUrl(sourceBlob) : url,
    })))
    const blob = new Blob([JSON.stringify({ project, photos: portablePhotos, selectedPhotoId }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${project.projectName || 'retro-memory-project'}.json`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const importJson = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const payload = JSON.parse(await file.text())
      if (!payload.project) throw new Error('Invalid project')
      const hydratedPhotos = await Promise.all((Array.isArray(payload.photos) ? payload.photos : []).map((photo) => hydratePhoto({
        ...photo,
        transform: photo.transform || payload.project?.transform,
      })))
      revokePhotoUrls(photos)
      setProject({ ...initialProject, ...payload.project, id: makeId() })
      setPhotos(hydratedPhotos)
      setSelectedPhotoId(payload.selectedPhotoId || hydratedPhotos[0]?.id || null)
      setPast([])
      setFuture([])
      flash('Project file imported')
    } catch { flash('That project file could not be opened') }
    event.target.value = ''
  }

  const exportArtwork = async () => {
    if (exportInProgressRef.current) return
    const target = project.view === 'roll' ? rollRef.current : cardRef.current
    if (!target) return
    exportInProgressRef.current = true
    setIsExporting(true)

    try {
      const width = Math.max(1, target.scrollWidth || target.offsetWidth || 1)
      const height = Math.max(1, target.scrollHeight || target.offsetHeight || 1)
      const maxOutputPixels = 16_000_000
      const pixelRatio = Math.max(1, Math.min(3, Math.sqrt(maxOutputPixels / (width * height))))
      const blob = await toBlob(target, {
        cacheBust: true,
        pixelRatio,
        backgroundColor: '#efe9df',
      })
      if (!blob) {
        flash('Export could not be created')
        return
      }
      if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current)
      const url = URL.createObjectURL(blob)
      exportUrlRef.current = url
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${project.projectName || 'retro-memory'}-${project.view}.png`
      anchor.click()
      window.setTimeout(() => {
        if (exportUrlRef.current === url) {
          URL.revokeObjectURL(url)
          exportUrlRef.current = null
        }
      }, 1000)
      flash(`${project.view === 'roll' ? 'Contact sheet' : 'Card'} exported as PNG`)
    } finally {
      exportInProgressRef.current = false
      setIsExporting(false)
    }
  }

  const filmStyle = (photo = selectedPhoto, transformOverride = null) => {
    const transform = transformOverride || photo?.transform || project.transform || defaultTransform
    const sourceRatio = (photo?.width || 1) / (photo?.height || 1)
    const cropRatio = layoutCropRatios[project.layout] || layoutCropRatios.instant
    const zoom = Math.max(1, transform.zoom || 1)
    const normalizedX = Math.max(-1, Math.min(1, (transform.x || 0) / 70))
    const positionX = 50 + (Math.max(-70, Math.min(70, transform.x)) / 70) * 50
    const zoomTravel = (zoom - 1) * 50
    const hasHorizontalSourceTravel = sourceRatio > cropRatio
    const translateX = hasHorizontalSourceTravel ? 0 : -normalizedX * zoomTravel

    return {
      filter: `brightness(${project.film.brightness}%) contrast(${project.film.contrast}%) saturate(${project.film.saturation}%) sepia(${project.film.sepia}%) blur(${project.film.blur}px)`,
      objectPosition: `${hasHorizontalSourceTravel ? positionX : 50}% 50%`,
      transform: `translateX(${translateX}%) scale(${zoom}) rotate(${transform.rotate || 0}deg)`,
    }
  }

  const getCropSelectionGeometry = (photo, transform) => {
    const sourceRatio = (photo?.width || 1) / (photo?.height || 1)
    const cropRatio = layoutCropRatios[project.layout] || layoutCropRatios.instant
    const zoom = Math.max(1, transform?.zoom || 1)
    let widthFraction = 1
    let heightFraction = 1

    if (sourceRatio > cropRatio) {
      widthFraction = cropRatio / sourceRatio
    } else {
      heightFraction = sourceRatio / cropRatio
    }

    widthFraction = Math.min(1, widthFraction / zoom)
    heightFraction = Math.min(1, heightFraction / zoom)

    const normalizedX = Math.max(-1, Math.min(1, (transform?.x || 0) / 70))
    const left = ((normalizedX + 1) / 2) * (1 - widthFraction)
    const top = (1 - heightFraction) / 2

    return { left, top, widthFraction, heightFraction }
  }

  const getCropSelectionStyle = (photo, transform) => {
    const { left, top, widthFraction, heightFraction } = getCropSelectionGeometry(photo, transform)
    return {
      left: `${left * 100}%`,
      top: `${top * 100}%`,
      width: `${widthFraction * 100}%`,
      height: `${heightFraction * 100}%`,
      transform: `rotate(${-(transform?.rotate || 0)}deg)`,
    }
  }

  const handlePointerDown = (event) => {
    if (!selectedPhoto || project.side === 'back') return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragState({
      photoId: selectedPhoto.id,
      x: event.clientX,
      startX: selectedTransform.x,
    })
  }

  const handlePointerMove = (event) => {
    if (!dragState) return
    const dx = (event.clientX - dragState.x) / 4
    schedulePhotoTransform(dragState.photoId, {
      x: Math.max(-60, Math.min(60, dragState.startX + dx)),
    })
  }

  const handlePointerUp = () => {
    if (!dragState) return
    flushPhotoTransform()
    setDragState(null)
  }

  const openPositionEditor = (photo = selectedPhoto) => {
    if (!photo) return
    const transform = withoutVerticalTransform(photo.transform || project.transform)
    setSelectedPhotoId(photo.id)
    setPositionEditor({ photoId: photo.id, draft: { ...transform } })
    setEditorDrag(null)
    setEditorResize(null)
  }

  const patchEditorTransform = (patch) => {
    setPositionEditor((current) => {
      if (!current) return current
      return {
        ...current,
        draft: normalizeTransform(current.draft, patch),
      }
    })
  }

  const scheduleEditorTransform = (patch) => {
    pendingEditorTransformRef.current = {
      ...(pendingEditorTransformRef.current || {}),
      ...patch,
    }
    if (editorTransformFrameRef.current) return

    editorTransformFrameRef.current = window.requestAnimationFrame(() => {
      editorTransformFrameRef.current = null
      const next = pendingEditorTransformRef.current
      pendingEditorTransformRef.current = null
      if (next) patchEditorTransform(next)
    })
  }

  const cancelScheduledEditorTransform = () => {
    if (editorTransformFrameRef.current) {
      window.cancelAnimationFrame(editorTransformFrameRef.current)
      editorTransformFrameRef.current = null
    }
    pendingEditorTransformRef.current = null
  }

  const closePositionEditor = () => {
    cancelScheduledEditorTransform()
    setPositionEditor(null)
    setEditorDrag(null)
    setEditorResize(null)
  }

  const savePositionEditor = () => {
    if (!positionEditor) return
    const pending = pendingEditorTransformRef.current
    const draft = pending
      ? normalizeTransform(positionEditor.draft, pending)
      : positionEditor.draft
    cancelScheduledEditorTransform()
    patchPhotoTransform(positionEditor.photoId, draft)
    closePositionEditor()
    flash('Photo position updated')
  }

  const handleEditorPointerDown = (event) => {
    if (!positionEditor) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const sourceFrame = event.currentTarget.closest('.position-source-frame')
    const bounds = sourceFrame?.getBoundingClientRect()
    if (!bounds) return
    setEditorDrag({
      x: event.clientX,
      startX: positionEditor.draft.x,
      width: bounds.width,
    })
  }

  const handleEditorPointerMove = (event) => {
    if (!editorDrag || !positionEditor) return
    const dx = ((event.clientX - editorDrag.x) / Math.max(1, editorDrag.width)) * 140
    scheduleEditorTransform({
      x: Math.max(-70, Math.min(70, editorDrag.startX + dx)),
    })
  }

  const handleEditorPointerUp = () => setEditorDrag(null)

  const handleEditorResizePointerDown = (event, handle) => {
    if (!positionEditor || !editingPhoto) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const sourceFrame = event.currentTarget.closest('.position-source-frame')
    const bounds = sourceFrame?.getBoundingClientRect()
    if (!bounds) return

    setEditorResize({
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startZoom: Math.max(1, positionEditor.draft.zoom || 1),
      startX: positionEditor.draft.x || 0,
      sourceWidth: bounds.width,
      sourceHeight: bounds.height,
      geometry: getCropSelectionGeometry(editingPhoto, positionEditor.draft),
    })
    setEditorDrag(null)
  }

  const handleEditorResizePointerMove = (event) => {
    if (!editorResize || !positionEditor || !editingPhoto) return
    event.stopPropagation()

    const { handle, geometry } = editorResize
    const dx = event.clientX - editorResize.startClientX
    const dy = event.clientY - editorResize.startClientY
    const startWidthPx = geometry.widthFraction * editorResize.sourceWidth
    const startHeightPx = geometry.heightFraction * editorResize.sourceHeight
    const scaleCandidates = []

    if (handle.includes('e')) {
      scaleCandidates.push(Math.max(0.08, (startWidthPx + dx) / Math.max(1, startWidthPx)))
    }
    if (handle.includes('w')) {
      scaleCandidates.push(Math.max(0.08, (startWidthPx - dx) / Math.max(1, startWidthPx)))
    }
    if (handle.includes('s')) {
      scaleCandidates.push(Math.max(0.08, (startHeightPx + dy) / Math.max(1, startHeightPx)))
    }
    if (handle.includes('n')) {
      scaleCandidates.push(Math.max(0.08, (startHeightPx - dy) / Math.max(1, startHeightPx)))
    }

    if (!scaleCandidates.length) return
    const scaleFactor = scaleCandidates.length === 1
      ? scaleCandidates[0]
      : scaleCandidates.reduce((best, value) => (
        Math.abs(value - 1) > Math.abs(best - 1) ? value : best
      ), scaleCandidates[0])

    const newZoom = Number(Math.max(1, Math.min(5, editorResize.startZoom / scaleFactor)).toFixed(2))
    const resizedGeometry = getCropSelectionGeometry(editingPhoto, {
      ...positionEditor.draft,
      zoom: newZoom,
      x: editorResize.startX,
      y: 0,
    })

    let targetLeft
    if (handle.includes('w')) {
      targetLeft = geometry.left + geometry.widthFraction - resizedGeometry.widthFraction
    } else if (handle.includes('e')) {
      targetLeft = geometry.left
    } else {
      targetLeft = geometry.left + (geometry.widthFraction - resizedGeometry.widthFraction) / 2
    }

    const maxLeft = Math.max(0, 1 - resizedGeometry.widthFraction)
    targetLeft = Math.max(0, Math.min(maxLeft, targetLeft))

    const normalizedX = maxLeft > 0 ? (2 * targetLeft / maxLeft) - 1 : 0

    scheduleEditorTransform({
      zoom: newZoom,
      x: Number((normalizedX * 70).toFixed(2)),
    })
  }

  const handleEditorResizePointerUp = (event) => {
    event.stopPropagation()
    setEditorResize(null)
  }

  const handleEditorWheel = (event) => {
    if (!positionEditor) return
    event.preventDefault()
    const direction = event.deltaY > 0 ? -0.08 : 0.08
    scheduleEditorTransform({
      zoom: Math.max(1, Math.min(5, Number((positionEditor.draft.zoom + direction).toFixed(2)))),
    })
  }

  const editingPhoto = positionEditor
    ? photos.find((photo) => photo.id === positionEditor.photoId)
    : null

  const renderPhoto = (photo = selectedPhoto, draggable = true) => (
    <div
      className={`photo-window ${draggable ? 'is-draggable' : ''}`}
      onPointerDown={draggable ? handlePointerDown : undefined}
      onPointerMove={draggable ? handlePointerMove : undefined}
      onPointerUp={draggable ? handlePointerUp : undefined}
      onPointerCancel={draggable ? handlePointerUp : undefined}
      onDoubleClick={draggable && photo ? () => openPositionEditor(photo) : undefined}
      title={draggable && photo ? 'Double-click to position photo' : undefined}
    >
      {photo ? <img src={photo.url} alt={photo.name || 'Memory'} style={filmStyle(photo)} draggable="false" decoding="async" /> : (
        <div className="empty-photo"><Camera size={38} strokeWidth={1.4} /><strong>Add a photo</strong><span>Your memory stays on this device.</span></div>
      )}
      {project.film.warmth !== 0 && <div className="warmth-overlay" style={{ opacity: Math.abs(project.film.warmth) / 100, background: project.film.warmth >= 0 ? '#f29b55' : '#5f92bf' }} />}
      {project.film.fade > 0 && <div className="fade-overlay" style={{ opacity: project.film.fade / 180 }} />}
      {project.film.grain > 0 && <div className="grain-overlay" style={{ opacity: project.film.grain / 100 }} />}
      {project.film.vignette > 0 && <div className="vignette-overlay" style={{ opacity: project.film.vignette / 100 }} />}
    </div>
  )

  const renderFront = () => (
    <>
      {renderPhoto()}
      <div className="card-copy">
        <div><h2>{project.title || 'Untitled memory'}</h2>{project.location && <p>{project.location}</p>}</div>
        <time>{project.date || '— — —'}</time>
      </div>
      {project.layout === 'editorial' && <div className="editorial-mark">MEMORY / {String(Math.max(0, photos.indexOf(selectedPhoto)) + 1).padStart(2, '0')}</div>}
    </>
  )

  const renderBack = () => (
    <div className="card-back">
      <div className="postcard-rule" />
      <div className="back-note">
        <span className="eyebrow">A note from this moment</span>
        <p>{project.note || 'No note yet.'}</p>
        <div className="signature-line">{project.title || 'Memory'}</div>
      </div>
      <div className="back-meta">
        <div className="stamp" style={{ borderColor: project.accentColor, color: project.accentColor }}>
          <span>MEMORY</span><strong>{project.date?.slice(0, 4) || new Date().getFullYear()}</strong>
        </div>
        <dl>
          <div><dt>Date</dt><dd>{project.date || 'Not set'}</dd></div>
          <div><dt>Place</dt><dd>{project.location || 'Not set'}</dd></div>
          {selectedPhoto && <div><dt>Source</dt><dd>{selectedPhoto.name}</dd></div>}
        </dl>
      </div>
    </div>
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-icon"><Film size={20} /></div>
          <div><span className="brand-kicker">LOCAL ANALOG TOOL</span><h1>Retro Memory Studio</h1></div>
        </div>
        <div className="top-actions">
          <button className="ghost-button" onClick={newProject}><RotateCcw size={16} /> New</button>
          <button className="ghost-button" onClick={saveCurrentProject}><Save size={16} /> Save</button>
          <button className="primary-button" onClick={exportArtwork} disabled={isExporting}><Download size={17} /> {isExporting ? 'Exporting…' : 'Export PNG'}</button>
        </div>
      </header>

      <div className="studio-grid">
        <aside className="control-panel">
          <nav className="panel-tabs" aria-label="Editor panels">
            {[
              ['compose', Layers3, 'Compose'], ['film', Sparkles, 'Film Lab'],
              ['memory', Archive, 'Memory'], ['projects', FolderOpen, 'Projects'],
            ].map((item) => {
              const [id, TabIcon, label] = item
              return <button key={id} className={activePanel === id ? 'active' : ''} onClick={() => setActivePanel(id)}><TabIcon size={17} /> {label}</button>
            })}
          </nav>

          <div className="panel-content">
            {activePanel === 'compose' && (
              <div className="control-stack">
                <section>
                  <div className="section-heading"><div><span>01</span><h3>Layout</h3></div></div>
                  <div className="layout-grid">
                    {layoutOptions.map((layout) => (
                      <button key={layout.id} className={`layout-choice ${project.layout === layout.id ? 'selected' : ''}`} onClick={() => patchProject({ layout: layout.id })}>
                        <span className={`layout-mini mini-${layout.id}`} /><strong>{layout.name}</strong><small>{layout.hint}</small>
                      </button>
                    ))}
                  </div>
                </section>
                <section>
                  <div className="section-heading"><div><span>02</span><h3>Photo roll</h3></div><em>{photos.length} frames</em></div>
                  <label className="upload-zone"><ImagePlus size={24} /><strong>Add photos</strong><span>JPG, PNG, WEBP · multiple files supported</span><input type="file" multiple accept="image/*" onChange={handleFiles} /></label>
                </section>
                <section>
                  <div className="section-heading"><div><span>03</span><h3>Frame position</h3></div><button className="text-button" disabled={!selectedPhoto} onClick={() => patchSelectedTransform({ ...defaultTransform })}>Reset</button></div>
                  <button className="position-photo-button" disabled={!selectedPhoto} onClick={() => openPositionEditor()}>
                    <Maximize2 size={16} />
                    <span><strong>Position photo</strong><small>Open the precision editor</small></span>
                  </button>
                  <Slider label="Zoom" value={Math.max(1, selectedTransform.zoom)} min={1} max={5} step={0.05} unit="×" onChange={(zoom) => patchSelectedTransform({ zoom })} />
                  <Slider label="Horizontal" value={Math.round(selectedTransform.x)} min={-70} max={70} unit="%" onChange={(x) => patchSelectedTransform({ x })} />
                  <Slider label="Rotate" value={selectedTransform.rotate} min={-45} max={45} unit="°" onChange={(rotate) => patchSelectedTransform({ rotate })} />
                  <p className="helper-copy">Drag directly for quick framing, or double-click the photo to open the precision positioning editor.</p>
                </section>
                <section>
                  <div className="section-heading"><div><span>04</span><h3>Paper & ink</h3></div></div>
                  <div className="color-grid">
                    <label><span>Paper</span><input type="color" value={project.frameColor} onChange={(e) => patchProject({ frameColor: e.target.value })} /></label>
                    <label><span>Ink</span><input type="color" value={project.inkColor} onChange={(e) => patchProject({ inkColor: e.target.value })} /></label>
                    <label><span>Accent</span><input type="color" value={project.accentColor} onChange={(e) => patchProject({ accentColor: e.target.value })} /></label>
                  </div>
                </section>
              </div>
            )}

            {activePanel === 'film' && (
              <div className="control-stack">
                <section>
                  <div className="section-heading"><div><span>01</span><h3>Film recipes</h3></div><button className="text-button" onClick={saveCustomPreset}>Save recipe</button></div>
                  <div className="preset-list">
                    {allPresets.map((preset) => (
                      <button key={preset.id} onClick={() => applyPreset(preset)}>
                        <span className="preset-swatch" style={{ '--preset-warmth': preset.film.warmth >= 0 ? '#d78a55' : '#6995ac', '--preset-fade': `${Math.min(70, preset.film.fade + 15)}%` }} />
                        <span><strong>{preset.name}</strong><small>{preset.custom ? 'Your local recipe' : 'Studio recipe'}</small></span>
                      </button>
                    ))}
                  </div>
                </section>
                <section>
                  <div className="section-heading"><div><span>02</span><h3>Develop</h3></div><Settings2 size={16} /></div>
                  <Slider label="Exposure" value={project.film.brightness} min={70} max={135} unit="%" onChange={(brightness) => patchFilm({ brightness })} />
                  <Slider label="Contrast" value={project.film.contrast} min={60} max={160} unit="%" onChange={(contrast) => patchFilm({ contrast })} />
                  <Slider label="Saturation" value={project.film.saturation} min={0} max={170} unit="%" onChange={(saturation) => patchFilm({ saturation })} />
                  <Slider label="Sepia" value={project.film.sepia} min={0} max={80} unit="%" onChange={(sepia) => patchFilm({ sepia })} />
                  <Slider label="Warmth" value={project.film.warmth} min={-50} max={50} onChange={(warmth) => patchFilm({ warmth })} />
                  <Slider label="Fade" value={project.film.fade} min={0} max={55} unit="%" onChange={(fade) => patchFilm({ fade })} />
                  <Slider label="Grain" value={project.film.grain} min={0} max={55} unit="%" onChange={(grain) => patchFilm({ grain })} />
                  <Slider label="Vignette" value={project.film.vignette} min={0} max={70} unit="%" onChange={(vignette) => patchFilm({ vignette })} />
                  <Slider label="Softness" value={project.film.blur} min={0} max={1.5} step={0.05} unit="px" onChange={(blur) => patchFilm({ blur })} />
                </section>
              </div>
            )}

            {activePanel === 'memory' && (
              <div className="control-stack">
                <section>
                  <div className="section-heading"><div><span>01</span><h3>Front caption</h3></div></div>
                  <label className="field"><span>Title</span><input value={project.title} maxLength={52} onChange={(e) => patchProject({ title: e.target.value })} placeholder="A small moment" /></label>
                  <label className="field"><span>Date</span><input type="date" value={project.date} onChange={(e) => patchProject({ date: e.target.value })} /></label>
                  <label className="field"><span>Location</span><input value={project.location} maxLength={44} onChange={(e) => patchProject({ location: e.target.value })} placeholder="Somewhere worth remembering" /></label>
                </section>
                <section>
                  <div className="section-heading"><div><span>02</span><h3>Back of card</h3></div></div>
                  <label className="field"><span>Memory note</span><textarea value={project.note} maxLength={260} rows={8} onChange={(e) => patchProject({ note: e.target.value })} /></label>
                  <p className="helper-copy">Switch the preview to “Back” to see the note as a postcard-style memory side.</p>
                </section>
                {selectedPhoto && (
                  <section>
                    <div className="section-heading"><div><span>03</span><h3>Local file details</h3></div></div>
                    <dl className="metadata-list">
                      <div><dt>File</dt><dd>{selectedPhoto.name}</dd></div>
                      <div><dt>Dimensions</dt><dd>{selectedPhoto.width || '?'} × {selectedPhoto.height || '?'}</dd></div>
                      <div><dt>Size</dt><dd>{(selectedPhoto.bytes / 1024 / 1024).toFixed(2)} MB</dd></div>
                      <div><dt>Modified</dt><dd>{new Date(selectedPhoto.lastModified).toLocaleDateString()}</dd></div>
                    </dl>
                  </section>
                )}
              </div>
            )}

            {activePanel === 'projects' && (
              <div className="control-stack">
                <section>
                  <div className="section-heading"><div><span>01</span><h3>Current project</h3></div></div>
                  <label className="field"><span>Project name</span><input value={project.projectName} onChange={(e) => patchProject({ projectName: e.target.value })} /></label>
                  <div className="button-row">
                    <button className="primary-button grow" onClick={saveCurrentProject}><Save size={16} /> Save locally</button>
                    <button className="ghost-button" onClick={exportJson}><Download size={16} /> JSON</button>
                  </div>
                  <button className="import-button" onClick={() => importRef.current?.click()}><Upload size={16} /> Import project JSON</button>
                  <input ref={importRef} hidden type="file" accept="application/json,.json" onChange={importJson} />
                  <p className="helper-copy">Saved projects use IndexedDB in this browser. The JSON option gives you a portable backup.</p>
                </section>
                <section>
                  <div className="section-heading"><div><span>02</span><h3>Saved on this device</h3></div><em>{savedProjects.length}</em></div>
                  <div className="saved-list">
                    {!savedProjects.length && <p className="empty-list">No saved projects yet.</p>}
                    {savedProjects.map((item) => (
                      <div className="saved-project" key={item.id}>
                        <button onClick={() => openSavedProject(item.id)}><strong>{item.projectName}</strong><span>{item.photoCount} photos · {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : ''}</span></button>
                        <button className="icon-button danger" onClick={() => deleteSavedProject(item.id)} aria-label="Delete saved project"><Trash2 size={16} /></button>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </div>
        </aside>

        <main className="workspace">
          <div className="workspace-toolbar">
            <div className="segmented">
              <button className={project.view === 'card' ? 'active' : ''} onClick={() => patchProject({ view: 'card' })}><Layers3 size={15} /> Card</button>
              <button className={project.view === 'roll' ? 'active' : ''} onClick={() => patchProject({ view: 'roll' })}><Film size={15} /> Contact sheet</button>
            </div>
            {project.view === 'card' && (
              <div className="segmented">
                <button className={project.side === 'front' ? 'active' : ''} onClick={() => patchProject({ side: 'front' })}>Front</button>
                <button className={project.side === 'back' ? 'active' : ''} onClick={() => patchProject({ side: 'back' })}><ArrowLeftRight size={14} /> Back</button>
              </div>
            )}
            <div className="history-buttons">
              <button className="icon-button" disabled={!past.length} onClick={undo} title="Undo"><Undo2 size={17} /></button>
              <button className="icon-button" disabled={!future.length} onClick={redo} title="Redo"><Redo2 size={17} /></button>
            </div>
          </div>

          <div className="stage">
            {project.view === 'card' ? (
              <div className="card-stage">
                <div className="stage-label">{project.layout.toUpperCase()} · {project.side.toUpperCase()}</div>
                <div ref={cardRef} className={`memory-card layout-${project.layout} side-${project.side}`} style={{ backgroundColor: project.frameColor, color: project.inkColor, '--accent': project.accentColor }}>
                  {project.side === 'front' ? renderFront() : renderBack()}
                </div>
                {project.side === 'front' && selectedPhoto && <p className="drag-tip">Drag to reframe · double-click for precision positioning.</p>}
              </div>
            ) : (
              <div className="roll-stage">
                <div ref={rollRef} className="contact-sheet" style={{ '--sheet-accent': project.accentColor }}>
                  <div className="contact-header">
                    <div><span>RETRO MEMORY STUDIO / CONTACT SHEET</span><h2>{project.projectName}</h2></div>
                    <strong>{String(photos.length).padStart(2, '0')} FRAMES</strong>
                  </div>
                  <div className="contact-grid">
                    {photos.length ? photos.map((photo, index) => (
                      <article key={photo.id}>
                        <div className="contact-photo">{renderPhoto(photo, false)}</div>
                        <footer><span>{String(index + 1).padStart(2, '0')}</span><strong>{photo.name.replace(/\.[^.]+$/, '')}</strong></footer>
                      </article>
                    )) : (
                      <div className="empty-contact"><Film size={44} /><strong>No frames yet</strong><span>Add several photos to build a contact sheet.</span></div>
                    )}
                  </div>
                  <div className="contact-footer"><span>{project.date || new Date().toISOString().slice(0, 10)}</span><span>{project.location || 'LOCAL ARCHIVE'}</span></div>
                </div>
              </div>
            )}
          </div>

          <div className="photo-dock">
            <div className="dock-heading"><span>ROLL / {photos.length} FRAME{photos.length === 1 ? '' : 'S'}</span><small>Click a frame to edit it</small></div>
            <div className="thumbnail-strip">
              {photos.map((photo, index) => (
                <div key={photo.id} className={`thumbnail-card ${selectedPhoto?.id === photo.id ? 'active' : ''}`}>
                  <button className="thumbnail" onClick={() => setSelectedPhotoId(photo.id)}><img src={photo.url} alt="" loading="lazy" decoding="async" /><span>{String(index + 1).padStart(2, '0')}</span></button>
                  <button className="thumbnail-remove" onClick={() => removePhoto(photo.id)} aria-label="Remove photo"><Trash2 size={12} /></button>
                </div>
              ))}
              <label className="thumbnail-add"><ImagePlus size={20} /><span>Add</span><input type="file" multiple accept="image/*" onChange={handleFiles} /></label>
            </div>
          </div>
        </main>
      </div>

      {positionEditor && editingPhoto && (
        <div className="position-editor-backdrop" role="dialog" aria-modal="true" aria-label="Position photo">
          <div className="position-editor">
            <header className="position-editor-header">
              <div>
                <span className="position-editor-kicker">FRAME {String(Math.max(0, photos.indexOf(editingPhoto)) + 1).padStart(2, '0')}</span>
                <h2>Position photo</h2>
                <p>Drag the image until the crop feels right. Scroll to zoom.</p>
              </div>
              <button className="position-close" onClick={closePositionEditor} aria-label="Close position editor"><X size={20} /></button>
            </header>

            <div className="position-editor-body">
              <div className="position-canvas">
                <div className="position-canvas-label"><Move size={14} /> DRAG LEFT / RIGHT</div>
                <div
                  className="position-source-frame"
                  style={{ aspectRatio: `${editingPhoto.width || 16} / ${editingPhoto.height || 9}` }}
                  onWheel={handleEditorWheel}
                >
                  <img
                    className="position-source-image"
                    src={editingPhoto.url}
                    alt={editingPhoto.name || 'Photo being positioned'}
                    style={{ filter: filmStyle(editingPhoto, positionEditor.draft).filter }}
                    draggable="false"
                    decoding="async"
                  />
                  <div
                    className={`position-crop-selection position-crop-${project.layout}`}
                    style={getCropSelectionStyle(editingPhoto, positionEditor.draft)}
                    onPointerDown={handleEditorPointerDown}
                    onPointerMove={handleEditorPointerMove}
                    onPointerUp={handleEditorPointerUp}
                    onPointerCancel={handleEditorPointerUp}
                  >
                    <div className="position-rule rule-v1" /><div className="position-rule rule-v2" />
                    <div className="position-rule rule-h1" /><div className="position-rule rule-h2" />
                    {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((handle) => (
                      <span
                        key={handle}
                        className={`position-handle handle-${handle}`}
                        onPointerDown={(event) => handleEditorResizePointerDown(event, handle)}
                        onPointerMove={handleEditorResizePointerMove}
                        onPointerUp={handleEditorResizePointerUp}
                        onPointerCancel={handleEditorResizePointerUp}
                      />
                    ))}
                    <div className="position-crop-badge">CARD CROP</div>
                    <div className="position-rotate-stem" />
                    <div className="position-rotate-handle"><RotateCw size={14} /></div>
                  </div>
                </div>
                <div className="position-photo-info">
                  <span>{editingPhoto.name}</span>
                  <span>{editingPhoto.width || '?'} × {editingPhoto.height || '?'}</span>
                </div>
              </div>

              <aside className="position-controls">
                <div className="position-control-heading"><Maximize2 size={17} /><div><strong>Transform</strong><span>Only this frame is changed</span></div></div>
                <Slider label="Zoom" value={Math.max(1, positionEditor.draft.zoom)} min={1} max={5} step={0.05} unit="×" onChange={(zoom) => patchEditorTransform({ zoom })} />
                <Slider label="Horizontal" value={Math.round(positionEditor.draft.x)} min={-70} max={70} unit="%" onChange={(x) => patchEditorTransform({ x })} />
                <Slider label="Rotate" value={positionEditor.draft.rotate} min={-45} max={45} unit="°" onChange={(rotate) => patchEditorTransform({ rotate })} />
                <div className="position-shortcuts">
                  <div><Move size={14} /><span>Drag</span><small>left / right</small></div>
                  <div><ZoomIn size={14} /><span>Scroll</span><small>zoom photo</small></div>
                  <div><RotateCw size={14} /><span>Slider</span><small>rotate photo</small></div>
                </div>
                <button className="position-reset" onClick={() => patchEditorTransform({ ...defaultTransform })}><RotateCcw size={15} /> Reset position</button>
                <div className="position-editor-actions">
                  <button className="ghost-button grow" onClick={closePositionEditor}>Cancel</button>
                  <button className="primary-button grow" onClick={savePositionEditor}><Check size={16} /> Done</button>
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}
      {notice && <div className="toast">{notice}</div>}
    </div>
  )
}

export default App
