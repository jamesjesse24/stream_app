#!/usr/bin/env node

// Simple script to check if FFmpeg is available
const { spawn } = require('child_process');

function checkFFmpeg() {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', ['-version'], { stdio: 'pipe' });
    
    let output = '';
    ffmpeg.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        const versionMatch = output.match(/ffmpeg version (\S+)/);
        const version = versionMatch ? versionMatch[1] : 'unknown';
        console.log(`✅ FFmpeg is available (version: ${version})`);
        resolve(true);
      } else {
        console.log('❌ FFmpeg is not available');
        console.log('To install FFmpeg:');
        console.log('• Windows: Download from https://ffmpeg.org/download.html');
        console.log('• macOS: brew install ffmpeg');
        console.log('• Ubuntu/Debian: sudo apt install ffmpeg');
        console.log('• CentOS/RHEL: sudo yum install ffmpeg');
        resolve(false);
      }
    });
    
    ffmpeg.on('error', (error) => {
      console.log('❌ FFmpeg is not available');
      console.log('Error:', error.message);
      resolve(false);
    });
  });
}

if (require.main === module) {
  console.log('Checking FFmpeg availability...');
  checkFFmpeg();
}

module.exports = { checkFFmpeg };
