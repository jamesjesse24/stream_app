/**
 * Direct Cloudflare bypass test
 * Tests the actual request with debugging
 * Run with: node test-direct-cloudflare.js
 */

const axios = require('axios');

async function testDirectRequest() {
  console.log('🧪 Direct SupJAV Request Test');
  console.log('=============================\n');

  const cookie = 'cf_clearance=HIwb5a9kHMwCrSjRo9phZYa4rpuqkJOGbywF2dYjPxk-1753305597-1.2.1.1-wz_5KF87jL7GcIK2Ug2sR7yR0TfkuEE5KTSBbUvF5QX3lAvTMhfqkQWtcgTfrgzg_HrmrILIT3VTeJ4GQg_L7omOcwTV34yfueiLeJ849azu9VZfQTJfTn5laGClHLROGe8DvoU2d_nWsaUHUBg7fJWjDTSvJTPpOwf4sXoEElxxepAjnPpWfoe5q.WSjHdGTRS4GpyHQPQCwpN.RoHLy6OtuAx9vCPtXKWHU86yo8JZC4zYTQggkQ3M8Yt1tq7Y';
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'DNT': '1',
    'Sec-GPC': '1',
    'Priority': 'u=0, i',
    'Cookie': cookie
  };

  const testUrls = [
    'https://supjav.com',
    'https://supjav.com/popular',
    'https://supjav.com/popular/page/1'
  ];

  for (const url of testUrls) {
    console.log(`\n🌐 Testing: ${url}`);
    
    try {
      const response = await axios.get(url, {
        headers,
        timeout: 15000,
        validateStatus: () => true, // Accept all status codes
        maxRedirects: 5
      });

      console.log(`📊 Status: ${response.status}`);
      console.log(`📏 Content Length: ${response.data.length} chars`);
      
      // Check for Cloudflare indicators
      const content = response.data.toString();
      const indicators = {
        'Cloudflare Challenge': content.includes('cf-challenge') || content.includes('window._cf_chl_opt'),
        'Cloudflare Ray ID': content.includes('Ray ID') || content.includes('cf-ray'),
        'Access Denied': content.includes('Access denied') || content.includes('403 Forbidden'),
        'Just a Moment': content.includes('Just a moment') || content.includes('Please wait'),
        'Normal Page': content.includes('<title>') && !content.includes('Cloudflare')
      };

      console.log('🔍 Content Analysis:');
      Object.entries(indicators).forEach(([key, value]) => {
        console.log(`   ${value ? '✅' : '❌'} ${key}`);
      });

      // If successful, look for content
      if (response.status === 200 && indicators['Normal Page']) {
        const cheerio = require('cheerio');
        const $ = cheerio.load(content);
        
        const posts = $('div.posts > div.post');
        console.log(`🎯 Found ${posts.length} posts on page`);
        
        if (posts.length > 0) {
          console.log('📝 First few titles:');
          posts.slice(0, 3).each((i, el) => {
            const title = $(el).find('img').attr('alt') || 'No title';
            console.log(`   ${i + 1}. ${title.substring(0, 50)}...`);
          });
        }
      }

    } catch (error) {
      console.log(`❌ Request failed: ${error.message}`);
      if (error.response) {
        console.log(`📊 Status: ${error.response.status}`);
        console.log(`📄 Response: ${error.response.data.substring(0, 200)}...`);
      }
    }
  }

  console.log('\n💡 Recommendations:');
  console.log('1. Try getting a fresh cookie from a new browser session');
  console.log('2. Make sure to copy ALL cookies from supjav.com (not just cf_clearance)');
  console.log('3. Use the exact same User-Agent as your browser');
  console.log('4. Consider using a proxy service or browser automation');
}

// Check if required modules are available
try {
  require('axios');
  require('cheerio');
  testDirectRequest();
} catch (error) {
  console.log('❌ Missing dependencies. Run: npm install axios cheerio');
}
