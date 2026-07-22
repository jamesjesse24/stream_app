#!/usr/bin/env node

/**
 * Test your exact curl request using Node.js
 */

import axios from 'axios';
import * as cheerio from 'cheerio';

async function testExactCurl() {
  console.log('🧪 Testing Your Exact Curl Request');
  console.log('===================================\n');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Connection': 'keep-alive',
    'Cookie': 'cf_clearance=HIwb5a9kHMwCrSjRo9phZYa4rpuqkJOGbywF2dYjPxk-1753305597-1.2.1.1-wz_5KF87jL7GcIK2Ug2sR7yR0TfkuEE5KTSBbUvF5QX3lAvTMhfqkQWtcgTfrgzg_HrmrILIT3VTeJ4GQg_L7omOcwTV34yfueiLeJ849azu9VZfQTJfTn5laGClHLROGe8DvoU2d_nWsaUHUBg7fJWjDTSvJTPpOwf4sXoEElxxepAjnPpWfoe5q.WSjHdGTRS4GpyHQPQCwpN.RoHLy6OtuAx9vCPtXKWHU86yo8JZC4zYTQggkQ3M8Yt1tq7Y',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'DNT': '1',
    'Sec-GPC': '1',
    'Priority': 'u=0, i'
  };

  const urls = [
    'https://supjav.com/',
    'https://supjav.com/popular',
    'https://supjav.com/popular/page/1'
  ];

  for (const url of urls) {
    console.log(`\n🌐 Testing: ${url}`);
    
    try {
      const response = await axios.get(url, {
        headers,
        timeout: 15000,
        validateStatus: () => true,
        maxRedirects: 5
      });

      console.log(`📊 Status: ${response.status}`);
      console.log(`📏 Content Length: ${response.data.length} chars`);
      
      const content = response.data.toString();
      
      // Check for various indicators
      const checks = {
        'Cloudflare Challenge': content.includes('cf-challenge') || content.includes('window._cf_chl_opt'),
        'Challenge Page': content.includes('Checking your browser') || content.includes('Just a moment'),
        'Access Denied': content.includes('Access denied') || content.includes('403'),
        'Ray ID': content.includes('Ray ID:'),
        'Has Title Tag': content.includes('<title>'),
        'Has SupJAV Content': content.includes('supjav') || content.includes('SupJAV'),
        'Has Posts': content.includes('div.posts') || content.includes('post'),
        'Normal Page': content.includes('<title>') && !content.includes('Cloudflare') && !content.includes('cf-challenge')
      };

      console.log('🔍 Content Analysis:');
      Object.entries(checks).forEach(([key, value]) => {
        const icon = value ? '✅' : '❌';
        console.log(`   ${icon} ${key}`);
      });

      if (checks['Normal Page']) {
        console.log('\n🎉 SUCCESS! Cookie is working!');
        
        // Try to parse content
        try {
          const $ = cheerio.load(content);
          
          const title = $('title').text();
          console.log(`📄 Page Title: ${title}`);
          
          const posts = $('div.posts > div.post, .post-item, article');
          console.log(`📝 Found ${posts.length} posts`);
          
          if (posts.length > 0) {
            console.log('\n🎯 Sample content found:');
            posts.slice(0, 3).each((i, el) => {
              const $el = $(el);
              const title = $el.find('img').attr('alt') || $el.find('h2, h3, .title').text() || 'No title';
              console.log(`   ${i + 1}. ${title.substring(0, 50)}...`);
            });
          }
          
          return true; // Success!
          
        } catch (parseError) {
          console.log('⚠️  Content parsing failed:', parseError.message);
        }
      } else if (checks['Cloudflare Challenge']) {
        console.log('\n🚫 Cookie appears to be expired or invalid');
      }

    } catch (error) {
      console.log(`❌ Request failed: ${error.message}`);
      if (error.code === 'ENOTFOUND') {
        console.log('🌐 Network connectivity issue');
      }
    }
  }

  console.log('\n💡 Next Steps:');
  console.log('1. If cookie is working: The API should work too');
  console.log('2. If cookie expired: Get a fresh one from your browser');
  console.log('3. If still blocked: Try from the same IP/network as your browser');
}

testExactCurl().catch(console.error);
