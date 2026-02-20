# Database Schema Documentation

This document outlines the database structure for the DataBirdLab project, based on the `sqlmodel` definitions in `app/models.py`.

The database is powered by **SQLite** (located at `data/db.sqlite`).

## Tables

### 1. Survey
Represents a data collection survey event.

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `INTEGER` | **Primary Key**. Unique identifier for the survey. |
| `name` | `TEXT` | Name of the survey. |
| `date` | `DATETIME` | Date and time of the survey. Defaults to current time. |
| `type` | `TEXT` | Type of survey. |

**Relationships:**
- `media`: One-to-Many relationship with `MediaAsset`.

---

### 2. MediaAsset
Represents a media file (image or audio) collected during a survey.

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `INTEGER` | **Primary Key**. Unique identifier. |
| `survey_id` | `INTEGER` | **Foreign Key** referencing `survey.id`. |
| `file_path` | `TEXT` | Path to the media file. |
| `lat_tl` | `FLOAT` | Top-Left Latitude (Geospatial). |
| `lon_tl` | `FLOAT` | Top-Left Longitude (Geospatial). |
| `lat_br` | `FLOAT` | Bottom-Right Latitude (Geospatial). |
| `lon_br` | `FLOAT` | Bottom-Right Longitude (Geospatial). |
| `is_processed` | `BOOLEAN` | Whether the asset has been processed. Default: `False`. |
| `is_validated` | `BOOLEAN` | Whether the asset has been validated. Default: `False`. |

**Relationships:**
- `survey`: Linked `Survey`.
- `visual_detections`: One-to-Many relationship with `VisualDetection`.
- `acoustic_detections`: One-to-Many relationship with `AcousticDetection`.

---

### 3. VisualDetection
Stores YOLO-based visual object detections on media assets.

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `INTEGER` | **Primary Key**. Unique identifier. |
| `asset_id` | `INTEGER` | **Foreign Key** referencing `mediaasset.id`. |
| `confidence` | `FLOAT` | AI confidence score. |
| `class_name` | `TEXT` | Detected class name. |
| `bbox_json` | `TEXT` | JSON string of bounding box: `[x, y, w, h]` (1280x1280 image). |
| `corrected_class`| `TEXT` | Human-corrected class name (Optional). |
| `corrected_bbox` | `TEXT` | Human-corrected bounding box (Optional). |

**Relationships:**
- `asset`: Linked `MediaAsset`.

---

### 4. AcousticDetection
Stores acoustic detections on media assets.

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `INTEGER` | **Primary Key**. Unique identifier. |
| `asset_id` | `INTEGER` | **Foreign Key** referencing `mediaasset.id`. |
| `class_name` | `TEXT` | Detected class name. |
| `confidence` | `FLOAT` | AI confidence score. |
| `start_time` | `FLOAT` | Start time of detection (seconds). |
| `end_time` | `FLOAT` | End time of detection (seconds). |
| `is_human_reviewed`| `BOOLEAN` | Whether it has been reviewed. Default: `True`. |
| `corrected_class`| `TEXT` | Human-corrected class name (Optional). |

**Relationships:**
- `asset`: Linked `MediaAsset`.
