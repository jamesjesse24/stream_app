const axios = require('axios');
const cheerio = require('cheerio');
const { CookieJar } = require('tough-cookie');
const FormData = require('form-data');

// Simple redirector bypasser for this context
class RedirectorBypasser {
  constructor(client, headers) {
    this.client = client;
    this.headers = headers;
  }

  async bypass(url) {
    try {
      const response = await this.client.get(url, { 
        headers: this.headers,
        maxRedirects: 0,
        validateStatus: () => true
      });
      
      if (response.status === 302 && response.headers.location) {
        return response.headers.location;
      }
      
      return url;
    } catch (error) {
      console.error('Redirector bypass error:', error);
      return url;
    }
  }
}

// Configuration
const config = {
  defaults: {
    domain: 'https://uhdmovies.casa/',
    quality: '1080p',
    sizeSort: 'desc'
  },
  preferences: {
    domain: 'https://uhdmovies.casa/',
    quality: '1080p',
    sizeSort: 'desc'
  }
};

class UHDMovies {
  constructor() {
    this.name = "UHD Movies";
    this.lang = "en";
    this.supportsLatest = false;
    
    // Setup HTTP client with cookie support
    this.cookieJar = new CookieJar();
    this.client = axios.create({
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };
    
    this.redirectBypasser = new RedirectorBypasser(this.client, this.headers);
    this.preferences = config.preferences;
    
    // Size regex for file size detection
    this.SIZE_REGEX = /\[((?:.(?!\[))+)\][ ]*$/i;
  }

  get baseUrl() {
    return this.preferences.domain || config.defaults.domain;
  }

  async getCurrentBaseUrl() {
    try {
      const response = await this.client.get(`${this.baseUrl}/`, {
        headers: this.headers,
        maxRedirects: 0,
        validateStatus: (status) => status < 400
      });
      
      if (response.status === 301 && response.headers.location) {
        const newUrl = response.headers.location.replace(/\/$/, '');
        this.preferences.domain = newUrl;
        return newUrl;
      }
      
      return this.baseUrl;
    } catch (error) {
      return this.baseUrl;
    }
  }

  async popularAnimeRequest(page = 1) {
    const currentBaseUrl = await this.getCurrentBaseUrl();
    return `${currentBaseUrl}/page/${page}/`;
  }

  popularAnimeSelector() {
    return "div#content div.gridlove-posts > div.layout-masonry";
  }

  popularAnimeFromElement(element, $) {
    const linkEl = $(element).find("div.entry-image > a");
    const imgEl = linkEl.find("img");
    
    return {
      url: this.getRelativeUrl(linkEl.attr("href")),
      thumbnailUrl: imgEl.attr("src") || imgEl.attr("data-src"),
      title: linkEl.attr("title")?.replace("Download", "").trim() || "Unknown"
    };
  }

  popularAnimeNextPageSelector() {
    return "div#content > nav.gridlove-pagination > a.next";
  }

  async getPopularAnime(page = 1) {
    try {
      const url = await this.popularAnimeRequest(page);
      const response = await this.client.get(url, { headers: this.headers });
      const $ = cheerio.load(response.data);
      
      const animeList = [];
      const selector = this.popularAnimeSelector();
      
      $(selector).each((index, element) => {
        const anime = this.popularAnimeFromElement(element, $);
        if (anime.url && anime.title) {
          animeList.push(anime);
        }
      });

      const hasNextPage = $(this.popularAnimeNextPageSelector()).length > 0;
      
      return {
        animeList,
        hasNextPage
      };
    } catch (error) {
      console.error('Error in getPopularAnime:', error);
      return { animeList: [], hasNextPage: false };
    }
  }

  async searchAnimeRequest(page = 1, query = "") {
    const currentBaseUrl = await this.getCurrentBaseUrl();
    const cleanQuery = query.replace(/\s+/g, '+').toLowerCase();
    return `${currentBaseUrl}/page/${page}/?s=${cleanQuery}`;
  }

  async searchAnime(page = 1, query = "") {
    try {
      const url = await this.searchAnimeRequest(page, query);
      const response = await this.client.get(url, { headers: this.headers });
      const $ = cheerio.load(response.data);
      
      const animeList = [];
      const selector = this.popularAnimeSelector();
      
      $(selector).each((index, element) => {
        const anime = this.popularAnimeFromElement(element, $);
        if (anime.url && anime.title) {
          animeList.push(anime);
        }
      });

      const hasNextPage = $(this.popularAnimeNextPageSelector()).length > 0;
      
      return {
        animeList,
        hasNextPage
      };
    } catch (error) {
      console.error('Error in searchAnime:', error);
      return { animeList: [], hasNextPage: false };
    }
  }

  async getAnimeDetails(animeUrl) {
    try {
      const currentBaseUrl = await this.getCurrentBaseUrl();
      const fullUrl = currentBaseUrl + animeUrl;
      const response = await this.client.get(fullUrl, { headers: this.headers });
      const $ = cheerio.load(response.data);
      
      const title = $(".entry-title").text()
        ?.replace(/download/i, "").trim() || "Movie";
      
      const description = $("pre:contains('plot'), .entry-content p").first().text() || "No description available.";
      
      return {
        title,
        status: "COMPLETED",
        description,
        initialized: true
      };
    } catch (error) {
      console.error('Error in getAnimeDetails:', error);
      return {
        title: "Unknown",
        status: "UNKNOWN", 
        description: "No description available.",
        initialized: false
      };
    }
  }

  async getEpisodeList(animeUrl) {
    try {
      const currentBaseUrl = await this.getCurrentBaseUrl();
      const fullUrl = currentBaseUrl + animeUrl;
      const response = await this.client.get(fullUrl, { headers: this.headers });
      const $ = cheerio.load(response.data);
      
      const episodeElements = $("p:has(a[href*='?sid='],a[href*='r?key=']):has(a[class*='maxbutton'])[style*='center']");
      
      if (episodeElements.length === 0) {
        // Fallback to any download links
        const fallbackElements = $("a[href*='drive.google.com'], a[href*='?sid='], a[href*='r?key=']").parent();
        if (fallbackElements.length === 0) {
          throw new Error("No episodes found");
        }
      }

      const episodes = [];
      episodeElements.each((index, element) => {
        const $element = $(element);
        const links = [];
        
        $element.find("a").each((linkIndex, linkElement) => {
          const $link = $(linkElement);
          const url = $link.attr("href");
          
          if (url && !$link.attr("class")?.includes("-zip")) {
            links.push({ url, quality: "HD" });
          }
        });

        if (links.length > 0) {
          episodes.push({
            url: JSON.stringify({ urls: links }),
            name: `Episode ${index + 1}`,
            episodeNumber: index + 1
          });
        }
      });

      return episodes.length > 0 ? episodes : [{
        url: JSON.stringify({ urls: [{ url: animeUrl, quality: "HD" }] }),
        name: "Movie",
        episodeNumber: 1
      }];
    } catch (error) {
      console.error('Error in getEpisodeList:', error);
      return [{
        url: JSON.stringify({ urls: [{ url: animeUrl, quality: "HD" }] }),
        name: "Movie",
        episodeNumber: 1
      }];
    }
  }

  async getVideoList(episode) {
    try {
      const urlData = JSON.parse(episode.url);
      const videoList = [];

      for (const epUrl of urlData.urls) {
        try {
          // For now, return the direct URL
          videoList.push({
            url: epUrl.url,
            quality: `${epUrl.quality} - Direct Link`,
            videoUrl: epUrl.url
          });
        } catch (error) {
          console.error(`Error processing video link: ${error.message}`);
        }
      }

      return videoList;
    } catch (error) {
      console.error('Error in getVideoList:', error);
      return [];
    }
  }

  getRelativeUrl(fullUrl) {
    if (!fullUrl) return "";
    try {
      const url = new URL(fullUrl);
      return url.pathname + url.search + url.hash;
    } catch {
      return fullUrl.startsWith('/') ? fullUrl : '/' + fullUrl;
    }
  }
}

module.exports = UHDMovies;
