/**
 * Example usage of the enhanced VideoPlayerModal with Google Drive links
 * 
 * This example shows how to use the enhanced video player with various types
 * of Google Drive video links and other streaming video sources.
 */

import React, { useState } from 'react';
import { VideoPlayerModal } from '@/components/VideoPlayerModal';
import { Button } from '@/components/ui/button';

interface VideoLink {
  url: string;
  quality: string;
}

export default function GoogleDriveVideoExample() {
  const [selectedVideo, setSelectedVideo] = useState<VideoLink | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Example Google Drive video links (replace with your actual links)
  const exampleVideos: VideoLink[] = [
    {
      url: 'https://drive.google.com/file/d/1ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh/view?usp=sharing',
      quality: '1080p - Google Drive Share Link'
    },
    {
      url: 'https://video-downloads.googleusercontent.com/ADGPM2mnFpJDtCdE9xxxxx',
      quality: '720p - Direct Download Link'
    },
    {
      url: 'https://drive.google.com/uc?export=download&id=1ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh',
      quality: '480p - Direct Export Link'
    },
    {
      url: 'https://docs.google.com/file/d/1ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh/preview',
      quality: '720p - Docs Preview Link'
    }
  ];

  const handleVideoSelect = (video: VideoLink) => {
    setSelectedVideo(video);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedVideo(null);
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Enhanced Google Drive Video Player Examples</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {exampleVideos.map((video, index) => (
          <div key={index} className="border rounded-lg p-4">
            <h3 className="font-semibold mb-2">{video.quality}</h3>
            <p className="text-sm text-gray-600 mb-3 break-all">{video.url}</p>
            <Button 
              onClick={() => handleVideoSelect(video)}
              className="w-full"
            >
              Play Video
            </Button>
          </div>
        ))}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h2 className="font-semibold text-blue-800 mb-2">Features of Enhanced Video Player:</h2>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>✅ Progressive streaming for large Google Drive files</li>
          <li>✅ Automatic URL optimization for better compatibility</li>
          <li>✅ Early playback start while download continues</li>
          <li>✅ Robust error handling and retry mechanisms</li>
          <li>✅ Support for various Google Drive link formats</li>
          <li>✅ Fallback options when direct playback fails</li>
          <li>✅ Network-aware streaming configuration</li>
          <li>✅ Real-time download progress tracking</li>
        </ul>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h2 className="font-semibold text-yellow-800 mb-2">Google Drive Video Tips:</h2>
        <ul className="text-sm text-yellow-700 space-y-1">
          <li>• Ensure video sharing is set to "Anyone with the link can view"</li>
          <li>• For large files (&gt;25MB), the player will use progressive streaming</li>
          <li>• Direct download links (googleusercontent.com) work best</li>
          <li>• Some mobile networks may have restrictions on large file downloads</li>
          <li>• If playback fails, try the "Open in New Tab" option</li>
        </ul>
      </div>

      <VideoPlayerModal
        videoLink={selectedVideo}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
      />
    </div>
  );
}

/**
 * Integration with existing anime/video apps:
 * 
 * 1. Replace your existing VideoPlayerModal import:
 *    import { VideoPlayerModal } from '@/components/VideoPlayerModal';
 * 
 * 2. Use it the same way as before:
 *    <VideoPlayerModal
 *      videoLink={videoLink}
 *      isOpen={isOpen}
 *      onClose={onClose}
 *    />
 * 
 * 3. The enhanced player will automatically:
 *    - Detect Google Drive links
 *    - Optimize URLs for better streaming
 *    - Handle progressive download for large files
 *    - Provide better error messages and retry options
 * 
 * 4. For Google Drive links, make sure they're in one of these formats:
 *    - https://drive.google.com/file/d/FILE_ID/view
 *    - https://drive.google.com/uc?export=download&id=FILE_ID
 *    - https://video-downloads.googleusercontent.com/...
 *    - https://docs.google.com/file/d/FILE_ID/preview
 */
