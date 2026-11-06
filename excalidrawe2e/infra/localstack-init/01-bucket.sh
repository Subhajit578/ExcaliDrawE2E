#!/bin/sh
# Runs inside the container once S3 is ready, so a fresh clone needs no
# clicking through a console. Mirrors what you would configure by hand on R2.
set -e
BUCKET="${STORAGE_BUCKET:-whiteboard-images}"

awslocal s3api create-bucket --bucket "$BUCKET"

# Public read. Objects are named by the SHA-256 of their bytes, so a key is
# already unguessable - signing reads would buy nothing and would make them
# uncacheable. This is the same posture as an R2 public bucket.
awslocal s3api put-bucket-policy --bucket "$BUCKET" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Effect\": \"Allow\",
    \"Principal\": \"*\",
    \"Action\": \"s3:GetObject\",
    \"Resource\": \"arn:aws:s3:::$BUCKET/*\"
  }]
}"

# CORS, because the browser PUTs straight to this origin from localhost:3000.
# Without it the preflight fails and the upload never leaves the browser -
# while curl keeps working, which is what makes it confusing to debug.
awslocal s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }]
}'

echo "[init] bucket $BUCKET ready"
