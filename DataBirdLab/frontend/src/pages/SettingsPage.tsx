import { Settings } from "lucide-react"

export default function SettingsPage() {
    return (
        <div className="p-6">
            <div className="flex items-center gap-3 mb-6">
                <Settings className="h-6 w-6 text-muted-foreground" />
                <h1 className="text-2xl font-bold">Settings</h1>
            </div>
            <div className="rounded-lg border bg-card p-6">
                <p className="text-muted-foreground">
                    Settings page coming soon. This will include pipeline parameters,
                    model management, and species-color mapping configuration.
                </p>
            </div>
        </div>
    )
}
