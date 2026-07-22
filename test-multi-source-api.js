#!/usr/bin/env node

/**
 * Test script for the anime APIs
 * Run with: node test-multi-source-api.js
 */

const baseUrl = 'http://localhost:3000';

async function testAPI(endpoint, description) {
  console.log(`\n🧪 Testing: ${description}`);
  console.log(`📡 Endpoint: ${endpoint}`);
  
  try {
    const response = await fetch(`${baseUrl}${endpoint}`);
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Success');
      if (data.animeList) {
        console.log(`📊 Results: ${data.animeList.length} items`);
        if (data.animeList.length > 0) {
          console.log(`📝 First item: ${data.animeList[0].title}`);
        }
      } else if (data.videos) {
        console.log(`🎥 Videos: ${data.videos.length} sources`);
        data.videos.forEach(video => {
          console.log(`   - ${video.quality}: ${video.videoUrl.substring(0, 50)}...`);
        });
      } else {
        console.log('📄 Response keys:', Object.keys(data));
      }
    } else {
      console.log('❌ Error:', data.error);
    }
  } catch (error) {
    console.log('💥 Request failed:', error.message);
  }
}

async function runTests() {
  console.log('🚀 Starting API Tests');
  console.log('=' .repeat(50));

  // Test UHDMovies API
  await testAPI('/api/anime?action=popular&page=1', 'UHDMovies popular content');
  await testAPI('/api/anime?action=search&query=anime&page=1', 'UHDMovies search');
  
  // Test SupJAV info
  await testAPI('/api/supjav?action=info', 'SupJAV source information');
  
  // Test SupJAV popular (English)
  await testAPI('/api/supjav?action=popular&lang=en&page=1', 'SupJAV popular content (English)');
  
  // Test SupJAV popular (Japanese)
  await testAPI('/api/supjav?action=popular&lang=ja&page=1', 'SupJAV popular content (Japanese)');
  
  // Test SupJAV search
  await testAPI('/api/supjav?action=search&query=school&lang=en&page=1', 'SupJAV search (English)');

  console.log('\n' + '=' .repeat(50));
  console.log('🎉 Tests completed!');
  console.log('💡 Available endpoints:');
  console.log('   - /api/anime (UHDMovies)');
  console.log('   - /api/supjav (SupJAV)');
}

// Check if fetch is available (Node.js 18+)
if (typeof fetch === 'undefined') {
  console.log('❌ This script requires Node.js 18+ with built-in fetch support');
  console.log('💡 Or install node-fetch: npm install node-fetch');
  process.exit(1);
}

runTests().catch(console.error);
