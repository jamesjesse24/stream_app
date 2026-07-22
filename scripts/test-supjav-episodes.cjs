/**
 * Enhanced SupJAV Episodes & Videos Test
 * Tests the complete flow: popular -> details -> episodes -> videos
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api/supjav';
const SESSION_TOKEN = 'cf_session_firefox_updated';

async function testCompleteFlow() {
  console.log('🎬 Enhanced SupJAV Episode Extraction Test');
  console.log('============================================\n');

  try {
    // Step 1: Get popular anime/JAV
    console.log('📋 Step 1: Getting popular content...');
    const popularResponse = await axios.get(`${BASE_URL}?action=popular&lang=en&page=1&sessionToken=${SESSION_TOKEN}`);
    
    if (popularResponse.data.error) {
      console.log('❌ Error getting popular:', popularResponse.data.error);
      return;
    }

    const animeList = popularResponse.data.animeList || [];
    console.log(`✅ Found ${animeList.length} popular items`);

    if (animeList.length === 0) {
      console.log('⚠️ No content found to test with');
      return;
    }

    // Take first item for testing
    const testItem = animeList[0];
    console.log(`🎯 Testing with: "${testItem.title}"`);
    console.log(`📍 URL: ${testItem.url}\n`);

    // Step 2: Get detailed information
    console.log('📋 Step 2: Getting detailed information...');
    const detailsResponse = await axios.get(`${BASE_URL}?action=details&url=${encodeURIComponent(testItem.url)}&sessionToken=${SESSION_TOKEN}`);
    
    if (detailsResponse.data.error) {
      console.log('❌ Error getting details:', detailsResponse.data.error);
      if (detailsResponse.data.needsChallenge) {
        console.log('🔒 Cloudflare challenge required');
        console.log('🌐 Challenge URL:', detailsResponse.data.challengeUrl);
        return;
      }
    } else {
      console.log('✅ Details retrieved successfully');
      console.log(`📝 Title: ${detailsResponse.data.title || 'N/A'}`);
      console.log(`👥 Artist: ${detailsResponse.data.artist || 'N/A'}`);
      console.log(`🏢 Author: ${detailsResponse.data.author || 'N/A'}`);
      console.log(`🏷️ Genres: ${(detailsResponse.data.genre || []).join(', ') || 'N/A'}\n`);
    }

    // Step 3: Get episodes/streaming options
    console.log('📋 Step 3: Getting episodes/streaming options...');
    const episodesResponse = await axios.get(`${BASE_URL}?action=episodes&url=${encodeURIComponent(testItem.url)}&sessionToken=${SESSION_TOKEN}`);
    
    if (episodesResponse.data.error) {
      console.log('❌ Error getting episodes:', episodesResponse.data.error);
      if (episodesResponse.data.needsChallenge) {
        console.log('🔒 Cloudflare challenge required');
        return;
      }
    } else {
      const episodes = episodesResponse.data.episodes || [];
      console.log(`✅ Found ${episodes.length} episodes/streaming options`);
      
      episodes.forEach((episode, index) => {
        console.log(`   ${index + 1}. ${episode.name} (${episode.quality || 'Unknown Quality'})`);
        if (episode.streamingUrl) {
          console.log(`      🔗 Streaming URL: ${episode.streamingUrl.substring(0, 80)}...`);
        }
      });
      console.log('');

      // Step 4: Get video streams for first episode
      if (episodes.length > 0) {
        const firstEpisode = episodes[0];
        console.log('📋 Step 4: Getting video streams...');
        console.log(`🎥 Testing episode: "${firstEpisode.name}"`);
        
        const videosResponse = await axios.get(`${BASE_URL}?action=videos&url=${encodeURIComponent(firstEpisode.url)}&sessionToken=${SESSION_TOKEN}`);
        
        if (videosResponse.data.error) {
          console.log('❌ Error getting videos:', videosResponse.data.error);
        } else {
          const videos = videosResponse.data.videos || [];
          console.log(`✅ Found ${videos.length} video streams`);
          
          videos.forEach((video, index) => {
            console.log(`   ${index + 1}. ${video.quality} - ${video.player || 'Unknown Player'}`);
            console.log(`      🔗 Video URL: ${video.videoUrl.substring(0, 80)}...`);
            if (video.headers?.Referer) {
              console.log(`      📄 Referer: ${video.headers.Referer.substring(0, 60)}...`);
            }
          });
        }
      }
    }

    console.log('\n✨ Test completed successfully!');

  } catch (error) {
    console.log('💥 Test failed with error:', error.message);
    if (error.response) {
      console.log('📊 Status:', error.response.status);
      console.log('📄 Response:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Check if server is running first
async function checkServer() {
  try {
    const response = await axios.get(`${BASE_URL}?action=info`, { timeout: 5000 });
    console.log('🟢 Server is running');
    console.log('📍 SupJAV API Info:', JSON.stringify(response.data, null, 2));
    console.log('');
    return true;
  } catch (error) {
    console.log('🔴 Server not running or not responding');
    console.log('💡 Please start the Next.js development server first');
    console.log('⚡ Command: npm run dev');
    return false;
  }
}

async function main() {
  const serverRunning = await checkServer();
  if (serverRunning) {
    await testCompleteFlow();
  }
}

main();
