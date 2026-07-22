import { spawn } from 'child_process';
import path from 'path';

interface CloudflareSession {
  cookies: string[];
  userAgent: string;
  timestamp: number;
}

class CloudflareBypass {
  private sessions: Map<string, CloudflareSession> = new Map();
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  /**
   * Open browser popup for user to solve Cloudflare challenge
   */
  async openBrowserForChallenge(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';
      const isMac = process.platform === 'darwin';
      
      let command: string;
      let args: string[];

      if (isWindows) {
        command = 'cmd';
        args = ['/c', 'start', '', url];
      } else if (isMac) {
        command = 'open';
        args = [url];
      } else {
        command = 'xdg-open';
        args = [url];
      }

      const browserProcess = spawn(command, args, {
        detached: true,
        stdio: 'ignore'
      });

      browserProcess.unref();

      console.log(`\n🌐 Browser opened for Cloudflare challenge: ${url}`);
      console.log('📋 Instructions:');
      console.log('   1. Complete the "I\'m not a robot" challenge');
      console.log('   2. Wait for the page to load normally');
      console.log('   3. Copy the URL from your browser');
      console.log('   4. Return to the API and the session will be used automatically');
      
      // Return a session token that can be used to check status
      const sessionToken = this.generateSessionToken(url);
      resolve(sessionToken);
    });
  }

  /**
   * Prompt user to manually provide session cookies after solving challenge
   */
  async promptForSession(url: string): Promise<CloudflareSession | null> {
    const sessionToken = await this.openBrowserForChallenge(url);
    
    // In a real implementation, you'd have a way to receive the cookies
    // For now, we'll simulate waiting and return a mock session
    console.log(`\n⏳ Waiting for user to complete Cloudflare challenge...`);
    console.log(`📝 Session token: ${sessionToken}`);
    
    // Create a temporary endpoint where user can submit cookies
    await this.createTempCookieEndpoint(sessionToken);
    
    return new Promise((resolve) => {
      // Poll for session completion
      const pollInterval = setInterval(() => {
        const session = this.sessions.get(sessionToken);
        if (session) {
          clearInterval(pollInterval);
          resolve(session);
        }
      }, 2000);

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        console.log('⏰ Session timeout - user did not complete challenge');
        resolve(null);
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Create temporary endpoint for receiving cookies
   */
  private async createTempCookieEndpoint(sessionToken: string): Promise<void> {
    console.log(`\n🔗 Manual cookie submission:`)
    console.log(`   After solving the challenge, you can manually set cookies by calling:`);
    console.log(`   POST /api/supjav/set-session`);
    console.log(`   Body: { "sessionToken": "${sessionToken}", "cookies": ["cookie1=value1", "cookie2=value2"] }`);
  }

  /**
   * Generate unique session token
   */
  private generateSessionToken(url: string): string {
    const timestamp = Date.now();
    const urlHash = Buffer.from(url).toString('base64').slice(0, 10);
    return `cf_session_${urlHash}_${timestamp}`;
  }

  /**
   * Store session cookies manually
   */
  setSession(sessionToken: string, cookies: string[], userAgent?: string): void {
    this.sessions.set(sessionToken, {
      cookies,
      userAgent: userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      timestamp: Date.now()
    });
    
    console.log(`✅ Session stored for token: ${sessionToken}`);
  }

  /**
   * Get session for making authenticated requests
   */
  getSession(sessionToken: string): CloudflareSession | null {
    const session = this.sessions.get(sessionToken);
    
    if (!session) {
      return null;
    }

    // Check if session expired
    if (Date.now() - session.timestamp > this.SESSION_TIMEOUT) {
      this.sessions.delete(sessionToken);
      console.log(`🕐 Session expired for token: ${sessionToken}`);
      return null;
    }

    return session;
  }

  /**
   * Make request with Cloudflare session
   */
  async makeAuthenticatedRequest(url: string, sessionToken?: string): Promise<any> {
    const session = sessionToken ? this.getSession(sessionToken) : null;
    
    // Use Firefox headers from the curl request
    const headers: any = {
      'User-Agent': session?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'DNT': '1',
      'Sec-GPC': '1',
      'Priority': 'u=0, i'
    };

    if (session?.cookies) {
      headers['Cookie'] = session.cookies.join('; ');
    }

    try {
      const axios = (await import('axios')).default;
      const response = await axios.get(url, {
        headers,
        timeout: 15000,
        validateStatus: (status: number) => status < 500,
        maxRedirects: 5
      });

      // Check if still blocked by Cloudflare - improved detection
      const content = response.data.toString();
      
      // More precise detection of Cloudflare challenges
      const isCloudflareChallenge = (
        content.includes('Just a moment') ||
        content.includes('Checking your browser') ||
        content.includes('Please enable JavaScript and cookies') ||
        content.includes('DDoS protection by Cloudflare') ||
        content.includes('cf-challenge') ||
        content.includes('window._cf_chl_opt') ||
        content.includes('cf-spinner-please-wait') ||
        (content.includes('<title>Just a moment...</title>') && response.status === 403)
      );
      
      // Check for actual SupJAV content
      const hasSupJavContent = (
        content.includes('div.posts') || 
        content.includes('div.post') ||
        content.includes('class="post"') ||
        content.includes('supjav.com') && content.includes('post-meta')
      );
      
      const isBlocked = response.status === 403 || isCloudflareChallenge || !hasSupJavContent;
      
      console.log(`🔍 Debug - URL: ${url}, Status: ${response.status}`);
      console.log(`🔍 Content length: ${content.length}, CF Challenge: ${isCloudflareChallenge}, Has SupJAV: ${hasSupJavContent}, Blocked: ${isBlocked}`);
      
      if (isBlocked) {
        console.log(`🚫 Cloudflare protection detected for: ${url}`);
        console.log(`Content preview: ${content.substring(0, 200)}...`);
        
        if (!sessionToken) {
          const newSessionToken = await this.promptForSession(url);
          if (newSessionToken) {
            return this.makeAuthenticatedRequest(url, newSessionToken.toString());
          }
        }
        
        return {
          error: 'Cloudflare protection active',
          needsChallenge: true,
          challengeUrl: url,
          sessionToken: sessionToken || this.generateSessionToken(url)
        };
      }

      return {
        data: response.data,
        status: response.status,
        headers: response.headers
      };

    } catch (error: any) {
      console.error(`Request failed for ${url}:`, error.message);
      return {
        error: 'Request failed',
        message: error.message,
        needsChallenge: true,
        challengeUrl: url
      };
    }
  }

  /**
   * Clear expired sessions
   */
  cleanupSessions(): void {
    const now = Date.now();
    this.sessions.forEach((session, token) => {
      if (now - session.timestamp > this.SESSION_TIMEOUT) {
        this.sessions.delete(token);
      }
    });
  }
}

export default CloudflareBypass;
export type { CloudflareSession };
