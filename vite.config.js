import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // onnxruntime-web (used by the AI background removal) breaks when Vite pre-bundles it.
  optimizeDeps: { exclude: ['@imgly/background-removal', 'onnxruntime-web'] },
})
