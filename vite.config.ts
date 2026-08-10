import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base so the build works from any path (a subdirectory, a file:// open, or
  // monet.mouftools.com at the root).
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Monet — Minecraft texture editor',
        short_name: 'Monet',
        description: 'Paint 3D-style 2D editor for Minecraft texture making.',
        theme_color: '#3fa7d6',
        background_color: '#3d3d40',
        display: 'standalone',
        orientation: 'landscape',
        start_url: './',
        /**
         * Open-with from the OS file manager — docs/07 §10. Chromium registers these with
         * Windows (and macOS/Linux) when the PWA is **installed**, so "Open with → Monet"
         * appears in Explorer. `action` must be a real served URL: Monet has no client-side
         * routing and no catch-all rewrite, so it is the app root, and `launchQueue` (not the
         * URL) carries the files. Extensions here mirror TYPE_IMAGES in fsa/localFile.ts —
         * registering a type the editor cannot open would be worse than not registering it.
         *
         * No per-handler `icons`: declaring them would repaint every associated file in
         * Explorer with Monet's icon, and a folder of textures is easier to read with its
         * normal thumbnails. `launch_type` is left at its default, `single-client`, so a
         * multi-file selection arrives as one launch carrying every file.
         */
        file_handlers: [
          {
            action: '/',
            accept: {
              'image/png': ['.png'],
              'image/jpeg': ['.jpg', '.jpeg'],
              'image/webp': ['.webp'],
              'image/bmp': ['.bmp'],
              'image/gif': ['.gif'],
              'image/vnd.microsoft.icon': ['.ico'],
            },
          },
          { action: '/', accept: { 'application/zip': ['.monet'] } },
        ],
        // Opening a second file reuses the window it would otherwise duplicate; the files
        // arrive as extra document tabs instead of extra windows.
        launch_handler: { client_mode: 'focus-existing' },
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The app shell is small and fully client-side, so precache all of it: editing local
        // files keeps working offline. Fonts are part of the build output.
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        maximumFileSizeToCacheInBytes: 6_000_000,
        navigateFallback: 'index.html',
        // The token exchange is a real server route; the shell must never stand in for it.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
});
