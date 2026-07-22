export const config = {
  defaults: {
    domain: "https://uhdmovies.email",
    quality: "1080p",
    sizeSort: "asc",
    source: "uhdmovies"
  },
  
  preferences: {
    domain: process.env.UHD_DOMAIN || "https://uhdmovies.email",
    quality: process.env.UHD_QUALITY || "1080p",
    sizeSort: process.env.UHD_SIZE_SORT || "asc",
    source: process.env.ANIME_SOURCE || "uhdmovies"
  },

  qualityOptions: ["2160p", "1080p", "720p", "480p"],
  sizeSortOptions: ["asc", "desc"],
  
  sources: {
    uhdmovies: {
      name: "UHD Movies",
      baseUrl: "https://uhdmovies.email",
      supportedQualities: ["2160p", "1080p", "720p", "480p"],
      supportedLanguages: ["en"],
      type: "movie_site"
    },
    supjav: {
      name: "SupJAV",
      baseUrl: "https://supjav.com",
      supportedQualities: ["1080p", "720p", "480p", "360p"],
      supportedLanguages: ["en", "ja", "zh"],
      type: "jav_site",
      protectorUrl: "https://lk1.supremejav.com/supjav.php"
    }
  }
} as const;

export default config;
