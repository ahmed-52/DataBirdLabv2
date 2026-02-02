import { useEffect, useState, useMemo } from "react"
import { Eye, Mic, Search, SlidersHorizontal, ArrowUpDown, Activity } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"

export default function DetectionsPage() {
  const [visualData, setVisualData] = useState<any[]>([])
  const [acousticData, setAcousticData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [sortField, setSortField] = useState("confidence")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [page, setPage] = useState(0)
  const pageSize = 25

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch("/api/detections/visual?days=30").then((r) => r.json()),
      fetch("/api/detections/acoustic?days=30").then((r) => r.json()),
    ])
      .then(([visual, acoustic]) => {
        setVisualData(visual.map((d: any) => ({ ...d, type: "visual" })))
        setAcousticData(acoustic.map((d: any) => ({ ...d, type: "acoustic" })))
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const filterAndSort = (data: any[]) => {
    let filtered = data
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (d) =>
          d.species?.toLowerCase().includes(q) ||
          d.survey_name?.toLowerCase().includes(q)
      )
    }
    filtered.sort((a, b) => {
      const aVal = a[sortField] ?? 0
      const bVal = b[sortField] ?? 0
      if (sortDir === "asc") return aVal > bVal ? 1 : -1
      return aVal < bVal ? 1 : -1
    })
    return filtered
  }

  const allData = useMemo(
    () => filterAndSort([...visualData, ...acousticData]),
    [visualData, acousticData, searchQuery, sortField, sortDir]
  )
  const filteredVisual = useMemo(() => filterAndSort(visualData), [visualData, searchQuery, sortField, sortDir])
  const filteredAcoustic = useMemo(() => filterAndSort(acousticData), [acousticData, searchQuery, sortField, sortDir])

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortDir("desc")
    }
    setPage(0)
  }

  const paginate = (data: any[]) => {
    const start = page * pageSize
    return data.slice(start, start + pageSize)
  }

  const SortHeader = ({ field, children }: { field: string; children: React.ReactNode }) => (
    <TableHead
      className="cursor-pointer hover:text-zinc-900 select-none group transition-colors h-10 box-border bg-zinc-50"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider text-zinc-500 group-hover:text-zinc-900 font-display">
        {children}
        <ArrowUpDown size={10} className={`opacity-0 group-hover:opacity-100 transition-opacity ${sortField === field ? 'opacity-100 text-primary' : ''}`} />
      </div>
    </TableHead>
  )

  const DetectionTable = ({ data }: { data: any[] }) => {
    const pagedData = paginate(data)
    const totalPages = Math.ceil(data.length / pageSize)

    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-sm border border-zinc-200 bg-white overflow-hidden">
          <Table>
            <TableHeader className="bg-zinc-50">
              <TableRow className="border-b border-zinc-200">
                <TableHead className="h-10 text-[10px] uppercase font-bold tracking-wider text-zinc-500 font-display bg-zinc-50">Data Type</TableHead>
                <SortHeader field="species">Species Taxonomy</SortHeader>
                <SortHeader field="confidence">Confidence Score</SortHeader>
                <TableHead className="h-10 text-[10px] uppercase font-bold tracking-wider text-zinc-500 font-display bg-zinc-50">Geo-Coordinates</TableHead>
                <TableHead className="h-10 text-[10px] uppercase font-bold tracking-wider text-zinc-500 font-display bg-zinc-50">Source Mission</TableHead>
                <SortHeader field="timestamp">Acquisition Time</SortHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-zinc-400 py-12 border-none">
                    <div className="flex flex-col items-center gap-2">
                      <Search className="h-8 w-8 opacity-20" />
                      <span className="text-xs font-mono uppercase">No detection signatures found within current parameters</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                pagedData.map((det: any) => (
                  <TableRow key={`${det.type}-${det.id}`} className="hover:bg-zinc-50/80 border-b border-zinc-100 transition-colors">
                    <TableCell className="py-2.5">
                      {det.type === "visual" ? (
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-teal-50 border border-teal-100 text-teal-700 text-[10px] font-bold uppercase tracking-wide">
                          <Eye size={10} />
                          Visual
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-orange-50 border border-orange-100 text-orange-700 text-[10px] font-bold uppercase tracking-wide">
                          <Mic size={10} />
                          Audio
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-bold text-zinc-700 text-xs font-mono py-2.5">{det.species}</TableCell>
                    <TableCell className="py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-zinc-100 rounded-sm overflow-hidden border border-zinc-200">
                          <div className={`h-full ${det.confidence > 0.8 ? 'bg-zinc-800' : 'bg-zinc-400'}`} style={{ width: `${det.confidence * 100}%` }}></div>
                        </div>
                        <span className="text-[10px] font-mono text-zinc-500">
                          {(det.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-[10px] font-mono text-zinc-500 py-2.5">
                      {det.lat && det.lon ? `${det.lat.toFixed(4)}, ${det.lon.toFixed(4)}` : 'N/A'}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-zinc-600 py-2.5">
                      {det.survey_name || "—"}
                    </TableCell>
                    <TableCell className="text-[10px] font-mono text-zinc-500 py-2.5">
                      {det.timestamp
                        ? new Date(det.timestamp).toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[10px] font-mono text-zinc-400 uppercase">
              Displaying {page * pageSize + 1}–{Math.min((page + 1) * pageSize, data.length)} / {data.length} records
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs font-bold uppercase rounded-sm border-zinc-200 text-zinc-600 bg-white hover:bg-zinc-50"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs font-bold uppercase rounded-sm border-zinc-200 text-zinc-600 bg-white hover:bg-zinc-50"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto min-h-screen bg-white">
      <div className="flex items-end justify-between border-b border-zinc-100 pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Activity size={14} className="text-zinc-400" />
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Global Telemetry Log</span>
          </div>
          <h1 className="text-2xl font-bold font-display uppercase tracking-tight text-zinc-900">Signatures Database</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="px-3 py-1 bg-zinc-50 border border-zinc-200 rounded-sm text-[10px] font-mono text-zinc-500">
            TOTAL_RECORDS: {allData.length}
          </div>
        </div>
      </div>

      {/* Search / Filter Bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
          <Input
            placeholder="FILTER_SPECIES_OR_MISSION_ID..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(0) }}
            className="pl-9 bg-zinc-50 border-zinc-200 text-xs font-mono focus-visible:ring-primary rounded-sm h-9"
          />
        </div>
        <Button variant="outline" className="h-9 rounded-sm border-zinc-200 text-zinc-600 hover:bg-zinc-50 text-xs font-bold uppercase ml-auto">
          <SlidersHorizontal size={14} className="mr-2" />
          Advanced Filters
        </Button>
      </div>

      <div className="tech-panel border-none shadow-none bg-transparent">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 w-full bg-zinc-100" />
            ))}
          </div>
        ) : (
          <Tabs defaultValue="all" onValueChange={() => setPage(0)} className="w-full">
            <div className="mb-4">
              <TabsList className="bg-zinc-100 p-0.5 h-8 rounded-sm w-fit border border-zinc-200">
                <TabsTrigger value="all" className="h-7 text-[10px] uppercase font-bold px-3 rounded-sm data-[state=active]:bg-white data-[state=active]:text-zinc-900 data-[state=active]:shadow-sm text-zinc-500">
                  All Records
                </TabsTrigger>
                <TabsTrigger value="visual" className="h-7 text-[10px] uppercase font-bold px-3 rounded-sm data-[state=active]:bg-white data-[state=active]:text-teal-700 data-[state=active]:shadow-sm text-zinc-500">
                  Visual
                </TabsTrigger>
                <TabsTrigger value="acoustic" className="h-7 text-[10px] uppercase font-bold px-3 rounded-sm data-[state=active]:bg-white data-[state=active]:text-orange-700 data-[state=active]:shadow-sm text-zinc-500">
                  Acoustic
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="all" className="mt-0">
              <DetectionTable data={allData} />
            </TabsContent>
            <TabsContent value="visual" className="mt-0">
              <DetectionTable data={filteredVisual} />
            </TabsContent>
            <TabsContent value="acoustic" className="mt-0">
              <DetectionTable data={filteredAcoustic} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}
