#!/bin/bash

# Set n8n environment variables
export N8N_BASIC_AUTH_ACTIVE=false
export N8N_PORT=5678
export WEBHOOK_URL=http://127.0.0.1:5678

# 1. Start n8n in the background (Headless)
echo "Starting n8n on port 5678..."
npx n8n start > n8n.log 2>&1 &
N8N_PID=$!

# 2. Wait for n8n to initialize
echo "Waiting for n8n to start..."
sleep 20

# Check if n8n is running
if curl -s http://127.0.0.1:5678 > /dev/null; then
    echo "✅ n8n is running!"
else
    echo "⚠️ n8n may not be ready yet, but continuing..."
fi

# 3. Import the Workflow (Automatic Setup)
echo "Importing Workflow..."
npx n8n import:workflow --input=whatsapp_n8n_workflow.json

# 4. Activate the workflow
echo "Activating Workflow..."
npx n8n update:workflow --id=1 --active=true || echo "Workflow activation skipped"

# 5. Start the WhatsApp Bridge (Foreground App for Render)
echo "Starting WhatsApp Bridge..."
node wa_api.js
