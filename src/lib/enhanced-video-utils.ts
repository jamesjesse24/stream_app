/**
 * Enhanced Video Utilities for Google Drive and streaming video support
 * Based on best practices from React Player and Next Video
 */

export interface VideoMetadata {
  contentLength?: number;
  contentType: string;
  supportsRanges: boolean;
  isStreamable: boolean;
  estimatedDuration?: number;
  isMkvFile?: boolean;
  requiresConversion?: boolean;
}

export interface StreamingOptions {
  maxInitialChunkSize?: number;
  earlyPlaybackThreshold?: number;
  progressiveThreshold?: number;
  enableProgressiveLoading?: boolean;
}

export interface VideoFormatInfo {
  extension: string;
  mimeType: string;
  isSupported: boolean;
  requiresConversion: boolean;
  conversionTarget?: string;
  description: string;
}

/**
 * Comprehensive video format support matrix
 */
export const VIDEO_FORMATS: Record<string, VideoFormatInfo> = {
  'mp4': {
    extension: 'mp4',
    mimeType: 'video/mp4',
    isSupported: true,
    requiresConversion: false,
    description: 'MP4 - Widely supported'
  },
  'webm': {
    extension: 'webm',
    mimeType: 'video/webm',
    isSupported: true,
    requiresConversion: false,
    description: 'WebM - Modern web format'
  },
  'ogg': {
    extension: 'ogg',
    mimeType: 'video/ogg',
    isSupported: true,
    requiresConversion: false,
    description: 'OGG - Open source format'
  },
  'mkv': {
    extension: 'mkv',
    mimeType: 'video/x-matroska',
    isSupported: false,
    requiresConversion: true,
    conversionTarget: 'mp4',
    description: 'MKV - Matroska container (requires conversion)'
  },
  'avi': {
    extension: 'avi',
    mimeType: 'video/x-msvideo',
    isSupported: false,
    requiresConversion: true,
    conversionTarget: 'mp4',
    description: 'AVI - Legacy format (requires conversion)'
  },
  'mov': {
    extension: 'mov',
    mimeType: 'video/quicktime',
    isSupported: false,
    requiresConversion: true,
    conversionTarget: 'mp4',
    description: 'MOV - QuickTime format (may require conversion)'
  },
  'wmv': {
    extension: 'wmv',
    mimeType: 'video/x-ms-wmv',
    isSupported: false,
    requiresConversion: true,
    conversionTarget: 'mp4',
    description: 'WMV - Windows Media format (requires conversion)'
  },
  'flv': {
    extension: 'flv',
    mimeType: 'video/x-flv',
    isSupported: false,
    requiresConversion: true,
    conversionTarget: 'mp4',
    description: 'FLV - Flash video (requires conversion)'
  }
};

/**
 * Advanced Google Drive URL optimization with multiple fallback strategies
 */
export function optimizeGoogleDriveUrlRobust(url: string): string {
  console.log('Optimizing Google Drive URL:', url);
  
  let fileId = '';
  
  // Extract file ID from various Google Drive URL patterns
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,           // Standard sharing URL
    /[?&]id=([a-zA-Z0-9_-]+)/,               // Open URL format
    /\/d\/([a-zA-Z0-9_-]+)/,                 // Short format
    /docs\.google\.com\/file\/d\/([^\/]+)/,   // Docs format
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      fileId = match[1];
      break;
    }
  }
  
  // If already a direct download URL, return as-is
  if (url.includes('googleusercontent.com') || url.includes('export=download')) {
    return url;
  }
  
  if (fileId) {
    // Create multiple optimized URL options
    const baseUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    
    // Add confirmation parameter for large files
    const optimizedUrl = `${baseUrl}&confirm=t`;
    
    console.log('Optimized Google Drive URL:', optimizedUrl);
    return optimizedUrl;
  }
  
  console.log('Could not extract file ID, using original URL');
  return url;
}

/**
 * Probe video metadata from URL
 */
export async function probeVideoMetadata(
  url: string,
  signal?: AbortSignal
): Promise<VideoMetadata> {
  const metadata: VideoMetadata = {
    contentType: 'video/mp4',
    supportsRanges: false,
    isStreamable: false,
  };
  
  try {
    // Try HEAD request first
    const headResponse = await fetch(url, {
      method: 'HEAD',
      mode: 'cors',
      credentials: 'omit',
      signal,
    });
    
    if (headResponse.ok) {
      const contentLength = headResponse.headers.get('content-length');
      const contentType = headResponse.headers.get('content-type');
      const acceptRanges = headResponse.headers.get('accept-ranges');
      
      metadata.contentLength = contentLength ? parseInt(contentLength) : undefined;
      metadata.contentType = contentType || 'video/mp4';
      metadata.supportsRanges = acceptRanges === 'bytes';
      metadata.isStreamable = metadata.supportsRanges && (metadata.contentLength || 0) > 0;
      
      return metadata;
    }
  } catch (headError) {
    console.log('HEAD request failed, trying range probe');
  }
  
  try {
    // Fallback: small range request to test capabilities
    const probeResponse = await fetch(url, {
      method: 'GET',
      headers: { 'Range': 'bytes=0-1023' },
      mode: 'cors',
      credentials: 'omit',
      signal,
    });
    
    if (probeResponse.status === 206) {
      metadata.supportsRanges = true;
      metadata.isStreamable = true;
      
      const contentRange = probeResponse.headers.get('content-range');
      if (contentRange) {
        const totalSize = contentRange.split('/')[1];
        metadata.contentLength = totalSize ? parseInt(totalSize) : undefined;
      }
      
      const contentType = probeResponse.headers.get('content-type');
      metadata.contentType = contentType || 'video/mp4';
      
      // Cancel the probe response body
      const reader = probeResponse.body?.getReader();
      if (reader) {
        await reader.cancel();
      }
    }
  } catch (probeError) {
    console.log('Range probe failed');
  }
  
  return metadata;
}

/**
 * Check if URL is a supported video format
 */
export function isVideoUrl(url: string): boolean {
  const videoExtensions = /\.(mp4|webm|ogg|avi|mov|wmv|flv|mkv|m4v|3gp)(\?.*)?$/i;
  const streamingFormats = /\.(m3u8|mpd)(\?.*)?$/i;
  
  return videoExtensions.test(url) || streamingFormats.test(url);
}

/**
 * Detect video provider from URL
 */
export function detectVideoProvider(url: string): string {
  const lowerUrl = url.toLowerCase();
  
  if (lowerUrl.includes('googleusercontent.com') || lowerUrl.includes('drive.google.com')) {
    return 'google-drive';
  }
  if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) {
    return 'youtube';
  }
  if (lowerUrl.includes('vimeo.com')) {
    return 'vimeo';
  }
  if (lowerUrl.includes('dropbox.com')) {
    return 'dropbox';
  }
  if (lowerUrl.includes('onedrive')) {
    return 'onedrive';
  }
  if (isVideoUrl(url)) {
    return 'direct';
  }
  
  return 'unknown';
}

/**
 * Get optimal streaming configuration based on file size and connection
 */
export function getStreamingConfig(metadata: VideoMetadata): StreamingOptions {
  const fileSize = metadata.contentLength || 0;
  const fileSizeMB = fileSize / (1024 * 1024);
  
  // Conservative settings for mobile/slow connections
  if (typeof navigator !== 'undefined' && 
      'connection' in navigator && 
      navigator.connection && 
      typeof navigator.connection === 'object' &&
      'effectiveType' in navigator.connection && 
      ['slow-2g', '2g', '3g'].includes((navigator.connection as any).effectiveType)) {
    return {
      maxInitialChunkSize: 1 * 1024 * 1024,  // 1MB
      earlyPlaybackThreshold: 512 * 1024,     // 512KB
      progressiveThreshold: 5 * 1024 * 1024,  // 5MB
      enableProgressiveLoading: true,
    };
  }
  
  // Standard settings for good connections
  if (fileSizeMB < 10) {
    return {
      maxInitialChunkSize: 2 * 1024 * 1024,   // 2MB
      earlyPlaybackThreshold: 1 * 1024 * 1024, // 1MB
      progressiveThreshold: 10 * 1024 * 1024,  // 10MB
      enableProgressiveLoading: false,
    };
  }
  
  // Large file settings
  return {
    maxInitialChunkSize: 5 * 1024 * 1024,    // 5MB
    earlyPlaybackThreshold: 2 * 1024 * 1024, // 2MB
    progressiveThreshold: 20 * 1024 * 1024,  // 20MB
    enableProgressiveLoading: true,
  };
}

/**
 * Create optimized video source URLs for different scenarios
 */
export function createVideoSources(originalUrl: string): Array<{src: string, type: string}> {
  const provider = detectVideoProvider(originalUrl);
  const sources = [];
  
  // Primary source
  if (provider === 'google-drive') {
    const optimizedUrl = optimizeGoogleDriveUrlRobust(originalUrl);
    sources.push({ src: optimizedUrl, type: 'video/mp4' });
    
    // Fallback to original URL
    if (optimizedUrl !== originalUrl) {
      sources.push({ src: originalUrl, type: 'video/mp4' });
    }
  } else {
    sources.push({ src: originalUrl, type: 'video/mp4' });
  }
  
  // Add additional format sources for direct video URLs
  if (provider === 'direct') {
    const baseUrl = originalUrl.split('.').slice(0, -1).join('.');
    sources.push(
      { src: `${baseUrl}.webm`, type: 'video/webm' },
      { src: `${baseUrl}.ogg`, type: 'video/ogg' }
    );
  }
  
  return sources;
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Estimate video duration from file size (rough approximation)
 */
export function estimateVideoDuration(fileSize: number): number {
  // Very rough estimate: assume ~1MB per minute for standard quality
  const estimatedMinutes = fileSize / (1024 * 1024);
  return Math.max(estimatedMinutes * 60, 60); // At least 1 minute
}

/**
 * Detect video format from URL or content type
 */
export function detectVideoFormat(url: string, contentType?: string): VideoFormatInfo | null {
  // Check content type first
  if (contentType) {
    for (const format of Object.values(VIDEO_FORMATS)) {
      if (contentType.includes(format.mimeType)) {
        return format;
      }
    }
  }
  
  // Check URL extension
  const urlLower = url.toLowerCase();
  for (const format of Object.values(VIDEO_FORMATS)) {
    if (urlLower.includes(`.${format.extension}`)) {
      return format;
    }
  }
  
  return null;
}

/**
 * Check if video format is natively supported in browsers
 */
export function isNativelySupported(format: VideoFormatInfo): boolean {
  return format.isSupported && !format.requiresConversion;
}

/**
 * Check if video format requires conversion
 */
export function requiresConversion(format: VideoFormatInfo): boolean {
  return format.requiresConversion;
}

/**
 * Get conversion target format
 */
export function getConversionTarget(format: VideoFormatInfo): string {
  return format.conversionTarget || 'mp4';
}

/**
 * Enhanced MKV detection with detailed analysis
 */
export function detectMkvFile(url: string, contentType?: string): boolean {
  const urlLower = url.toLowerCase();
  const mkvIndicators = [
    '.mkv',
    'matroska',
    'video/x-matroska',
    'video/x-matroska; codecs',
    'application/x-matroska',
    'video/mkv',
    '.webm', // WebM is also Matroska-based
    'video/webm'
  ];
  
  // Check URL
  const urlHasMkv = mkvIndicators.some(indicator => urlLower.includes(indicator));
  
  // Check content type
  const contentTypeHasMkv = contentType ? 
    mkvIndicators.some(indicator => contentType.toLowerCase().includes(indicator)) : 
    false;
  
  // Check for common file hosting patterns that might serve MKV
  const suspiciousPatterns = [
    'download',
    'file',
    'media',
    'video',
    'stream',
    'watch'
  ];
  
  const hasSuspiciousPattern = suspiciousPatterns.some(pattern => 
    urlLower.includes(pattern) && !urlLower.includes('.mp4') && !urlLower.includes('.mov')
  );
  
  return urlHasMkv || contentTypeHasMkv || hasSuspiciousPattern;
}

/**
 * Detect MKV file signature from binary data
 */
export function detectMkvFromBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  
  // Check for EBML signature (Matroska/WebM): 1A 45 DF A3
  const signature = Array.from(bytes.slice(0, 4))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  if (signature === '1a45dfa3') return true;
  
  // Check for alternative Matroska signatures
  const altSignatures = [
    '1a45dfa2', // Alternative EBML
    '42f7810f', // Segment header
    '18538067'  // SeekHead
  ];
  
  return altSignatures.some(sig => {
    for (let i = 0; i <= bytes.length - 4; i++) {
      const currentSig = Array.from(bytes.slice(i, i + 4))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      if (currentSig === sig) return true;
    }
    return false;
  });
}

/**
 * Advanced file type detection with multiple methods
 */
export async function detectAdvancedFileType(url: string): Promise<{
  isMkv: boolean;
  confidence: number;
  method: string;
  finalUrl: string;
  metadata?: any;
}> {
  try {
    // Method 1: URL-based detection
    if (detectMkvFile(url)) {
      return {
        isMkv: true,
        confidence: 0.8,
        method: 'url-pattern',
        finalUrl: url
      };
    }

    // Method 2: HEAD request for headers
    const headResponse = await fetch(url, { 
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'video/*,*/*;q=0.9'
      }
    });

    if (headResponse.ok) {
      const contentType = headResponse.headers.get('content-type') || '';
      const contentDisposition = headResponse.headers.get('content-disposition') || '';
      
      if (detectMkvFile(url, contentType) || contentDisposition.includes('.mkv')) {
        return {
          isMkv: true,
          confidence: 0.9,
          method: 'http-headers',
          finalUrl: url,
          metadata: {
            contentType,
            contentDisposition,
            contentLength: headResponse.headers.get('content-length')
          }
        };
      }
    }

    // Method 3: Partial content inspection
    const partialResponse = await fetch(url, {
      headers: {
        'Range': 'bytes=0-2047', // First 2KB
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'video/*,*/*;q=0.9'
      }
    });

    if (partialResponse.ok) {
      const buffer = await partialResponse.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);
      
      if (detectMkvFromBytes(uint8Array)) {
        return {
          isMkv: true,
          confidence: 0.95,
          method: 'binary-signature',
          finalUrl: url,
          metadata: {
            signatureFound: true,
            bytesChecked: uint8Array.length
          }
        };
      }
    }

    return {
      isMkv: false,
      confidence: 0.1,
      method: 'no-detection',
      finalUrl: url
    };

  } catch (error) {
    console.error('Advanced file type detection failed:', error);
    return {
      isMkv: detectMkvFile(url), // Fallback to basic detection
      confidence: 0.3,
      method: 'fallback-url-only',
      finalUrl: url
    };
  }
}

/**
 * Check browser compatibility for advanced video features
 */
export function checkBrowserVideoSupport(): {
  webassembly: boolean;
  mediaSource: boolean;
  webcodecs: boolean;
  canConvertMkv: boolean;
} {
  const support = {
    webassembly: typeof WebAssembly !== 'undefined',
    mediaSource: typeof MediaSource !== 'undefined',
    webcodecs: typeof VideoDecoder !== 'undefined',
    canConvertMkv: false
  };
  
  // MKV conversion requires WebAssembly
  support.canConvertMkv = support.webassembly;
  
  return support;
}

/**
 * Check if server-side MKV conversion is available
 */
export async function checkServerMkvSupport(): Promise<boolean> {
  try {
    const response = await fetch('/api/stream-mkv?url=test', { method: 'HEAD' });
    return response.status !== 404; // 404 means the endpoint doesn't exist
  } catch {
    return false;
  }
}

/**
 * Get optimal MKV playback strategy
 */
export function getMkvPlaybackStrategy(browserSupport: ReturnType<typeof checkBrowserVideoSupport>): 'server' | 'client' | 'download' {
  // Now we have server-side chunked streaming support!
  // This is the recommended approach from Stack Overflow
  return 'server';
  
  // Keep client-side as fallback if browser supports WebAssembly
  // if (browserSupport.canConvertMkv) {
  //   return 'client';
  // }
  
  // Final fallback to download
  // return 'download';
}

/**
 * Create streaming URL for MKV files
 */
export function createMkvStreamUrl(originalUrl: string, options: {
  quality?: 'high' | 'medium' | 'low';
  preset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium';
} = {}): string {
  const params = new URLSearchParams({
    url: originalUrl,
    quality: options.quality || 'medium',
    preset: options.preset || 'fast'
  });
  
  return `/api/stream-mkv?${params.toString()}`;
}
