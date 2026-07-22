import { Anime, AnimeDetails, Episode, VideoLink, SearchResponse } from '@/types';

class UHDMoviesAPI {
  private baseUrl = '/api/anime';

  async getPopularAnime(page: number = 1): Promise<SearchResponse> {
    try {
      const response = await fetch(`${this.baseUrl}?action=popular&page=${page}`);
      if (!response.ok) {
        throw new Error('Failed to fetch popular anime');
      }
      const result = await response.json();
      return {
        animeList: result.animeList.map((anime: any) => ({
          ...anime,
          title: this.formatTitle(anime.title)
        })),
        hasNextPage: result.hasNextPage,
        totalPages: result.totalPages,
        currentPage: result.currentPage
      };
    } catch (error) {
      console.error('Error fetching popular anime:', error);
      return { animeList: [], hasNextPage: false, totalPages: 1, currentPage: 1 };
    }
  }

  async searchAnime(page: number = 1, query: string = ""): Promise<SearchResponse> {
    try {
      const response = await fetch(`${this.baseUrl}?action=search&page=${page}&query=${encodeURIComponent(query)}`);
      if (!response.ok) {
        throw new Error('Failed to search anime');
      }
      const result = await response.json();
      return {
        animeList: result.animeList.map((anime: any) => ({
          ...anime,
          title: this.formatTitle(anime.title)
        })),
        hasNextPage: result.hasNextPage,
        totalPages: result.totalPages,
        currentPage: result.currentPage
      };
    } catch (error) {
      console.error('Error searching anime:', error);
      return { animeList: [], hasNextPage: false, totalPages: 1, currentPage: 1 };
    }
  }

  async getAnimeDetails(url: string): Promise<AnimeDetails | null> {
    try {
      const response = await fetch(`${this.baseUrl}?action=details&url=${encodeURIComponent(url)}`);
      if (!response.ok) {
        throw new Error('Failed to fetch anime details');
      }
      const details = await response.json();
      return {
        ...details,
        title: this.formatTitle(details.title)
      };
    } catch (error) {
      console.error('Error fetching anime details:', error);
      return null;
    }
  }

  async getEpisodeList(url: string): Promise<Episode[]> {
    try {
      const response = await fetch(`${this.baseUrl}?action=episodes&url=${encodeURIComponent(url)}`);
      if (!response.ok) {
        throw new Error('Failed to fetch episode list');
      }
      const episodes = await response.json();
      return episodes.map((episode: any) => ({
        ...episode,
        name: this.formatTitle(episode.name)
      }));
    } catch (error) {
      console.error('Error fetching episode list:', error);
      return [];
    }
  }

  async getVideoLinks(episode: Episode): Promise<VideoLink[]> {
    try {
      const response = await fetch(`${this.baseUrl}?action=videos&episode=${encodeURIComponent(JSON.stringify(episode))}`);
      if (!response.ok) {
        throw new Error('Failed to fetch video links');
      }
      const videos = await response.json();
      return videos;
    } catch (error) {
      console.error('Error fetching video links:', error);
      return [];
    }
  }

  private formatTitle(title: string): string {
    return title
      .replace(/download/gi, '')
      .replace(/\[.*?\]/g, '')
      .trim();
  }
}

export default UHDMoviesAPI;
