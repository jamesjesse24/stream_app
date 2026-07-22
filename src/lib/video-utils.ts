/**
 * Video utilities for handling various video sources including Google Drive
 */

export interface VideoLinkInfo {
  url: string;
  type: 'direct' | 'google-drive' | 'download' | 'streaming' | 'unknown';
  optimized?: string;
  recommendations?: string[];
}

/**
 * Analyzes a video URL and provides optimization recommendations
 */
export function analyzeVideoUrl(url: string): VideoLinkInfo {
  const lowerUrl = url.toLowerCase();
  const info: VideoLinkInfo = {
    url,
    type: 'unknown',
    recommendations: []
  };

  // Google Drive detection and optimization
  if (lowerUrl.includes('googleusercontent.com') || 
      lowerUrl.includes('drive.google.com') ||
      lowerUrl.includes('docs.google.com/file')) {
    info.type = 'google-drive';
    info.optimized = optimizeGoogleDriveUrl(url);
    info.recommendations = [
      'Ensure the Google Drive file has sharing permissions set to "Anyone with the link can view"',
      'Large video files (>100MB) may take time to buffer - consider compressing the video',
      'For best results, use MP4 format with H.264 encoding',
      'Avoid using MKV, AVI, or other container formats not supported by browsers'
    ];
  }
  // Direct streaming URLs
  else if (lowerUrl.includes('.mp4') || lowerUrl.includes('.webm') || 
           lowerUrl.includes('.ogg') || lowerUrl.includes('m3u8') || 
           lowerUrl.includes('mpd')) {
    info.type = 'streaming';
    info.recommendations = [
      'This appears to be a direct streaming URL',
      'Ensure CORS headers are properly configured on the server',
      'For HLS (.m3u8) or DASH (.mpd) streams, modern browsers should handle them natively'
    ];
  }
  // Other download links
  else if (lowerUrl.includes('dropbox.com') || lowerUrl.includes('onedrive') ||
           lowerUrl.includes('download') || lowerUrl.includes('dl.') ||
           lowerUrl.includes('files.')) {
    info.type = 'download';
    info.recommendations = [
      'This appears to be a download link',
      'The video will be downloaded before playback begins',
      'Large files may take significant time to download',
      'Consider using a direct streaming URL if available'
    ];
  }
  // Direct video file URLs
  else if (lowerUrl.includes('.mkv') || lowerUrl.includes('.avi') || 
           lowerUrl.includes('.wmv')) {
    info.type = 'direct';
    info.recommendations = [
      'This video format may not be supported in browsers',
      'Consider converting to MP4 with H.264 encoding for better compatibility',
      'Use VLC or similar media player for best playback experience'
    ];
  }

  return info;
}

/**
 * Optimizes Google Drive URLs for better video streaming
 */
export function optimizeGoogleDriveUrl(url: string): string {
  try {
    let fileId = '';
    
    if (url.includes('/file/d/')) {
      const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      fileId = match ? match[1] : '';
    } else if (url.includes('id=')) {
      const match = url.match(/id=([a-zA-Z0-9_-]+)/);
      fileId = match ? match[1] : '';
    } else if (url.includes('googleusercontent.com')) {
      return url; // Already optimized
    }
    
    if (fileId) {
      return `https://drive.google.com/uc?export=download&id=${fileId}`;
    }
    
    return url;
  } catch (error) {
    console.error('Error optimizing Google Drive URL:', error);
    return url;
  }
}

/**
 * Checks if a URL is likely to be a video file
 */
export function isVideoUrl(url: string): boolean {
  const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.wmv', '.flv'];
  const streamingFormats = ['m3u8', 'mpd'];
  
  const lowerUrl = url.toLowerCase();
  
  return videoExtensions.some(ext => lowerUrl.includes(ext)) ||
         streamingFormats.some(format => lowerUrl.includes(format)) ||
         lowerUrl.includes('googleusercontent.com') ||
         lowerUrl.includes('drive.google.com');
}

/**
 * Gets recommended video settings for optimal playback
 */
export function getVideoRecommendations(): string[] {
  return [
    '🎥 **Format**: Use MP4 with H.264 video codec and AAC audio codec',
    '📐 **Resolution**: 1080p or lower for web streaming (higher resolutions increase file size)',
    '🗜️ **Compression**: Balance quality and file size - aim for 2-8 Mbps bitrate',
    '🔗 **Google Drive**: Set sharing to "Anyone with the link can view"',
    '🌐 **CORS**: Ensure your server allows cross-origin requests for direct URLs',
    '📱 **Mobile**: Consider providing multiple quality options for different devices',
    '⚡ **Performance**: Files under 100MB will load faster than larger files'
  ];
}
