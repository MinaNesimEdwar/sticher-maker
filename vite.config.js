import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import vercel from './vercel.json' with { type: 'json' }

// Same headers Vercel sends, so `npm run preview` behaves like production.
const siteHeaders = Object.fromEntries(vercel.headers.find((h) => h.source === '/(.*)').headers.map((h) => [h.key, h.value]))

export default defineConfig({
  plugins: [react()],
  // onnxruntime-web (used by the AI background removal) breaks when Vite pre-bundles it.
  optimizeDeps: { exclude: ['@imgly/background-removal', 'onnxruntime-web'] },
  preview: { headers: siteHeaders },
})
