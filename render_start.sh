#!/bin/bash

# 1. Start n8n in the background (Headless)
echo "Starting n8n..."
npx n8n start > n8n.log 2>&1 &

# 2. Wait for n8n to initialize (give it 15 seconds)
sleep 15

# 3. Import the Workflow (Automatic Setup)
echo "Importing Workflow..."
npx n8n import:workflow --input=whatsapp_n8n_workflow.json

# 4. Start the WhatsApp Bridge (Foreground App for Render)
echo "Starting WhatsApp Bridge..."
node wa_api.js
