'use client';

import React, { useState } from 'react';
import { VideoPlayerModal } from '@/components/VideoPlayerModal';
import { MkvVideoPlayer } from '@/components/MkvVideoPlayer';
import { Button } from '@/components/ui/button';
import { checkBrowserVideoSupport } from '@/lib/enhanced-video-utils';

/**
 * Example demonstrating enhanced MKV video support with subtitles and duration display
 */
export function MkvSupportExample() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [showDirectPlayer, setShowDirectPlayer] = useState(false);
  const [playerErrors, setPlayerErrors] = useState<string[]>([]);
  
  const browserSupport = checkBrowserVideoSupport();

  // Example MKV video links with subtitle information
  const exampleMkvVideos = [
    {
      title: 'Multi-Language MKV Sample',
      url: 'https://example.com/sample-multilang.mkv',
      quality: 'HD 1080p',
      duration: '01:07:54',
      description: 'High quality MKV with multiple subtitle tracks (English, Korean, Spanish, etc.)',
      features: ['H.264 Video', 'EAC3 Audio', '30+ Subtitle Tracks', 'Forced Subtitles']
    },
    {
      title: 'Anime MKV with SDH Subtitles', 
      url: 'https://example.com/anime-sample.mkv',
      quality: '4K UHD',
      duration: '00:24:12',
      description: 'Ultra high definition MKV with hearing impaired subtitles',
      features: ['HEVC Video', 'Multi-channel Audio', 'SDH Subtitles', 'Forced Subtitles']
    },
    {
      title: 'Google Drive MKV with Seeking',
      url: 'https://drive.google.com/file/d/1234567890abcdef/view',
      quality: 'HD 720p',
      duration: '02:15:30',
      description: 'MKV file with seeking support and chapter navigation',
      features: ['H.264 Video', 'AAC Audio', 'Chapter Markers', 'Seek Support']
    }
  ];

  const handlePlayVideo = (videoUrl: string) => {
    setSelectedVideo(videoUrl);
    setIsModalOpen(true);
    setPlayerErrors([]);
  };

  const handleDirectPlayer = (videoUrl: string) => {
    setSelectedVideo(videoUrl);
    setShowDirectPlayer(true);
    setPlayerErrors([]);
  };

  const handlePlayerError = (error: string) => {
    setPlayerErrors(prev => [...prev, error]);
  };

  const handlePlayerSuccess = () => {
    setPlayerErrors([]);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          Enhanced MKV Video Support
        </h1>
        <p className="text-gray-600 dark:text-gray-400 text-lg">
          MKV playback with subtitle support, duration display, and seeking
        </p>
      </div>

      {/* New Features Highlight */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-lg p-6 border border-blue-200 dark:border-blue-800">
        <h2 className="text-xl font-semibold mb-4 text-blue-900 dark:text-blue-100">
          🎬 New Features
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-3xl mb-2">📝</div>
            <p className="font-medium text-blue-800 dark:text-blue-200">Multi-Language Subtitles</p>
            <p className="text-xs text-blue-600 dark:text-blue-300">30+ subtitle tracks supported</p>
          </div>
          <div className="text-center">
            <div className="text-3xl mb-2">⏱️</div>
            <p className="font-medium text-blue-800 dark:text-blue-200">Duration Display</p>
            <p className="text-xs text-blue-600 dark:text-blue-300">Full movie length shown</p>
          </div>
          <div className="text-center">
            <div className="text-3xl mb-2">🎯</div>
            <p className="font-medium text-blue-800 dark:text-blue-200">Seeking Support</p>
            <p className="text-xs text-blue-600 dark:text-blue-300">Jump to any timestamp</p>
          </div>
          <div className="text-center">
            <div className="text-3xl mb-2">🔊</div>
            <p className="font-medium text-blue-800 dark:text-blue-200">SDH & Forced Subs</p>
            <p className="text-xs text-blue-600 dark:text-blue-300">Accessibility features</p>
          </div>
        </div>
      </div>

      {/* Browser Support Status */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4">Browser Compatibility</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className={`text-2xl mb-2 ${browserSupport.webassembly ? 'text-green-500' : 'text-red-500'}`}>
              {browserSupport.webassembly ? '✅' : '❌'}
            </div>
            <p className="text-sm font-medium">WebAssembly</p>
            <p className="text-xs text-gray-500">Required for conversion</p>
          </div>
          <div className="text-center">
            <div className={`text-2xl mb-2 ${browserSupport.mediaSource ? 'text-green-500' : 'text-red-500'}`}>
              {browserSupport.mediaSource ? '✅' : '❌'}
            </div>
            <p className="text-sm font-medium">MediaSource</p>
            <p className="text-xs text-gray-500">For streaming</p>
          </div>
          <div className="text-center">
            <div className={`text-2xl mb-2 ${browserSupport.webcodecs ? 'text-green-500' : 'text-orange-500'}`}>
              {browserSupport.webcodecs ? '✅' : '⚠️'}
            </div>
            <p className="text-sm font-medium">WebCodecs</p>
            <p className="text-xs text-gray-500">Optional enhancement</p>
          </div>
          <div className="text-center">
            <div className={`text-2xl mb-2 ${browserSupport.canConvertMkv ? 'text-green-500' : 'text-red-500'}`}>
              {browserSupport.canConvertMkv ? '✅' : '❌'}
            </div>
            <p className="text-sm font-medium">MKV Support</p>
            <p className="text-xs text-gray-500">Overall capability</p>
          </div>
        </div>
        
        {browserSupport.canConvertMkv ? (
          <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="text-green-800 dark:text-green-200 text-sm">
              ✓ Your browser supports MKV conversion! You can play MKV files directly in the browser.
            </p>
          </div>
        ) : (
          <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
            <p className="text-yellow-800 dark:text-yellow-200 text-sm">
              ⚠️ Your browser doesn't support MKV conversion. You can still download files for external playback.
            </p>
          </div>
        )}
      </div>

      {/* Example MKV Videos */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4">Example MKV Videos</h2>
        <div className="space-y-4">
          {exampleMkvVideos.map((video, index) => (
            <div key={index} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h3 className="font-medium text-gray-900 dark:text-gray-100">
                    {video.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {video.description}
                  </p>
                  <div className="flex items-center gap-4 mt-2 text-xs">
                    <span className="text-purple-600 dark:text-purple-400">
                      Quality: {video.quality}
                    </span>
                    <span className="text-blue-600 dark:text-blue-400">
                      Duration: {video.duration}
                    </span>
                    <span className="text-green-600 dark:text-green-400">
                      Format: MKV
                    </span>
                  </div>
                  
                  {/* Feature badges */}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {video.features.map((feature, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full"
                      >
                        {feature}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  <Button
                    size="sm"
                    onClick={() => handlePlayVideo(video.url)}
                    disabled={!browserSupport.canConvertMkv}
                  >
                    Play in Modal
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDirectPlayer(video.url)}
                    disabled={!browserSupport.canConvertMkv}
                  >
                    Direct Player
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
        
        {!browserSupport.canConvertMkv && (
          <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg">
            <p className="text-gray-700 dark:text-gray-300 text-sm">
              💡 To test MKV playback, try using a modern browser like Chrome, Firefox, Safari, or Edge.
            </p>
          </div>
        )}
      </div>

      {/* Features Overview */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4">MKV Support Features</h2>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-3">
              🎬 Format Detection
            </h3>
            <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
              <li>• Automatic MKV file detection from URLs</li>
              <li>• Content-Type header analysis</li>
              <li>• File extension and MIME type checking</li>
              <li>• Google Drive and cloud storage support</li>
            </ul>
          </div>
          
          <div>
            <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-3">
              ⚡ Real-time Conversion
            </h3>
            <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
              <li>• Browser-based FFmpeg conversion</li>
              <li>• Progress tracking and cancellation</li>
              <li>• Web-optimized output settings</li>
              <li>• Memory-efficient processing</li>
            </ul>
          </div>
          
          <div>
            <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-3">
              🔄 Fallback Options
            </h3>
            <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
              <li>• Download for external players</li>
              <li>• VLC Media Player recommendations</li>
              <li>• Browser compatibility warnings</li>
              <li>• Alternative viewing methods</li>
            </ul>
          </div>
          
          <div>
            <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-3">
              🎯 User Experience
            </h3>
            <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
              <li>• Seamless integration with video modal</li>
              <li>• Detailed progress and error feedback</li>
              <li>• Responsive design for all devices</li>
              <li>• Accessibility considerations</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Usage Instructions */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4">How to Use MKV Support</h2>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full w-6 h-6 flex items-center justify-center text-sm font-medium flex-shrink-0">
              1
            </div>
            <div>
              <h4 className="font-medium text-gray-900 dark:text-gray-100">
                Upload or Link MKV File
              </h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Provide a direct URL to an MKV file or use a supported cloud storage link (Google Drive, Dropbox, etc.)
              </p>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <div className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full w-6 h-6 flex items-center justify-center text-sm font-medium flex-shrink-0">
              2
            </div>
            <div>
              <h4 className="font-medium text-gray-900 dark:text-gray-100">
                Automatic Detection
              </h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                The system automatically detects MKV format and checks browser compatibility for conversion
              </p>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <div className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full w-6 h-6 flex items-center justify-center text-sm font-medium flex-shrink-0">
              3
            </div>
            <div>
              <h4 className="font-medium text-gray-900 dark:text-gray-100">
                Enhanced Playback Experience
              </h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Enjoy full duration display, subtitle selection from 30+ languages, seeking support, and SDH accessibility features
              </p>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <div className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full w-6 h-6 flex items-center justify-center text-sm font-medium flex-shrink-0">
              4
            </div>
            <div>
              <h4 className="font-medium text-gray-900 dark:text-gray-100">
                Subtitle & Audio Controls
              </h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Use the subtitle button to choose between available tracks, including forced subtitles and hearing-impaired versions
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Video Player Modal */}
      {selectedVideo && (
        <VideoPlayerModal
          videoLink={{
            url: selectedVideo,
            quality: 'HD'
          }}
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedVideo(null);
          }}
        />
      )}

      {/* Direct MKV Player */}
      {showDirectPlayer && selectedVideo && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-6xl w-full max-h-[95vh] overflow-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Enhanced MKV Player</h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowDirectPlayer(false);
                    setSelectedVideo(null);
                    setPlayerErrors([]);
                  }}
                >
                  Close
                </Button>
              </div>
              
              {/* Error Display */}
              {playerErrors.length > 0 && (
                <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <h4 className="font-medium text-red-800 dark:text-red-200 mb-2">Player Errors:</h4>
                  <ul className="text-sm text-red-700 dark:text-red-300 space-y-1">
                    {playerErrors.map((error, index) => (
                      <li key={index}>• {error}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              <MkvVideoPlayer 
                videoUrl={selectedVideo}
                onError={handlePlayerError}
                onSuccess={handlePlayerSuccess}
              />
              
              {/* Feature Info */}
              <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                <p>
                  🎬 This player supports subtitle selection, duration display, and seeking.
                  Use the subtitle button to toggle between available language tracks.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
