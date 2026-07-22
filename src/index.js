import axios from 'axios';
import * as cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';
import FormData from 'form-data';
import { RedirectorBypasser } from './redirector-bypasser.js';
import config from './config.js';

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
      validateStatus: () => true, // Don't throw on HTTP error codes
    });
    
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };
    
    this.redirectBypasser = new RedirectorBypasser(this.client, this.headers);
    this.preferences = config.preferences;
    
    // Size regex for file size detection
    this.SIZE_REGEX = /\[((?:.(?!\[))+)\][ ]*$/i;
  }

  parseFileSizeBytes(value) {
    if (typeof value !== "string") return null;
    const match = value.match(/(\d+(?:\.\d+)?)\s*(TB|GB|MB|KB)/i);
    if (!match) return null;

    const amount = Number.parseFloat(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const unit = match[2].toUpperCase();
    const multiplier = unit === "TB"
      ? 1024 ** 4
      : unit === "GB"
        ? 1024 ** 3
        : unit === "MB"
          ? 1024 ** 2
          : 1024;
    const bytes = Math.round(amount * multiplier);
    return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
  }

  findFileSizeBytes(...values) {
    for (const value of values) {
      const bytes = this.parseFileSizeBytes(value);
      if (bytes) return bytes;
    }
    return null;
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

  // ============================== Popular ===============================
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
      thumbnailUrl: imgEl.attr("src"),
      title: linkEl.attr("title")?.replace("Download", "").trim() || "Unknown"
    };
  }

  popularAnimeNextPageSelector() {
    return "div#content > nav.gridlove-pagination > a.next";
  }

  async getPopularAnime(page = 1) {
    const url = await this.popularAnimeRequest(page);
    const response = await this.client.get(url, { headers: this.headers });
    const $ = cheerio.load(response.data);
    
    const animeList = [];
    const selector = this.popularAnimeSelector();
    
    $(selector).each((index, element) => {
      const anime = this.popularAnimeFromElement(element, $);
      animeList.push(anime);
    });

    const hasNextPage = $(this.popularAnimeNextPageSelector()).length > 0;
    
    return {
      animeList,
      hasNextPage
    };
  }

  // =============================== Search ===============================
  async searchAnimeRequest(page = 1, query = "", filters = {}) {
    const currentBaseUrl = await this.getCurrentBaseUrl();
    const cleanQuery = query.replace(/\s+/g, '+').toLowerCase();
    return `${currentBaseUrl}/page/${page}/?s=${cleanQuery}`;
  }

  async searchAnime(page = 1, query = "") {
    const url = await this.searchAnimeRequest(page, query);
    const response = await this.client.get(url, { headers: this.headers });
    const $ = cheerio.load(response.data);
    
    const animeList = [];
    const selector = this.popularAnimeSelector();
    
    $(selector).each((index, element) => {
      const anime = this.popularAnimeFromElement(element, $);
      animeList.push(anime);
    });

    const hasNextPage = $(this.popularAnimeNextPageSelector()).length > 0;
    
    return {
      animeList,
      hasNextPage
    };
  }

  // =========================== Anime Details ============================
  async getAnimeDetails(animeUrl) {
    const currentBaseUrl = await this.getCurrentBaseUrl();
    const fullUrl = currentBaseUrl + animeUrl;
    const response = await this.client.get(fullUrl, { headers: this.headers });
    const $ = cheerio.load(response.data);
    
    const title = $(".entry-title").text()
      ?.replace(/download/i, "").trim() || "Movie";
    
    const description = $("pre:contains('plot')").text() || "";
    
    return {
      title,
      status: "COMPLETED",
      description,
      initialized: true
    };
  }

  // ============================== Episodes ==============================
  episodeListSelector() {
    return "p:has(a[href*='?sid='],a[href*='r?key=']):has(a[class*='maxbutton'])[style*='center']";
  }

  async getEpisodeList(animeUrl) {
    const currentBaseUrl = await this.getCurrentBaseUrl();
    const fullUrl = currentBaseUrl + animeUrl;
    const response = await this.client.get(fullUrl, { headers: this.headers });
    const $ = cheerio.load(response.data);
    
    const episodeElements = $(this.episodeListSelector());
    
    if (episodeElements.length === 0) {
      throw new Error("Only Zip Pack Available");
    }

    const qualityRegex = /\d{3,4}p/i;
    const seasonRegex = /[ .]?S(?:eason)?[ .]?(\d{1,2})[ .]?/i;
    const seasonTitleRegex = /[ .\[(]?S(?:eason)?[ .]?(\d{1,2})[ .\])]/i;
    const partRegex = /Part ?(\d{1,2})/i;

    // Check if it's a series
    const firstEpisodeText = episodeElements.first().text() || "";
    const isSeries = /episode|zip|pack/i.test(firstEpisodeText);

    const episodeGroups = new Map();

    episodeElements.each((index, element) => {
      const $element = $(element);
      const prevP = $element.prev().text();
      
      // Extract quality
      let qualityMatch = prevP.match(qualityRegex);
      let quality = qualityMatch ? qualityMatch[0] : 
        ($element.text().match(qualityRegex)?.[0] || "HD");

      // Determine episode name
      let defaultName;
      if (isSeries) {
        let seasonMatch = prevP.match(seasonRegex);
        let seasonNumber = "1";
        
        if (!seasonMatch) {
          const prevPre = $element.prevAll("pre,div.mks_separator").first().text();
          seasonMatch = prevPre.match(seasonRegex);
        }
        
        if (!seasonMatch) {
          const title = $("h1.entry-title").text();
          seasonMatch = title.match(seasonTitleRegex);
        }
        
        if (seasonMatch) {
          seasonNumber = seasonMatch[1];
        }

        const partMatch = prevP.match(partRegex);
        const part = partMatch ? ` Pt ${partMatch[1]}` : "";
        
        defaultName = `Season ${parseInt(seasonNumber) || 1}${part}`;
      } else {
        const prevHeader = $element.prevAll("h1,h2,h3,pre:not(:contains('plot'))").first().text();
        defaultName = (prevHeader || `Movie - ${quality}`)
          .replace(/download/i, "").trim();
        
        if (/collection/i.test(defaultName)) {
          defaultName = $element.prev().text();
        }
      }

      // Extract links
      $element.find("a").each((linkIndex, linkElement) => {
        const $link = $(linkElement);
        
        // Skip zip links
        if ($link.attr("class")?.includes("-zip")) return;
        
        const episodeText = $link.text().replace(/episode/i, "").trim();
        const episodeNum = parseInt(episodeText) || linkIndex + 1;
        const url = $link.attr("href");
        
        if (!url) return;

        const key = `${defaultName}-${episodeNum}`;
        if (!episodeGroups.has(key)) {
          episodeGroups.set(key, {
            name: defaultName,
            episodeNum,
            urls: []
          });
        }
        
        episodeGroups.get(key).urls.push({ url, quality });
      });
    });

    // Convert to episode list
    const episodeList = Array.from(episodeGroups.entries()).map(([key, data], index) => {
      return {
        url: JSON.stringify({ urls: data.urls }),
        name: isSeries ? `${data.name} Ep ${data.episodeNum}` : data.name,
        episodeNumber: isSeries ? data.episodeNum : index + 1
      };
    });

    return episodeList.reverse();
  }

  // ============================ Video Links =============================
  async getVideoList(episode) {
    const urlData = JSON.parse(episode.url);
    const videoList = [];

    for (const epUrl of urlData.urls) {
      try {
        const mediaUrl = await this.getMediaUrl(epUrl);
        if (!mediaUrl) continue;

        if (this.isDriveSeedUrl(mediaUrl)) {
          const driveSeedVideos = await this.extractGDriveLink(mediaUrl, epUrl.quality);
          videoList.push(...driveSeedVideos);
          continue;
        }

        const videos = await this.extractVideo(mediaUrl, epUrl.quality);
        if (videos.length > 0) {
          videoList.push(...videos);
        } else {
          // Try GDrive extraction
          const gdriveVideos = await this.extractGDriveLink(mediaUrl, epUrl.quality);
          if (gdriveVideos.length > 0) {
            videoList.push(...gdriveVideos);
          } else {
            // Try instant link
            const instantLink = await this.getDirectLink(mediaUrl, "instant", "/mfile/");
            if (instantLink) {
              videoList.push({
                url: instantLink,
                quality: `${epUrl.quality} - GDrive Instant link`,
                videoUrl: instantLink
              });
            }
          }
        }
      } catch (error) {
        console.error(`Error processing video link: ${error.message}`);
      }
    }

    return this.sortVideos(videoList);
  }

  async getMediaUrl(epUrl) {
    const url = this.resolveHttpUrl(epUrl?.url);
    if (!url) return null;
    if (this.isDriveSeedUrl(url)) return url;

    let response;

    try {
      if (url.includes("?sid=")) {
        // Use redirector bypasser
        const finalUrl = await this.redirectBypasser.bypass(url);
        if (!finalUrl) return null;
        response = await this.client.get(finalUrl, { headers: this.headers });
      } else if (url.includes("r?key=")) {
        response = await this.client.get(url, { headers: this.headers });
      } else {
        return null;
      }

      const body = response.data;
      const path = body.split('replace("')[1]?.split('"')[0];

      if (!path || path === "/404") return null;

      return this.resolveHttpUrl(
        path,
        this.getResponseUrl(response, url)
      );
    } catch (error) {
      console.error(`Error getting media URL: ${error.message}`);
      return null;
    }
  }

  async extractVideo(url, quality) {
    const videos = [];
    
    for (let type = 1; type <= 3; type++) {
      try {
        const workerVideos = await this.extractWorkerLinks(url, quality, type);
        videos.push(...workerVideos);
      } catch (error) {
        console.error(`Error extracting worker links type ${type}: ${error.message}`);
      }
    }
    
    return videos;
  }

  async extractWorkerLinks(mediaUrl, quality, type) {
    const reqLink = mediaUrl.replace("/file/", "/wfile/") + `?type=${type}`;
    
    try {
      const response = await this.client.get(reqLink, { headers: this.headers });
      const $ = cheerio.load(response.data);
      
      const cardHeaderText = $("div.card-header").text().trim();
      const sizeMatch = cardHeaderText.match(this.SIZE_REGEX);
      const sizeText = sizeMatch?.[1] || "";
      const size = sizeText ? ` - ${sizeText}` : "";
      const fileSizeBytes = this.parseFileSizeBytes(sizeText);
      
      const videos = [];
      $("div.card-body div.mb-4 > a").each((index, element) => {
        const link = $(element).attr("href");
        if (!link) return;

        let decodedLink;
        
        if (link.includes("workers.dev")) {
          decodedLink = link;
        } else {
          const base64Url = link.split("download?url=")[1];
          if (base64Url) {
            decodedLink = Buffer.from(base64Url, 'base64').toString('utf8');
          } else {
            return;
          }
        }

        decodedLink = this.resolveHttpUrl(decodedLink, reqLink);
        if (!decodedLink) return;
        
        videos.push({
          url: decodedLink,
          quality: `${quality} - CF ${type} Worker ${index + 1}${size}`,
          videoUrl: decodedLink,
          fileSizeBytes,
          mediaInfoStatus: fileSizeBytes ? "available" : undefined
        });
      });
      
      return videos;
    } catch (error) {
      console.error(`Error extracting worker links: ${error.message}`);
      return [];
    }
  }

  resolveHttpUrl(value, baseUrl) {
    if (typeof value !== "string" || !value.trim()) return null;

    try {
      const resolvedUrl = baseUrl
        ? new URL(value.trim(), baseUrl)
        : new URL(value.trim());

      if (!["http:", "https:"].includes(resolvedUrl.protocol)) return null;
      return resolvedUrl.toString();
    } catch {
      return null;
    }
  }

  isDriveSeedUrl(value) {
    const url = this.resolveHttpUrl(value);
    if (!url) return false;

    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "driveseed.org" || hostname.endsWith(".driveseed.org");
  }

  getResponseUrl(response, fallbackUrl) {
    const candidates = [
      response?.request?.res?.responseUrl,
      response?.config?.url,
      fallbackUrl
    ];

    for (const candidate of candidates) {
      const resolvedUrl = this.resolveHttpUrl(candidate);
      if (resolvedUrl) return resolvedUrl;
    }

    return null;
  }

  extractDriveSeedLinks($, pageUrl, quality, fallbackFileSizeBytes = null) {
    const links = [];
    const seenUrls = new Set();

    $("a[href]").each((index, element) => {
      const link = $(element);
      const label = link.text().replace(/\s+/g, " ").trim();

      // DriveSeed's Resume Cloud and login buttons lead to HTML pages. Only
      // return buttons which represent an actual downloadable media URL.
      if (!/direct\s+download|cloud(?:\s+resume)?\s+download/i.test(label)) return;

      const url = this.resolveHttpUrl(link.attr("href"), pageUrl);
      if (!url || seenUrls.has(url)) return;

      const fileSizeBytes = this.findFileSizeBytes(label) || fallbackFileSizeBytes;
      seenUrls.add(url);
      links.push({
        url,
        quality: `${quality} - DriveSeed Cloud`,
        videoUrl: url,
        fileSizeBytes,
        mediaInfoStatus: fileSizeBytes ? "available" : undefined
      });
    });

    return links;
  }

  async extractDriveSeedInstantLink($, pageUrl, quality, fileSizeBytes = null) {
    const instantButton = $("a[href]").filter((index, element) =>
      /instant\s+download/i.test($(element).text())
    ).first();
    const landingUrl = this.resolveHttpUrl(instantButton.attr("href"), pageUrl);

    if (!landingUrl) return null;

    const landingResponse = await fetch(landingUrl, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        ...this.headers,
        Referer: pageUrl
      },
      signal: AbortSignal.timeout(30000)
    });
    const finalLandingUrl = this.resolveHttpUrl(landingResponse.url, landingUrl);
    if (!finalLandingUrl) return null;

    const embeddedUrl = this.resolveHttpUrl(
      new URL(finalLandingUrl).searchParams.get("url"),
      finalLandingUrl
    );
    const contentType = landingResponse.headers.get("content-type")?.toLowerCase() || "";
    const directUrl = embeddedUrl || (
      contentType.startsWith("video/") || contentType === "application/octet-stream"
        ? finalLandingUrl
        : null
    );
    if (!directUrl) return null;

    const headerSize = Number.parseInt(
      landingResponse.headers.get("content-length") || "",
      10
    );
    const resolvedFileSizeBytes = fileSizeBytes || (
      Number.isSafeInteger(headerSize) && headerSize > 0 ? headerSize : null
    );

    return {
      url: directUrl,
      quality: `${quality} - DriveSeed Instant`,
      videoUrl: directUrl,
      fileSizeBytes: resolvedFileSizeBytes,
      mediaInfoStatus: resolvedFileSizeBytes ? "available" : undefined
    };
  }

  async getDirectLink(url, action = "direct", newPath = "/file/") {
    try {
      const requestUrl = this.resolveHttpUrl(url);
      if (!requestUrl) return null;

      const response = await this.client.get(requestUrl, { headers: this.headers });
      const $ = cheerio.load(response.data);
      
      const script = $("script:contains('async function taskaction')").html();
      if (!script) return requestUrl;

      const keyMatch = script.match(/key", "([^"]+)"/);
      if (!keyMatch) return null;
      
      const key = keyMatch[1];
      
      const formData = new FormData();
      formData.append('action', action);
      formData.append('key', key);
      formData.append('action_token', '');

      const urlObj = new URL(requestUrl);
      const postUrl = requestUrl.replace("/file/", newPath);
      const headers = {
        ...this.headers,
        'x-token': urlObj.host,
        ...formData.getHeaders()
      };
      
      const postResponse = await this.client.post(postUrl, formData, { headers });
      
      // Check if response is valid JSON
      let result;
      try {
        if (typeof postResponse.data === 'string') {
          result = JSON.parse(postResponse.data);
        } else if (typeof postResponse.data === 'object') {
          result = postResponse.data;
        } else {
          console.error(`Unexpected response type: ${typeof postResponse.data}`);
          return null;
        }
      } catch (jsonError) {
        console.error(`JSON parsing failed: ${jsonError.message}, Response: ${postResponse.data}`);
        return null;
      }
      
      return this.resolveHttpUrl(
        result.url,
        this.getResponseUrl(postResponse, postUrl)
      );
    } catch (error) {
      console.error(`Error getting direct link: ${error.message}`);
      return null;
    }
  }

  async extractGDriveLink(mediaUrl, quality) {
    try {
      const sourceUrl = this.resolveHttpUrl(mediaUrl);
      if (!sourceUrl) return [];

      const isDriveSeed = this.isDriveSeedUrl(sourceUrl);
      const neoUrl = isDriveSeed
        ? sourceUrl
        : await this.getDirectLink(sourceUrl) || sourceUrl;
      const response = await this.client.get(neoUrl, { headers: this.headers });
      const $ = cheerio.load(response.data);
      const pageUrl = this.getResponseUrl(response, neoUrl);

      if (!pageUrl) return [];

      if (isDriveSeed) {
        const pageFileSizeBytes = this.findFileSizeBytes(
          $("div.card-header").text(),
          $("div.card-body").text(),
          $("body").text()
        );
        const driveSeedLinks = this.extractDriveSeedLinks(
          $,
          pageUrl,
          quality,
          pageFileSizeBytes
        );

        const resumeButton = $("a[href]").filter((index, element) =>
          /resume\s+cloud/i.test($(element).text())
        ).first();
        const resumeUrl = this.resolveHttpUrl(resumeButton.attr("href"), pageUrl);

        if (resumeUrl) {
          const resumeResponse = await this.client.get(resumeUrl, { headers: this.headers });
          const $resume = cheerio.load(resumeResponse.data);
          const resumePageUrl = this.getResponseUrl(resumeResponse, resumeUrl);
          const resumeFileSizeBytes = this.findFileSizeBytes(
            $resume("div.card-header").text(),
            $resume("div.card-body").text(),
            $resume("body").text()
          ) || pageFileSizeBytes;
          const resumeLinks = this.extractDriveSeedLinks(
            $resume,
            resumePageUrl,
            quality,
            resumeFileSizeBytes
          );

          driveSeedLinks.push(...resumeLinks);
        }

        // Cloud/Resume Cloud is range-capable and is the preferred playback
        // source. Instant is a non-range fallback and may wrap an HTML page.
        if (driveSeedLinks.length === 0) {
          const instantLink = await this.extractDriveSeedInstantLink(
            $,
            pageUrl,
            quality,
            pageFileSizeBytes
          );
          if (instantLink) driveSeedLinks.push(instantLink);
        }

        return Array.from(
          new Map(driveSeedLinks.map(link => [link.url, link])).values()
        );
      }
      
      const downloadButtons = $("div.card-body a.btn");
      const driveButtons = downloadButtons.filter((index, element) =>
        /g(?:oogle)?\s*drive/i.test($(element).text())
      );
      const gdBtn = driveButtons.length
        ? driveButtons.first()
        : downloadButtons.first();
      if (!gdBtn.length) return [];
      
      const gdLink = this.resolveHttpUrl(gdBtn.attr("href"), pageUrl);
      if (!gdLink) return [];

      const sizeMatch = gdBtn.text().match(this.SIZE_REGEX);
      const sizeText = sizeMatch?.[1] || "";
      const size = sizeText ? ` - ${sizeText}` : "";
      const fileSizeBytes = this.parseFileSizeBytes(sizeText);
      
      const gdResponse = await this.client.get(gdLink, { headers: this.headers });
      const $gd = cheerio.load(gdResponse.data);
      
      const downloadForm = $gd("form#download-form");
      if (!downloadForm.length) return [];
      
      const realLink = this.resolveHttpUrl(
        downloadForm.attr("action"),
        this.getResponseUrl(gdResponse, gdLink)
      );
      if (!realLink) return [];

      return [{
        url: realLink,
        quality: `${quality} - Gdrive${size}`,
        videoUrl: realLink,
        fileSizeBytes,
        mediaInfoStatus: fileSizeBytes ? "available" : undefined
      }];
    } catch (error) {
      console.error(`Error extracting GDrive link: ${error.message}`);
      return [];
    }
  }

  sortVideos(videos) {
    const preferredQuality = this.preferences.quality || config.defaults.quality;
    const ascSort = (this.preferences.sizeSort || config.defaults.sizeSort) === "asc";

    return videos.sort((a, b) => {
      // First sort by preferred quality
      const aHasPreferred = a.quality.includes(preferredQuality);
      const bHasPreferred = b.quality.includes(preferredQuality);
      
      if (aHasPreferred !== bHasPreferred) {
        return bHasPreferred ? 1 : -1;
      }

      // Then sort by file size
      const aSize = this.extractFileSize(a.quality);
      const bSize = this.extractFileSize(b.quality);
      
      return ascSort ? aSize - bSize : bSize - aSize;
    });
  }

  extractFileSize(quality) {
    const size = quality.split('-').pop().trim();
    if (/gb/i.test(size)) {
      return (parseFloat(size.replace(/gb/i, '')) || 1) * 1000;
    } else if (/mb/i.test(size)) {
      return parseFloat(size.replace(/mb/i, '')) || 1;
    }
    return 1;
  }

  getRelativeUrl(fullUrl) {
    if (!fullUrl) return "";
    try {
      const url = new URL(fullUrl);
      return url.pathname + url.search + url.hash;
    } catch {
      return fullUrl;
    }
  }

  // Preferences management
  updatePreferences(newPrefs) {
    this.preferences = { ...this.preferences, ...newPrefs };
    // In a real application, you'd save this to a file or database
  }
}

export { UHDMovies };
export default UHDMovies;
