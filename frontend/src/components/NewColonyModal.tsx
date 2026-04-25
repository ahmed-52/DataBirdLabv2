import { useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { useCurrentColony } from "@/contexts/CurrentColonyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type NewColonyForm = {
  slug: string;
  name: string;
  description: string;
  lat: number;
  lon: number;
};

export const NewColonyModal = ({ onClose }: { onClose: () => void }) => {
  const { refresh, setCurrentColony } = useCurrentColony();
  const [form, setForm] = useState<NewColonyForm>({
    slug: "",
    name: "",
    description: "",
    lat: 0,
    lon: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.post("/api/colonies", form);
      await refresh();
      setCurrentColony(form.slug);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create colony");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">New colony</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Slug (e.g. prek-toal)"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            className="bg-zinc-800 text-zinc-100 border-zinc-700"
          />
          <Input
            placeholder="Display name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-zinc-800 text-zinc-100 border-zinc-700"
          />
          <Input
            placeholder="Description (optional)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="bg-zinc-800 text-zinc-100 border-zinc-700"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              type="number"
              step="0.000001"
              placeholder="Latitude"
              value={Number.isFinite(form.lat) ? form.lat : 0}
              onChange={(e) =>
                setForm({ ...form, lat: parseFloat(e.target.value) || 0 })
              }
              className="bg-zinc-800 text-zinc-100 border-zinc-700"
            />
            <Input
              type="number"
              step="0.000001"
              placeholder="Longitude"
              value={Number.isFinite(form.lon) ? form.lon : 0}
              onChange={(e) =>
                setForm({ ...form, lon: parseFloat(e.target.value) || 0 })
              }
              className="bg-zinc-800 text-zinc-100 border-zinc-700"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={onClose} className="text-zinc-300">
              Cancel
            </Button>
            <Button
              onClick={onSave}
              disabled={saving || !form.slug || !form.name}
            >
              {saving ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
