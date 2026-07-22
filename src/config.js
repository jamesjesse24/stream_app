const config = {
  defaults: {
    domain: "https://uhdmovies.casa/",
    quality: "1080p",
    sizeSort: "asc"
  },
  
  preferences: {
    domain: process.env.UHD_DOMAIN || "https://uhdmovies.casa/",
    quality: process.env.UHD_QUALITY || "1080p",
    sizeSort: process.env.UHD_SIZE_SORT || "asc"
  },

  qualityOptions: ["2160p", "1080p", "720p", "480p"],
  sizeSortOptions: ["asc", "desc"]
};

export default config;