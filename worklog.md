---
Task ID: 1
Agent: main
Task: Separate Kitchen, Admin, and Courier into their own routes; make Kitchen and Courier PWAs with install-to-homescreen

Work Log:
- Created PWA infrastructure: usePWAInstall hook, PWAInstallBanner component, PWAInstallInstructions component
- Created useServiceWorker hook for service worker registration
- Created web app manifests: manifest-kuchyna.json, manifest-kurier.json
- Created service workers: sw-kuchyna.js, sw-kurier.js (cache-first for static, network-first for API)
- Generated PWA icons using AI image generation: icon-kuchyna-512.png, icon-kurier-512.png, and 192px versions
- Refactored / page.tsx to only show customer ordering flow (no more sidebar navigation)
- Created /kuchyna route with PWA: layout.tsx (manifest + viewport metadata), page.tsx (dark theme kitchen panel with install banner)
- Created /kurier route with PWA: layout.tsx (manifest + viewport metadata), page.tsx (green theme courier panel with install banner)
- Created /admin route: layout.tsx, page.tsx (regular web page, no PWA)
- Fixed lint error in usePWAInstall.ts (setState in effect → useSyncExternalStore)
- All lint checks pass
- Browser-verified all 4 routes: /, /kuchyna, /admin, /kurier — all render correctly

Stage Summary:
- Customer page (/) now only shows the ordering flow — no kitchen/admin/courier access
- Kitchen (/kuchyna) is a standalone PWA with dark theme, install banner, service worker
- Courier (/kurier) is a standalone PWA with green theme, install banner, service worker
- Admin (/admin) is a separate regular page (no PWA needed)
- Both PWA pages have "Uložiť na plochu" (Save to homescreen) buttons with iOS/Android instructions
- Auto-install banner appears when browser supports beforeinstallprompt
- Manual install instructions shown for iOS Safari users
