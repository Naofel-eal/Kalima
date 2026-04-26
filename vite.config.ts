import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Served from https://<user>.github.io/Kalima/ — every path needs the prefix.
const BASE = '/Kalima/';

export default defineConfig({
  base: BASE,
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'fonts/AmiriQuran.woff2',
        'words.lite.json',
        'icon.svg',
        'icon-192.png',
        'icon-512.png',
        'maskable-512.png',
        'apple-touch-icon.png',
      ],
      manifest: {
        name: 'Kalima — Quranic word reading practice',
        short_name: 'Kalima',
        description: 'Daily practice for reading vocalized Quranic words fluently.',
        lang: 'en',
        dir: 'ltr',
        scope: BASE,
        start_url: BASE,
        display: 'standalone',
        background_color: '#f4ecd8',
        theme_color: '#8b6f47',
        orientation: 'portrait',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,json}'],
        // Lite words file is ~870KB — bump default 2MB cache size just in case.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
});
