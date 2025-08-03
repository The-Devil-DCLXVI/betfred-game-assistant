import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: { main: resolve(__dirname, 'src/main.js') },
      output: {
        entryFileNames: 'main.bundle.js'
      }
    }
  },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: 'manifest.json', dest: '.' },
        { src: 'styles.css', dest: '.' },
        { src: 'youtube.png', dest: '.' },
        { src: 'pnuk.png', dest: '.' },
        { src: 'betfred_scan_data.json', dest: '.' },
        { src: 'icon16.png', dest: '.' },
        { src: 'icon32.png', dest: '.' },
        { src: 'icon48.png', dest: '.' },
        { src: 'icon128.png', dest: '.' }
      ]
    })
  ]
}); 