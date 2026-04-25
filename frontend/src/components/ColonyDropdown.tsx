import { useState } from "react";
import { useCurrentColony } from "@/contexts/CurrentColonyContext";
import { Button } from "@/components/ui/button";
import { ChevronDown, Plus, MapPin } from "lucide-react";
import { NewColonyModal } from "./NewColonyModal";

export const ColonyDropdown = () => {
  const { currentColony, colonies, setCurrentColony } = useCurrentColony();
  const [open, setOpen] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);

  // Empty state: when there are no colonies at all, show a primary "Create your first colony"
  // button instead of an unhelpful disabled-looking dropdown.
  if (colonies.length === 0) {
    return (
      <>
        <Button
          variant="default"
          onClick={() => setShowNewModal(true)}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Plus className="w-4 h-4 mr-2" /> Create your first colony
        </Button>
        {showNewModal && <NewColonyModal onClose={() => setShowNewModal(false)} />}
      </>
    );
  }

  return (
    <>
      <div className="relative">
        <Button
          variant="ghost"
          onClick={() => setOpen((prev) => !prev)}
          className="text-zinc-100 hover:bg-zinc-800 px-2 w-full justify-start"
        >
          <MapPin className="w-4 h-4 mr-2" />
          <span className="flex-1 text-left">{currentColony ? currentColony.name : "Select colony"}</span>
          <ChevronDown className="w-4 h-4 ml-2" />
        </Button>
        {open && (
          <div className="absolute top-full mt-1 left-0 w-64 bg-zinc-900 border border-zinc-800 rounded-md shadow-lg z-50">
            {colonies.map((c) => {
              const isActive = currentColony?.slug === c.slug;
              return (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => {
                    setCurrentColony(c.slug);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 hover:bg-zinc-800 ${
                    isActive ? "bg-zinc-800" : ""
                  }`}
                >
                  <div className="text-zinc-100 text-sm">{c.name}</div>
                  <div className="text-zinc-500 text-xs">
                    {c.lat.toFixed(3)}, {c.lon.toFixed(3)}
                  </div>
                </button>
              );
            })}
            {colonies.length === 0 && (
              <div className="px-3 py-2 text-zinc-500 text-sm">
                No colonies yet
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setShowNewModal(true);
              }}
              className="w-full text-left px-3 py-2 hover:bg-zinc-800 border-t border-zinc-800 text-emerald-400 text-sm flex items-center"
            >
              <Plus className="w-4 h-4 mr-2" /> New colony
            </button>
          </div>
        )}
      </div>
      {showNewModal && <NewColonyModal onClose={() => setShowNewModal(false)} />}
    </>
  );
};
