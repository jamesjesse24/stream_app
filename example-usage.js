import UHDMovies from './src/index.js';

async function example() {
  const extension = new UHDMovies();

  try {
    // Get popular anime
    console.log("Fetching popular anime...");
    const popular = await extension.getPopularAnime(1);
    console.log(`Found ${popular.animeList.length} anime`);
    
    if (popular.animeList.length > 0) {
      const firstAnime = popular.animeList[0];
      console.log(`Selected: ${firstAnime.title}`);
      
      // Get anime details
      const details = await extension.getAnimeDetails(firstAnime.url);
      console.log(`Description: ${details.description}`);
      
      // Get episodes
      const episodes = await extension.getEpisodeList(firstAnime.url);
      console.log(`Found ${episodes.length} episodes`);
      
      if (episodes.length > 0) {
        // Get video links for first episode
        const videos = await extension.getVideoList(episodes[0]);
        console.log(`Found ${videos.length} video links`);
        
        videos.forEach((video, index) => {
          console.log(`${index + 1}. ${video.quality} - ${video.url}`);
        });
      }
    }
    
    // Search example
    console.log("\nSearching for 'action'...");
    const searchResults = await extension.searchAnime(1, "action");
    console.log(`Found ${searchResults.animeList.length} search results`);
    
  } catch (error) {
    console.error("Error:", error.message);
  }
}

// Run example
example();