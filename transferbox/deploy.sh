#!/usr/bin/env bash
#
# Deploys the TransferBox backend configuration:
#   1. Realtime Database security rules
#   2. Cloud Storage security rules
#   3. Cloud Storage CORS policy (without it, downloads fail while uploads work)
#
# Requires a one-time `firebase login` (and `gcloud auth login` for step 3).
# Run from this directory:  ./deploy.sh
set -euo pipefail

PROJECT="${FIREBASE_PROJECT:-storage-a9cb1}"
BUCKET="${FIREBASE_BUCKET:-${PROJECT}.appspot.com}"

cd "$(dirname "$0")"

echo "Project: ${PROJECT}"
echo "Bucket:  gs://${BUCKET}"
echo

echo "==> Deploying Realtime Database and Storage rules"
firebase deploy --only database,storage --project "${PROJECT}"

echo
echo "==> Applying Storage CORS policy"
if command -v gcloud >/dev/null 2>&1; then
  gcloud storage buckets update "gs://${BUCKET}" --cors-file=firebase/cors.json
elif command -v gsutil >/dev/null 2>&1; then
  gsutil cors set firebase/cors.json "gs://${BUCKET}"
else
  echo "Neither gcloud nor gsutil is installed — CORS not applied." >&2
  echo "Install the Google Cloud CLI, then run:" >&2
  echo "  gcloud storage buckets update gs://${BUCKET} --cors-file=firebase/cors.json" >&2
  exit 1
fi

echo
echo "Done. Verify with:"
echo "  firebase database:get / --project ${PROJECT}  # should be denied by the rules"
echo "  gcloud storage buckets describe gs://${BUCKET} --format='default(cors_config)'"
