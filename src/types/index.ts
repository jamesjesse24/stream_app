export interface Anime {
  url: string;
  thumbnailUrl: string;
  title: string;
}

export interface AnimeDetails {
  title: string;
  status: string;
  description: string;
  initialized: boolean;
  thumbnailUrl?: string;
}

export interface Episode {
  url: string;
  name: string;
  episodeNumber: number;
}

export interface VideoLink {
  url: string;
  quality: string;
  videoUrl?: string;
  id?: string;
  status?: 'checking' | 'live' | 'dead' | 'unknown';
  statusChecked?: boolean;
  fileSizeBytes?: number | null;
  fileSizeEstimated?: boolean;
  mediaInfoStatus?: 'checking' | 'available' | 'estimated' | 'unavailable';
  isHls?: boolean;
}

export interface SearchResponse {
  animeList: Anime[];
  hasNextPage: boolean;
  totalPages?: number;
  currentPage?: number;
}

export interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}
