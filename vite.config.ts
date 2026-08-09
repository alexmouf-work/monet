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
      },
    }),
  ],
});
