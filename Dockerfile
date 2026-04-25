# syntax=docker/dockerfile:1
FROM python:3.11-slim AS base
# Code lives at /app/backend/. WORKDIR=/app/backend and PYTHONPATH=/app/backend
# so `from app.*` imports resolve (matches local dev convention: commands run
# from the backend/ directory).
WORKDIR /app/backend
ENV PYTHONUNBUFFERED=1 PYTHONPATH=/app/backend

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY backend/ /app/backend/
# frontend/dist must be built BEFORE docker build (not in container)
COPY frontend/dist /app/backend/static/dist/

# Order matters: gcloud run deploy --source . builds the FINAL target by default.
# api is last so `deploy --source .` defaults to it. pipeline-job is built
# explicitly via --target when deploying the Cloud Run Job.
FROM base AS pipeline-job
CMD ["python", "-m", "scripts.run_pipeline_job"]

FROM base AS api
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
