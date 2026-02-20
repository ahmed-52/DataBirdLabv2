import React, { useEffect, useState, useMemo } from 'react';
import {
  Activity,
  Bird,
  BarChart2,
  Map as MapIcon,
  Filter,
  Calendar,
  Settings,
  Upload,
  Check,
  Radio,
  ChevronRight
} from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

// Components
import UnifiedMap from '../components/UnifiedMap';
import InspectorPanel from '../components/InspectorPanel';
import { WeeklyActivityChart, SpeciesDistributionChart } from '../components/Charts';
import SpeciesActivityChart from '../components/SpeciesActivityChart';
import NewSurveyModal from '../components/NewSurveyModal';
import SettingsModal from '../components/SettingsModal';
import StatsCard from '../components/StatsCard';

// API & Types
import {
  fetchEcologicalData,
  fetchSurveys,
  fetchARUs
} from '@/lib/api';
import {
  Survey,
  VisualDetection,
  AcousticDetection,
  ARU
} from '@/types';

type FilterMode = '7d' | '30d' | '90d' | 'ytd';

export default function DashboardPage() {
  // --- State ---

  // Data
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [arus, setArus] = useState<ARU[]>([]);
  const [visualData, setVisualData] = useState<VisualDetection[]>([]);
  const [acousticData, setAcousticData] = useState<AcousticDetection[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterMode, setFilterMode] = useState<FilterMode>('30d');
  const [selectedSurveyIds, setSelectedSurveyIds] = useState<number[]>([]);

  // Selection / Inspector
  const [selectedVisual, setSelectedVisual] = useState<VisualDetection | null>(null);
  const [selectedAcoustic, setSelectedAcoustic] = useState<AcousticDetection | null>(null);
  const [selectedARU, setSelectedARU] = useState<{ id: string, lat: number, lon: number, detectionCount: number, aru_id?: number } | null>(null);
  const [selectedSurvey, setSelectedSurvey] = useState<Survey | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);

  // Modals
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // --- Effects ---

  // Initial Load: Surveys & ARUs
  useEffect(() => {
    const initLoad = async () => {
      try {
        const [fetchedSurveys, fetchedARUs] = await Promise.all([
          fetchSurveys(),
          fetchARUs()
        ]);
        setSurveys(fetchedSurveys);
        setArus(fetchedARUs);
      } catch (err) {
        console.error("Failed to load initial data", err);
      }
    };
    initLoad();
  }, []);

  // Data Fetch on Filter Change
  useEffect(() => {
    const loadEcologicalData = async () => {
      setLoading(true);
      try {
        // Calculate days for API
        let days = 30;
        if (filterMode === '7d') days = 7;
        if (filterMode === '90d') days = 90;
        if (filterMode === 'ytd') {
          const now = new Date();
          const startOfYear = new Date(now.getFullYear(), 0, 1);
          const diff = now.getTime() - startOfYear.getTime();
          days = Math.ceil(diff / (1000 * 3600 * 24));
        }

        const { visualDetections, acousticDetections } = await fetchEcologicalData(
          days,
          selectedSurveyIds
        );

        setVisualData(visualDetections);
        setAcousticData(acousticDetections);
      } catch (err) {
        console.error("Failed to fetch ecological data", err);
      } finally {
        setLoading(false);
      }
    };
    loadEcologicalData();
  }, [filterMode, selectedSurveyIds]);

  // --- Handlers ---

  const handleSelectVisual = (d: VisualDetection) => {
    setSelectedVisual(d);
    setSelectedAcoustic(null);
    setSelectedARU(null);
    setSelectedSurvey(null);
    setIsInspectorOpen(true);
  };

  const handleSelectAcoustic = (d: AcousticDetection) => {
    setSelectedAcoustic(d);
    setSelectedVisual(null);
    setSelectedARU(null);
    setSelectedSurvey(null);
    setIsInspectorOpen(true);
  };

  const handleSelectARU = (aruData: any) => {
    setSelectedARU(aruData);
    setSelectedVisual(null);
    setSelectedAcoustic(null);
    setSelectedSurvey(null);
    setIsInspectorOpen(true);
  };

  const handleSelectSurvey = (survey: Survey) => {
    setSelectedSurvey(survey);
    setSelectedVisual(null);
    setSelectedAcoustic(null);
    setSelectedARU(null);
    setIsInspectorOpen(true);
  };

  const handleCloseInspector = () => {
    setIsInspectorOpen(false);
    setSelectedVisual(null);
    setSelectedAcoustic(null);
    setSelectedARU(null);
    setSelectedSurvey(null);
  };

  const handleUploadComplete = async () => {
    const s = await fetchSurveys();
    setSurveys(s);
    const { visualDetections, acousticDetections } = await fetchEcologicalData(
      filterMode === '7d' ? 7 : 30, // Simplification
      selectedSurveyIds
    );
    setVisualData(visualDetections);
    setAcousticData(acousticDetections);
  };

  // --- Derived Stats ---

  const uniqueSpecies = useMemo(() => {
    const set = new Set([
      ...visualData.map(d => d.species),
      ...acousticData.map(d => d.species)
    ]);
    return set.size;
  }, [visualData, acousticData]);

  const totalDetections = visualData.length + acousticData.length;

  const chartData = useMemo(() => {
    return [...visualData, ...acousticData];
  }, [visualData, acousticData]);

  const aruDetectionCounts = useMemo(() => {
    const counts = new Map<number, number>();
    acousticData.forEach(d => {
      if (d.aru_id != null) counts.set(d.aru_id, (counts.get(d.aru_id) ?? 0) + 1);
    });
    return counts;
  }, [acousticData]);

  // Filtered surveys for map
  const mapSurveys = useMemo(() => {
    if (selectedSurveyIds.length > 0) {
      return surveys.filter(s => selectedSurveyIds.includes(s.id));
    }
    return surveys;
  }, [surveys, selectedSurveyIds]);

  return (
    <div className="min-h-screen pb-20 bg-background font-sans text-foreground selection:bg-primary/20 selection:text-primary">
      {/* Modals */}
      <NewSurveyModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onUploadComplete={handleUploadComplete}
      />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
      <InspectorPanel
        isOpen={isInspectorOpen}
        onClose={handleCloseInspector}
        selectedVisual={selectedVisual}
        selectedAcoustic={selectedAcoustic}
        selectedARU={selectedARU}
        selectedSurvey={selectedSurvey}
        filterDays={filterMode === '7d' ? 7 : (filterMode === '90d' ? 90 : 30)}
        selectedSurveyIds={selectedSurveyIds}
      />



      {/* Field Header - Dense & Technical */}
      <header className="tech-header h-14 px-4 md:px-6 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-6">
          <SidebarTrigger />
          {/* Logo */}

          <h1 className="text-sm font-bold tracking-tight font-display uppercase">
            DataBird<span className="font-light text-muted-foreground">Lab</span>
            <span className="ml-2 px-1.5 py-0.5 bg-zinc-100 text-zinc-500 text-[10px] rounded border border-zinc-200 font-mono">Beta</span>
          </h1>


          <div className="h-4 w-px bg-border"></div>

          {/* Survey Filter - Compact */}
          <div className="flex items-center gap-2">
            <Select
              value={selectedSurveyIds.length === 0 ? "all" : selectedSurveyIds[0].toString()}
              onValueChange={(val) => {
                if (val === "all") setSelectedSurveyIds([]);
                else setSelectedSurveyIds([parseInt(val)]);
              }}
            >
              <SelectTrigger className="w-[180px] h-8 text-xs border-border bg-background hover:bg-zinc-50 transition-colors focus:ring-0 focus:ring-offset-0 text-foreground font-medium">
                <SelectValue placeholder="All Surveys" />
              </SelectTrigger>
              <SelectContent className="border-border rounded-md shadow-none">
                <SelectItem value="all" className="text-xs">All Surveys</SelectItem>
                {surveys.map(s => (
                  <SelectItem key={s.id} value={s.id.toString()} className="text-xs font-mono">
                    {s.name} <span className="text-muted-foreground ml-2">{new Date(s.date).toLocaleDateString()}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Time Filter - Segmented Control technical */}
          <div className="hidden md:flex bg-muted p-0.5 rounded border border-border">
            {(['7d', '30d', '90d', 'ytd'] as FilterMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-all ${filterMode === mode
                  ? 'bg-white text-primary shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                {mode === 'ytd' ? 'YTD' : mode}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-border opacity-50"></div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsSettingsOpen(true)}
            className="text-muted-foreground hover:text-foreground h-8 w-8"
          >
            <Settings size={16} />
          </Button>

          <Button
            onClick={() => setIsUploadModalOpen(true)}
            size="sm"
            className="bg-zinc-900 hover:bg-zinc-800 text-white h-8 text-xs font-medium rounded-sm border border-zinc-900"
          >
            <Upload size={14} className="mr-2" />
            Ingest Data
          </Button>
        </div>
      </header >

      <main className="relative z-10 px-4 md:px-6 py-6 max-w-[1920px] mx-auto space-y-6">

        {/* Dashboard Title & Meta - High Density */}
        <div className="flex items-end justify-between border-b border-border pb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="text-[10px] font-mono text-emerald-700 font-medium uppercase tracking-wider">System: Active</span>
              <span className="text-zinc-300">|</span>
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">LOC: 11.55N, 104.91E</span>
            </div>
            <h1 className="text-3xl font-display font-bold text-zinc-900 tracking-tight leading-none">
              Boeung Sne Colony
            </h1>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-mono text-zinc-400 uppercase">Last Sync</div>
            <div className="text-sm font-mono font-medium text-zinc-700">Today, 14:02:33 UTC</div>
          </div>
        </div>

        {/* Field Grid */}
        <div className="grid grid-cols-12 gap-4 items-start">

          {/* Left Column: Map & Primary Analysis */}
          <div className="col-span-12 xl:col-span-8 flex flex-col gap-4">
            {/* Map Panel */}
            <div className="group h-[400px] tech-panel relative overflow-hidden">
              <div className="absolute top-4 left-4 z-[400] bg-white border border-border px-3 py-1.5 rounded-sm shadow-none pointer-events-none flex items-center gap-3">
                <div className="p-1 bg-zinc-100 text-zinc-600 rounded-sm">
                  <MapIcon size={12} />
                </div>
                <div>
                  <h3 className="font-bold text-zinc-900 text-[10px] uppercase tracking-wider font-display">Unified Telemetry Map</h3>
                  <p className="text-[9px] font-mono text-zinc-500">VIS + ACOUSTIC LAYERS</p>
                </div>
              </div>
              <UnifiedMap
                visualDetections={visualData}
                acousticDetections={acousticData}
                arus={arus}
                surveys={mapSurveys}
                onSelectVisual={handleSelectVisual}
                onSelectAcoustic={handleSelectAcoustic}
                onSelectARU={handleSelectARU}
                onSelectSurvey={handleSelectSurvey}
                autoZoom={false}
              />
            </div>

            {/* Charts Grid - Technical */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="h-[300px] tech-panel overflow-hidden">
                <SpeciesActivityChart type="acoustic" title="BIOACOUSTIC ACTIVITY" />
              </div>
              <div className="h-[300px] tech-panel overflow-hidden">
                <SpeciesActivityChart type="visual" title="VISUAL CENSUS TRENDS" />
              </div>
            </div>
          </div>

          {/* Right Column: Metrics & Status */}
          <div className="col-span-12 xl:col-span-4 flex flex-col gap-4">

            {/* Metric Row */}
            <div className="grid grid-cols-2 gap-4">
              <StatsCard
                title="SPECIES COUNT"
                value={uniqueSpecies.toString()}
                icon={Bird}
                trend="+2"
                trendUp={true}
              />
              <StatsCard
                title="DETECTION EVENTS"
                value={totalDetections.toString()}
                icon={Activity}
                trend="+12%"
                trendUp={true}
              />
            </div>

            {/* ARU Station List */}
            {arus.length > 0 && (
              <Card className="tech-card rounded-lg p-0">
                <div className="px-4 py-3 border-b border-border bg-zinc-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Radio size={14} className="text-zinc-500" />
                    <span className="text-xs font-bold text-zinc-700 font-display uppercase tracking-wide">ARU Stations</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] h-5 rounded-sm font-mono font-normal">{arus.length}</Badge>
                </div>
                <div className="divide-y divide-border">
                  {arus.map(aru => {
                    const count = aruDetectionCounts.get(aru.id) ?? 0;
                    const isSelected = selectedARU?.aru_id === aru.id;
                    return (
                      <button
                        key={aru.id}
                        onClick={() => handleSelectARU({
                          id: `ARU-${aru.id}`,
                          lat: aru.lat,
                          lon: aru.lon,
                          detectionCount: count,
                          aru_id: aru.id
                        })}
                        className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-zinc-50 group ${isSelected ? 'bg-orange-50' : ''}`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${count > 0 ? 'bg-orange-400' : 'bg-zinc-300'}`} />
                          <span className={`text-xs font-mono font-medium ${isSelected ? 'text-orange-700' : 'text-zinc-700'}`}>{aru.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {count > 0 && (
                            <span className="text-[10px] font-mono text-zinc-400 tabular-nums">{count} det.</span>
                          )}
                          <ChevronRight size={12} className={`transition-colors ${isSelected ? 'text-orange-400' : 'text-zinc-300 group-hover:text-zinc-400'}`} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Detailed Charts */}
            <div className="flex flex-col gap-4">
              <Card className="tech-card rounded-lg p-0">
                <div className="px-4 py-3 border-b border-border bg-zinc-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar size={14} className="text-zinc-500" />
                    <span className="text-xs font-bold text-zinc-700 font-display uppercase tracking-wide">Temporal Distribution</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] h-5 rounded-sm font-mono font-normal">N={chartData.length}</Badge>
                </div>
                <CardContent className="h-[220px] p-0">
                  {/* Assuming Chart handles padding internally */}
                  <WeeklyActivityChart days={filterMode === '7d' ? 7 : 30} visualDetections={chartData} />
                </CardContent>
              </Card>

              <Card className="tech-card rounded-lg p-0">
                <div className="px-4 py-3 border-b border-border bg-zinc-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart2 size={14} className="text-zinc-500" />
                    <span className="text-xs font-bold text-zinc-700 font-display uppercase tracking-wide">Species Breakdown</span>
                  </div>
                </div>
                <CardContent className="h-[240px] p-0">
                  <SpeciesDistributionChart days={filterMode === '7d' ? 7 : 30} visualDetections={chartData} />
                </CardContent>
              </Card>


            </div>

          </div>
        </div>
      </main>
    </div >
  );
}
