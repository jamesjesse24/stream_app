// Mock data for testing purposes
export const mockAnimeData = {
  animeList: [
    {
      url: "/anime/attack-on-titan",
      thumbnailUrl: "https://via.placeholder.com/300x400/1f2937/ffffff?text=Attack+on+Titan",
      title: "Attack on Titan"
    },
    {
      url: "/anime/demon-slayer",
      thumbnailUrl: "https://via.placeholder.com/300x400/dc2626/ffffff?text=Demon+Slayer",
      title: "Demon Slayer"
    },
    {
      url: "/anime/naruto",
      thumbnailUrl: "https://via.placeholder.com/300x400/ea580c/ffffff?text=Naruto",
      title: "Naruto"
    },
    {
      url: "/anime/one-piece",
      thumbnailUrl: "https://via.placeholder.com/300x400/059669/ffffff?text=One+Piece",
      title: "One Piece"
    },
    {
      url: "/anime/my-hero-academia",
      thumbnailUrl: "https://via.placeholder.com/300x400/2563eb/ffffff?text=My+Hero+Academia",
      title: "My Hero Academia"
    },
    {
      url: "/anime/jujutsu-kaisen",
      thumbnailUrl: "https://via.placeholder.com/300x400/7c3aed/ffffff?text=Jujutsu+Kaisen",
      title: "Jujutsu Kaisen"
    },
    {
      url: "/anime/one-punch-man",
      thumbnailUrl: "https://via.placeholder.com/300x400/db2777/ffffff?text=One+Punch+Man",
      title: "One Punch Man"
    },
    {
      url: "/anime/tokyo-ghoul",
      thumbnailUrl: "https://via.placeholder.com/300x400/374151/ffffff?text=Tokyo+Ghoul",
      title: "Tokyo Ghoul"
    },
    {
      url: "/anime/fullmetal-alchemist",
      thumbnailUrl: "https://via.placeholder.com/300x400/b45309/ffffff?text=Fullmetal+Alchemist",
      title: "Fullmetal Alchemist"
    },
    {
      url: "/anime/death-note",
      thumbnailUrl: "https://via.placeholder.com/300x400/111827/ffffff?text=Death+Note",
      title: "Death Note"
    },
    {
      url: "/anime/hunter-x-hunter",
      thumbnailUrl: "https://via.placeholder.com/300x400/166534/ffffff?text=Hunter+x+Hunter",
      title: "Hunter x Hunter"
    },
    {
      url: "/anime/mob-psycho-100",
      thumbnailUrl: "https://via.placeholder.com/300x400/4338ca/ffffff?text=Mob+Psycho+100",
      title: "Mob Psycho 100"
    },
    {
      url: "/anime/spirited-away",
      thumbnailUrl: "https://via.placeholder.com/300x400/0891b2/ffffff?text=Spirited+Away",
      title: "Spirited Away"
    },
    {
      url: "/anime/your-name",
      thumbnailUrl: "https://via.placeholder.com/300x400/c2410c/ffffff?text=Your+Name",
      title: "Your Name"
    },
    {
      url: "/anime/weathering-with-you",
      thumbnailUrl: "https://via.placeholder.com/300x400/1d4ed8/ffffff?text=Weathering+with+You",
      title: "Weathering with You"
    },
    {
      url: "/anime/akira",
      thumbnailUrl: "https://via.placeholder.com/300x400/be123c/ffffff?text=Akira",
      title: "Akira"
    }
  ],
  hasNextPage: true
};

export const mockAnimeDetails = {
  title: "Attack on Titan",
  status: "COMPLETED",
  description: "Humanity fights for survival against giant humanoid Titans that have brought civilization to the brink of extinction.",
  initialized: true
};

export const mockEpisodes = [
  {
    url: JSON.stringify({ urls: [{ url: "https://example.com/video1", quality: "1080p" }] }),
    name: "Episode 1 - To You, in 2000 Years",
    episodeNumber: 1
  },
  {
    url: JSON.stringify({ urls: [{ url: "https://example.com/video2", quality: "1080p" }] }),
    name: "Episode 2 - That Day",
    episodeNumber: 2
  }
];

export const mockVideoLinks = [
  {
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    quality: "1080p - Sample Video",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
  },
  {
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    quality: "720p - Sample Video",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"
  }
];
