@echo off
echo Starting UHDMovies Full Stack Application...
echo Backend will run on http://localhost:3001
echo Frontend will run on http://localhost:3000
echo.

echo Cleaning up existing processes...
npx kill-port 3000 3001 >nul 2>&1

echo Starting both servers...
npm run dev:full
