'use client';

import { useState } from 'react';
import { MkvVideoPlayer } from '@/components/MkvVideoPlayer';
import { GoogleDriveDiagnostic } from '@/components/GoogleDriveDiagnostic';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function TestMkvPage() {
  const [videoUrl, setVideoUrl] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [showDiagnostic, setShowDiagnostic] = useState(false);

  const handlePlayVideo = () => {
    if (videoUrl.trim()) {
      setIsPlaying(true);
      setErrors([]);
    }
  };

  const handlePlayerError = (error: string) => {
    setErrors(prev => [...prev, error]);
  };

  const handlePlayerSuccess = () => {
    setErrors([]);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            MKV Transcoding Player Test
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Stream MKV files with real-time transcoding to MP4, live seeking, and subtitle support
          </p>
          <div className="mt-2 inline-flex items-center gap-2 px-3 py-1 bg-green-100 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-full">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span className="text-green-700 dark:text-green-300 text-sm font-medium">
              Live Transcoding Active
            </span>
          </div>
          <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
            <p className="text-blue-800 dark:text-blue-200 text-sm">
              🔧 <strong>Google Drive URLs Improved:</strong> Enhanced timeout handling, retry logic, and better FFmpeg parameters for video-downloads.googleusercontent.com URLs.
            </p>
          </div>
        </div>

        {/* URL Input */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
          <div className="flex gap-2">
            <Input
              type="url"
              placeholder="Enter MKV video URL..."
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              className="flex-1"
            />
            <Button onClick={handlePlayVideo} disabled={!videoUrl.trim()}>
              Load Video
            </Button>
            <Button 
              variant="outline" 
              onClick={async () => {
                if (!videoUrl.trim()) return;
                try {
                  const response = await fetch(`/api/test-transcode?url=${encodeURIComponent(videoUrl)}`);
                  const result = await response.json();
                  console.log('Transcode test result:', result);
                  alert(`Test Result:\nContent-Type: ${result.contentType}\nIs MP4: ${result.isMP4}\nTranscoding: ${result.transcoding}\nStatus: ${result.status}`);
                } catch (error) {
                  console.error('Test failed:', error);
                  alert('Test failed - check console');
                }
              }}
              disabled={!videoUrl.trim()}
            >
              Test Transcode
            </Button>
            <Button 
              variant="outline" 
              onClick={async () => {
                if (!videoUrl.trim()) return;
                try {
                  const response = await fetch(`/api/test-google-drive?url=${encodeURIComponent(videoUrl)}`);
                  const result = await response.json();
                  console.log('Google Drive test result:', result);
                  
                  if (result.success) {
                    const streaming = result.tests.streaming;
                    alert(`Google Drive Test Results:\n` +
                          `✅ Connection: Working\n` +
                          `📊 Speed: ${streaming.speedKBps} KB/s\n` +
                          `📦 Data Read: ${streaming.bytesRead} bytes in ${streaming.chunks} chunks\n` +
                          `⏱️ Time: ${streaming.timeMs}ms\n` +
                          `🎯 Recommendations:\n${result.recommendations.join('\n')}`);
                  } else {
                    alert(`Google Drive Test Failed:\n${result.error}\n\nCheck console for details.`);
                  }
                } catch (error) {
                  console.error('Google Drive test failed:', error);
                  alert('Google Drive test failed - check console');
                }
              }}
              disabled={!videoUrl.trim()}
            >
              Test Google Drive
            </Button>
            <Button 
              variant="outline" 
              onClick={() => setShowDiagnostic(true)}
              disabled={!videoUrl.trim()}
            >
              Run Diagnostic
            </Button>
          </div>
          
          {/* Sample URLs */}
          <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
            <p className="font-medium mb-2">Sample URLs for testing:</p>
            <div className="space-y-1">
              <button
                className="block text-blue-600 dark:text-blue-400 hover:underline"
                onClick={() => setVideoUrl('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4')}
              >
                Test MP4 (Should work directly)
              </button>
              <button
                className="block text-blue-600 dark:text-blue-400 hover:underline"
                onClick={() => setVideoUrl('https://file-examples.com/storage/fe75c8ad7f6c71bade9aa36/2017/10/file_example_JPG_100kB.mkv')}
              >
                Sample MKV File (Will be transcoded)
              </button>
              <button
                className="block text-blue-600 dark:text-blue-400 hover:underline"
                onClick={() => setVideoUrl('https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mkv')}
              >
                Sample MKV 1 (720p - Transcoded to MP4)
              </button>
              <button
                className="block text-blue-600 dark:text-blue-400 hover:underline"
                onClick={() => setVideoUrl('https://example.com/download/video?file=movie&format=mkv')}
              >
                Hidden MKV (no .mkv extension - Auto-detected)
              </button>
              <button
                className="block text-blue-600 dark:text-blue-400 hover:underline text-left"
                onClick={() => setVideoUrl('https://video-downloads.googleusercontent.com/ADGPM2kg5rXITDu5TyfdndmRZOSdMVmFfOCn7-iJjRanKELc920mLYRAh_w_q_nW5mhExTH9M1tN5C2J2eIW7Me75btc-72T7ZSFowjvRtcHOsJtiAgs2R4MkcbWti18TjJYIg3fT9peI6cP1kjJngiHBGA3cvDrePOAsxSl8YRQrkU0Uoh82mIvuE-TvEyFvdMbY4zyY6GVbPQDVaR4xZVey0z82u8SbrBlxSm_UknYulE6HpEKH5FSC-4RV865cnn2uWvCWmY4-swhboAnZCva8qC3DJUr-a8G0Wljpd-pvmwmdLAtBojHapu-Rdmp0mge7KJlYYMdVrIx3nk0pm5r6vQGNV574a9hAxNxPM9t50ZpG5_dQx1_wMHf4HUubLwE3nEldFpxVjOtv2hK91koz28LnwBhfZpPkA0Npi-KhVtbiHrW_tNYZGXFRD7ItdkWaIRdgdngCnbScK7vEFwJ7ABjz4AZ61Dv1P1tCl0dw5wWPIKZvijRRyPEhgAbdV_nDwMlz5nCMu3nBCw0UI_1z_OlRwtJfbXEPhN8ipPImRhzyP4vD757OAl5kZlluKqy1nrYIgPrRxrWy_8IZ_E66WoT6h5bSNhyNOlwnLLv0XWMqN-RMFzqxtfs9vHqmXz2A7HOoOSEmw0Yd_WLmE9d_ykee_uCxdgUfODTvyXk76LI5wbdjNJZvkQDUNrH7w3cIwcHTmuIgC1n8WtpVqgLwAXe66QaAA2je6onijzK5TfaMB-1ICN8Q_aGCYvmAcpBuUXPeg2Nlhzh5dgAD9RyvMJfr42-6JRugeSTJA-N-JarHPixV_-7QZTT3Y9Bday815WPDAVvpKUxr3F7vCxz3U1OKSOb0BRJZney_tSSWbLUTMeIvnak230gECik68mK5lhPR0qshk92awlQrY2m-vx2-zn0Vob2_mIfQIp65Aay9B4H_kLfCSW6ubzeqX1V04oSDW_F9yL2_Nr7QycnmclO7VrjFMtfue7S_R7od6YXlntUMnKYEpi0NGC_ITvcDjUZQ8v-h9TTMx1G8AasUdRaLX9DUWdrtAVmoHbdAeY1aDa1ono')}
              >
                🔗 Google Drive MKV (Authenticated URL - Transcoded)
              </button>
            </div>
            
            {/* Transcoding Info */}
            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
              <p className="text-blue-800 dark:text-blue-200 text-xs">
                <strong>🔄 How it works:</strong> MKV files are automatically transcoded to MP4 with AAC audio on-the-fly. 
                The stream starts immediately and transcoding happens in real-time as you watch.
              </p>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {errors.length > 0 && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
            <h3 className="font-medium text-red-800 dark:text-red-200 mb-2">Errors:</h3>
            <ul className="text-sm text-red-700 dark:text-red-300 space-y-1">
              {errors.map((error, index) => (
                <li key={index}>• {error}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Video Player */}
        {isPlaying && videoUrl && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            {/* Debug Info */}
            <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded border text-sm">
              <div className="font-medium text-gray-700 dark:text-gray-300 mb-2">Streaming Info:</div>
              <div className="text-gray-600 dark:text-gray-400 space-y-1">
                <div><strong>Original URL:</strong> <code className="text-xs bg-gray-200 dark:bg-gray-600 px-1 rounded">{videoUrl}</code></div>
                <div><strong>Streaming Endpoint:</strong> <code className="text-xs bg-gray-200 dark:bg-gray-600 px-1 rounded">/api/stream-mkv?url={encodeURIComponent(videoUrl)}</code></div>
                <div><strong>Process:</strong> MKV → FFmpeg Transcoding → MP4 Stream → Browser (disguised as .mp4 file)</div>
              </div>
            </div>
            
            <MkvVideoPlayer
              videoUrl={videoUrl}
              onError={handlePlayerError}
              onSuccess={handlePlayerSuccess}
            />
          </div>
        )}

        {/* Features List */}
        <div className="mt-8 bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">Live Transcoding Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 className="font-medium text-green-600 dark:text-green-400 mb-2">✓ Real-time Transcoding</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                MKV files are converted to MP4 with AAC audio on-the-fly using FFmpeg
              </p>
            </div>
            <div>
              <h3 className="font-medium text-blue-600 dark:text-blue-400 mb-2">✓ Live Seeking Support</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Seek to any position with time-based seeking during transcoding
              </p>
            </div>
            <div>
              <h3 className="font-medium text-purple-600 dark:text-purple-400 mb-2">✓ Subtitle Extraction</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Multi-language subtitles extracted and converted to WebVTT format
              </p>
            </div>
            <div>
              <h3 className="font-medium text-orange-600 dark:text-orange-400 mb-2">✓ Native HTML5 Player</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Direct MP4 streaming with native browser controls and better compatibility
              </p>
            </div>
            <div>
              <h3 className="font-medium text-indigo-600 dark:text-indigo-400 mb-2">✓ Google Drive Support</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Handles authenticated URLs and direct download links seamlessly
              </p>
            </div>
            <div>
              <h3 className="font-medium text-pink-600 dark:text-pink-400 mb-2">✓ Smart Error Handling</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Fallback metadata detection and robust error recovery
              </p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Google Drive Diagnostic Modal */}
      {showDiagnostic && (
        <GoogleDriveDiagnostic 
          videoUrl={videoUrl}
          onClose={() => setShowDiagnostic(false)}
        />
      )}
    </div>
  );
}
