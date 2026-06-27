@echo off
echo Starting MediLink dev server on port 3001...
start /B node_modules\.bin\next dev --port 3001

echo Waiting 15 seconds for server to initialize...
ping 127.0.0.1 -n 16 > nul

echo Running Playwright regression suite...
node_modules\.bin\playwright test tests/regression/auth.spec.js --reporter=list --timeout=60000

echo Done.
