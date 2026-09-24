import { useEffect, useMemo, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import {
  Archive, ArrowLeftRight, Camera, Download, Film, FolderOpen, ImagePlus,
  Layers3, Redo2, RotateCcw, Save, Settings2, Sparkles, Trash2, Undo2, Upload,
} from 'lucide-react'
import './App.css'

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
  transform: { zoom: 1, x: 0, y: 0, rotate: 0 },
  film: { ...defaultFilm },
}

const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = reject
  reader.readAsDataURL(file)
})

const getImageSize = (url) => new Promise((resolve) => {
  const image = new Image()
  image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
  image.onerror = () => resolve({ width: 0, height: 0 })
  image.src = url
})

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
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => db.close()
  })
}

const saveProjectToDb = (payload) => dbAction('readwrite', (store) => store.put(payload))
const deleteProjectFromDb = (id) => dbAction('readwrite', (store) => store.delete(id))
const loadProjectFromDb = (id) => dbAction('readonly', (store) => store.get(id))
const listProjectsFromDb = () => dbAction('readonly', (store) => store.getAll())

const Slider = ({ label, value, min, max, step = 1, unit = '', onChange }) => (
  <label className="slider-row">
    <div className="slider-heading"><span>{label}</span><strong>{value}{unit}</strong></div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
  </label>
)

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
  const cardRef = useRef(null)
  const rollRef = useRef(null)
  const importRef = useRef(null)

  const selectedPhoto = photos.find((photo) => photo.id === selectedPhotoId) || photos[0] || null
  const allPresets = useMemo(() => [...builtInPresets, ...customPresets], [customPresets])

  useEffect(() => {
    if (!selectedPhotoId && photos[0]) setSelectedPhotoId(photos[0].id)
  }, [photos, selectedPhotoId])

  useEffect(() => { refreshProjects() }, [])
  useEffect(() => { localStorage.setItem('retro-memory-presets', JSON.stringify(customPresets)) }, [customPresets])

  const flash = (message) => {
    setNotice(message)
    window.clearTimeout(flash.timeout)
    flash.timeout = window.setTimeout(() => setNotice(''), 2200)
  }

  const commitProject = (next) => {
    setPast((items) => [...items.slice(-39), project])
    setFuture([])
    setProject(next)
  }

  const patchProject = (patch) => commitProject({ ...project, ...patch })
  const patchTransform = (patch) => commitProject({ ...project, transform: { ...project.transform, ...patch } })
  const patchFilm = (patch) => commitProject({ ...project, film: { ...project.film, ...patch } })

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
      const items = await listProjectsFromDb()
      setSavedProjects(items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')))
    } catch { setSavedProjects([]) }
  }

  const handleFiles = async (event) => {
    const files = [...(event.target.files || [])]
    if (!files.length) return
    const nextPhotos = []
    for (const file of files) {
      const url = await fileToDataUrl(file)
      const size = await getImageSize(url)
      nextPhotos.push({
        id: makeId(), url, name: file.name, type: file.type, bytes: file.size,
        lastModified: file.lastModified, ...size,
      })
    }
    setPhotos((items) => [...items, ...nextPhotos])
    setSelectedPhotoId((current) => current || nextPhotos[0]?.id)
    event.target.value = ''
    flash(`${nextPhotos.length} photo${nextPhotos.length > 1 ? 's' : ''} added to the roll`)
  }

  const removePhoto = (id) => {
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
    const payload = { id, project: normalized, photos, selectedPhotoId, updatedAt: new Date().toISOString() }
    setProject(normalized)
    await saveProjectToDb(payload)
    await refreshProjects()
    flash('Project saved on this device')
  }

  const openSavedProject = async (id) => {
    const payload = await loadProjectFromDb(id)
    if (!payload) return
    setProject(payload.project)
    setPhotos(payload.photos || [])
    setSelectedPhotoId(payload.selectedPhotoId || payload.photos?.[0]?.id || null)
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
    setProject({ ...initialProject, id: makeId() })
    setPhotos([])
    setSelectedPhotoId(null)
    setPast([])
    setFuture([])
    flash('New blank roll created')
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ project, photos, selectedPhotoId }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${project.projectName || 'retro-memory-project'}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const importJson = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const payload = JSON.parse(await file.text())
      if (!payload.project) throw new Error('Invalid project')
      setProject({ ...initialProject, ...payload.project, id: makeId() })
      setPhotos(Array.isArray(payload.photos) ? payload.photos : [])
      setSelectedPhotoId(payload.selectedPhotoId || payload.photos?.[0]?.id || null)
      setPast([])
      setFuture([])
      flash('Project file imported')
    } catch { flash('That project file could not be opened') }
    event.target.value = ''
  }

  const exportArtwork = async () => {
    const target = project.view === 'roll' ? rollRef.current : cardRef.current
    if (!target) return
    const dataUrl = await toPng(target, { cacheBust: true, pixelRatio: 3, backgroundColor: '#efe9df' })
    const anchor = document.createElement('a')
    anchor.href = dataUrl
    anchor.download = `${project.projectName || 'retro-memory'}-${project.view}.png`
    anchor.click()
    flash(`${project.view === 'roll' ? 'Contact sheet' : 'Card'} exported as PNG`)
  }

  const filmStyle = (photo = selectedPhoto) => ({
    filter: `brightness(${project.film.brightness}%) contrast(${project.film.contrast}%) saturate(${project.film.saturation}%) sepia(${project.film.sepia}%) blur(${project.film.blur}px)`,
    transform: photo?.id === selectedPhoto?.id
      ? `translate(${project.transform.x}%, ${project.transform.y}%) scale(${project.transform.zoom}) rotate(${project.transform.rotate}deg)`
      : 'scale(1.02)',
  })

  const handlePointerDown = (event) => {
    if (!selectedPhoto || project.side === 'back') return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragState({ x: event.clientX, y: event.clientY, startX: project.transform.x, startY: project.transform.y })
  }

  const handlePointerMove = (event) => {
    if (!dragState) return
    const dx = (event.clientX - dragState.x) / 4
    const dy = (event.clientY - dragState.y) / 4
    setProject((current) => ({
      ...current,
      transform: {
        ...current.transform,
        x: Math.max(-50, Math.min(50, dragState.startX + dx)),
        y: Math.max(-50, Math.min(50, dragState.startY + dy)),
      },
    }))
  }

  const handlePointerUp = () => {
    if (!dragState) return
    setPast((items) => [...items.slice(-39), { ...project, transform: { ...project.transform, x: dragState.startX, y: dragState.startY } }])
    setFuture([])
    setDragState(null)
  }

  const renderPhoto = (photo = selectedPhoto, draggable = true) => (
    <div
      className={`photo-window ${draggable ? 'is-draggable' : ''}`}
      onPointerDown={draggable ? handlePointerDown : undefined}
      onPointerMove={draggable ? handlePointerMove : undefined}
      onPointerUp={draggable ? handlePointerUp : undefined}
      onPointerCancel={draggable ? handlePointerUp : undefined}
    >
      {photo ? <img src={photo.url} alt={photo.name || 'Memory'} style={filmStyle(photo)} draggable="false" /> : (
        <div className="empty-photo"><Camera size={38} strokeWidth={1.4} /><strong>Add a photo</strong><span>Your memory stays on this device.</span></div>
      )}
      <div className="warmth-overlay" style={{ opacity: Math.abs(project.film.warmth) / 100, background: project.film.warmth >= 0 ? '#f29b55' : '#5f92bf' }} />
      <div className="fade-overlay" style={{ opacity: project.film.fade / 180 }} />
      <div className="grain-overlay" style={{ opacity: project.film.grain / 100 }} />
      <div className="vignette-overlay" style={{ opacity: project.film.vignette / 100 }} />
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
          <button className="primary-button" onClick={exportArtwork}><Download size={17} /> Export PNG</button>
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
                  <div className="section-heading"><div><span>03</span><h3>Frame crop</h3></div><button className="text-button" onClick={() => patchTransform({ zoom: 1, x: 0, y: 0, rotate: 0 })}>Reset</button></div>
                  <Slider label="Zoom" value={project.transform.zoom} min={0.8} max={2.5} step={0.05} unit="×" onChange={(zoom) => patchTransform({ zoom })} />
                  <Slider label="Horizontal" value={Math.round(project.transform.x)} min={-50} max={50} unit="%" onChange={(x) => patchTransform({ x })} />
                  <Slider label="Vertical" value={Math.round(project.transform.y)} min={-50} max={50} unit="%" onChange={(y) => patchTransform({ y })} />
                  <Slider label="Rotate" value={project.transform.rotate} min={-12} max={12} unit="°" onChange={(rotate) => patchTransform({ rotate })} />
                  <p className="helper-copy">You can also drag the image directly inside the card.</p>
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
                        <button onClick={() => openSavedProject(item.id)}><strong>{item.project?.projectName || 'Untitled project'}</strong><span>{item.photos?.length || 0} photos · {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : ''}</span></button>
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
                {project.side === 'front' && selectedPhoto && <p className="drag-tip">Drag the photograph to reframe it.</p>}
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
                  <button className="thumbnail" onClick={() => setSelectedPhotoId(photo.id)}><img src={photo.url} alt="" /><span>{String(index + 1).padStart(2, '0')}</span></button>
                  <button className="thumbnail-remove" onClick={() => removePhoto(photo.id)} aria-label="Remove photo"><Trash2 size={12} /></button>
                </div>
              ))}
              <label className="thumbnail-add"><ImagePlus size={20} /><span>Add</span><input type="file" multiple accept="image/*" onChange={handleFiles} /></label>
            </div>
          </div>
        </main>
      </div>
      {notice && <div className="toast">{notice}</div>}
    </div>
  )
}

export default App
