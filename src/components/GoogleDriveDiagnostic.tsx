// src/components/GoogleDriveDiagnostic.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle, Clock, RefreshCw } from 'lucide-react';

interface GoogleDriveDiagnosticProps {
  videoUrl: string;
  onClose: () => void;
}

interface TestResult {
  success: boolean;
  error?: string;
  tests?: {
    head: {
      status: number;
      contentType: string | null;
      contentLength: string | null;
      acceptRanges: string | null;
    };
    range: {
      status: number;
      supportsRanges: boolean;
    };
    streaming: {
      bytesRead: number;
      chunks: number;
      timeMs: number;
      speedKBps: string;
      isGood: boolean;
    };
  };
  recommendations: string[];
}

export function GoogleDriveDiagnostic({ videoUrl, onClose }: GoogleDriveDiagnosticProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [step, setStep] = useState('idle');

  const runDiagnostic = async () => {
    setIsRunning(true);
    setResult(null);
    setStep('connecting');

    try {
      const response = await fetch(`/api/test-google-drive?url=${encodeURIComponent(videoUrl)}`);
      const data = await response.json();
      
      setResult(data);
      setStep('complete');
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        recommendations: ['Check network connection and try again']
      });
      setStep('error');
    } finally {
      setIsRunning(false);
    }
  };

  useEffect(() => {
    // Auto-run diagnostic when component mounts
    runDiagnostic();
  }, [videoUrl]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-blue-500" />
              Google Drive Diagnostic
            </h3>
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
          
          {/* URL Display */}
          <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded text-sm">
            <strong>URL:</strong> {videoUrl.substring(0, 80)}...
          </div>

          {/* Status */}
          <div className="mb-4">
            {step === 'connecting' && (
              <div className="flex items-center gap-2 text-blue-600">
                <Clock className="w-4 h-4 animate-spin" />
                <span>Testing connection...</span>
              </div>
            )}
            {step === 'complete' && result?.success && (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle className="w-4 h-4" />
                <span>Diagnostic complete</span>
              </div>
            )}
            {step === 'error' && (
              <div className="flex items-center gap-2 text-red-600">
                <AlertCircle className="w-4 h-4" />
                <span>Diagnostic failed</span>
              </div>
            )}
          </div>

          {/* Results */}
          {result && (
            <div className="space-y-4">
              {result.success && result.tests && (
                <div className="space-y-3">
                  {/* Connection Test */}
                  <div className="p-3 border rounded">
                    <h4 className="font-medium mb-2">Connection Test</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>Status: {result.tests.head.status}</div>
                      <div>Content-Type: {result.tests.head.contentType || 'N/A'}</div>
                      <div>Size: {result.tests.head.contentLength ? `${(parseInt(result.tests.head.contentLength) / 1024 / 1024).toFixed(1)}MB` : 'Unknown'}</div>
                      <div>Range Support: {result.tests.head.acceptRanges || 'N/A'}</div>
                    </div>
                  </div>

                  {/* Streaming Test */}
                  <div className="p-3 border rounded">
                    <h4 className="font-medium mb-2">Streaming Test</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>Speed: {result.tests.streaming.speedKBps} KB/s</div>
                      <div>Data Read: {result.tests.streaming.bytesRead} bytes</div>
                      <div>Time: {result.tests.streaming.timeMs}ms</div>
                      <div>Status: {result.tests.streaming.isGood ? '✅ Good' : '⚠️ Slow'}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Recommendations */}
              <div className="p-3 border rounded">
                <h4 className="font-medium mb-2">Recommendations</h4>
                <div className="space-y-1">
                  {result.recommendations.map((rec, index) => (
                    <div key={index} className="text-sm flex items-start gap-2">
                      <span className="text-xs mt-1">•</span>
                      <span>{rec}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Error Details */}
              {result.error && (
                <div className="p-3 border rounded bg-red-50 dark:bg-red-900/20">
                  <h4 className="font-medium mb-2 text-red-800 dark:text-red-200">Error Details</h4>
                  <p className="text-sm text-red-700 dark:text-red-300">{result.error}</p>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="mt-6 flex gap-2">
            <Button 
              onClick={runDiagnostic} 
              disabled={isRunning}
              className="flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isRunning ? 'animate-spin' : ''}`} />
              {isRunning ? 'Testing...' : 'Run Again'}
            </Button>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
