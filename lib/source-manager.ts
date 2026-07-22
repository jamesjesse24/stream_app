import config from './config';
import { SupJavWrapper } from './supjav-wrapper';
import { getUHDMoviesInstance } from './uhdmovies-wrapper';

interface AnimeSource {
  name: string;
  getPopularAnime(page: number): Promise<any>;
  searchAnime(query: string, page: number): Promise<any>;
  getAnimeDetails(url: string): Promise<any>;
  getEpisodeList(animeUrl: string): Promise<any>;
  getVideoList(episodeUrl: string): Promise<any>;
}

class UHDMoviesSource implements AnimeSource {
  name = "UHDMovies";
  
  async getPopularAnime(page: number) {
    const uhdmovies = await getUHDMoviesInstance();
    return await uhdmovies.getPopularAnime(page);
  }

  async searchAnime(query: string, page: number) {
    const uhdmovies = await getUHDMoviesInstance();
    return await uhdmovies.searchAnime(page, query);
  }

  async getAnimeDetails(url: string) {
    const uhdmovies = await getUHDMoviesInstance();
    return await uhdmovies.getAnimeDetails(url);
  }

  async getEpisodeList(animeUrl: string) {
    const uhdmovies = await getUHDMoviesInstance();
    return await uhdmovies.getEpisodeList(animeUrl);
  }

  async getVideoList(episodeUrl: string) {
    const uhdmovies = await getUHDMoviesInstance();
    return await uhdmovies.getVideoList(episodeUrl);
  }
}

class SupJavSource implements AnimeSource {
  name = "SupJAV";
  private wrapper: SupJavWrapper;

  constructor(lang: string = "en") {
    this.wrapper = new SupJavWrapper(lang);
  }

  async getPopularAnime(page: number) {
    return await this.wrapper.getPopularAnime(page);
  }

  async searchAnime(query: string, page: number) {
    return await this.wrapper.searchAnime(query, page);
  }

  async getAnimeDetails(url: string) {
    return await this.wrapper.getAnimeDetails(url);
  }

  async getEpisodeList(animeUrl: string) {
    return await this.wrapper.getEpisodeList(animeUrl);
  }

  async getVideoList(episodeUrl: string) {
    return await this.wrapper.getVideoList(episodeUrl);
  }
}

export class SourceManager {
  private sources: Map<string, AnimeSource> = new Map();

  constructor() {
    this.initializeSources();
  }

  private initializeSources() {
    // Initialize UHDMovies source
    this.sources.set('uhdmovies', new UHDMoviesSource());

    // Initialize SupJAV sources for different languages
    for (const lang of config.sources.supjav.supportedLanguages) {
      const sourceKey = lang === 'en' ? 'supjav' : `supjav-${lang}`;
      this.sources.set(sourceKey, new SupJavSource(lang));
    }
  }

  getSource(sourceKey: string): AnimeSource | null {
    return this.sources.get(sourceKey) || null;
  }

  getAvailableSources(): string[] {
    return Array.from(this.sources.keys());
  }

  getSourceInfo(sourceKey: string) {
    const sourceConfig = Object.entries(config.sources).find(([key]) => 
      sourceKey.startsWith(key)
    );
    
    if (sourceConfig) {
      const [configKey, configValue] = sourceConfig;
      const lang = sourceKey.includes('-') ? sourceKey.split('-')[1] : 'en';
      
      return {
        name: (configValue as any).name,
        baseUrl: (configValue as any).baseUrl,
        supportedQualities: (configValue as any).supportedQualities,
        supportedLanguages: (configValue as any).supportedLanguages,
        type: (configValue as any).type,
        protectorUrl: (configValue as any).protectorUrl,
        language: lang,
        key: sourceKey
      };
    }
    
    return null;
  }

  async executeOnSource<T>(
    sourceKey: string, 
    method: keyof AnimeSource, 
    ...args: any[]
  ): Promise<T> {
    const source = this.getSource(sourceKey);
    if (!source) {
      throw new Error(`Source ${sourceKey} not found`);
    }

    const sourceMethod = source[method] as (...args: any[]) => Promise<T>;
    if (typeof sourceMethod !== 'function') {
      throw new Error(`Method ${method} not found on source ${sourceKey}`);
    }

    return await sourceMethod.apply(source, args);
  }

  async searchAllSources(query: string, page: number = 1, excludeSources: string[] = []) {
    const results: Record<string, any> = {};
    const promises: Array<Promise<void>> = [];

    this.sources.forEach((source, sourceKey) => {
      if (excludeSources.includes(sourceKey)) return;

      promises.push(
        source.searchAnime(query, page)
          .then((result: any) => {
            results[sourceKey] = {
              source: this.getSourceInfo(sourceKey),
              ...result
            };
          })
          .catch((error: any) => {
            console.error(`Error searching ${sourceKey}:`, error);
            results[sourceKey] = {
              source: this.getSourceInfo(sourceKey),
              animeList: [],
              hasNextPage: false,
              error: error.message
            };
          })
      );
    });

    await Promise.all(promises);
    return results;
  }

  async getPopularFromAllSources(page: number = 1, excludeSources: string[] = []) {
    const results: Record<string, any> = {};
    const promises: Array<Promise<void>> = [];

    this.sources.forEach((source, sourceKey) => {
      if (excludeSources.includes(sourceKey)) return;

      promises.push(
        source.getPopularAnime(page)
          .then((result: any) => {
            results[sourceKey] = {
              source: this.getSourceInfo(sourceKey),
              ...result
            };
          })
          .catch((error: any) => {
            console.error(`Error getting popular from ${sourceKey}:`, error);
            results[sourceKey] = {
              source: this.getSourceInfo(sourceKey),
              animeList: [],
              hasNextPage: false,
              error: error.message
            };
          })
      );
    });

    await Promise.all(promises);
    return results;
  }
}

export default SourceManager;
