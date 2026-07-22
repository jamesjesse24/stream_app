"use client";
import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Play, Pause, Info, Download } from "lucide-react";

interface StreamDebuggerProps {
  testUrl?: string;
}

export function StreamDebugger({ 
  testUrl = "https://video-downloads.googleusercontent.com/ADGPM2kRSnFUai4S7rm0uS1oJHJrZVVCjzwEH98hUwaTHOfmO-IXzNMSYIMo0VSomSN8nz9NXL-GmU4exbRgZ6Pc37AIaMWOt_4KPzRgADm6rVVtpBSiuNsSKBcxLhSpPDnoOOzZJzXwrw6ageBYWtE4uODwaZNUYHG6u57HWbrDV1p2zFNhDUjAitZLmuKDDct9R16OH7GrV1wYpzhkgbw7xmgLCfV6bmyGqCoSE3uvX47A7wmkEefyqDEnpIWHM7_8n471HCTzcb_I0gb9CPnp2eKOKM7ZAOjXbvi4_lD3mymGY5koXUgLSaPyU-kLRtrEVj4i2xONxeywFmKk1VhwGoHgTsGWi85SbBr1ATFlwc2H7jp67YQ40ISwX73SMJn2RaIK0cnoPEgaggiyELOSuKWFKLgNMkVZFTZKrcj0WXzLSypq-m5PFcRWlyVomoXwKb6BRhc01kKk6JDV9-6siu1v1OgM07VYsw01EQEU_jEOQoblDcAk2rLxzS-U-V3D4lvXp2T9pv6xbwtpjOBlwmeU12ORJ9v74jr8HPg9drhi5atQKLT0KcnHYz49LnvGGx1PvXMk2NF4SWoTMW2QG_rfelN1bE6N4NZNsjnHSglFxc1sdRyWnez1ekl-P-CtHnHQz8dzWPSxzWZpneK8tqiGz_rfQm5dJoEsXyQpE1rKdgWScOGYH2c8YNRQwZnBKoMKU3812gBRmH2943bcb5hTK1fKhFDSYN8y_HANj2ywmKUaFyJpCtES3IyM9LnOQNSB8ufG723iUP71MWbsNwfTEd8PkSNELpAutuTYgguIR5h9YF53VyiexdPcj3xLhCwn9jfWEvxWvC8eZOF4IpdoIChcWR_mtnK86O6s0Ct7QZXDamTT9QS3HKMtI64DTQHJbCToxsd3ZA1p3_ObtSxbpu7rrzCif1GTbOW5Pds6DfMlxUA1Pm57lBrUV-XFKz00ZT1R_WkWBjng7cS9-bihDsvfwojf2a4yqTN0k6EW4w_5dNG5HEEPq3mcfn6ObQFZkfuS_NYVHhOVrqzWncQVkrDlp7K7bCjFB9VRb4HoFUUSqoo"
}: StreamDebuggerProps) {
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [videoError, setVideoError] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [networkLogs, setNetworkLogs] = useState<string[]>([]);
  const [videoMetadata, setVideoMetadata] = useState<any>(null);
  const [bufferProgress, setBufferProgress] = useState(0);
  const [loadingState, setLoadingState] = useState<string>("idle");
  const [useAlternativePlayer, setUseAlternativePlayer] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const streamUrl = `/api/stream?url=${encodeURIComponent(testUrl)}`;
  
  // Add network request logging
  const logNetwork = (message: string) => {
    setNetworkLogs(prev => [...prev.slice(-20), `${new Date().toLocaleTimeString()}: ${message}`]);
  };

  // Test direct URL access
  const testDirectUrl = async () => {
    setLoading(true);
    logNetwork("Testing direct URL access...");
    
    try {
      const response = await fetch(testUrl, { method: 'HEAD' });
      logNetwork(`Direct URL HEAD response: ${response.status} ${response.statusText}`);
      
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      
      setDebugInfo((prev: any) => ({
        ...prev,
        directUrl: {
          status: response.status,
          statusText: response.statusText,
          headers
        }
      }));
    } catch (error) {
      logNetwork(`Direct URL error: ${error}`);
      setDebugInfo((prev: any) => ({
        ...prev,
        directUrl: { error: error instanceof Error ? error.message : 'Unknown error' }
      }));
    }
    setLoading(false);
  };

  // Test stream API
  const testStreamApi = async () => {
    setLoading(true);
    logNetwork("Testing stream API...");
    
    try {
      const response = await fetch(streamUrl, { method: 'HEAD' });
      logNetwork(`Stream API HEAD response: ${response.status} ${response.statusText}`);
      
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      
      setDebugInfo((prev: any) => ({
        ...prev,
        streamApi: {
          status: response.status,
          statusText: response.statusText,
          headers
        }
      }));
    } catch (error) {
      logNetwork(`Stream API error: ${error}`);
      setDebugInfo((prev: any) => ({
        ...prev,
        streamApi: { error: error instanceof Error ? error.message : 'Unknown error' }
      }));
    }
    setLoading(false);
  };

  // Test range request
  const testRangeRequest = async () => {
    setLoading(true);
    logNetwork("Testing range request...");
    
    try {
      const response = await fetch(streamUrl, {
        headers: { 'Range': 'bytes=0-1023' }
      });
      logNetwork(`Range request response: ${response.status} ${response.statusText}`);
      
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      
      setDebugInfo((prev: any) => ({
        ...prev,
        rangeRequest: {
          status: response.status,
          statusText: response.statusText,
          headers,
          contentLength: headers['content-length'],
          contentRange: headers['content-range']
        }
      }));
    } catch (error) {
      logNetwork(`Range request error: ${error}`);
      setDebugInfo((prev: any) => ({
        ...prev,
        rangeRequest: { error: error instanceof Error ? error.message : 'Unknown error' }
      }));
    }
    setLoading(false);
  };

  // Test MP4 metadata analysis
  const testMP4Analysis = async () => {
    setLoading(true);
    logNetwork("Analyzing MP4 metadata...");
    
    try {
      const response = await fetch(`/api/stream-info?url=${encodeURIComponent(testUrl)}`);
      const result = await response.json();
      
      logNetwork(`MP4 Analysis: ${result.info.isValidMP4 ? 'Valid MP4' : 'Invalid/Unknown format'}`);
      
      if (result.info.moovFound) {
        logNetwork(`MP4 moov atom found at offset ${result.info.moovOffset}, size: ${result.info.moovSize} bytes`);
      }
      
      if (result.recommendations) {
        result.recommendations.forEach((rec: string) => {
          logNetwork(`Recommendation: ${rec}`);
        });
      }
      
      setDebugInfo((prev: any) => ({
        ...prev,
        mp4Analysis: result
      }));
      
    } catch (error) {
      logNetwork(`MP4 Analysis failed: ${error}`);
      setDebugInfo((prev: any) => ({
        ...prev,
        mp4Analysis: { error: error instanceof Error ? error.message : 'Unknown error' }
      }));
    }
    
    setLoading(false);
  };

  // Run all tests
  const runAllTests = async () => {
    setDebugInfo({});
    setNetworkLogs([]);
    await testDirectUrl();
    await testStreamApi();
    await testRangeRequest();
    await testMP4Analysis();
  };

  // Video event handlers
  const handleVideoLoad = () => {
    logNetwork("Video loaded successfully");
    setLoadingState("loaded");
    if (videoRef.current) {
      const video = videoRef.current;
      setVideoMetadata({
        duration: video.duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
        networkState: video.networkState
      });
    }
  };

  const handleVideoError = (e: any) => {
    const error = e.target.error;
    const errorMessage = `Video error: Code ${error?.code}, Message: ${error?.message || 'Unknown error'}`;
    logNetwork(errorMessage);
    setVideoError(errorMessage);
    setLoadingState("error");
  };

  const handleVideoProgress = () => {
    if (videoRef.current) {
      const buffered = videoRef.current.buffered;
      if (buffered.length > 0) {
        const bufferedEnd = buffered.end(buffered.length - 1);
        const duration = videoRef.current.duration || 1;
        const bufferPercent = (bufferedEnd / duration) * 100;
        setBufferProgress(bufferPercent);
        logNetwork(`Buffered: ${bufferedEnd.toFixed(2)}s (${bufferPercent.toFixed(1)}%)`);
      }
    }
  };

  const handleLoadStart = () => {
    logNetwork("Video load started");
    setLoadingState("loading");
    setVideoError("");
  };

  const handleCanPlay = () => {
    logNetwork("Video can start playing");
    setLoadingState("canplay");
  };

  const handleCanPlayThrough = () => {
    logNetwork("Video can play through without buffering");
    setLoadingState("canplaythrough");
  };

  const handleWaiting = () => {
    logNetwork("Video is waiting for more data");
    setLoadingState("waiting");
  };

  const handlePlaying = () => {
    logNetwork("Video started playing");
    setLoadingState("playing");
  };

  // Force video to try loading with different strategies
  const forceVideoLoad = () => {
    if (videoRef.current) {
      const video = videoRef.current;
      logNetwork("Forcing video load...");
      
      // Stop any current loading
      video.pause();
      video.currentTime = 0;
      
      // Clear and reload
      video.src = '';
      video.load();
      
      // Set new source
      setTimeout(() => {
        video.src = streamUrl;
        video.load();
      }, 100);
      
      // Try to start loading with a small range request
      setTimeout(() => {
        if (video.readyState < 3) {
          logNetwork("Video still not ready, attempting to play...");
          video.play().catch(e => logNetwork(`Play failed: ${e.message}`));
        }
      }, 2000);
    }
  };

  // Test simple blob download (for comparison)
  const testBlobDownload = async () => {
    setLoading(true);
    logNetwork("Testing small blob download...");
    
    try {
      const response = await fetch(streamUrl, {
        headers: { 'Range': 'bytes=0-1048576' } // First 1MB only
      });
      
      if (response.ok) {
        const blob = await response.blob();
        logNetwork(`Downloaded ${blob.size} bytes successfully`);
        
        // Create blob URL and try to play
        const blobUrl = URL.createObjectURL(blob);
        if (videoRef.current) {
          videoRef.current.src = blobUrl;
        }
        
        setDebugInfo((prev: any) => ({
          ...prev,
          blobTest: {
            success: true,
            size: blob.size,
            type: blob.type
          }
        }));
      } else {
        logNetwork(`Blob download failed: ${response.status}`);
      }
    } catch (error) {
      logNetwork(`Blob download error: ${error}`);
      setDebugInfo((prev: any) => ({
        ...prev,
        blobTest: { error: error instanceof Error ? error.message : 'Unknown error' }
      }));
    }
    setLoading(false);
  };

  // Test direct video without proxy
  const testDirectVideo = () => {
    if (videoRef.current) {
      logNetwork("Testing direct video URL (bypass proxy)...");
      videoRef.current.src = testUrl;
      videoRef.current.load();
    }
  };

  // Test small chunk stream
  const testSmallChunk = async () => {
    setLoading(true);
    logNetwork("Testing small chunk stream...");
    
    try {
      const testStreamUrl = `/api/test-stream?url=${encodeURIComponent(testUrl)}`;
      
      // First test if we can fetch the chunk
      const response = await fetch(testStreamUrl);
      if (response.ok) {
        const blob = await response.blob();
        logNetwork(`Small chunk downloaded: ${blob.size} bytes`);
        
        // Now try to play it
        if (videoRef.current) {
          const blobUrl = URL.createObjectURL(blob);
          videoRef.current.src = blobUrl;
          videoRef.current.load();
        }
        
        setDebugInfo((prev: any) => ({
          ...prev,
          smallChunkTest: {
            success: true,
            size: blob.size,
            type: blob.type,
            status: response.status
          }
        }));
      } else {
        logNetwork(`Small chunk test failed: ${response.status}`);
        setDebugInfo((prev: any) => ({
          ...prev,
          smallChunkTest: { error: `HTTP ${response.status}` }
        }));
      }
    } catch (error) {
      logNetwork(`Small chunk error: ${error}`);
      setDebugInfo((prev: any) => ({
        ...prev,
        smallChunkTest: { error: error instanceof Error ? error.message : 'Unknown error' }
      }));
    }
    setLoading(false);
  };

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="w-5 h-5" />
            Video Stream Debugger
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Controls */}
          <div className="flex gap-2 flex-wrap">
            <Button onClick={runAllTests} disabled={loading}>
              Run All Tests
            </Button>
            <Button onClick={testDirectUrl} disabled={loading} variant="outline">
              Test Direct URL
            </Button>
            <Button onClick={testStreamApi} disabled={loading} variant="outline">
              Test Stream API
            </Button>
            <Button onClick={testRangeRequest} disabled={loading} variant="outline">
              Test Range Request
            </Button>
            <Button onClick={testMP4Analysis} disabled={loading} variant="outline">
              Analyze MP4 Metadata
            </Button>
            <Button onClick={forceVideoLoad} variant="secondary">
              Force Video Load
            </Button>
            <Button onClick={testBlobDownload} disabled={loading} variant="secondary">
              Test Blob Download
            </Button>
            <Button onClick={testDirectVideo} variant="outline">
              Test Direct Video
            </Button>
            <Button onClick={() => setUseAlternativePlayer(!useAlternativePlayer)} variant="outline">
              {useAlternativePlayer ? 'Use Normal Player' : 'Use Alternative Player'}
            </Button>
            <Button onClick={testSmallChunk} disabled={loading} variant="secondary">
              Test Small Chunk
            </Button>
          </div>

          {/* URL Info */}
          <div className="space-y-2">
            <h3 className="font-semibold">Test URL:</h3>
            <div className="bg-gray-100 p-2 rounded text-sm break-all">
              {testUrl}
            </div>
            <div className="bg-blue-100 p-2 rounded text-sm break-all">
              Stream URL: {streamUrl}
            </div>
            
            {/* Status indicators */}
            {debugInfo && (
              <div className="flex gap-2 flex-wrap mt-2">
                {debugInfo.smallChunkTest?.success && (
                  <Badge variant="default" className="bg-green-500">
                    ✓ Small Chunk: {(debugInfo.smallChunkTest.size / 1024 / 1024).toFixed(1)}MB
                  </Badge>
                )}
                {debugInfo.blobTest?.success && (
                  <Badge variant="default" className="bg-green-500">
                    ✓ Blob Test: {(debugInfo.blobTest.size / 1024 / 1024).toFixed(1)}MB
                  </Badge>
                )}
                {debugInfo.rangeRequest?.status === 206 && (
                  <Badge variant="default" className="bg-green-500">
                    ✓ Range Support
                  </Badge>
                )}
                {debugInfo.mp4Analysis?.info?.isValidMP4 && (
                  <Badge variant="default" className="bg-green-500">
                    ✓ Valid MP4: moov at {debugInfo.mp4Analysis.info.moovOffset}
                  </Badge>
                )}
                {debugInfo.mp4Analysis?.info && !debugInfo.mp4Analysis.info.isValidMP4 && (
                  <Badge variant="destructive">
                    ✗ Invalid MP4
                  </Badge>
                )}
                {debugInfo.mp4Analysis?.info?.supportsRanges === false && (
                  <Badge variant="secondary">
                    No Range Support
                  </Badge>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Video Player */}
      <Card>
        <CardHeader>
          <CardTitle>Video Player Test</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
              {videoError ? (
                <div className="flex items-center justify-center h-full text-red-500">
                  <AlertCircle className="w-8 h-8 mr-2" />
                  {videoError}
                </div>
              ) : useAlternativePlayer ? (
                // Alternative player with different settings
                <div className="w-full h-full">
                  <iframe
                    src={`data:text/html,<video controls autoplay style="width:100%;height:100%"><source src="${streamUrl}" type="video/mp4"></video>`}
                    className="w-full h-full border-0"
                    title="Alternative Video Player"
                  />
                </div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    controls
                    preload="auto"
                    crossOrigin="anonymous"
                    className="w-full h-full"
                    onLoadStart={handleLoadStart}
                    onLoadedData={handleVideoLoad}
                    onError={handleVideoError}
                    onProgress={handleVideoProgress}
                    onCanPlay={handleCanPlay}
                    onCanPlayThrough={handleCanPlayThrough}
                    onWaiting={handleWaiting}
                    onPlaying={handlePlaying}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                  >
                    <source src={streamUrl} type="video/mp4" />
                    Your browser does not support this video format.
                  </video>
                  
                  {/* Loading overlay with detailed state */}
                  {loadingState !== "canplaythrough" && loadingState !== "playing" && !videoError && (
                    <div className="absolute inset-0 bg-black bg-opacity-75 flex flex-col items-center justify-center text-white">
                      <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-white mb-4"></div>
                      <div className="text-center">
                        <div className="text-lg mb-2">Loading Video...</div>
                        <div className="text-sm text-gray-300">State: {loadingState}</div>
                        {bufferProgress > 0 && (
                          <div className="text-sm text-gray-300">Buffered: {bufferProgress.toFixed(1)}%</div>
                        )}
                        <div className="text-xs text-gray-400 mt-2">
                          Large files may take time to buffer
                        </div>
                        <div className="text-xs text-gray-400">
                          Try "Test Blob Download" or "Alternative Player" if stuck
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            
            {videoMetadata && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                <Badge variant="outline">Duration: {videoMetadata.duration?.toFixed(2)}s</Badge>
                <Badge variant="outline">Size: {videoMetadata.videoWidth}x{videoMetadata.videoHeight}</Badge>
                <Badge variant="outline">Ready State: {videoMetadata.readyState}</Badge>
                <Badge variant="outline">Network State: {videoMetadata.networkState}</Badge>
                <Badge variant="outline">Loading: {loadingState}</Badge>
              </div>
            )}
            
            {/* Buffer progress bar */}
            {bufferProgress > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>Buffer Progress</span>
                  <span>{bufferProgress.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                    style={{ width: `${bufferProgress}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Network Logs */}
      <Card>
        <CardHeader>
          <CardTitle>Network Logs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-black text-green-400 p-4 rounded font-mono text-sm max-h-60 overflow-y-auto">
            {networkLogs.length === 0 ? (
              <div className="text-gray-500">No logs yet. Run tests to see network activity.</div>
            ) : (
              networkLogs.map((log, index) => (
                <div key={index}>{log}</div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Debug Results */}
      {debugInfo && (
        <Card>
          <CardHeader>
            <CardTitle>Debug Results</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto max-h-96">
              {JSON.stringify(debugInfo, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
