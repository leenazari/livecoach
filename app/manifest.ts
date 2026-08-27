import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LiveCoach CRM",
    short_name: "LiveCoach",
    description: "Live sales coaching, outreach and CRM intelligence in one place.",
    start_url: "/crm",
    display: "standalone",
    background_color: "#0F1217",
    theme_color: "#E0A458",
    icons: [
      {
        src: "/brand/livecoach-mark-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/brand/livecoach-mark-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
