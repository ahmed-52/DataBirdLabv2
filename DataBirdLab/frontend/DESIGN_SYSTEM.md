# Enterprise Scientific Design System
**Codename:** Field Telemetry

## 1. Design Philosophy
The interface is not a "website" or a "SaaS dashboard". It is a **Scientific Instrument**.
-   **Intent**: Precise, Rugged, Data-Dense.
-   **Metaphor**: A ruggedized field laptop used at a telemetry station.
-   **Feel**: Cold, responsive, trustworthy.

## 2. Global Foundations

### Color System (`Zinc` + `Signal Teal`)
We reject "warm / cozy" tones. We use neutral, archival-grade grays and high-visibility signal colors.

-   **Base Surface**: `Zinc-50` (`#fafafa`) or White.
-   **Borders**: `Zinc-200` (`#e4e4e7`). Crisp, high-contrast separation.
-   **Text**: `Zinc-900` (Headings) to `Zinc-500` (Labels).
-   **Primary**: **Signal Teal** (`#0f766e` / `teal-800`). Used for active states and critical actions.
-   **Status**:
    -   **Active/Normal**: `Emerald-500` (LED Green)
    -   **Warning/Check**: `Amber-600` (Hazard Orange)
    -   **Critical/Alert**: `Rose-600` (Signal Red)

### Typography
Hierarchy is established by weight and font family, not just size.

-   **Headings**: **Outfit** (Google Sans alternative). Geometric, authoritative.
    -   *Usage*: Page titles, card headers, metric labels.
    -   *Class*: `.font-display`
-   **Interface**: **Inter**. Neutral, legible, invisible.
    -   *Usage*: Body text, buttons, inputs.
    -   *Class*: `.font-sans`
-   **Data**: **JetBrains Mono**. Monospaced, tabular, technical.
    -   *Usage*: Coordinates, timestamps, sensor values, IDs.
    -   *Class*: `.font-mono`

### Depth Strategy: "Borders-Only"
We **reject drop shadows**. In a data-dense environment, shadows create muddy noise.
-   **Depth**: Created by **1px borders** (`border-border`).
-   **Elevation**: None. Every element sits on the same plane, separated by distinct lines.
-   **Layers**: Background > Border > Content.

### Density
-   **Whitespace**: Minimal. "Comfortable" whitespace is for marketing. Scientific tools use "efficient" whitespace.
-   **Grid**: Rigid 12-column system.
-   **Spacing**: Tight (`gap-4` or `gap-2`).

## 3. Component Standards

### Cards (`.tech-card`)
-   **Background**: White.
-   **Border**: 1px solid `Zinc-200`.
-   **Radius**: `sm` or `md` (4px - 6px). No large 16px+ roundings.
-   **Shadow**: None.
-   **Hover**: Border darken (`border-zinc-400`). No lift.

### Headers (`.tech-header`)
-   **Height**: Slim (14 / 56px).
-   **Border**: Bottom 1px solid `border-border`.
-   **Content**: Title + Version + Controls. No decorative gradients.

### Stats / Metrics
-   **Input**: Top-left label (Uppercase, Zinc-500, `.font-display`).
-   **Value**: Large mono/display number (Zinc-900).
-   **Trend**: Small, distinct, mono font.

## 4. Usage Rules (Do's & Don'ts)

| Do | Don't |
| :--- | :--- |
| Use **JetBrains Mono** for every number. | Use Inter for numbers. |
| Use **Uppercased Labels** (`text-[10px] tracking-wider`). | Use normal sentence case for labels. |
| Use **1px Borders** to separate sections. | Use bg-gray-100 to separate sections. |
| Use **Teal/Emerald** for actions. | Use Blue/Indigo (Generic SaaS). |
| Show density and "all data at once". | Hide data behind "Show More". |

## 5. CSS Utility Classes
Located in `index.css`:
-   `.tech-border`: Standard border utility.
-   `.tech-panel`: White bg, bordered, rounded.
-   `.tech-card`: Interactive panel with hover state.
-   `.font-display`, `.font-data`: Typography shortcuts.
