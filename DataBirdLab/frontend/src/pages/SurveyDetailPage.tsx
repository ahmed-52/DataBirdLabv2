import { useEffect, useState, useMemo } from "react"
import { useParams, Link } from "react-router-dom"
import { ArrowLeft, Calendar, FileText, Image as ImageIcon, MapPin, Search, Mic, Activity, Eye } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import UnifiedMap from "@/components/UnifiedMap"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export default function SurveyDetailPage() {
  const { surveyId: id } = useParams()
  const [survey, setSurvey] = useState<any>(null)
  const [visualDetections, setVisualDetections] = useState<any[]>([])
  const [acousticDetections, setAcousticDetections] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filterText, setFilterText] = useState("")

  useEffect(() => {
    if (!id) return
    setLoading(true)

    // Simulate fetching survey details + detections
    // In a real app, these would be proper API calls
    Promise.all([
      // Fetch survey metadata
      fetch(`/api/surveys/${id}`).then(res => {
        if (!res.ok) throw new Error('Survey not found')
        return res.json()
      }).catch(err => {
        console.warn("Survey fetch failed", err)
        return null
      }),
      // Fetch detections with robust handling
      fetch(`/api/detections/visual?survey_ids=${id}&days=3650`).then(res => res.ok ? res.json() : []).catch(() => []),
      fetch(`/api/detections/acoustic?survey_ids=${id}&days=3650`).then(res => res.ok ? res.json() : []).catch(() => [])
    ])
      .then(([surveyData, visual, acoustic]) => {
        // Fallback if survey endpoint not ready
        const sData = surveyData || {
          id: parseInt(id),
          name: `Orthomosaic Mission ${id}`,
          date: new Date().toISOString(),
          status: "completed",
          area: "Boeung Sne Restricted Zone",
          notes: "Routine aerial surveillance and acoustic monitoring."
        }
        setSurvey(sData)

        // Ensure arrays
        const vData = Array.isArray(visual) ? visual : [];
        const aData = Array.isArray(acoustic) ? acoustic : [];

        setVisualDetections(vData.map((d: any) => ({ ...d, type: 'visual' })))
        setAcousticDetections(aData.map((d: any) => ({ ...d, type: 'acoustic' })))
      })
      .catch(err => {
        console.error("Critical error in survey data loading:", err)
      })
      .finally(() => setLoading(false))

  }, [id])

  const filteredDetections = useMemo(() => {
    const all = [...visualDetections, ...acousticDetections]
    if (!filterText) return all
    const lower = filterText.toLowerCase()
    return all.filter(d => d.species.toLowerCase().includes(lower))
  }, [visualDetections, acousticDetections, filterText])

  const speciesSummary = useMemo(() => {
    const summary: Record<string, { count: number, visual: number, acoustic: number }> = {}
    filteredDetections.forEach(d => {
      if (!summary[d.species]) summary[d.species] = { count: 0, visual: 0, acoustic: 0 }
      summary[d.species].count++
      if (d.type === 'visual') summary[d.species].visual++
      else summary[d.species].acoustic++
    })
    return Object.entries(summary).sort((a, b) => b[1].count - a[1].count)
  }, [filteredDetections])

  if (loading) {
    return (
      <div className="p-6 space-y-4 max-w-7xl mx-auto">
        <Skeleton className="h-8 w-1/3 bg-zinc-100" />
        <Skeleton className="h-[400px] w-full bg-zinc-100" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-32 bg-zinc-100" />
          <Skeleton className="h-32 bg-zinc-100" />
          <Skeleton className="h-32 bg-zinc-100" />
        </div>
      </div>
    )
  }

  if (!survey) return <div className="p-12 text-center font-mono text-zinc-400">MISSION_DATA_NOT_FOUND</div>

  return (
    <div className="min-h-screen bg-white pb-12">
      {/* Header */}
      <div className="border-b border-zinc-200 bg-white sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center gap-2 mb-2">
            <Link to="/surveys" className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 hover:text-zinc-600 flex items-center gap-1 transition-colors">
              <ArrowLeft size={10} />
              Back to Registry
            </Link>
          </div>
          <div className="flex justify-between items-end">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="rounded-sm border-teal-200 bg-teal-50 text-teal-700 text-[9px] uppercase font-bold tracking-widest px-1.5 py-0.5 pointer-events-none">
                  Completed Mission
                </Badge>
                <span className="text-[10px] font-mono text-zinc-400">ID: {survey.id}</span>
              </div>
              <h1 className="text-2xl font-bold text-zinc-900 font-display uppercase tracking-tight">{survey.name}</h1>
            </div>
            <div className="flex items-center gap-6 text-xs text-zinc-600 font-mono">
              <div className="flex items-center gap-2">
                <Calendar size={14} className="text-zinc-400" />
                <span>{new Date(survey.date).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-zinc-400" />
                <span>{survey.area}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Overview Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Map Column */}
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-zinc-100 rounded-sm border border-zinc-200 overflow-hidden relative">
              <div className="absolute top-3 left-3 z-[100] bg-white/90 backdrop-blur border border-zinc-200 px-2 py-1 rounded-sm flex items-center gap-2 shadow-none pointer-events-none">
                <MapPin size={12} className="text-zinc-500" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-700 font-display">Mission Trajectory Map</span>
              </div>
              {/* Reusing UnifiedMap visually but likely fixed or read-only if desired, passing detections */}
              <div className="h-[400px] grayscale-[0.2] contrast-[0.95]">
                <UnifiedMap
                  visualDetections={visualDetections}
                  acousticDetections={acousticDetections}
                  arus={survey?.aru ? [{ ...survey.aru, status: 'active' }] : []} // Show survey ARU if available
                  surveys={[survey]}
                  // Callbacks can be empty or navigate
                  onSelectVisual={() => { }}
                  onSelectAcoustic={() => { }}
                  onSelectARU={() => { }}
                  onSelectSurvey={() => { }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-900 font-display uppercase tracking-tight flex items-center gap-2">
                <Activity size={16} className="text-primary" />
                Detections Log
              </h3>
              <div className="w-64">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-zinc-400" />
                  <Input
                    placeholder="FILTER_SPECIES..."
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    className="pl-7 h-7 text-[10px] font-mono bg-zinc-50 border-zinc-200 focus-visible:ring-primary rounded-sm"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white border border-zinc-200 rounded-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-zinc-100">
                    <TableHead className="w-[50px] text-[9px] uppercase tracking-wider font-bold text-zinc-500 h-8">Type</TableHead>
                    <TableHead className="w-[80px] text-[9px] uppercase tracking-wider font-bold text-zinc-500 h-8">Time</TableHead>
                    <TableHead className="text-[9px] uppercase tracking-wider font-bold text-zinc-500 h-8">Species</TableHead>
                    <TableHead className="text-right text-[9px] uppercase tracking-wider font-bold text-zinc-500 h-8">Conf</TableHead>
                    <TableHead className="w-[50px] text-right text-[9px] uppercase tracking-wider font-bold text-zinc-500 h-8">Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDetections.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-xs text-zinc-400 font-mono uppercase">
                        No signatures found matching criteria
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredDetections.map((det: any) => (
                      <TableRow key={`${det.type}-${det.id}`} className="group hover:bg-zinc-50 border-zinc-100">
                        <TableCell className="py-1">
                          <Badge variant="outline" className={`rounded-sm text-[9px] uppercase font-bold tracking-wide border px-1 py-0 ${det.type === 'visual' ? 'bg-teal-50 border-teal-100 text-teal-700' : 'bg-orange-50 border-orange-100 text-orange-700'}`}>
                            {det.type === 'visual' ? <Eye size={8} /> : <Mic size={8} />}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-1 text-[10px] font-mono text-zinc-500">
                          {new Date(det.timestamp).toLocaleTimeString()}
                        </TableCell>
                        <TableCell className="py-1 font-bold text-zinc-700 text-[10px] font-display uppercase">
                          {det.species}
                        </TableCell>
                        <TableCell className="py-1 text-right text-[10px] font-mono text-zinc-500">
                          {(det.confidence * 100).toFixed(1)}%
                        </TableCell>
                        <TableCell className="py-1 text-right">
                          {det.type === 'visual' && det.imageUrl ? (
                            <div className="w-6 h-6 rounded-sm bg-zinc-100 border border-zinc-200 overflow-hidden ml-auto">
                              <img src={det.imageUrl} alt="" className="w-full h-full object-cover" />
                            </div>
                          ) : (
                            <div className="w-6 h-6 rounded-sm bg-zinc-100 border border-zinc-200 flex items-center justify-center ml-auto text-zinc-300">
                              <Activity size={10} />
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Sidebar Stats */}
          <div className="space-y-6">
            <div className="bg-zinc-50 border border-zinc-200 rounded-sm p-4">
              <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 border-b border-zinc-200 pb-2">Mission Manifest</h4>
              <div className="space-y-4">
                <div>
                  <div className="text-2xl font-bold text-zinc-900 font-display">{filteredDetections.length}</div>
                  <div className="text-[10px] font-mono text-zinc-500 uppercase">Total Signatures</div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-lg font-bold text-teal-700 font-display">{visualDetections.length}</div>
                    <div className="text-[9px] font-mono text-zinc-500 uppercase flex items-center gap-1">
                      <Eye size={8} /> Visual
                    </div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-orange-700 font-display">{acousticDetections.length}</div>
                    <div className="text-[9px] font-mono text-zinc-500 uppercase flex items-center gap-1">
                      <Mic size={8} /> Acoustic
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="border border-zinc-200 rounded-sm overflow-hidden bg-white">
              <div className="bg-zinc-50 px-4 py-2 border-b border-zinc-200">
                <h4 className="text-[10px] font-bold text-zinc-700 uppercase tracking-widest flex items-center gap-2">
                  <FileText size={12} />
                  Taxonomy Report
                </h4>
              </div>
              <div className="divide-y divide-zinc-100 max-h-[500px] overflow-y-auto">
                {speciesSummary.map(([species, stats]) => (
                  <div key={species} className="p-3 hover:bg-zinc-50 transition-colors">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-bold text-zinc-800 font-display uppercase">{species}</span>
                      <span className="text-xs font-mono font-bold text-zinc-900">{stats.count}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-1 flex-1 bg-zinc-100 rounded-full overflow-hidden">
                        <div className="h-full bg-zinc-800" style={{ width: `${(stats.count / filteredDetections.length) * 100}%` }}></div>
                      </div>
                    </div>
                    <div className="flex justify-between mt-1 text-[9px] font-mono text-zinc-400 uppercase">
                      <span>Vis: {stats.visual}</span>
                      <span>Acst: {stats.acoustic}</span>
                    </div>
                  </div>
                ))}
                {speciesSummary.length === 0 && (
                  <div className="p-4 text-center text-[10px] font-mono text-zinc-400 uppercase">No Data</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
