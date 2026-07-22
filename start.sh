#!/bin/bash

echo "Starting UHDMovies Full Stack Application..."
echo "Backend will run on http://localhost:3001"
echo "Frontend will run on http://localhost:3000"
echo ""

# Kill any existing processes on these ports
echo "Cleaning up existing processes..."
npx kill-port 3000 3001 2>/dev/null || true

# Start both servers
npm run dev:full
