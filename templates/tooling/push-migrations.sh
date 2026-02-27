#!/bin/bash
# Push Supabase migrations to remote database
# Usage: npm run migrate

set -e

# Check if SUPABASE_ACCESS_TOKEN is set
if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
    echo "❌ SUPABASE_ACCESS_TOKEN environment variable is not set"
    echo "Please set it using: export SUPABASE_ACCESS_TOKEN=your_token"
    exit 1
fi

# Get project ref from config
PROJECT_REF=$(grep 'project_id' supabase/config.toml | cut -d'"' -f2)

if [ -z "$PROJECT_REF" ]; then
    echo "❌ Could not find project_id in supabase/config.toml"
    exit 1
fi

echo "🚀 Pushing migrations to Supabase project: $PROJECT_REF"

# Push migrations using Supabase CLI
npx supabase db push --project-ref "$PROJECT_REF"

echo "✅ Migrations pushed successfully!"
