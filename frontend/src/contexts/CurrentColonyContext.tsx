import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { apiClient, setApiClientColony } from "@/lib/apiClient";
import { supabase } from "@/lib/supabaseClient";
import { useQueryClient } from "@tanstack/react-query";

export type Colony = {
  id: number;
  slug: string;
  name: string;
  description?: string;
  lat: number;
  lon: number;
  species_color_mapping?: string;
  visual_model_path?: string;
  acoustic_model_path?: string;
  min_confidence: number;
  tile_size: number;
};

type Ctx = {
  currentColony: Colony | null;
  colonies: Colony[];
  setCurrentColony: (slug: string) => void;
  refresh: () => Promise<void>;
};

const CurrentColonyContext = createContext<Ctx | null>(null);

const LS_KEY = "databirdlab.currentColonySlug";

export const CurrentColonyProvider = ({ children }: { children: ReactNode }) => {
  const [colonies, setColonies] = useState<Colony[]>([]);
  const [currentColony, setCurrentColonyState] = useState<Colony | null>(null);
  const queryClient = useQueryClient();

  const loadColonies = async () => {
    // Skip if not authenticated — /api/colonies requires auth and would 422 on /login or /signup.
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return;
    try {
      const list: Colony[] = await apiClient.get("/api/colonies");
      setColonies(list);
      const persisted = localStorage.getItem(LS_KEY);
      const found = list.find((c) => c.slug === persisted) ?? list[0] ?? null;
      if (found) {
        setCurrentColonyState(found);
        setApiClientColony(found.slug);
        localStorage.setItem(LS_KEY, found.slug);
      }
    } catch (e) {
      console.warn("Failed to load colonies", e);
    }
  };

  useEffect(() => {
    loadColonies();
    // Reload colonies when auth state changes (sign-in or sign-out).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        loadColonies();
      } else {
        setColonies([]);
        setCurrentColonyState(null);
        setApiClientColony(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const setCurrentColony = (slug: string) => {
    const found = colonies.find((c) => c.slug === slug);
    if (!found) return;
    setCurrentColonyState(found);
    setApiClientColony(slug);
    localStorage.setItem(LS_KEY, slug);
    queryClient.invalidateQueries();
  };

  return (
    <CurrentColonyContext.Provider value={{ currentColony, colonies, setCurrentColony, refresh: loadColonies }}>
      {children}
    </CurrentColonyContext.Provider>
  );
};

export const useCurrentColony = () => {
  const ctx = useContext(CurrentColonyContext);
  if (!ctx) throw new Error("useCurrentColony must be used inside CurrentColonyProvider");
  return ctx;
};
