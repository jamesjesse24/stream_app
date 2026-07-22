"use client";
import React, { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Maximize, Minimize, Volume2, VolumeX, AlertCircle } from "lucide-react";
import { VideoLink } from "@/types";
import { MkvVideoPlayer } from "./MkvVideoPlayer";
import { detectMkvFile, detectAdvancedFileType } from "@/lib/enhanced-video-utils";

interface VideoPlayerModalProps {
  videoLink: VideoLink | null;
  isOpen: boolean;
  onClose: () => void;
  onBackToDetails?: () => void;
}

export function VideoPlayerModal({ videoLink, isOpen, onClose, onBackToDetails }: VideoPlayerModalProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [showDebug, setShowDebug] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Reset states when modal opens or videoLink changes
  React.useEffect(() => {
    if (isOpen && videoLink) {
      setError("");
      setIsLoading(true);
      setIsFullscreen(false);
      setDebugInfo(null);
      setShowDebug(false);
    }
  }, [isOpen, videoLink]);

  // Enhanced MKV detection with actual file inspection
  const [actualFileType, setActualFileType] = useState<'mkv' | 'other' | 'checking'>('checking');
  const [realVideoUrl, setRealVideoUrl] = useState<string>('');
  const [detectionInfo, setDetectionInfo] = useState<any>(null);

  // Always use the transcoding pipeline - no file type detection needed
  // This ensures consistent behavior and avoids client-side complexity
  React.useEffect(() => {
    if (videoLink?.url) {
      setActualFileType('mkv'); // Always treat as MKV to use transcoding pipeline
      setRealVideoUrl(videoLink.url);
      setDetectionInfo({ 
        isMkv: true, 
        confidence: 1.0, 
        method: 'forced-transcoding',
        finalUrl: videoLink.url 
      });
    }
  }, [videoLink?.url]);

  // Debug function
  const runDebugCheck = async () => {
    if (!videoLink) return;
    try {
      setShowDebug(true);
      
      // Test the actual stream endpoint
      const streamEndpoint = `/api/stream-mkv?url=${encodeURIComponent(videoLink.url)}`;
      const f = await fetch(streamEndpoint, { method: 'HEAD' });
      if (!f.ok) {
        setDebugInfo({ error: `Failed to fetch stream: ${f.status} ${f.statusText}` });
        return;
      }
      
      const debugData = {
        originalUrl: videoLink.url,
        streamEndpoint: streamEndpoint,
        actualPlayback: 'Transcoding pipeline via /api/stream-mkv',
        status: f.status,
        contentType: f.headers.get('content-type'),
        contentLength: f.headers.get('content-length'),
        xRemux: f.headers.get('x-remux'),
        xSource: f.headers.get('x-source'),
        headers: Object.fromEntries(f.headers.entries())
      };
      
      setDebugInfo(debugData);
    } catch (err) {
      setDebugInfo({ error: 'Failed to fetch debug info', details: err });
    }
  };

  if (!videoLink) return null;

  const streamUrl = `/api/stream/${encodeURIComponent(realVideoUrl || videoLink.url)}`;
  
  // Use actual detected file type
  const isMkvFile = actualFileType === 'mkv';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[80vh] bg-black">
        <DialogHeader><DialogTitle className="text-white">{videoLink.quality}</DialogTitle></DialogHeader>
        <div className="relative px-2 pb-4">
          <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
            {error ? (
              <div className="p-6 text-center text-white">
                <AlertCircle className="mx-auto mb-4 text-red-500 w-16 h-16" />
                <p className="mb-4">{error}</p>
                <Button size="sm" onClick={() => setError("")}>Retry</Button>
                <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(realVideoUrl || videoLink.url)}>
                  Copy URL
                </Button>
              </div>
            ) : actualFileType === 'checking' ? (
              <div className="flex items-center justify-center h-full text-white">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
                  <div>Setting up transcoding pipeline...</div>
                  <div className="text-sm text-gray-400 mt-2">This may take a moment for large files</div>
                </div>
              </div>
            ) : isMkvFile ? (
              <MkvVideoPlayer
                videoUrl={realVideoUrl || videoLink.url}
                onError={(err) => setError(err)}
                onSuccess={() => setIsLoading(false)}
              />
            ) : (
              <>
                <video
                  ref={videoRef}
                  controls
                  preload="metadata"
                  crossOrigin="anonymous"
                  className="w-full h-full"
                  onError={(e) => {
                    console.error('Video error:', e);
                    setError("Video failed to load. This might be due to network issues or an invalid video URL.");
                    setIsLoading(false);
                  }}
                  onLoadStart={() => {
                    setError("");
                    setIsLoading(true);
                  }}
                  onLoadedData={() => setIsLoading(false)}
                  onCanPlay={() => setIsLoading(false)}
                >
                  <source src={streamUrl} type="video/mp4" />
                  Your browser does not support this video format.
                </video>
                {isLoading && !error && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
                    <div className="text-white text-lg">Loading video...</div>
                  </div>
                )}
              </>
            )}
            
            {!error && !isMkvFile && (
              <div className="absolute top-2 right-2 flex space-x-2">
                <Button size="sm" variant="outline" onClick={() => {
                  if (videoRef.current) videoRef.current.muted = !isMuted;
                  setIsMuted(!isMuted);
                }}>
                  {isMuted ? <VolumeX /> : <Volume2 />}
                </Button>
                <Button size="sm" variant="outline" onClick={() => {
                  if (!document.fullscreenElement) videoRef.current?.requestFullscreen();
                  else document.exitFullscreen();
                  setIsFullscreen(!isFullscreen);
                }}>
                  {isFullscreen ? <Minimize /> : <Maximize />}
                </Button>
              </div>
            )}
          </div>
          
          <div className="mt-3 space-x-2">
            {onBackToDetails ? (
              <Button size="sm" variant="secondary" onClick={onBackToDetails}>Back to Episodes</Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
            )}
            <Button size="sm" onClick={() => navigator.clipboard.writeText(realVideoUrl || videoLink.url)}>Copy URL</Button>
            <Button size="sm" variant="outline" onClick={() => window.open(realVideoUrl || videoLink.url, "_blank")}>Open in New Tab</Button>
            <Button size="sm" variant="outline" onClick={runDebugCheck}>Debug Stream</Button>
            {showDebug && (
              <Button size="sm" variant="outline" onClick={() => setShowDebug(false)}>Hide Debug</Button>
            )}
          </div>
          
          {/* Debug Panel */}
          {showDebug && debugInfo && (
            <div className="mt-4 bg-gray-900 p-4 rounded-lg text-white text-sm overflow-auto max-h-96">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold">Debug Information</h3>
                <div className="flex gap-2 text-xs">
                  <div className="px-2 py-1 rounded bg-green-600">
                    Transcoding Pipeline
                  </div>
                  {detectionInfo && (
                    <div className="px-2 py-1 rounded bg-purple-600">
                      Detected: {detectionInfo.isMkv ? 'MKV' : 'Other'} ({Math.round(detectionInfo.confidence * 100)}%)
                    </div>
                  )}
                </div>
              </div>
              <pre className="whitespace-pre-wrap">{JSON.stringify(debugInfo, null, 2)}</pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
