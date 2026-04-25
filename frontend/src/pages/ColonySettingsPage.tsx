import { useState, useEffect } from "react";
import { useCurrentColony, type Colony } from "@/contexts/CurrentColonyContext";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ColonyFormState = Partial<Colony>;

export default function ColonySettingsPage() {
  const { currentColony, refresh } = useCurrentColony();
  const [form, setForm] = useState<ColonyFormState>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (currentColony) setForm({ ...currentColony });
  }, [currentColony?.slug]);

  if (!currentColony) {
    return (
      <div className="p-6 text-zinc-300">
        No colony selected. Create one from the colony switcher in the sidebar.
      </div>
    );
  }

  const onSave = async () => {
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      await apiClient.patch(`/api/colonies/${currentColony.slug}`, {
        name: form.name,
        description: form.description,
        lat: form.lat,
        lon: form.lon,
        species_color_mapping: form.species_color_mapping,
        visual_model_path: form.visual_model_path,
        acoustic_model_path: form.acoustic_model_path,
        min_confidence: form.min_confidence,
        tile_size: form.tile_size,
      });
      await refresh();
      setInfo("Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save colony");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl space-y-4 bg-zinc-950 min-h-screen">
      <h1 className="text-2xl text-zinc-100">
        {currentColony.name} <span className="text-zinc-500">— Settings</span>
      </h1>

      <div className="space-y-3">
        <label className="block text-zinc-400 text-xs uppercase tracking-wide">
          Name
        </label>
        <Input
          placeholder="Name"
          value={form.name ?? ""}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="bg-zinc-800 text-zinc-100 border-zinc-700"
        />

        <label className="block text-zinc-400 text-xs uppercase tracking-wide">
          Description
        </label>
        <Input
          placeholder="Description"
          value={form.description ?? ""}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="bg-zinc-800 text-zinc-100 border-zinc-700"
        />

        <label className="block text-zinc-400 text-xs uppercase tracking-wide">
          Latitude / Longitude
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Input
            type="number"
            step="0.000001"
            value={form.lat ?? 0}
            onChange={(e) =>
              setForm({ ...form, lat: parseFloat(e.target.value) || 0 })
            }
            className="bg-zinc-800 text-zinc-100 border-zinc-700"
          />
          <Input
            type="number"
            step="0.000001"
            value={form.lon ?? 0}
            onChange={(e) =>
              setForm({ ...form, lon: parseFloat(e.target.value) || 0 })
            }
            className="bg-zinc-800 text-zinc-100 border-zinc-700"
          />
        </div>

        <label className="block text-zinc-400 text-xs uppercase tracking-wide">
          Visual model path
        </label>
        <Input
          placeholder="Visual model path"
          value={form.visual_model_path ?? ""}
          onChange={(e) =>
            setForm({ ...form, visual_model_path: e.target.value })
          }
          className="bg-zinc-800 text-zinc-100 border-zinc-700"
        />

        <label className="block text-zinc-400 text-xs uppercase tracking-wide">
          Acoustic model path
        </label>
        <Input
          placeholder="Acoustic model path"
          value={form.acoustic_model_path ?? ""}
          onChange={(e) =>
            setForm({ ...form, acoustic_model_path: e.target.value })
          }
          className="bg-zinc-800 text-zinc-100 border-zinc-700"
        />

        <label className="block text-zinc-400 text-xs uppercase tracking-wide">
          Min confidence
        </label>
        <Input
          type="number"
          step="0.01"
          placeholder="Min confidence"
          value={form.min_confidence ?? 0.25}
          onChange={(e) =>
            setForm({
              ...form,
              min_confidence: parseFloat(e.target.value) || 0,
            })
          }
          className="bg-zinc-800 text-zinc-100 border-zinc-700"
        />

        <label className="block text-zinc-400 text-xs uppercase tracking-wide">
          Tile size
        </label>
        <Input
          type="number"
          placeholder="Tile size"
          value={form.tile_size ?? 1280}
          onChange={(e) =>
            setForm({ ...form, tile_size: parseInt(e.target.value) || 0 })
          }
          className="bg-zinc-800 text-zinc-100 border-zinc-700"
        />

        <label className="block text-zinc-400 text-xs uppercase tracking-wide">
          Species color mapping (JSON)
        </label>
        <textarea
          placeholder='{"species_a": "#ff0000"}'
          value={form.species_color_mapping ?? ""}
          onChange={(e) =>
            setForm({ ...form, species_color_mapping: e.target.value })
          }
          className="w-full h-32 bg-zinc-800 text-zinc-100 border border-zinc-700 p-2 rounded font-mono text-sm"
        />

        {error && <p className="text-red-400 text-sm">{error}</p>}
        {info && <p className="text-emerald-400 text-sm">{info}</p>}

        <Button onClick={onSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
