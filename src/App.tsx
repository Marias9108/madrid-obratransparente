import { useState, useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, Tooltip as LeafletTooltip, GeoJSON } from 'react-leaflet'
import L from 'leaflet'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  CartesianGrid, AreaChart, Area
} from 'recharts'
import {
  Building2, Star, TreePine, MessageCircle, Send, Camera,
  Filter, ChevronDown, ChevronUp, Search, AlertTriangle, X, RotateCcw
} from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import './App.css'

/* ---- Types ---- */
interface KPIs {
  pct_obras_en_plazo: number; desviacion_media_presupuesto: number
  num_obras_activas: number; pct_incidencias_criticas: number
  total_obras_mayores: number; total_obras_urbanas: number
  total_licencias: number; total_sanciones: number
  total_recurrentes: number; total_arboles_riesgo: number
  presupuesto_total: number; total_constructoras: number
  total_edificios_publicos: number
}
interface ObraMayor {
  titulo: string; empresa: string; estado: string; status: string
  presupuesto: number; distrito: string; tipo: string
  lat: number; lon: number; fecha_inicio: string; fecha_fin: string; plazo: string
  direccion: string; linea_inversion: string; gasto_ejecutado: number; pct_ejecucion: number
  retrasada?: boolean; fuera_presupuesto?: boolean
}
interface AlertaConflicto {
  retrasada: string; conflicto_con: string
  distrito_retrasada: string; distrito_conflicto: string
  distancia_km: number; severity: string; reason: string
  lat_r: number; lon_r: number; lat_c: number; lon_c: number
  presupuesto_retrasada: number; presupuesto_conflicto: number
  pct_retrasada: number; plazo_retrasada: string
}
interface ObraUrbana {
  direccion: string; distrito: string; tipo: string; descripcion: string
  fecha_inicio: string; fecha_fin: string; empresa: string
  status: string; is_emergency: boolean
  lat: number; lon: number
}
interface Constructora {
  empresa: string; estrellas: number; puntuacion: number; obras_realizadas: number
  quejas_ciudadanas: number; quejas_por_1000_obras: number
  obras_retrasadas: number; obras_fuera_presupuesto: number
  desviacion_media_pct: number; tasa_retraso_pct: number
  obras_mayores: number; emergencias: number
  distritos: string[]
  desglose: {
    base: number; penalizacion_quejas: number; penalizacion_presupuesto: number
    penalizacion_retrasos: number; bonus_volumen: number; bonus_cobertura: number
  }
  fuentes_nacionales?: {
    nota: string; url_placsp: string; url_cnmc: string
    url_tribunal_cuentas: string; url_rolece: string
  }
}
interface ArbolIncidente {
  lat: number; lon: number; tipo: string; distrito: string
  barrio: string; detalle: string; fecha: string; ano: string
}
interface IncidenciaCritica {
  obra: string; distrito: string; tipo_incidencia: string; categoria: string
  descripcion: string; fuente: string; fecha: string; estado: string
  impacto: string; lat: number; lon: number; url_fuente: string
}
interface PresupuestoDistrito { distrito: string; presupuesto: number; num_obras: number }
interface EdificioPublico { nombre: string; tipo: string; presupuesto: number; ejecutado: number; estado: string; distrito: string; direccion: string; ano_presupuesto: number; lat: number | null; lon: number | null; linea_inversion: string }
interface Prediccion {
  presupuesto_original: number; desviacion_historica_pct: number
  factor_recurrencia: number; factor_emergencias: number
  presupuesto_estimado_final: number; desviacion_estimada: number
  factores: { nombre: string; impacto_pct: number; descripcion: string }[]
  historico: { ano: number; presupuesto_inicial: number; presupuesto_final: number; desviacion: number; ejecucion_pct?: number }[]
}

const TABS = [
  'General', 'Obras Urbanas', 'Obras Mayores', 'Constructoras',
  'Árboles', 'Presupuesto', 'Edificios Púb.'
] as const
type Tab = typeof TABS[number]

function formatEur(n: number) {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(1) + 'B €'
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + 'M €'
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(0) + 'K €'
  return n.toFixed(0) + ' €'
}
function formatNum(n: number) { return n.toLocaleString('es-ES') }

function useData<T>(url: string, fallback: T): T {
  const [data, setData] = useState<T>(fallback)
  useEffect(() => { fetch(url).then(r => r.json()).then(setData).catch(() => {}) }, [url])
  return data
}

function BigNumber({ value, label, sub, color = 'text-blue-700', bg = 'bg-white' }: { value: string; label: string; sub?: string; color?: string; bg?: string }) {
  return (
    <div className={`${bg} rounded-2xl shadow-sm border border-gray-100 p-6 text-center hover:shadow-md transition-shadow`}>
      <p className={'text-4xl font-extrabold ' + color}>{value}</p>
      <p className="text-sm font-semibold text-gray-700 mt-2">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function StarRating({ stars, size = 16 }: { stars: number; size?: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={size} className={i <= Math.round(stars) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200 fill-gray-200'} />
      ))}
    </div>
  )
}

const impactoColor: Record<string, string> = {
  alto: 'bg-red-100 text-red-800 border-red-200',
  medio: 'bg-amber-100 text-amber-800 border-amber-200',
  bajo: 'bg-green-100 text-green-800 border-green-200'
}
const categoriaIcon: Record<string, string> = {
  'Denuncia judicial': '⚖️', 'Denuncia medioambiental': '🌿', 'Protesta vecinal': '✊',
  'Afección grave al tráfico/movilidad': '🚗', 'Riesgo sanitario': '☢️', 'Daños a viviendas': '🏠',
  'Obra paralizada': '🚫', 'Obra paralizada (histórica)': '📜', 'Hallazgo arqueológico': '🏛️',
  'Desviación presupuestaria': '💸'
}

/* ---- PAGE 1: PANEL ---- */
function PanelTab({ kpis, incidencias }: { kpis: KPIs; incidencias: IncidenciaCritica[] }) {
  const [filtroCategoria, setFiltroCategoria] = useState('Todas')
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  const paralizadas = useMemo(() => incidencias.filter(i =>
    i.estado.toLowerCase().includes('paralizada') || i.tipo_incidencia.includes('paralizada')
  ), [incidencias])

  const categorias = useMemo(() => {
    const s = new Set(incidencias.map(i => i.categoria))
    return ['Todas', ...Array.from(s).sort((a, b) => a.localeCompare(b, 'es'))]
  }, [incidencias])

  const filtered = useMemo(() => {
    if (filtroCategoria === 'Todas') return incidencias
    return incidencias.filter(i => i.categoria === filtroCategoria)
  }, [incidencias, filtroCategoria])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <BigNumber value={kpis.pct_obras_en_plazo + '%'} label="Obras ejecutadas en plazo en 2025" color="text-blue-700" bg="bg-blue-50" />
        <BigNumber value={kpis.desviacion_media_presupuesto + '%'} label="Desviación Presupuesto Inversiones 2025" color="text-amber-700" bg="bg-amber-50" />
        <BigNumber value={String(kpis.num_obras_activas)} label="Obras Activas" color="text-emerald-700" bg="bg-emerald-50" />
        <BigNumber value={String(incidencias.length)} label="Incidencias Críticas" color="text-rose-700" bg="bg-rose-50" />
      </div>

      {/* Incidencias Críticas Section */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-gradient-to-r from-red-600 to-rose-500 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-white" />
            <h3 className="text-base font-bold text-white">Incidencias Críticas en Obras</h3>
            <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full font-medium">{incidencias.length} detectadas</span>
          </div>
          <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)}
            className="text-xs border border-white/30 rounded-lg px-3 py-1.5 bg-white/20 text-white [&>option]:text-gray-800 [&>option]:bg-white">
            {categorias.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="space-y-2 p-5">
          {filtered.map((inc, idx) => (
            <div key={idx} className="border border-gray-100 rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}>
                <span className="text-lg">{categoriaIcon[inc.categoria] || '⚠️'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{inc.obra}</p>
                  <p className="text-[11px] text-gray-500">{inc.distrito} · {inc.fecha}</p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${impactoColor[inc.impacto] || impactoColor.medio}`}>
                  {inc.impacto.toUpperCase()}
                </span>
                <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{inc.estado}</span>
                {expandedIdx === idx ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
              </div>
              {expandedIdx === idx && (
                <div className="px-3 pb-3 pt-0 border-t border-gray-50">
                  <p className="text-xs text-gray-700 mt-2 leading-relaxed">{inc.descripcion}</p>
                  <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-400">
                    <span>Categoría: <b className="text-gray-600">{inc.categoria}</b></span>
                    <span>Fuente: <b className="text-gray-600">{inc.fuente}</b></span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ---- PAGE 2: OBRAS URBANAS ---- */
function ObrasUrbanasTab({ obras }: { obras: ObraUrbana[] }) {
  const [filtroTipo, setFiltroTipo] = useState('Todos')
  const [filtroStatus, setFiltroStatus] = useState<string | null>(null)
  const [showReport, setShowReport] = useState(false)
  const [reportAddr, setReportAddr] = useState('')
  const [reportDesc, setReportDesc] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const tipos = useMemo(() => {
    const s = new Set(obras.map(o => o.tipo).filter(Boolean))
    return ['Todos', ...Array.from(s).sort((a, b) => a.localeCompare(b, 'es'))]
  }, [obras])

  const tipoFiltered = useMemo(() => {
    if (filtroTipo === 'Todos') return obras
    return obras.filter(o => o.tipo === filtroTipo)
  }, [obras, filtroTipo])

  const statusColor: Record<string, string> = {
    finalizada: '#16a34a', en_proceso: '#eab308', recurrente: '#dc2626', pendiente: '#9ca3af'
  }

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { finalizada: 0, en_proceso: 0, recurrente: 0, pendiente: 0 }
    tipoFiltered.forEach(o => { c[o.status] = (c[o.status] || 0) + 1 })
    return c
  }, [tipoFiltered])

  const filtered = useMemo(() => {
    if (!filtroStatus) return tipoFiltered
    return tipoFiltered.filter(o => o.status === filtroStatus)
  }, [tipoFiltered, filtroStatus])

  const withCoords = useMemo(() => {
    return filtered.filter(o => o.lat && o.lon).slice(0, 3000)
  }, [filtered])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-gray-500" />
          <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500">
            {tipos.map(t => <option key={t} value={t}>{t || 'Sin tipo'}</option>)}
          </select>
        </div>
        <button onClick={() => setShowReport(!showReport)}
          className="ml-auto text-xs bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-1">
          <Camera size={14} /> Reportar avería
        </button>
      </div>

      {showReport && (
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-blue-800">Proponer nueva obra / Reportar avería</h4>
          <input type="text" placeholder="Dirección de la avería..."
            value={reportAddr} onChange={e => setReportAddr(e.target.value)}
            className="w-full text-sm border border-blue-200 rounded-lg px-3 py-2" />
          <textarea placeholder="Descripción del problema..."
            value={reportDesc} onChange={e => setReportDesc(e.target.value)}
            className="w-full text-sm border border-blue-200 rounded-lg px-3 py-2 h-20" />
          <div className="flex items-center gap-3">
            <input ref={fileRef} type="file" accept="image/*" className="text-xs" />
            <button onClick={() => { setShowReport(false); setReportAddr(''); setReportDesc(''); alert('Reporte enviado. Gracias por colaborar.') }}
              className="text-xs bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
              Enviar reporte
            </button>
          </div>
          <p className="text-[10px] text-gray-400">También puedes reportar directamente en <a href="https://avisos.madrid.es" target="_blank" rel="noreferrer" className="underline text-blue-500">avisos.madrid.es</a> o llamando al 010</p>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {Object.entries(statusCounts).map(([status, count]) => (
            <div key={status} className="text-center p-3 rounded-lg cursor-pointer transition-all"
              style={{ backgroundColor: statusColor[status] + (filtroStatus === status ? '30' : '15'), border: filtroStatus === status ? `2px solid ${statusColor[status]}` : '2px solid transparent' }}
              onClick={() => setFiltroStatus(filtroStatus === status ? null : status)}>
              <p className="text-2xl font-bold" style={{ color: statusColor[status] }}>{formatNum(count)}</p>
              <p className="text-xs text-gray-600 capitalize">{status === 'en_proceso' ? 'En proceso' : status}</p>
            </div>
          ))}
        </div>
        <MapContainer center={[40.4168, -3.7038]} zoom={12} scrollWheelZoom={true}
          style={{ height: 380, borderRadius: '0.5rem' }}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png" />
          {withCoords.map((o, i) => (
            <CircleMarker key={`${o.lat}-${o.lon}-${o.status}-${i}`} center={[o.lat, o.lon]} radius={3}
              fillColor={statusColor[o.status] || '#9ca3af'} fillOpacity={0.8}
              stroke={true} color="#fff" weight={1}
              eventHandlers={{ mouseover: (e) => e.target.openTooltip(), mouseout: (e) => e.target.closeTooltip() }}>
              <LeafletTooltip sticky>
                <div className="text-xs">
                  <p className="font-bold text-blue-700">{o.descripcion || 'Mantenimiento urbano'}</p>
                  <p className="font-semibold mt-1">{o.direccion}</p>
                  <p><b>Tipo:</b> {o.tipo || 'N/A'}</p>
                  <p><b>Distrito:</b> {o.distrito}</p>
                  <p><b>Empresa:</b> {o.empresa}</p>
                  <p><b>Estado:</b> <span className="capitalize">{o.status === 'en_proceso' ? 'En proceso' : o.status}</span></p>
                  <p><b>Inicio:</b> {o.fecha_inicio || 'N/A'}</p>
                  {o.fecha_fin && <p><b>Fin:</b> {o.fecha_fin}</p>}
                  {o.is_emergency && <p className="text-amber-600 font-bold mt-1">Avería urgente</p>}
                </div>
              </LeafletTooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  )
}

/* ---- PAGE 3: OBRAS MAYORES ---- */
function ObrasMayoresTab({ obras, alertas }: { obras: ObraMayor[], alertas: AlertaConflicto[] }) {
  const [filtroTipo, setFiltroTipo] = useState('Todos')
  const [filtroStatus, setFiltroStatus] = useState<string | null>(null)
  const [presMin, setPresMin] = useState(0)
  const [presMax, setPresMax] = useState(400000000)
  const [showAlertas, setShowAlertas] = useState(false)

  const getYear = (fecha: string | undefined) => {
    if (!fecha) return null
    const parts = fecha.split('/')
    for (const p of parts) { if (p.length === 4 && p.startsWith('20')) return parseInt(p) }
    return null
  }

  const obrasBase = useMemo(() => {
    return obras.filter(o => {
      const yi = getYear(o.fecha_inicio)
      if (yi && yi >= 2015) return true
      if (o.status !== 'finalizada') return true
      return false
    })
  }, [obras])

  const tiposObra = useMemo(() => {
    const s = new Set(obrasBase.map(o => o.tipo).filter(Boolean))
    return ['Todos', ...Array.from(s).sort((a, b) => a.localeCompare(b, 'es'))]
  }, [obrasBase])

  const maxPres = useMemo(() => Math.max(...obrasBase.map(o => o.presupuesto), 1), [obrasBase])

  const filtered = useMemo(() => {
    return obrasBase.filter(o => {
      if (filtroTipo !== 'Todos' && o.tipo !== filtroTipo) return false
      if (o.presupuesto < presMin || o.presupuesto > presMax) return false
      if (filtroStatus === 'finalizada' && o.status !== 'finalizada') return false
      if (filtroStatus === 'en_curso' && o.status !== 'en_curso') return false
      if (filtroStatus === 'pendiente' && o.status !== 'pendiente' && o.status !== 'licitacion') return false
      if (filtroStatus === 'retrasada' && !o.retrasada) return false
      if (filtroStatus === 'fuera_presupuesto' && !o.fuera_presupuesto) return false
      return true
    })
  }, [obrasBase, filtroTipo, presMin, presMax, filtroStatus])

  const statusColor: Record<string, string> = {
    en_curso: '#2563eb', finalizada: '#16a34a', pendiente: '#9ca3af', licitacion: '#9ca3af'
  }
  const statusLabel: Record<string, string> = {
    en_curso: 'En curso', finalizada: 'Finalizada', pendiente: 'Pendiente', licitacion: 'En licitación'
  }

  const filteredForCounts = useMemo(() => {
    return obrasBase.filter(o => {
      if (filtroTipo !== 'Todos' && o.tipo !== filtroTipo) return false
      if (o.presupuesto < presMin || o.presupuesto > presMax) return false
      return true
    })
  }, [obrasBase, filtroTipo, presMin, presMax])

  const statusCounts = useMemo(() => {
    const c = { finalizada_2025: 0, en_curso: 0, pendiente: 0, retrasada: 0, fuera_presupuesto: 0 }
    filteredForCounts.forEach(o => {
      if (o.status === 'finalizada' && getYear(o.fecha_fin) === 2025) c.finalizada_2025++
      if (o.status === 'en_curso') c.en_curso++
      else if (o.status !== 'finalizada') c.pendiente++
      if (o.retrasada) c.retrasada++
      if (o.fuera_presupuesto) c.fuera_presupuesto++
    })
    return c
  }, [filteredForCounts])

  const kpiItems = [
    { key: 'finalizada', label: 'Finalizadas en 2025', count: statusCounts.finalizada_2025, color: '#16a34a', bg: '#f0fdf4' },
    { key: 'en_curso', label: 'En curso', count: statusCounts.en_curso, color: '#2563eb', bg: '#eff6ff' },
    { key: 'pendiente', label: 'Pendiente / Licitación', count: statusCounts.pendiente, color: '#9ca3af', bg: '#f9fafb' },
    { key: 'retrasada', label: 'Retrasadas', count: statusCounts.retrasada, color: '#dc2626', bg: '#fef2f2', icon: '\u23F1' },
    { key: 'fuera_presupuesto', label: 'Fuera de presupuesto', count: statusCounts.fuera_presupuesto, color: '#9333ea', bg: '#faf5ff', icon: '\uD83D\uDCB0' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-3">
        {kpiItems.map(item => (
          <div key={item.key} className="text-center p-3 rounded-xl cursor-pointer transition-all bg-white shadow-sm border border-gray-100"
            style={{ backgroundColor: filtroStatus === item.key ? item.color + '20' : item.bg, border: filtroStatus === item.key ? `2px solid ${item.color}` : '1px solid #f3f4f6' }}
            onClick={() => setFiltroStatus(filtroStatus === item.key ? null : item.key)}>
            <p className="text-2xl font-bold" style={{ color: item.color }}>
              {item.icon && <span className="mr-1 text-lg">{item.icon}</span>}
              {item.count}
            </p>
            <p className="text-[11px] text-gray-600 mt-1">{item.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-white rounded-xl p-4 border border-gray-100">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Tipo:</label>
          <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
            className="text-xs border rounded-lg px-2 py-1.5">
            {tiposObra.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-64">
          <label className="text-xs text-gray-500 whitespace-nowrap">Presupuesto:</label>
          <div className="relative flex-1 h-8 flex items-center">
            <div className="absolute h-1 bg-gray-200 rounded w-full" />
            <div className="absolute h-1 bg-blue-500 rounded" style={{ left: `${(presMin / maxPres) * 100}%`, right: `${100 - (presMax / maxPres) * 100}%` }} />
            <input type="range" min={0} max={maxPres} step={100000} value={presMin}
              onChange={e => { const v = Number(e.target.value); if (v <= presMax) setPresMin(v) }}
              className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow" />
            <input type="range" min={0} max={maxPres} step={100000} value={presMax}
              onChange={e => { const v = Number(e.target.value); if (v >= presMin) setPresMax(v) }}
              className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow" />
          </div>
          <span className="text-xs text-gray-500 whitespace-nowrap relative z-10 bg-white pl-1">{formatEur(presMin)} - {formatEur(presMax)}</span>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <MapContainer center={[40.4168, -3.7038]} zoom={12} scrollWheelZoom={true}
          style={{ height: 380, borderRadius: '0.5rem' }}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png" />
          {filtered.filter(o => o.lat && o.lon).map((o, i) => {
            const radius = Math.max(6, Math.min(25, Math.sqrt(o.presupuesto / 1000000) * 3))
            const baseColor = statusColor[o.status] || '#9ca3af'
            const hasFlag = o.retrasada || o.fuera_presupuesto
            const flagHtml = hasFlag ? ((o.fuera_presupuesto ? `<span style="font-size:${(radius * 2 + 4) * 0.45}px;line-height:1;filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))">💰</span>` : '') + (o.retrasada ? `<span style="font-size:${(radius * 2 + 4) * 0.5}px;line-height:1;font-weight:900;filter:brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,.5))">⏱</span>` : '')) : ''
            if (hasFlag) {
              const iconSize = radius * 2 + 4
              return (
                <Marker key={`flagged-${i}`} position={[o.lat, o.lon]}
                  icon={L.divIcon({
                    className: '',
                    html: `<div style="width:${iconSize}px;height:${iconSize}px;border-radius:50%;background:${baseColor};opacity:0.85;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);">${flagHtml}</div>`,
                    iconSize: [iconSize, iconSize],
                    iconAnchor: [iconSize / 2, iconSize / 2]
                  })}>
                  <LeafletTooltip sticky>
                    <div className="text-xs max-w-xs">
                      <p className="font-bold text-sm text-blue-700">{o.titulo}</p>
                      {o.direccion && o.direccion !== '0,00' && o.direccion !== '-' && <p className="mt-1 font-semibold">{o.direccion}</p>}
                      <p><b>Estado:</b> {statusLabel[o.status] || o.estado}
                        {o.retrasada && <span className="ml-1 text-red-600 font-bold">\u23F1 Retrasada</span>}
                        {o.fuera_presupuesto && <span className="ml-1 text-purple-600 font-bold">\uD83D\uDCB0 Fuera de presupuesto</span>}
                      </p>
                      <p><b>Presupuesto:</b> {formatEur(o.presupuesto)}</p>
                      {o.gasto_ejecutado > 0 && <p><b>Ejecutado:</b> {formatEur(o.gasto_ejecutado)} ({o.pct_ejecucion}%)</p>}
                      <p><b>Distrito:</b> {o.distrito}</p>
                      <p><b>Tipo:</b> {o.tipo || 'N/A'}</p>
                      <p><b>Plazo:</b> {o.plazo || 'N/A'}</p>
                    </div>
                  </LeafletTooltip>
                </Marker>
              )
            }
            return (
              <CircleMarker key={i} center={[o.lat, o.lon]} radius={radius}
                fillColor={baseColor} fillOpacity={0.7}
                stroke={true} color="#fff" weight={2}>
                  <LeafletTooltip sticky>
                    <div className="text-xs max-w-xs">
                      <p className="font-bold text-sm text-blue-700">{o.titulo}</p>
                      {o.direccion && o.direccion !== '0,00' && o.direccion !== '-' && <p className="mt-1 font-semibold">{o.direccion}</p>}
                      <p><b>Estado:</b> {statusLabel[o.status] || o.estado}</p>
                      <p><b>Presupuesto:</b> {formatEur(o.presupuesto)}</p>
                      {o.gasto_ejecutado > 0 && <p><b>Ejecutado:</b> {formatEur(o.gasto_ejecutado)} ({o.pct_ejecucion}%)</p>}
                      <p><b>Distrito:</b> {o.distrito}</p>
                      <p><b>Tipo:</b> {o.tipo || 'N/A'}</p>
                      <p><b>Plazo:</b> {o.plazo || 'N/A'}</p>
                    </div>
                  </LeafletTooltip>
              </CircleMarker>
            )
          })}
        </MapContainer>
      </div>

      <div className="flex gap-4 text-xs flex-wrap items-center bg-white rounded-xl p-3 border border-gray-100">
        <span className="text-gray-500 font-semibold">Leyenda:</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#16a34a' }} /> Finalizada</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#2563eb' }} /> En curso</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#9ca3af' }} /> Pendiente / Licitación</span>
        <span className="flex items-center gap-1 border-l pl-3 ml-1"><span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-200 text-sm">{'\uD83D\uDCB0'}</span> Fuera de presupuesto</span>
        <span className="flex items-center gap-1"><span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-200 text-sm">{'\u23F1'}</span> Retrasada</span>
        <span className="text-gray-400 ml-auto">Tamaño = Presupuesto</span>
      </div>

      {alertas.length > 0 && (
        <div className="bg-red-50 rounded-xl border border-red-200 p-4">
          <button onClick={() => setShowAlertas(!showAlertas)}
            className="w-full flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-red-600" />
              <span className="text-sm font-bold text-red-800">
                {alertas.length} alertas de conflicto detectadas
              </span>
              <span className="text-xs text-red-600">
                ({alertas.filter(a => a.severity === 'critica').length} críticas, {alertas.filter(a => a.severity === 'alta').length} altas)
              </span>
            </div>
            {showAlertas ? <ChevronUp size={16} className="text-red-400" /> : <ChevronDown size={16} className="text-red-400" />}
          </button>
          <p className="text-xs text-red-600 mt-1">Proyectos retrasados que pueden afectar a obras cercanas en tráfico, sanidad, movilidad o servicios</p>
          {showAlertas && (
            <div className="mt-3 space-y-2 max-h-96 overflow-y-auto">
              {alertas.map((a, i) => (
                <div key={i} className={`rounded-lg p-3 border text-xs ${
                  a.severity === 'critica' ? 'bg-red-100 border-red-300' :
                  a.severity === 'alta' ? 'bg-orange-50 border-orange-200' :
                  'bg-yellow-50 border-yellow-200'
                }`}>
                  <div className="flex items-start gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-white font-bold uppercase text-[10px] ${
                      a.severity === 'critica' ? 'bg-red-600' :
                      a.severity === 'alta' ? 'bg-orange-500' : 'bg-yellow-500'
                    }`}>{a.severity}</span>
                    <div className="flex-1">
                      <p className="font-semibold text-gray-800">{a.reason}</p>
                      <div className="mt-1 grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-gray-500">Obra retrasada:</p>
                          <p className="font-medium text-red-700">{a.retrasada}</p>
                          <p className="text-gray-400">Plazo: {a.plazo_retrasada} | Ejecución: {a.pct_retrasada}% | {formatEur(a.presupuesto_retrasada)}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Conflicto con:</p>
                          <p className="font-medium text-gray-700">{a.conflicto_con}</p>
                          <p className="text-gray-400">Distrito: {a.distrito_conflicto} | {formatEur(a.presupuesto_conflicto)} | a {a.distancia_km}km</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Listado de Obras Mayores ({filtered.length})</h3>
        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-2">Obra</th>
                <th className="text-left py-2 px-2">Dirección</th>
                <th className="text-left py-2 px-2">Estado</th>
                <th className="text-right py-2 px-2">Presupuesto</th>
                <th className="text-left py-2 px-2">Distrito</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 px-2 max-w-xs truncate" title={o.titulo}>{o.titulo}</td>
                  <td className="py-2 px-2 text-blue-700 font-medium max-w-40 truncate">{o.direccion && o.direccion !== '0,00' && o.direccion !== '-' ? o.direccion : '\u2014'}</td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="px-2 py-0.5 rounded-full text-white text-[10px]"
                        style={{ backgroundColor: statusColor[o.status] || '#9ca3af' }}>
                        {statusLabel[o.status] || o.estado}
                      </span>
                      {o.retrasada && <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold">{'\u23F1'}</span>}
                      {o.fuera_presupuesto && <span className="px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold">{'\uD83D\uDCB0'}</span>}
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right font-mono">{o.presupuesto > 0 ? formatEur(o.presupuesto) : '\u2014'}</td>
                  <td className="py-2 px-2">{o.distrito}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ---- PAGE 4: CONSTRUCTORAS ---- */
function ConstructorasTab({ constructoras }: { constructoras: Constructora[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search) return constructoras
    const s = search.toLowerCase()
    return constructoras.filter(c => c.empresa.toLowerCase().includes(s))
  }, [constructoras, search])

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Ranking de Constructoras por Calidad</h3>
            <p className="text-xs text-gray-400 mt-1">Basado en quejas ciudadanas, retrasos, desviaciones presupuestarias y cobertura</p>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
            <input type="text" placeholder="Buscar empresa..." value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 w-56" />
          </div>
        </div>

        <div className="space-y-2">
          {filtered.map((c, i) => (
            <div key={c.empresa} className="border border-gray-100 rounded-xl overflow-hidden">
              <button onClick={() => setExpanded(expanded === c.empresa ? null : c.empresa)}
                className="w-full flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors text-left">
                <span className="text-lg font-bold text-gray-300 w-8">#{i + 1}</span>
                <div className="flex-1">
                  <p className="font-semibold text-gray-800">{c.empresa}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <StarRating stars={c.estrellas} />
                    <span className="text-xs text-gray-500">({c.puntuacion?.toFixed(1) ?? (c.estrellas * 20).toFixed(1)}/100)</span>
                  </div>
                </div>
                <div className="text-right text-xs text-gray-500">
                  <p>{c.obras_realizadas} obras</p>
                  {c.distritos.length > 0 && <p className="text-gray-400">{c.distritos.length} distritos</p>}
                </div>
                {expanded === c.empresa
                  ? <ChevronUp size={16} className="text-gray-400" />
                  : <ChevronDown size={16} className="text-gray-400" />}
              </button>

              {expanded === c.empresa && (
                <div className="bg-gray-50 p-4 border-t border-gray-100">
                  <h4 className="text-xs font-semibold text-gray-600 mb-3 uppercase">Indicadores de calidad</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div className="bg-white rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-blue-600">{c.obras_realizadas.toLocaleString()}</p>
                      <p className="text-xs text-gray-500">Obras realizadas</p>
                    </div>
                    <div className="bg-white rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-amber-600">{c.quejas_ciudadanas?.toLocaleString() ?? 0}</p>
                      <p className="text-xs text-gray-500">Quejas ciudadanas</p>
                      <p className="text-[10px] text-gray-400">{c.quejas_por_1000_obras?.toFixed(0) ?? 0} por 1.000 obras</p>
                    </div>
                    <div className="bg-white rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-red-600">{c.obras_retrasadas ?? 0}</p>
                      <p className="text-xs text-gray-500">Obras retrasadas</p>
                      <p className="text-[10px] text-gray-400">{c.tasa_retraso_pct?.toFixed(1) ?? 0}% del total</p>
                    </div>
                    <div className="bg-white rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-purple-600">{c.obras_fuera_presupuesto ?? 0}</p>
                      <p className="text-xs text-gray-500">Fuera de presupuesto</p>
                      <p className="text-[10px] text-gray-400">{c.desviacion_media_pct?.toFixed(1) ?? 0}% desv. media</p>
                    </div>
                    <div className="bg-white rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-green-600">{c.obras_mayores ?? 0}</p>
                      <p className="text-xs text-gray-500">Obras mayores</p>
                    </div>
                    <div className="bg-white rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-teal-600">{c.distritos.length}</p>
                      <p className="text-xs text-gray-500">Distritos cubiertos</p>
                    </div>
                  </div>

                  {c.desglose && (
                    <div className="mt-3 bg-white rounded-lg p-3">
                      <h5 className="text-xs font-semibold text-gray-600 mb-2">Desglose de puntuaci&oacute;n ({c.puntuacion?.toFixed(1) ?? '—'}/100)</h5>
                      <div className="space-y-1.5">
                        <div className="flex items-center text-xs">
                          <span className="w-40 text-gray-500">Base</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2 mr-2"><div className="bg-blue-500 h-2 rounded-full" style={{width: '100%'}} /></div>
                          <span className="w-12 text-right font-mono text-gray-700">+{c.desglose.base}</span>
                        </div>
                        <div className="flex items-center text-xs">
                          <span className="w-40 text-gray-500">Quejas ciudadanas</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2 mr-2"><div className="bg-amber-500 h-2 rounded-full" style={{width: `${Math.abs(c.desglose.penalizacion_quejas)}%`}} /></div>
                          <span className="w-12 text-right font-mono text-amber-600">{c.desglose.penalizacion_quejas.toFixed(1)}</span>
                        </div>
                        <div className="flex items-center text-xs">
                          <span className="w-40 text-gray-500">Desv. presupuesto</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2 mr-2"><div className="bg-purple-500 h-2 rounded-full" style={{width: `${Math.abs(c.desglose.penalizacion_presupuesto) * 4}%`}} /></div>
                          <span className="w-12 text-right font-mono text-purple-600">{c.desglose.penalizacion_presupuesto.toFixed(1)}</span>
                        </div>
                        <div className="flex items-center text-xs">
                          <span className="w-40 text-gray-500">Retrasos</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2 mr-2"><div className="bg-red-500 h-2 rounded-full" style={{width: `${Math.abs(c.desglose.penalizacion_retrasos) * 4}%`}} /></div>
                          <span className="w-12 text-right font-mono text-red-600">{c.desglose.penalizacion_retrasos.toFixed(1)}</span>
                        </div>
                        <div className="flex items-center text-xs">
                          <span className="w-40 text-gray-500">Bonus volumen</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2 mr-2"><div className="bg-green-500 h-2 rounded-full" style={{width: `${c.desglose.bonus_volumen * 10}%`}} /></div>
                          <span className="w-12 text-right font-mono text-green-600">+{c.desglose.bonus_volumen.toFixed(1)}</span>
                        </div>
                        <div className="flex items-center text-xs">
                          <span className="w-40 text-gray-500">Bonus cobertura</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2 mr-2"><div className="bg-teal-500 h-2 rounded-full" style={{width: `${c.desglose.bonus_cobertura * 10}%`}} /></div>
                          <span className="w-12 text-right font-mono text-teal-600">+{c.desglose.bonus_cobertura.toFixed(1)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {c.distritos.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs text-gray-500"><b>Distritos:</b> {c.distritos.join(', ')}</p>
                    </div>
                  )}
                  <div className="mt-3 bg-blue-50 rounded-lg p-3">
                    <p className="text-xs text-blue-700">
                      <b>Fuentes:</b> Avisos ciudadanos (Linea Madrid), Inversiones del Ayuntamiento, Licencias de obras, Contratos publicos de datos.madrid.es
                    </p>
                    {c.fuentes_nacionales && (
                      <p className="text-xs text-blue-500 mt-1">
                        <b>Pendiente:</b> {c.fuentes_nacionales.nota}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ---- PAGE 5: ARBOLES ---- */
const treeRedIcon = L.divIcon({
  html: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#dc2626" stroke="#991b1b" stroke-width="1.5"><path d="M12 2L7 9h3l-4 7h4l-5 8h14l-5-8h4l-4-7h3L12 2z"/><rect x="11" y="20" width="2" height="4" fill="#78350f"/></svg>',
  className: '',
  iconSize: [20, 20],
  iconAnchor: [10, 20],
  popupAnchor: [0, -18],
})

function ArbolesTab({ arboles }: { arboles: ArbolIncidente[] }) {
  const [filtroAno, setFiltroAno] = useState('2026')
  const [showReport, setShowReport] = useState(false)
  const [reportAddr, setReportAddr] = useState('')
  const [reportDesc, setReportDesc] = useState('')
  const fileRefTree = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    if (filtroAno === 'Todos') return arboles
    return arboles.filter(a => a.ano === filtroAno)
  }, [arboles, filtroAno])

  const porDistrito = useMemo(() => {
    const map: Record<string, { total: number }> = {}
    filtered.forEach(a => {
      const d = a.distrito || 'Desconocido'
      if (!map[d]) map[d] = { total: 0 }
      map[d].total++
    })
    return Object.entries(map)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 15)
      .map(([d, v]) => ({ name: d.length > 15 ? d.slice(0, 15) + '.' : d, ...v }))
  }, [filtered])

  return (
    <div className="space-y-4">
      <div className="bg-red-50 rounded-xl border border-red-200 p-4">
        <p className="text-sm text-red-800">
          <b>Mapa de árboles en mal estado</b> — {formatNum(filtered.length)} avisos ciudadanos
          de árboles en mal estado registrados (2024-2026). Las zonas con mayor concentración necesitan inspección prioritaria.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <select value={filtroAno} onChange={e => setFiltroAno(e.target.value)}
          className="text-xs border rounded-lg px-3 py-2">
          <option value="Todos">Todos los años</option>
          <option value="2024">2024</option>
          <option value="2025">2025</option>
          <option value="2026">2026</option>
        </select>
        <div className="flex gap-4 text-xs">
          <span className="flex items-center gap-1">
            <TreePine size={14} className="text-red-600" /> Árboles en mal estado ({formatNum(filtered.length)})
          </span>
        </div>
        <button onClick={() => setShowReport(!showReport)}
          className="ml-auto text-xs bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 flex items-center gap-1">
          <TreePine size={14} /> Reportar árbol en mal estado
        </button>
      </div>

      {showReport && (
        <div className="bg-red-50 rounded-xl border border-red-200 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-red-800">Reportar árbol en mal estado</h4>
          <input type="text" placeholder="Dirección o ubicación del árbol..."
            value={reportAddr} onChange={e => setReportAddr(e.target.value)}
            className="w-full text-sm border border-red-200 rounded-lg px-3 py-2" />
          <textarea placeholder="Descripción del problema (ramas caídas, inclinación peligrosa, plaga, etc.)..."
            value={reportDesc} onChange={e => setReportDesc(e.target.value)}
            className="w-full text-sm border border-red-200 rounded-lg px-3 py-2 h-20" />
          <div className="flex items-center gap-3">
            <input ref={fileRefTree} type="file" accept="image/*" className="text-xs" />
            <button onClick={() => { setReportAddr(''); setReportDesc(''); setShowReport(false); alert('Reporte enviado. Gracias por colaborar.') }}
              className="bg-red-600 text-white text-xs px-4 py-2 rounded-lg hover:bg-red-700">Enviar reporte</button>
          </div>
          <p className="text-[10px] text-gray-400">También puedes reportar directamente en <a href="https://avisos.madrid.es" target="_blank" rel="noreferrer" className="underline text-blue-500">avisos.madrid.es</a> o llamando al 010</p>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <MapContainer center={[40.4168, -3.7038]} zoom={12} scrollWheelZoom={true}
          style={{ height: 380, borderRadius: '0.5rem' }}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png" />
          {filtered.slice(0, 3000).map((a, i) => (
            <Marker key={'t' + i} position={[a.lat, a.lon]} icon={treeRedIcon}>
              <LeafletTooltip direction="top" sticky>
                <div className="text-xs">
                  <p className="font-bold text-red-700">Árbol en mal estado</p>
                  <p><b>Distrito:</b> {a.distrito}</p>
                  <p><b>Barrio:</b> {a.barrio}</p>
                  <p><b>Fecha:</b> {a.fecha}</p>
                  {a.direccion && <p><b>Dirección:</b> {a.direccion}</p>}
                </div>
              </LeafletTooltip>
            </Marker>
          ))}
        </MapContainer>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Árboles en mal estado por Distrito (Top 15)</h3>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={porDistrito} layout="vertical" margin={{ left: 5, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis type="number" tick={{ fontSize: 10 }} />
            <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 9 }} />
            <Tooltip />
            <Bar dataKey="total" fill="#dc2626" name="Árboles en mal estado" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* ---- DISTRICT INVESTMENT MAP (reusable) ---- */
function DistrictMap({ presupuestos }: { presupuestos: PresupuestoDistrito[] }) {
  const sorted = useMemo(() => [...presupuestos].sort((a, b) => b.presupuesto - a.presupuesto), [presupuestos])
  const maxPres = Math.max(...sorted.map(p => p.presupuesto), 1)
  const totalInversion = useMemo(() => presupuestos.reduce((s, p) => s + p.presupuesto, 0), [presupuestos])
  const totalObras = useMemo(() => presupuestos.reduce((s, p) => s + p.num_obras, 0), [presupuestos])

  const [geojsonData, setGeojsonData] = useState<GeoJSON.FeatureCollection | null>(null)
  const [hoveredDist, setHoveredDist] = useState<string | null>(null)

  useEffect(() => {
    fetch('/distritos_inversion.geojson')
      .then(r => r.json())
      .then(d => setGeojsonData(d))
      .catch(() => {})
  }, [])

  const getColor = (pres: number) => {
    const ratio = pres / maxPres
    if (ratio > 0.8) return '#1e3a5f'
    if (ratio > 0.6) return '#1e40af'
    if (ratio > 0.45) return '#2563eb'
    if (ratio > 0.3) return '#3b82f6'
    if (ratio > 0.2) return '#60a5fa'
    if (ratio > 0.1) return '#93c5fd'
    return '#dbeafe'
  }

  const styleFeature = (feature: GeoJSON.Feature | undefined) => {
    if (!feature) return {}
    const pres = (feature.properties as Record<string, number>)?.presupuesto ?? 0
    const nombre = (feature.properties as Record<string, string>)?.nombre ?? ''
    const isHovered = hoveredDist === nombre
    return {
      fillColor: getColor(pres),
      weight: isHovered ? 3 : 1.5,
      opacity: 1,
      color: isHovered ? '#1e40af' : '#fff',
      fillOpacity: isHovered ? 0.9 : 0.75,
    }
  }

  const onEachFeature = (feature: GeoJSON.Feature, layer: L.Layer) => {
    const props = feature.properties as Record<string, unknown>
    const nombre = (props.nombre as string) || ''
    const pres = (props.presupuesto as number) || 0
    const nObras = (props.num_obras as number) || 0
    layer.bindTooltip(
      `<div style="font-size:12px"><b>${nombre}</b><br/>` +
      `Inversión: ${formatEur(pres)}<br/>` +
      `N.º obras: ${nObras.toLocaleString('es-ES')}</div>`,
      { sticky: true, direction: 'top' }
    )
    layer.on({
      mouseover: () => setHoveredDist(nombre),
      mouseout: () => setHoveredDist(null),
    })
  }

  return (
    <>
      <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
        <p className="text-sm text-blue-800">
          <b>Inversión en obras por distrito</b> — Mapa colorímetro: a más intensidad de color, mayor inversión.
          Total: <b>{formatEur(totalInversion)}</b> en <b>{totalObras.toLocaleString('es-ES')}</b> obras.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Mapa de Inversión por Distrito</h3>
        <MapContainer center={[40.4168, -3.7038]} zoom={11} scrollWheelZoom={true}
          style={{ height: 380, borderRadius: '0.5rem' }}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png" />
          {geojsonData && (
            <GeoJSON
              key={hoveredDist || 'default'}
              data={geojsonData}
              style={styleFeature}
              onEachFeature={onEachFeature}
            />
          )}
        </MapContainer>
        <div className="flex items-center gap-2 mt-3 text-xs text-gray-500">
          <span>{formatEur(Math.min(...sorted.map(p => p.presupuesto)))}</span>
          <div className="flex h-4 flex-1 rounded overflow-hidden">
            {['#dbeafe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1e40af', '#1e3a5f'].map(c => (
              <div key={c} className="flex-1" style={{ backgroundColor: c }} />
            ))}
          </div>
          <span>{formatEur(maxPres)}</span>
        </div>
      </div>
    </>
  )
}

/* ---- PAGE 7: EDIFICIOS PUBLICOS ---- */
function EdificiosTab({ edificios }: { edificios: EdificioPublico[] }) {
  const [filtroAno, setFiltroAno] = useState('2025')

  const allAnos = useMemo(() => {
    const s = new Set<number>()
    edificios.forEach(e => s.add(e.ano_presupuesto))
    return Array.from(s).sort((a, b) => b - a)
  }, [edificios])

  const filtered = useMemo(() => {
    if (filtroAno === 'Todos') return edificios
    return edificios.filter(e => String(e.ano_presupuesto) === filtroAno)
  }, [edificios, filtroAno])

  const porTipo = useMemo(() => {
    const map: Record<string, { proyectos: number; presupuesto: number; ejecutado: number }> = {}
    filtered.forEach(e => {
      if (!map[e.tipo]) map[e.tipo] = { proyectos: 0, presupuesto: 0, ejecutado: 0 }
      map[e.tipo].proyectos++
      map[e.tipo].presupuesto += e.presupuesto
      map[e.tipo].ejecutado += e.ejecutado
    })
    return Object.entries(map)
      .sort((a, b) => b[1].presupuesto - a[1].presupuesto)
      .map(([k, v]) => ({ name: k, proyectos: v.proyectos, presupuesto: v.presupuesto, ejecutado: v.ejecutado, media: v.proyectos > 0 ? v.presupuesto / v.proyectos : 0 }))
  }, [filtered])

  const totalPresupuesto = filtered.reduce((s, e) => s + e.presupuesto, 0)
  const chartHeight = Math.max(300, porTipo.length * 28)

  return (
    <div className="space-y-4">
      <div className="bg-purple-50 rounded-xl border border-purple-200 p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm text-purple-800">
              <b>Inversiones en edificios públicos</b> — Proyectos de inversión del Ayuntamiento de Madrid en
              colegios, centros deportivos, bibliotecas, centros culturales, mercados y otros equipamientos municipales.
            </p>
          </div>
          <select value={filtroAno} onChange={e => setFiltroAno(e.target.value)}
            className="text-sm border-2 border-purple-300 rounded-lg px-3 py-2 bg-white font-semibold text-purple-700">
            <option value="Todos">Todos</option>
            {allAnos.map(a => <option key={a} value={String(a)}>{a}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 text-center">
          <p className="text-2xl font-bold text-purple-700">{filtered.length}</p>
          <p className="text-xs text-gray-500">Proyectos</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 text-center">
          <p className="text-2xl font-bold text-purple-700">{formatEur(totalPresupuesto)}</p>
          <p className="text-xs text-gray-500">Presupuesto Total</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Presupuesto por Tipo de Edificio{filtroAno !== 'Todos' ? ` (${filtroAno})` : ''}</h3>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart data={porTipo} layout="vertical" margin={{ left: 5, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v: number) => formatEur(v)} />
            <YAxis dataKey="name" type="category" width={180} tick={{ fontSize: 10 }} interval={0} />
            <Tooltip content={({ active, payload }: any) => {
              if (!active || !payload?.length) return null
              const d = payload[0].payload
              return (<div className="bg-white border border-gray-200 rounded-lg shadow-lg p-2 text-xs">
                <p className="font-semibold">{d.name}</p>
                <p style={{ color: '#7c3aed' }}>Presupuesto: {formatEur(d.presupuesto)}</p>
                <p className="text-gray-600">N.º proyectos: {d.proyectos}</p>
                <p className="text-gray-600">Media por proyecto: {formatEur(d.media)}</p>
              </div>)
            }} />
            <Bar dataKey="presupuesto" fill="#7c3aed" radius={[0, 4, 4, 0]} name="Presupuesto" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* ---- PAGE 8: PREDICCION ---- */
function PresupuestoCombinedTab({ prediccion, presupuestos }: { prediccion: Prediccion, presupuestos: PresupuestoDistrito[] }) {
  const ejecutado2026 = 90086000
  const estimadoTotal2026 = prediccion.presupuesto_estimado_final
  const estimadoRestante2026 = Math.max(0, estimadoTotal2026 - ejecutado2026)

  const chartData = [...(prediccion.historico || []).map(h => ({
    ano: h.ano,
    presupuesto_inicial: h.presupuesto_inicial,
    ejecutado_real: h.presupuesto_final,
    ejecutado_estimado: 0
  })), {
    ano: 2026,
    presupuesto_inicial: prediccion.presupuesto_original,
    ejecutado_real: ejecutado2026,
    ejecutado_estimado: estimadoRestante2026
  }]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <BigNumber value={formatEur(prediccion.presupuesto_original)} label="Presupuesto Original 2026" color="text-blue-600" />
        <BigNumber value={prediccion.desviacion_historica_pct + '%'} label="Desviación Histórica Media" color="text-amber-600" />
        <BigNumber value={formatEur(prediccion.desviacion_estimada)} label="Desviación Estimada 2026" sub="Infraejecución proyectada" color="text-rose-600" />
        <BigNumber value={formatEur(prediccion.presupuesto_estimado_final)} label="Gasto Final Estimado 2026" color="text-emerald-600" />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Evolución Histórica de Presupuesto</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="ano" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatEur(v)} />
              <Tooltip content={({ active, payload, label }: any) => {
                if (!active || !payload) return null
                const items = payload.filter((p: any) => p.value > 0 && (p.dataKey !== 'ejecutado_estimado' || label === 2026))
                if (!items.length) return null
                return (<div className="bg-white border border-gray-200 rounded-lg shadow-lg p-2 text-xs">
                  <p className="font-semibold mb-1">{label}</p>
                  {items.map((p: any, i: number) => (
                    <p key={i} style={{ color: p.fill }}>{p.name}: {formatEur(p.value)}</p>
                  ))}
                </div>)
              }} />
              <Bar dataKey="presupuesto_inicial" fill="#3b82f6" name="Presupuesto Aprobado" radius={[4, 4, 0, 0]} />
              <Bar dataKey="ejecutado_real" stackId="gasto" fill="#ef4444" name="Gasto Ejecutado" radius={[0, 0, 0, 0]} />
              <Bar dataKey="ejecutado_estimado" stackId="gasto" fill="#fca5a5" name="Estimación Restante (2026)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
      </div>

      <DistrictMap presupuestos={presupuestos} />
    </div>
  )
}

/* ---- FLOATING ASSISTANT WIDGET ---- */
interface ChatMsg { role: 'user' | 'bot'; text: string }

function FloatingAssistant({ kpis, constructoras, prediccion }: {
  kpis: KPIs; constructoras: Constructora[]; prediccion: Prediccion
}) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: 'bot', text: '¡Hola! Soy el asistente IA de Madrid ObraTransparente. Puedo analizar datos de obras, constructoras, presupuestos y más. Pregúntame lo que quieras:' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)

  const suggestions = [
    '¿Cuánto se ha desviado el presupuesto?',
    '¿Qué constructora tiene peor valoración?',
    '¿Qué distritos tienen más inversión?',
    '¿Qué obras tienen incidencias críticas?'
  ]

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages])

  const buildSystemPrompt = (): string => {
    const top3 = [...constructoras].sort((a, b) => b.estrellas - a.estrellas).slice(0, 3)
    const bot3 = [...constructoras].sort((a, b) => a.estrellas - b.estrellas).slice(0, 3)
    return `Eres el asistente IA de Madrid ObraTransparente, una plataforma de transparencia en obras públicas del Ayuntamiento de Madrid. Responde SIEMPRE en español. Sé conciso y usa datos concretos.

DATOS ACTUALES:
- Obras urbanas registradas: ${formatNum(kpis.total_obras_urbanas)}
- Direcciones con obras recurrentes (3+ intervenciones): ${formatNum(kpis.total_recurrentes)}
- Obras activas: ${formatNum(kpis.total_obras_activas)}
- Incidencias críticas: ${formatNum(kpis.incidencias_criticas)}
- Árboles en mal estado: ${formatNum(kpis.total_arboles_riesgo)}
- Obras ejecutadas en plazo (2025): ${kpis.obras_en_plazo_pct}%
- Presupuesto Original 2026: ${formatEur(prediccion.presupuesto_original)}
- Desviación histórica media: ${prediccion.desviacion_historica_pct}%
- Gasto final estimado 2026: ${formatEur(prediccion.presupuesto_estimado_final)}
- Desviación estimada 2026: ${formatEur(prediccion.desviacion_estimada)}
- Mejores constructoras: ${top3.map(c => c.empresa + ' (' + c.estrellas.toFixed(1) + '★)').join(', ')}
- Peores constructoras: ${bot3.map(c => c.empresa + ' (' + c.estrellas.toFixed(1) + '★)').join(', ')}
- Total constructoras evaluadas: ${constructoras.length}

Fuentes: datos.madrid.es, presupuestosabiertos.madrid.es, notas de prensa madrid.es.
Si no tienes datos suficientes para responder algo, dilo honestamente.`
  }

  const callHF = async (userMsg: string, history: ChatMsg[]): Promise<string> => {
    const apiMessages = history
      .filter(m => m.role !== 'bot' || history.indexOf(m) > 0)
      .map(m => ({ role: m.role === 'bot' ? 'assistant' : 'user', content: m.text }))
    apiMessages.push({ role: 'user', content: userMsg })

    try {
      const HF_TOKEN = import.meta.env.VITE_HF_TOKEN || ''
      if (!HF_TOKEN) return fallbackRespond(userMsg)
      const resp = await fetch('https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + HF_TOKEN },
        body: JSON.stringify({ inputs: buildSystemPrompt() + '\n' + apiMessages.map(m => m.role + ': ' + m.content).join('\n'), parameters: { max_new_tokens: 512, temperature: 0.7 } })
      })
      if (!resp.ok) throw new Error('API error: ' + resp.status)
      const data = await resp.json()
      return data?.[0]?.generated_text || fallbackRespond(userMsg)
    } catch (err) {
      console.error('HF API error:', err)
      return fallbackRespond(userMsg)
    }
  }

  const fallbackRespond = (question: string): string => {
    const q = question.toLowerCase()

    if (q.includes('recurrente') || q.includes('evitar') || q.includes('repetid'))
      return 'Hay ' + formatNum(kpis.total_recurrentes) + ' direcciones con 3 o más intervenciones repetidas en los últimos años. Las más problemáticas son calas programadas y canalizaciones.\n\nRecomendaciones:\n1. Priorizar reparaciones definitivas en las 50 direcciones con más recurrencia\n2. Evaluar si las constructoras responsables están cumpliendo estándares de calidad\n3. Considerar inversiones en infraestructura subterránea para reducir calas\n\nConsulta la pestaña "Obras Urbanas" para ver el detalle por dirección.'

    if (q.includes('constructora') || q.includes('licitaci') || q.includes('renovar') || q.includes('empresa')) {
      const worst = [...constructoras].sort((a, b) => a.estrellas - b.estrellas).slice(0, 5)
      const best = [...constructoras].sort((a, b) => b.estrellas - a.estrellas).slice(0, 5)
      const mentioned = q.match(/(?:a|de|sobre)\s+([\wÁ-ú\s]+?)[\s?]*$/i)
      if (mentioned) {
        const name = mentioned[1].trim().toUpperCase()
        const found = constructoras.find(c => c.empresa.toUpperCase().includes(name))
        if (found) {
          let r = '📊 ' + found.empresa + '\n'
          r += '• Valoración: ' + found.estrellas.toFixed(1) + '★ (' + found.puntuacion + '/100 pts)\n'
          r += '• Obras realizadas: ' + found.obras_realizadas + '\n'
          r += '• Obras retrasadas: ' + found.obras_retrasadas + '\n'
          r += '• Quejas ciudadanas: ' + found.quejas_ciudadanas + '\n'
          r += found.estrellas >= 4 ? '\nRecomendación: SÍ renovar licitación.' : found.estrellas >= 3 ? '\nRecomendación: Renovar con condiciones de mejora.' : '\nRecomendación: NO renovar. Buscar alternativa.'
          return r
        }
      }
      let response = 'Se han evaluado ' + constructoras.length + ' constructoras.\n\n⭐ Mejores valoradas:\n'
      response += best.map((c, i) => (i + 1) + '. ' + c.empresa + ' — ' + c.estrellas.toFixed(1) + '★ (' + c.obras_realizadas + ' obras)').join('\n')
      response += '\n\n⚠️ Peores valoradas (considerar no renovar):\n'
      response += worst.map((c, i) => (i + 1) + '. ' + c.empresa + ' — ' + c.estrellas.toFixed(1) + '★ (' + c.obras_retrasadas + ' retrasos)').join('\n')
      response += '\n\nPregúntame por una constructora específica para ver su ficha completa.'
      return response
    }

    if (q.includes('inicial') || q.includes('modificacion') || q.includes('partida') || q.includes('aprobado a inicio'))
      return 'Desglose del presupuesto de inversiones (Cap. 6) por año:\n\n2025: Inicial ~667M€ → Aprobado 768M€ (+15%)\n2024: Inicial ~523M€ → Aprobado 603M€ (+15%)\n2023: Inicial ~622M€ → Aprobado 715M€ (+15%)\n2022: Inicial ~620M€ → Aprobado 852M€ (+37%)\n2021: Inicial ~504M€ → Aprobado 653M€ (+30%)\n2020: Inicial ~490M€ → Aprobado 615M€ (+26%)\n\nLas modificaciones incluyen remanentes de tesorería y créditos extraordinarios.\nFuente: presupuestosabiertos.madrid.es y notas de prensa madrid.es.'

    if (q.includes('presupuesto') || q.includes('desvia') || q.includes('gasto'))
      return '📊 Resumen presupuestario 2026:\n\n• Presupuesto Original: ' + formatEur(prediccion.presupuesto_original) + '\n• Desviación histórica media (ponderada): ' + prediccion.desviacion_historica_pct + '%\n• Gasto final estimado: ' + formatEur(prediccion.presupuesto_estimado_final) + '\n• Desviación estimada: ' + formatEur(prediccion.desviacion_estimada) + '\n\nHistóricamente, el Ayto. ejecuta ~80% del presupuesto aprobado. Pregúntame "¿cuánto se aprobó a inicio de año?" para ver el desglose por año.'

    if (q.includes('distrito') || q.includes('inversión') || q.includes('inversion') || q.includes('zona') || q.includes('barrio'))
      return 'La inversión en obras se distribuye en 21 distritos de Madrid. Consulta la pestaña "Presupuesto" para ver el mapa colorimétrico con la inversión real por distrito (datos oficiales de datos.madrid.es).\n\nTotal inversión distritalizable 2026: 610.9M € en 486 proyectos.\nDistrito con más inversión: Latina (181.7M € — incluye Operación Campamento)\nMenor inversión: Moratalaz (4.6M €)'

    if (q.includes('barrio') || q.includes('pendiente') || q.includes('mantenimiento'))
      return 'Actualmente hay ' + formatNum(kpis.total_obras_urbanas) + ' obras de mantenimiento urbano registradas, con ' + formatNum(kpis.total_recurrentes) + ' direcciones recurrentes.\n\nConsulta la pestaña "Obras Urbanas" para ver el mapa detallado con filtros por tipo y estado.'

    if (q.includes('árbol') || q.includes('arbol') || q.includes('arbolado'))
      return '🌳 Se han registrado ' + formatNum(kpis.total_arboles_riesgo) + ' incidencias de arbolado en los últimos años.\n\nConsulta la pestaña "Árboles" para ver:\n• Mapa de incidencias por ubicación\n• Gráfico de árboles en mal estado por distrito (Top 15)\n• Filtros por distrito y año'

    if (q.includes('incidencia') || q.includes('crítica') || q.includes('critica') || q.includes('alerta'))
      return '⚠️ Hay ' + formatNum(kpis.incidencias_criticas) + ' incidencias críticas activas. Incluyen obras paralizadas, protestas vecinales, denuncias judiciales y riesgos sanitarios.\n\nConsulta el panel "General" para ver el listado completo con nivel de impacto y estado.'

    if (q.includes('plazo') || q.includes('retraso') || q.includes('puntual'))
      return '⏱️ El ' + kpis.obras_en_plazo_pct + '% de las obras se ejecutaron en plazo en 2025.\n\nEsto significa que casi la mitad de las obras sufren retrasos. Los factores principales son:\n• Ampliaciones de plazo solicitadas por constructoras\n• Imprevistos en subsuelo\n• Trámites administrativos\n\nConsulta "Obras Mayores" para ver el detalle por obra.'

    if (q.includes('activa') || q.includes('en curso') || q.includes('ejecut'))
      return 'Actualmente hay ' + formatNum(kpis.total_obras_activas) + ' obras activas en la ciudad de Madrid.\n\nPuedes verlas en detalle en las pestañas "Obras Urbanas" (mantenimiento) y "Obras Mayores" (grandes proyectos).'

    if (q.includes('hola') || q.includes('buenos') || q.includes('buenas'))
      return '¡Hola! Soy el asistente de Madrid ObraTransparente. Puedo ayudarte con:\n\n• Análisis de constructoras y licitaciones\n• Presupuesto y desviaciones\n• Obras recurrentes y cómo evitarlas\n• Inversión por distrito\n• Incidencias críticas\n• Arbolado en mal estado\n\n¿Sobre qué quieres saber?'

    if (q.includes('ayuda') || q.includes('puedes') || q.includes('haces') || q.includes('funciona'))
      return 'Puedo ayudarte con:\n\n📊 Presupuesto — desviaciones, estimaciones 2026\n🏗️ Constructoras — valoraciones, recomendación de renovación\n🔄 Obras recurrentes — direcciones problemáticas\n🗺️ Distritos — inversión por zona\n⚠️ Incidencias — alertas críticas activas\n🌳 Árboles — incidencias de arbolado\n⏱️ Plazos — obras retrasadas\n\nPregúntame directamente o pulsa una de las sugerencias.'

    return 'No tengo datos específicos sobre eso, pero puedo ayudarte con:\n• Presupuesto y desviaciones\n• Constructoras y licitaciones\n• Obras recurrentes\n• Inversión por distrito\n• Incidencias críticas\n• Arbolado\n• Plazos y retrasos\n\n¿Sobre cuál quieres saber más?'
  }

  const handleSend = async (text?: string) => {
    const msg = text || input.trim()
    if (!msg || loading) return
    const newMessages: ChatMsg[] = [...messages, { role: 'user', text: msg }]
    setMessages(newMessages)
    setInput('')
    setLoading(true)
    const reply = await callHF(msg, messages)
    setMessages(prev => [...prev, { role: 'bot', text: reply }])
    setLoading(false)
  }

  return (
    <>
      {/* Floating button */}
      <button onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-[9999] w-14 h-14 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-full shadow-lg hover:shadow-xl flex items-center justify-center transition-all hover:scale-105"
        title="Asistente ObraTransparente">
        {open ? <X size={24} className="text-white" /> : <MessageCircle size={24} className="text-white" />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-[9999] w-96 max-h-[520px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-3 flex items-center gap-3 shrink-0">
            <MessageCircle size={20} className="text-white" />
            <div className="flex-1">
              <h3 className="text-white font-semibold text-sm">Asistente ObraTransparente</h3>
              <p className="text-blue-100 text-[10px]">Pregunta sobre obras, constructoras, presupuestos...</p>
            </div>
            {messages.length > 1 && (
              <button onClick={() => { setMessages([{ role: 'bot', text: '¡Hola! Soy el asistente IA de Madrid ObraTransparente. Puedo analizar datos de obras, constructoras, presupuestos y más. Pregúntame lo que quieras:' }]); setInput('') }}
                className="text-white/70 hover:text-white" title="Nuevo chat">
                <RotateCcw size={16} />
              </button>
            )}
            <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white">
              <X size={18} />
            </button>
          </div>

          <div ref={chatRef} className="flex-1 overflow-y-auto p-3 space-y-2" style={{ maxHeight: 320 }}>
            {messages.map((m, i) => (
              <div key={i} className={'flex ' + (m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={'max-w-[85%] rounded-2xl px-3 py-2 text-xs whitespace-pre-line ' +
                  (m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800')}>
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-2xl px-4 py-3 text-xs text-gray-500 flex items-center gap-2">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                  Pensando...
                </div>
              </div>
            )}
          </div>

          {messages.length <= 1 && (
            <div className="px-3 pb-2 shrink-0">
              <p className="text-[10px] text-gray-400 mb-1.5">Ejemplos de lo que puedo hacer:</p>
              <div className="flex flex-col gap-1.5">
                {suggestions.map((s, i) => (
                  <button key={i} onClick={() => handleSend(s)}
                    className="text-left text-[11px] bg-gray-50 hover:bg-blue-50 text-gray-600 hover:text-blue-700 px-3 py-2 rounded-lg transition-colors border border-gray-200">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-gray-100 p-2 flex gap-2 shrink-0">
            <input type="text" value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Escribe tu pregunta..."
              className="flex-1 text-xs border border-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            <button onClick={() => handleSend()} disabled={loading}
              className={'text-white p-2 rounded-xl ' + (loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700')}>
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}

/* ---- MAIN APP ---- */
function App() {
  const [tab, setTab] = useState<Tab>('General')

  const kpis = useData<KPIs>('/kpis.json', {
    pct_obras_en_plazo: 0, desviacion_media_presupuesto: 0, num_obras_activas: 0,
    pct_incidencias_criticas: 0, total_obras_mayores: 0, total_obras_urbanas: 0,
    total_licencias: 0, total_sanciones: 0, total_recurrentes: 0,
    total_arboles_riesgo: 0, presupuesto_total: 0, total_constructoras: 0,
    total_edificios_publicos: 0
  })
  const obrasMayores = useData<ObraMayor[]>('/obras_mayores.json', [])
  const alertasConflictos = useData<AlertaConflicto[]>('/alertas_conflictos.json', [])
  const obrasUrbanas = useData<ObraUrbana[]>('/obras_urbanas.json', [])
  const constructoras = useData<Constructora[]>('/constructoras.json', [])
  const arboles = useData<ArbolIncidente[]>('/arboles.json', [])
  const presupuestos = useData<PresupuestoDistrito[]>('/presupuesto_distritos.json', [])
  const edificios = useData<EdificioPublico[]>('/edificios_publicos.json', [])
  const incidencias = useData<IncidenciaCritica[]>('/incidencias_criticas.json', [])
  const prediccion = useData<Prediccion>('/prediccion.json', {
    presupuesto_original: 0, desviacion_historica_pct: 0, factor_recurrencia: 0,
    factor_emergencias: 0, presupuesto_estimado_final: 0, desviacion_estimada: 0,
    factores: [], historico: []
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center">
                <Building2 size={20} className="text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">Madrid ObraTransparente</h1>
                <p className="text-xs text-gray-400">Sistema de Transparencia en Obras Públicas</p>
              </div>
            </div>
            <span className="text-xs text-gray-400 hidden md:block">Datos: datos.madrid.es | Portal de Datos Abiertos</span>
          </div>
        </div>
      </header>

      <nav className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-0.5 overflow-x-auto">
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={'px-3 py-3 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ' +
                  (tab === t
                    ? 'border-blue-600 text-blue-700 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300')}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {tab === 'General' && <PanelTab kpis={kpis} incidencias={incidencias} />}
        {tab === 'Obras Urbanas' && <ObrasUrbanasTab obras={obrasUrbanas} />}
        {tab === 'Obras Mayores' && <ObrasMayoresTab obras={obrasMayores} alertas={alertasConflictos} />}
        {tab === 'Constructoras' && <ConstructorasTab constructoras={constructoras} />}
        {tab === 'Árboles' && <ArbolesTab arboles={arboles} />}
        {tab === 'Presupuesto' && <PresupuestoCombinedTab prediccion={prediccion} presupuestos={presupuestos} />}
        {tab === 'Edificios Púb.' && <EdificiosTab edificios={edificios} />}
      </main>

      <footer className="bg-white border-t border-gray-200 mt-8 py-4">
        <div className="max-w-7xl mx-auto px-4 text-center text-xs text-gray-400">
          <p>Madrid ObraTransparente | Datos abiertos del Ayuntamiento de Madrid (datos.madrid.es)</p>
          <p className="mt-1">Fuentes: Actividad Contractual, Licencias de Obras, Avisos Ciudadanos, Inversiones, Sanciones, Arbolado, Presupuestos</p>
        </div>
      </footer>

      <FloatingAssistant kpis={kpis} constructoras={constructoras} prediccion={prediccion} />
    </div>
  )
}

export default App
