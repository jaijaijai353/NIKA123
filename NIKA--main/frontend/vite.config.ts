import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'), // so you can use "@/components/..."
    },
  },
  optimizeDeps: {
    exclude: [
      'lucide-react',
      'jspdf',
      'jspdf-autotable',
      'xlsx',
      'pptxgenjs',
      'chart.js',
    ],
  },
  build: {
    outDir: 'dist',
    sourcemap: true, // useful for debugging in Vercel/production
  },
  server: {
    port: 5173,
    open: true, // auto-open browser on dev
    host: true,
  },
})
