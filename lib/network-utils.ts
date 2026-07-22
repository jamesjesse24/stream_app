// lib/network-utils.ts
export interface NetworkTestResult {
  isOnline: boolean;
  latency: number | null;
  error?: string;
}

export async function testNetworkConnectivity(): Promise<NetworkTestResult> {
  try {
    const start = Date.now();
    
    // Test with a small, fast endpoint
    const response = await fetch('/api/stream', {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });
    
    const latency = Date.now() - start;
    
    return {
      isOnline: response.ok,
      latency,
      error: response.ok ? undefined : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      isOnline: false,
      latency: null,
      error: error instanceof Error ? error.message : 'Unknown network error'
    };
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  
  const networkErrorNames = ['NetworkError', 'TypeError', 'AbortError'];
  const networkErrorMessages = ['fetch', 'network', 'connection', 'timeout'];
  
  return networkErrorNames.includes(error.name) || 
         networkErrorMessages.some(msg => error.message.toLowerCase().includes(msg));
}

export function getErrorCategory(error: unknown): 'network' | 'format' | 'server' | 'unknown' {
  if (!(error instanceof Error)) return 'unknown';
  
  if (isNetworkError(error)) return 'network';
  
  const formatErrors = ['decode', 'format', 'codec', 'unsupported'];
  if (formatErrors.some(msg => error.message.toLowerCase().includes(msg))) {
    return 'format';
  }
  
  const serverErrors = ['500', '502', '503', '504'];
  if (serverErrors.some(code => error.message.includes(code))) {
    return 'server';
  }
  
  return 'unknown';
}
