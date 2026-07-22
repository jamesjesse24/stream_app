#!/usr/bin/env node

/**
 * Cookie extraction helper for Cloudflare bypass
 * Run this script to help extract cookies from browser
 */

console.log('🍪 Cloudflare Cookie Extraction Helper');
console.log('=====================================\n');

console.log('📋 Instructions for extracting cookies:');
console.log('1. Open your browser and navigate to the SupJAV site');
console.log('2. Complete the Cloudflare challenge');
console.log('3. Open Developer Tools (F12)');
console.log('4. Go to Application/Storage tab');
console.log('5. Click on Cookies > https://supjav.com');
console.log('6. Copy all cookie values\n');

console.log('🔧 How to use the cookies:');
console.log('1. Format cookies as an array: ["cookie1=value1", "cookie2=value2"]');
console.log('2. Make a POST request to /api/supjav/set-session');
console.log('3. Body: { "sessionToken": "your_token", "cookies": [...] }\n');

console.log('📝 Example curl command:');
console.log(`curl -X POST http://localhost:3000/api/supjav/set-session \\
  -H "Content-Type: application/json" \\
  -d '{
    "sessionToken": "cf_session_abc123",
    "cookies": [
      "cf_clearance=abc123...",
      "__cfduid=def456...",
      "session_id=ghi789..."
    ],
    "userAgent": "Mozilla/5.0..."
  }'`);

console.log('\n✨ After setting cookies, use the sessionToken in your API calls:');
console.log('GET /api/supjav?action=popular&sessionToken=cf_session_abc123');

console.log('\n🌐 Browser automation alternative:');
console.log('You can also use the browser popup feature by calling the API without sessionToken.');
console.log('The system will automatically open a browser window for you to solve the challenge.');

const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function interactiveHelper() {
  console.log('\n🤖 Interactive Cookie Helper');
  console.log('Would you like to start the interactive helper? (y/n)');
  
  rl.question('> ', async (answer) => {
    if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
      await runInteractiveHelper();
    } else {
      console.log('👋 Helper closed. Use the manual instructions above.');
      rl.close();
    }
  });
}

async function runInteractiveHelper() {
  console.log('\n🔄 Step 1: Generate session token');
  const sessionToken = generateSessionToken();
  console.log(`📝 Your session token: ${sessionToken}`);
  
  console.log('\n🌐 Step 2: Opening browser...');
  const { spawn } = require('child_process');
  const url = 'https://supjav.com';
  
  const isWindows = process.platform === 'win32';
  let command, args;
  
  if (isWindows) {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    command = 'open';
    args = [url];
  }
  
  const browserProcess = spawn(command, args, {
    detached: true,
    stdio: 'ignore'
  });
  browserProcess.unref();
  
  console.log(`✅ Browser opened to: ${url}`);
  console.log('\n📋 Complete the Cloudflare challenge in your browser');
  console.log('Then copy your cookies and paste them here.');
  
  rl.question('\nEnter cookies (comma-separated): ', (cookiesInput) => {
    const cookies = cookiesInput.split(',').map(c => c.trim()).filter(c => c);
    
    if (cookies.length === 0) {
      console.log('❌ No cookies provided');
      rl.close();
      return;
    }
    
    console.log(`\n✅ Received ${cookies.length} cookies`);
    console.log('📤 Sending to API...');
    
    sendCookiesToAPI(sessionToken, cookies);
  });
}

function generateSessionToken() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `cf_session_${random}_${timestamp}`;
}

async function sendCookiesToAPI(sessionToken, cookies) {
  try {
    const fetch = require('node-fetch');
    const response = await fetch('http://localhost:3000/api/supjav/set-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sessionToken,
        cookies,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      })
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Cookies stored successfully!');
      console.log(`📝 Session token: ${sessionToken}`);
      console.log('\n🚀 You can now use the SupJAV API with your session:');
      console.log(`GET /api/supjav?action=popular&sessionToken=${sessionToken}`);
    } else {
      console.log('❌ Error storing cookies:', result.error);
    }
  } catch (error) {
    console.log('💥 Failed to send cookies to API:', error.message);
    console.log('\n📋 Manual setup:');
    console.log(`Session Token: ${sessionToken}`);
    console.log(`Cookies: ${JSON.stringify(cookies, null, 2)}`);
  }
  
  rl.close();
}

// Check if fetch is available
if (typeof fetch === 'undefined') {
  try {
    require('node-fetch');
  } catch {
    console.log('\n⚠️  node-fetch not available. Install it for automatic cookie submission:');
    console.log('npm install node-fetch');
  }
}

interactiveHelper();
