import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import * as cheerio from 'cheerio';
import CloudflareBypass from '../../../lib/cloudflare-bypass';

const SUPJAV_BASE_URL = 'https://supjav.com';
const PROTECTOR_URL = 'https://lk1.supremejav.com/supjav.php';

const cfBypass = new CloudflareBypass();

class SimpleSupJav {
  private baseUrl = SUPJAV_BASE_URL;
  private lang: string;
  private sessionToken?: string;

  constructor(lang: string = 'en', sessionToken?: string) {
    this.lang = lang;
    this.sessionToken = sessionToken;
  }

  private get langPath(): string {
    return this.lang === 'en' ? '' : `/${this.lang}`;
  }

  async getPopular(page: number = 1) {
    try {
      const url = `${this.baseUrl}${this.langPath}/popular/page/${page}`;
      const response = await cfBypass.makeAuthenticatedRequest(url, this.sessionToken);

      // Check if Cloudflare challenge is needed - improved detection
      if (response.needsChallenge && !response.data) {
        return {
          animeList: [],
          hasNextPage: false,
          error: 'Cloudflare protection detected',
          needsChallenge: true,
          challengeUrl: response.challengeUrl,
          sessionToken: response.sessionToken,
          instructions: [
            '1. Open the challenge URL in your browser',
            '2. Complete the "I\'m not a robot" challenge', 
            '3. Copy all cookies from developer tools',
            '4. POST to /api/supjav/set-session with sessionToken and cookies',
            '5. Retry the API request'
          ]
        };
      }

      if (response.error && !response.data) {
        return { animeList: [], hasNextPage: false, error: response.error };
      }
      
      const $ = cheerio.load(response.data);
      const animeList: any[] = [];
      
      // Try multiple selector patterns to find posts  
      const selectors = [
        'div.posts > div.post > a',
        '.post-item > a',
        'article > a', 
        '.post > a',
        'div.post > a'
      ];
      
      let found = false;
      for (const selector of selectors) {
        $(selector).each((_, element) => {
          const $element = $(element);
          const url = $element.attr('href') || '';
          const $img = $element.find('img').first();
          
          if (url && $img.length > 0) {
            animeList.push({
              title: $img.attr('alt') || $img.attr('title') || '',
              thumbnail_url: $img.attr('data-original') || $img.attr('data-src') || $img.attr('src') || '',
              url: url.startsWith('http') ? url : `${this.baseUrl}${url}`,
              status: 'COMPLETED'
            });
            found = true;
          }
        });
        
        if (found) {
          console.log(`✅ Found ${animeList.length} posts using selector: ${selector}`);
          break;
        }
      }
      
      if (!found) {
        console.log('⚠️ No posts found with any selector. Page structure may have changed.');
        console.log(`Content preview: ${response.data.substring(0, 500)}...`);
      }

      const hasNextPage = $('div.pagination li.active:not(:nth-last-child(2))').length > 0;
      
      return { animeList, hasNextPage };
    } catch (error) {
      console.error('Error fetching popular:', error);
      return { animeList: [], hasNextPage: false };
    }
  }

  async search(query: string, page: number = 1) {
    try {
      if (query.startsWith('id:')) {
        const id = query.replace('id:', '');
        const details = await this.getDetails(`${this.baseUrl}/${id}`);
        return { animeList: [details], hasNextPage: false };
      }

      const url = `${this.baseUrl}${this.langPath}/?s=${encodeURIComponent(query)}`;
      const response = await cfBypass.makeAuthenticatedRequest(url, this.sessionToken);

      // Check if Cloudflare challenge is needed
      if (response.needsChallenge) {
        return {
          animeList: [],
          hasNextPage: false,
          error: 'Cloudflare protection detected',
          needsChallenge: true,
          challengeUrl: response.challengeUrl,
          sessionToken: response.sessionToken,
          instructions: [
            '1. Open the challenge URL in your browser',
            '2. Complete the "I\'m not a robot" challenge', 
            '3. Copy all cookies from developer tools',
            '4. POST to /api/supjav/set-session with sessionToken and cookies',
            '5. Retry the API request'
          ]
        };
      }

      if (response.error) {
        return { animeList: [], hasNextPage: false, error: response.error };
      }
      
      const $ = cheerio.load(response.data);
      const animeList: any[] = [];
      
      $('div.posts > div.post > a').each((_, element) => {
        const $element = $(element);
        const url = $element.attr('href') || '';
        const $img = $element.find('img').first();
        
        animeList.push({
          title: $img.attr('alt') || '',
          thumbnail_url: $img.attr('data-original') || $img.attr('src') || '',
          url: url.startsWith('http') ? url : `${this.baseUrl}${url}`,
          status: 'COMPLETED'
        });
      });

      const hasNextPage = $('div.pagination li.active:not(:nth-last-child(2))').length > 0;
      
      return { animeList, hasNextPage };
    } catch (error) {
      console.error('Error searching:', error);
      return { animeList: [], hasNextPage: false };
    }
  }

  async getDetails(url: string) {
    try {
      const response = await cfBypass.makeAuthenticatedRequest(url, this.sessionToken);
      
      if (response.needsChallenge) {
        return {
          error: 'Cloudflare protection detected',
          needsChallenge: true,
          challengeUrl: response.challengeUrl,
          sessionToken: response.sessionToken
        };
      }

      if (response.error) {
        throw new Error(response.error);
      }
      
      const $ = cheerio.load(response.data);
      
      // Try multiple selectors for content
      const contentSelectors = [
        'div.content > div.post-meta',
        'div.content',
        'article.post',
        '.single-post',
        '.post-content'
      ];
      
      let content = null;
      for (const selector of contentSelectors) {
        content = $(selector).first();
        if (content.length > 0) break;
      }
      
      if (!content || content.length === 0) {
        console.log('⚠️ No content found with any selector');
        content = $('body'); // Fallback to body
      }
      
      const title = content.find('h1, h2, .post-title, .entry-title').first().text().trim() || 
                   $('title').text().replace(' - SupJAV', '').trim() || '';
      
      const thumbnail_url = content.find('img').first().attr('src') || 
                           content.find('img').first().attr('data-src') || '';
      
      const author = content.find('p:contains("Maker :")').find('a').map((_, el) => $(el).text()).get().join(', ') || 
                    content.find('*:contains("Studio:")').next().text().trim() || undefined;
      
      const artist = content.find('p:contains("Cast :")').find('a').map((_, el) => $(el).text()).get().join(', ') || 
                    content.find('*:contains("Actresses:")').next().text().trim() || undefined;
      
      const genre = content.find('div.tags > a, .post-tags a, .entry-tags a').map((_, el) => $(el).text().trim()).get();

      return {
        title,
        thumbnail_url,
        author,
        artist,
        genre,
        status: 'COMPLETED',
        url
      };
    } catch (error) {
      console.error('Error fetching details:', error);
      throw error;
    }
  }

  async getEpisodes(animeUrl: string) {
    try {
      const response = await cfBypass.makeAuthenticatedRequest(animeUrl, this.sessionToken);
      
      if (response.needsChallenge) {
        return {
          episodes: [],
          error: 'Cloudflare protection detected',
          needsChallenge: true,
          challengeUrl: response.challengeUrl,
          sessionToken: response.sessionToken
        };
      }

      if (response.error) {
        return { episodes: [], error: response.error };
      }
      
      const $ = cheerio.load(response.data);
      const episodes: any[] = [];
      
      // Look for streaming links/episodes in the page
      const linkSelectors = [
        'div.btnst > a',
        '.download-links a', 
        '.streaming-links a',
        '.episode-links a',
        'a[href*="stream"]',
        'a[data-link]'
      ];
      
      let foundLinks = false;
      for (const selector of linkSelectors) {
        $(selector).each((index, element) => {
          const $element = $(element);
          const linkText = $element.text().trim();
          const href = $element.attr('href');
          const dataLink = $element.attr('data-link');
          
          if (linkText && (href || dataLink)) {
            episodes.push({
              name: linkText || `Episode ${index + 1}`,
              episode_number: index + 1,
              url: animeUrl,
              streamingUrl: href || dataLink,
              quality: this.extractQuality(linkText)
            });
            foundLinks = true;
          }
        });
        
        if (foundLinks) {
          console.log(`✅ Found ${episodes.length} streaming links using selector: ${selector}`);
          break;
        }
      }
      
      // If no streaming links found, create a single episode for the main page
      if (episodes.length === 0) {
        episodes.push({
          name: "Full Video",
          episode_number: 1,
          url: animeUrl,
          quality: "HD"
        });
      }
      
      return { episodes };
    } catch (error) {
      console.error('Error getting episodes:', error);
      return { episodes: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private extractQuality(text: string): string {
    const qualityMatch = text.match(/(1080p|720p|480p|360p|4K|HD|SD)/i);
    return qualityMatch ? qualityMatch[1].toUpperCase() : 'HD';
  }

  async getVideos(episodeUrl: string) {
    try {
      const response = await cfBypass.makeAuthenticatedRequest(episodeUrl, this.sessionToken);
      
      if (response.needsChallenge) {
        return {
          videos: [],
          error: 'Cloudflare protection detected',
          needsChallenge: true,
          challengeUrl: response.challengeUrl,
          sessionToken: response.sessionToken
        };
      }

      if (response.error) {
        return { videos: [], error: response.error };
      }
      
      const $ = cheerio.load(response.data);
      const videos: any[] = [];
      
      // Look for video/streaming links
      const videoSelectors = [
        'div.btnst > a',
        '.download-links a',
        '.streaming-links a', 
        'iframe[src*="stream"]',
        'video source',
        'a[href*=".mp4"]',
        'a[href*=".m3u8"]',
        'a[data-link]'
      ];
      
      for (const selector of videoSelectors) {
        $(selector).each((_, element) => {
          const $element = $(element);
          const linkText = $element.text().trim();
          const href = $element.attr('href') || $element.attr('src');
          const dataLink = $element.attr('data-link');
          
          if (href || dataLink) {
            let videoUrl = href || dataLink || '';
            
            // Handle SupJAV's protection system
            if (dataLink && !href) {
              videoUrl = `${PROTECTOR_URL}?c=${dataLink.split('').reverse().join('')}`;
            }
            
            videos.push({
              quality: this.extractQuality(linkText) || 'HD',
              videoUrl: videoUrl,
              headers: { 'Referer': episodeUrl },
              player: linkText || 'Direct Link'
            });
          }
        });
      }
      
      // If no videos found, try to extract any direct streaming URLs from scripts
      if (videos.length === 0) {
        const scriptContent = response.data;
        const urlMatches = scriptContent.match(/(https?:\/\/[^"'\s]+\.(mp4|m3u8|mkv|avi))/gi);
        
        if (urlMatches) {
          urlMatches.forEach((url: string, index: number) => {
            videos.push({
              quality: 'HD',
              videoUrl: url,
              headers: { 'Referer': episodeUrl },
              player: `Direct Link ${index + 1}`
            });
          });
        }
      }
      
      return { videos };
    } catch (error) {
      console.error('Error getting videos:', error);
      return { videos: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const lang = searchParams.get('lang') || 'en';
  const page = parseInt(searchParams.get('page') || '1');
  const query = searchParams.get('query') || '';
  const sessionToken = searchParams.get('sessionToken');

  const supjav = new SimpleSupJav(lang, sessionToken || undefined);

  try {
    switch (action) {
      case 'popular':
        const popularResult = await supjav.getPopular(page);
        return NextResponse.json({
          source: 'supjav',
          language: lang,
          ...popularResult,
          currentPage: page,
          totalPages: page + (popularResult.hasNextPage ? 10 : 0)
        });

      case 'search':
        const searchResult = await supjav.search(query, page);
        return NextResponse.json({
          source: 'supjav',
          language: lang,
          ...searchResult,
          currentPage: page,
          totalPages: page + (searchResult.hasNextPage ? 10 : 0)
        });

      case 'details':
        const url = searchParams.get('url');
        if (!url) {
          return NextResponse.json({ error: 'URL required' }, { status: 400 });
        }
        const details = await supjav.getDetails(url);
        return NextResponse.json({
          source: 'supjav',
          language: lang,
          ...details
        });

      case 'episodes':
        const animeUrl = searchParams.get('url');
        if (!animeUrl) {
          return NextResponse.json({ error: 'URL required' }, { status: 400 });
        }
        const episodesResult = await supjav.getEpisodes(animeUrl);
        return NextResponse.json({
          source: 'supjav',
          language: lang,
          ...episodesResult
        });

      case 'videos':
        const episodeUrl = searchParams.get('url');
        if (!episodeUrl) {
          return NextResponse.json({ error: 'Episode URL required' }, { status: 400 });
        }
        const videosResult = await supjav.getVideos(episodeUrl);
        return NextResponse.json({
          source: 'supjav',
          language: lang,
          ...videosResult
        });

      case 'info':
        return NextResponse.json({
          name: 'SupJAV',
          baseUrl: 'https://supjav.com',
          supportedLanguages: ['en', 'ja', 'zh'],
          supportedQualities: ['1080p', '720p', '480p', '360p'],
          currentLanguage: lang
        });

      default:
        return NextResponse.json({ 
          error: 'Invalid action. Supported actions: popular, search, details, episodes, videos, info' 
        }, { status: 400 });
    }
  } catch (error) {
    console.error('SupJAV API Error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error',
      details: error instanceof Error ? error.stack : 'Unknown error'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405 }
  );
}
