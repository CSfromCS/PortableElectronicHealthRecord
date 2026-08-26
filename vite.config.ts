import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, loadEnv } from 'vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

const base = './'

const packageJson = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as {
  version?: string
}
const appVersion = packageJson.version ?? '0.0.0'

const gitSha = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
})()

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const isStagingBuild = env.VITE_STAGING_MODE === 'true'

  return {
    base,
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    plugins: [
      tailwindcss(),
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          cacheId: isStagingBuild ? 'puhrr-staging' : 'puhrr-production',
        },
        includeAssets: [
          'assets/puhr-v1/32.png',
          'assets/puhr-v1/180.png',
          'assets/puhr-v1/192.png',
          'assets/puhr-v1/512.png',
          'assets/puhr-v1/puhr-v1.svg',
        ],
        // Source of truth for PWA metadata. Keep `public/manifest.json` mirrored.
        manifest: {
          name: 'PUHRR - Portable Electronic Health Record',
          short_name: 'PUHRR',
          description: 'Offline-first patient tracking for hospital rounds',
          id: './',
          scope: './',
          start_url: './',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#FDF6F0',
          theme_color: '#E2614A',
          icons: [
            {
              src: 'assets/puhr-v1/192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'assets/puhr-v1/512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable',
            },
          ],
        },
      }),
    ],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __GIT_SHA__: JSON.stringify(gitSha),
    },
  }
})
