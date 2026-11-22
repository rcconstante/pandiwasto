import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  // Lesson text is shared with the arcade Edge Function.
  server: { fs: { allow: [".", "../supabase/functions/arcade/items"] } },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
})
