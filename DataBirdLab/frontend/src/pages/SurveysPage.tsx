import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Plus, Binoculars, Mic, Eye, Calendar, MoreHorizontal, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import NewSurveyModal from "@/components/NewSurveyModal"
import { fetchSurveys } from "@/lib/api"

export default function SurveysPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [surveys, setSurveys] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [isNewSurveyOpen, setIsNewSurveyOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<any>(null)

  useEffect(() => {
    if (searchParams.get("new") === "true") {
      setIsNewSurveyOpen(true)
      setSearchParams({})
    }
  }, [searchParams, setSearchParams])

  useEffect(() => {
    loadSurveys()
  }, [])

  const loadSurveys = async () => {
    setLoading(true)
    const data = await fetchSurveys()
    setSurveys(data)
    setLoading(false)
  }

  const handleUploadComplete = async () => {
    await loadSurveys()
    setIsNewSurveyOpen(false)
  }

  const filterSurveys = (type: string) => {
    if (type === "all") return surveys
    return surveys.filter((s) => s.type === type)
  }

  const SurveyTable = ({ items }: { items: any[] }) => (
    <Table>
      <TableHeader>
        <TableRow className="border-b border-zinc-200">
          <TableHead className="text-xs uppercase font-bold text-zinc-500 track-wider font-display">Mission Name</TableHead>
          <TableHead className="text-xs uppercase font-bold text-zinc-500 track-wider font-display">Type</TableHead>
          <TableHead className="text-xs uppercase font-bold text-zinc-500 track-wider font-display">Acquisition Date</TableHead>
          <TableHead className="text-xs uppercase font-bold text-zinc-500 track-wider font-display">Status</TableHead>
          <TableHead className="text-right text-xs uppercase font-bold text-zinc-500 track-wider font-display">Controls</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-zinc-500 py-12 font-mono text-sm">
              NO_DATA_FOUND
            </TableCell>
          </TableRow>
        ) : (
          items.map((survey) => (
            <TableRow
              key={survey.id}
              className="cursor-pointer hover:bg-zinc-50 border-b border-zinc-100 transition-colors"
              onClick={() => navigate(`/surveys/${survey.id}`)}
            >
              <TableCell className="font-mono text-sm font-medium text-zinc-900">
                {survey.name}
                {survey.aru && (
                  <span className="ml-2 text-[10px] text-zinc-400 font-normal">
                    @ {survey.aru.name}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5">
                  {survey.type === "drone" ? (
                    <Eye className="size-3 text-zinc-500" />
                  ) : (
                    <Mic className="size-3 text-zinc-500" />
                  )}
                  <span className="text-xs font-mono uppercase text-zinc-700">{survey.type}</span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5 text-xs text-zinc-600 font-mono">
                  {new Date(survey.date).toLocaleDateString()}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-[10px] border-emerald-200 text-emerald-700 bg-white font-mono uppercase">
                  Processed
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="size-7 text-zinc-400 hover:text-zinc-700">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="border-border rounded-sm shadow-none">
                    <DropdownMenuItem className="text-xs font-mono" onClick={(e) => { e.stopPropagation(); navigate(`/surveys/${survey.id}`) }}>
                      VIEW_DETAILS
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-xs font-mono" onClick={(e) => { e.stopPropagation(); navigate(`/dashboard?survey=${survey.id}`) }}>
                      VIEW_ON_MAP
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-xs font-mono text-destructive"
                      disabled
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(survey) }}
                    >
                      <Trash2 className="mr-2 size-3" />
                      DELETE_RECORD
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )

  return (
    <div className="p-6 md:p-10 max-w-[1920px] mx-auto space-y-6 bg-background min-h-screen">
      <div className="flex items-end justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-zinc-900 tracking-tight leading-none">Survey Missions</h1>
          <p className="text-sm font-mono text-zinc-500 mt-1 uppercase tracking-wide">
            DATA_MANAGEMENT // {surveys.length} RECORD(S)
          </p>
        </div>
        <Button
          className="bg-zinc-900 hover:bg-zinc-800 text-white rounded-sm font-bold uppercase text-xs h-9 tracking-wide"
          onClick={() => setIsNewSurveyOpen(true)}
        >
          <Plus className="mr-2 size-3.5" />
          New Mission
        </Button>
      </div>

      <Card className="tech-card rounded-lg p-0">
        <CardContent className="p-0">
          <Tabs defaultValue="all" className="w-full">
            <div className="px-6 py-3 border-b border-border flex items-center bg-zinc-50/50">
              <TabsList className="bg-zinc-100 p-0.5 h-8 rounded-sm">
                <TabsTrigger value="all" className="text-[10px] uppercase font-bold px-3 h-7 rounded-sm data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  All Records
                </TabsTrigger>
                <TabsTrigger value="drone" className="text-[10px] uppercase font-bold px-3 h-7 rounded-sm data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  Aerial
                </TabsTrigger>
                <TabsTrigger value="acoustic" className="text-[10px] uppercase font-bold px-3 h-7 rounded-sm data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  Acoustic
                </TabsTrigger>
              </TabsList>
            </div>

            {loading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full bg-zinc-100 rounded-sm" />
                ))}
              </div>
            ) : (
              <div className="p-0">
                <TabsContent value="all" className="m-0">
                  <SurveyTable items={filterSurveys("all")} />
                </TabsContent>
                <TabsContent value="drone" className="m-0">
                  <SurveyTable items={filterSurveys("drone")} />
                </TabsContent>
                <TabsContent value="acoustic" className="m-0">
                  <SurveyTable items={filterSurveys("acoustic")} />
                </TabsContent>
              </div>
            )}
          </Tabs>
        </CardContent>
      </Card>

      <NewSurveyModal
        isOpen={isNewSurveyOpen}
        onClose={() => setIsNewSurveyOpen(false)}
        onUploadComplete={handleUploadComplete}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-lg border-zinc-200 shadow-none">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Confirm Deletion</AlertDialogTitle>
            <AlertDialogDescription className="font-mono text-xs">
              This action will permanently purge "{deleteTarget?.name}" and all associated telemetry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-sm text-xs font-bold uppercase">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-sm text-xs font-bold uppercase">
              CONFIRM_DELETE
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
