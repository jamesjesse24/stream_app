import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import config from './config';

interface Video {
  videoUrl: string;
  quality: string;
  headers?: Record<string, string>;
}

interface Episode {
  name: string;
  episode_number: number;
  url: string;
}

interface AnimeDetails {
  title: string;
  thumbnail_url?: string;
  author?: string;
  artist?: string;
  genre?: string[];
  status: string;
  url: string;
}

interface AnimePage {
  animeList: AnimeDetails[];
  hasNextPage: boolean;
}

export class SupJavWrapper {
  private name = "SupJAV";
  private baseUrl: string;
  private lang: string;
  private client: AxiosInstance;
  private protectorUrl: string;
  private supportedPlayers = new Set(["TV", "FST", "VOE", "ST"]);

  constructor(lang: string = "en") {
    this.lang = lang;
    this.baseUrl = config.sources.supjav.baseUrl;
    this.protectorUrl = config.sources.supjav.protectorUrl;
    
    this.client = axios.create({
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': `${this.baseUrl}/`,
        'Origin': this.baseUrl
      }
    });
  }

  private get langPath(): string {
    return this.lang === "en" ? "" : `/${this.lang}`;
  }

  private parseAnimeFromElement($: cheerio.CheerioAPI, element: any): AnimeDetails {
    const $element = $(element);
    const url = $element.attr('href') || '';
    const $img = $element.find('img').first();
    
    return {
      title: $img.attr('alt') || '',
      thumbnail_url: $img.attr('data-original') || $img.attr('src') || '',
      url: url.startsWith('http') ? url : `${this.baseUrl}${url}`,
      status: 'COMPLETED',
      genre: []
    };
  }

  async getPopularAnime(page: number = 1): Promise<AnimePage> {
    try {
      const url = `${this.baseUrl}${this.langPath}/popular/page/${page}`;
      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);
      
      const animeList: AnimeDetails[] = [];
      $('div.posts > div.post > a').each((_, element) => {
        animeList.push(this.parseAnimeFromElement($, element));
      });

      const hasNextPage = $('div.pagination li.active:not(:nth-last-child(2))').length > 0;

      return { animeList, hasNextPage };
    } catch (error) {
      console.error('Error fetching popular anime:', error);
      return { animeList: [], hasNextPage: false };
    }
  }

  async searchAnime(query: string, page: number = 1): Promise<AnimePage> {
    try {
      // Handle direct URL search
      if (query.startsWith('id:')) {
        const id = query.replace('id:', '');
        const details = await this.getAnimeDetails(`${this.baseUrl}/${id}`);
        return { animeList: [details], hasNextPage: false };
      }

      const url = `${this.baseUrl}${this.langPath}/?s=${encodeURIComponent(query)}`;
      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);
      
      const animeList: AnimeDetails[] = [];
      $('div.posts > div.post > a').each((_, element) => {
        animeList.push(this.parseAnimeFromElement($, element));
      });

      const hasNextPage = $('div.pagination li.active:not(:nth-last-child(2))').length > 0;

      return { animeList, hasNextPage };
    } catch (error) {
      console.error('Error searching anime:', error);
      return { animeList: [], hasNextPage: false };
    }
  }

  async getAnimeDetails(url: string): Promise<AnimeDetails> {
    try {
      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);
      
      const content = $('div.content > div.post-meta').first();
      const title = content.find('h2').text() || '';
      const thumbnail_url = content.find('img').attr('src') || '';
      
      // Extract additional metadata
      const author = content.find('p:contains("Maker :")').find('a').map((_, el) => $(el).text()).get().join(', ') || undefined;
      const artist = content.find('p:contains("Cast :")').find('a').map((_, el) => $(el).text()).get().join(', ') || undefined;
      const genre = content.find('div.tags > a').map((_, el) => $(el).text()).get();

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
      console.error('Error fetching anime details:', error);
      throw error;
    }
  }

  async getEpisodeList(animeUrl: string): Promise<Episode[]> {
    // SupJAV typically has single episodes (JAV videos)
    return [{
      name: "JAV",
      episode_number: 1,
      url: animeUrl
    }];
  }

  async getVideoList(episodeUrl: string): Promise<Video[]> {
    try {
      const response = await this.client.get(episodeUrl);
      const $ = cheerio.load(response.data);
      
      const players: Array<{name: string, id: string}> = [];
      
      $('div.btnst > a').each((_, element) => {
        const $element = $(element);
        const playerName = $element.text().trim();
        const dataLink = $element.attr('data-link');
        
        if (this.supportedPlayers.has(playerName) && dataLink) {
          players.push({
            name: playerName,
            id: this.reverseString(dataLink)
          });
        }
      });

      const videos: Video[] = [];
      
      for (const player of players) {
        try {
          const playerVideos = await this.extractVideosFromPlayer(player);
          videos.push(...playerVideos);
        } catch (error) {
          console.error(`Error extracting videos from ${player.name}:`, error);
        }
      }

      return this.sortVideosByQuality(videos);
    } catch (error) {
      console.error('Error getting video list:', error);
      return [];
    }
  }

  private async extractVideosFromPlayer(player: {name: string, id: string}): Promise<Video[]> {
    try {
      const protectorUrl = `${this.protectorUrl}?c=${player.id}`;
      const noRedirectClient = axios.create({
        maxRedirects: 0,
        validateStatus: (status) => status < 400,
        headers: {
          'Referer': `${this.protectorUrl}/`,
          ...this.client.defaults.headers
        }
      });

      const response = await noRedirectClient.get(protectorUrl);
      const videoUrl = response.headers.location;
      
      if (!videoUrl) {
        return [];
      }

      switch (player.name) {
        case "ST": // StreamTape
          return await this.extractStreamTapeVideos(videoUrl);
        case "VOE": // Voe
          return await this.extractVoeVideos(videoUrl);
        case "FST": // StreamWish
          return await this.extractStreamWishVideos(videoUrl);
        case "TV": // TV Player
          return await this.extractTVPlayerVideos(videoUrl);
        default:
          return [];
      }
    } catch (error) {
      console.error(`Error extracting from ${player.name}:`, error);
      return [];
    }
  }

  private async extractStreamTapeVideos(url: string): Promise<Video[]> {
    // Simplified StreamTape extraction
    try {
      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);
      
      // Extract video URL from StreamTape's pattern
      const scriptText = $('script').text();
      const match = scriptText.match(/getElementById\('videolink'\)\.innerHTML = "(.+?)"/);
      
      if (match) {
        return [{
          videoUrl: match[1],
          quality: "StreamTape",
          headers: { 'Referer': url }
        }];
      }
      
      return [];
    } catch (error) {
      console.error('StreamTape extraction error:', error);
      return [];
    }
  }

  private async extractVoeVideos(url: string): Promise<Video[]> {
    // Simplified Voe extraction
    try {
      const response = await this.client.get(url);
      const data = response.data;
      
      // Look for video URL in response
      const match = data.match(/'hls': '(.+?)'/);
      
      if (match) {
        return [{
          videoUrl: match[1],
          quality: "Voe",
          headers: { 'Referer': url }
        }];
      }
      
      return [];
    } catch (error) {
      console.error('Voe extraction error:', error);
      return [];
    }
  }

  private async extractStreamWishVideos(url: string): Promise<Video[]> {
    // Simplified StreamWish extraction
    try {
      const response = await this.client.get(url);
      const $ = cheerio.load(response.data);
      
      // Extract from script tags
      const scriptText = $('script').text();
      const match = scriptText.match(/file:"(.+?)"/);
      
      if (match) {
        return [{
          videoUrl: match[1],
          quality: "StreamWish",
          headers: { 'Referer': url }
        }];
      }
      
      return [];
    } catch (error) {
      console.error('StreamWish extraction error:', error);
      return [];
    }
  }

  private async extractTVPlayerVideos(url: string): Promise<Video[]> {
    try {
      const response = await this.client.get(url);
      const data = response.data;
      
      // Extract playlist URL
      const match = data.match(/var urlPlay = '(.+?)'/);
      
      if (match) {
        const playlistUrl = match[1];
        return await this.extractFromHLS(playlistUrl, url);
      }
      
      return [];
    } catch (error) {
      console.error('TV Player extraction error:', error);
      return [];
    }
  }

  private async extractFromHLS(playlistUrl: string, referer: string): Promise<Video[]> {
    try {
      const response = await this.client.get(playlistUrl, {
        headers: { 'Referer': referer }
      });
      
      const playlist = response.data;
      const videos: Video[] = [];
      
      // Parse HLS playlist
      const lines = playlist.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
          const resolutionMatch = line.match(/RESOLUTION=\d+x(\d+)/);
          const nextLine = lines[i + 1]?.trim();
          
          if (resolutionMatch && nextLine && !nextLine.startsWith('#')) {
            const quality = `${resolutionMatch[1]}p`;
            const videoUrl = nextLine.startsWith('http') ? nextLine : new URL(nextLine, playlistUrl).toString();
            
            videos.push({
              videoUrl,
              quality: `TV - ${quality}`,
              headers: { 'Referer': referer }
            });
          }
        }
      }
      
      return videos;
    } catch (error) {
      console.error('HLS extraction error:', error);
      return [];
    }
  }

  private reverseString(str: string): string {
    return str.split('').reverse().join('');
  }

  private sortVideosByQuality(videos: Video[]): Video[] {
    const qualityOrder = ['1080p', '720p', '480p', '360p'];
    
    return videos.sort((a, b) => {
      for (const quality of qualityOrder) {
        if (a.quality.includes(quality) && !b.quality.includes(quality)) {
          return -1;
        }
        if (!a.quality.includes(quality) && b.quality.includes(quality)) {
          return 1;
        }
      }
      return 0;
    });
  }
}

export default SupJavWrapper;
