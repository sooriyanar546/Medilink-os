@echo off
color 0b
echo =================================================================
echo             MediLink OS - Secure Vercel Deployment
echo =================================================================
echo.
echo IMPORTANT: Use your ARROW KEYS to select how you want to 
echo log in (GitHub, Google, or Email), and press ENTER.
echo.
pause
echo.

echo Logging you in...
call npx vercel login

echo.
echo Initializing Vercel Deployment...
call npx vercel --prod --yes

echo.
echo =================================================================
echo Deployment Process Completed!
echo If successful, Vercel just provided you with a live Production URL.
echo =================================================================
pause
