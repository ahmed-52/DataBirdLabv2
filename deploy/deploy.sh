#!/usr/bin/env bash
set -euo pipefail

PROJECT="databirdlabel"
REGION="us-central1"
SERVICE_ACCOUNT="databirdlab-runtime@${PROJECT}.iam.gserviceaccount.com"
GCS_BUCKET="databirdlab-static-ahmed"

echo "=== Build frontend (env vars baked in) ==="
cd frontend
test -f .env.production || { echo ".env.production missing — copy from .env.production.example"; exit 1; }
npm run build
cd ..

echo "=== Push API image ==="
gcloud run deploy databirdlab-api \
  --source . \
  --region "$REGION" \
  --execution-environment gen2 \
  --timeout=3600 \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 2 \
  --memory 2Gi \
  --cpu 2 \
  --service-account "$SERVICE_ACCOUNT" \
  --set-env-vars "DATABASE_URL=$DATABASE_URL,SUPABASE_URL=$SUPABASE_URL,STORAGE_BACKEND=gcs,GCS_BUCKET=$GCS_BUCKET,PIPELINE_MODE=cloudrun"

echo "=== Push pipeline-job image ==="
# Build image once, deploy to both Service and Job — Cloud Run Jobs uses --image, not --source
IMAGE_URL="us-central1-docker.pkg.dev/${PROJECT}/databirdlab/pipeline-job:latest"
docker build --target pipeline-job -t "$IMAGE_URL" .
docker push "$IMAGE_URL"

gcloud run jobs create pipeline-job \
  --image "$IMAGE_URL" \
  --region "$REGION" \
  --task-timeout 3600 \
  --memory 2Gi \
  --cpu 2 \
  --service-account "$SERVICE_ACCOUNT" \
  --set-env-vars "DATABASE_URL=$DATABASE_URL,SUPABASE_URL=$SUPABASE_URL,STORAGE_BACKEND=gcs,GCS_BUCKET=$GCS_BUCKET" \
  || gcloud run jobs update pipeline-job \
       --image "$IMAGE_URL" \
       --region "$REGION"

echo "=== Done. Service URL: $(gcloud run services describe databirdlab-api --region $REGION --format='value(status.url)') ==="
