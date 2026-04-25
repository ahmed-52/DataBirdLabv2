#!/usr/bin/env bash
# One-time IAM setup for DataBirdLab Cloud Run deployment.
# Creates the runtime service account and grants the roles needed for:
#   - invoking Cloud Run (run.invoker)
#   - reading/writing GCS objects on the static bucket (storage.objectAdmin)
#   - signing V4 URLs from inside Cloud Run (iam.serviceAccountTokenCreator on itself)
#
# Run this ONCE per GCP project before the first `deploy/deploy.sh`.
set -euo pipefail

PROJECT="databirdlabel"
SA="databirdlab-runtime"
SA_EMAIL="${SA}@${PROJECT}.iam.gserviceaccount.com"
GCS_BUCKET="databirdlab-static-ahmed"

gcloud iam service-accounts create "$SA" \
  --display-name="DataBirdLab Cloud Run runtime" \
  --project="$PROJECT"

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.invoker"

# Storage access on the bucket
gsutil iam ch "serviceAccount:${SA_EMAIL}:objectAdmin" "gs://${GCS_BUCKET}"

# CRITICAL: SA needs token creator on ITSELF for V4 signed URLs
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project="$PROJECT"
