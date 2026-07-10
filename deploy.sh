#!/bin/bash
set -e

# Configuration
SERVICE_NAME="darkraw-lab"
REGION="us-central1"

echo "=== DarkRaw LAB Cloud Run Deployment Helper ==="

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud CLI is not installed."
    echo "Please install it from https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Ensure user is logged in
echo "Checking active Google Cloud account..."
ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)")
if [ -z "$ACTIVE_ACCOUNT" ]; then
    echo "No active Google Cloud account found. Running 'gcloud auth login'..."
    gcloud auth login
fi

# Get current project
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
    echo "No active Google Cloud project configured."
    echo "Please set your project using: gcloud config set project <PROJECT_ID>"
    read -p "Enter Google Cloud Project ID to proceed: " PROJECT_ID
    if [ -z "$PROJECT_ID" ]; then
        echo "Error: Project ID is required."
        exit 1
    fi
    gcloud config set project "$PROJECT_ID"
fi

echo "Deploying to Google Cloud Run..."
echo "Project ID:   $PROJECT_ID"
echo "Service Name: $SERVICE_NAME"
echo "Region:       $REGION"
echo ""

# Deploy using source-to-service (Google Cloud Build will use our Dockerfile automatically)
gcloud run deploy "$SERVICE_NAME" \
    --source . \
    --region "$REGION" \
    --allow-unauthenticated \
    --port 8080

echo ""
echo "=== Deployment attempt complete ==="
