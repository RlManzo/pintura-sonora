import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: {
    host: true,
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "robots.txt"],
      manifest: {
        name: "Pintura Sonora",
        short_name: "PinturaSonora",
        description: "Explorá una pintura y generá sonido",
        theme_color: "#0b0b0b",
        background_color: "#0b0b0b",
        display: "standalone",
        scope: "/",
        start_url: "/",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
        ],
      },
    }),
  ],
});
