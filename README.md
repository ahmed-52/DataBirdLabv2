# DataBirdLab

DataBirdLab is an ecological monitoring platform designed to process and analyze drone imagery and acoustic data for bird surveys. It provides tools for visual detection of bird colonies with a custom Yolo model and acoustic identification of species using BirdNET.

## Features

- **Drone Imagery Analysis**: Process aerial imagery to detect and count bird colonies.
- **Acoustic Monitoring**: Analyze audio recordings using BirdNET to identify bird species by their calls.
- **Interactive Maps**: Visualize detections and survey areas on interactive Leaflet maps.
- **Data Visualization**: Explore species activity and trends through dynamic charts and graphs.
- **Survey Management**: Organize data by surveys and deploy Audio Recorders (ARUs) effectively.

## Tech Stack

- **Backend**: Python, FastAPI, SQLite, BirdNET-Analyzer
- **Frontend**: React, Vite, Tailwind CSS, Shadcn UI, Recharts, Leaflet

## Installation

### Backend

1.  Navigate to the `backend` directory:
    ```bash
    cd backend
    ```
2.  Create a virtual environment:
    ```bash
    python -m venv venv
    source venv/bin/activate  # On Windows: venv\Scripts\activate
    ```
3.  Install dependencies:
    ```bash
    pip install -r requirements.txt
    ```
4.  Run the server:
    ```bash
    fastapi dev app/main.py
    ```

### Frontend

1.  Navigate to the `frontend` directory:
    ```bash
    cd frontend
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Run the development server:
    ```bash
    npm run dev
    ```

## License

This project is licensed under the **Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)** license.

You are free to:

- **Share** — copy and redistribute the material in any medium or format
- **Adapt** — remix, transform, and build upon the material

Under the following terms:

- **Attribution** — You must give appropriate credit, provide a link to the license, and indicate if changes were made.
- **NonCommercial** — You may not use the material for commercial purposes.

See the [LICENSE](LICENSE) file for details.
