'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { NavigationHeader } from '@/components/NavigationHeader';
import { SearchBar } from '@/components/SearchBar';
import { AnimeGrid } from '@/components/AnimeGrid';
import { Pagination } from '@/components/Pagination';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Search as SearchIcon } from 'lucide-react';
import { Anime, PaginationInfo } from '@/types';
import UHDMoviesAPI from '@/lib/api';
import toast, { Toaster } from 'react-hot-toast';

export default function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [animes, setAnimes] = useState<Anime[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationInfo>({
    currentPage: 1,
    totalPages: 10,
    hasNextPage: false,
    hasPreviousPage: false,
  });

  const api = new UHDMoviesAPI();

  const loadSearchResults = useCallback(async (query: string, page: number) => {
    setLoading(true);
    try {
      const result = await api.searchAnime(page, query);
      
      if (result.animeList && result.animeList.length > 0) {
        setAnimes(result.animeList);
        setPagination({
          currentPage: page,
          totalPages: result.totalPages || Math.max(page + (result.hasNextPage ? 5 : 0), page),
          hasNextPage: result.hasNextPage,
          hasPreviousPage: page > 1,
        });
      } else {
        setAnimes([]);
        setPagination({
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        });
        toast.error(`No results found for "${query}"`);
      }
    } catch (error) {
      console.error('Error loading search results:', error);
      setAnimes([]);
      toast.error('Failed to load search results. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const query = searchParams.get('q') || '';
    const page = parseInt(searchParams.get('page') || '1');
    setSearchQuery(query);
    setCurrentPage(page);
    
    if (query) {
      loadSearchResults(query, page);
    }
  }, [searchParams, loadSearchResults]);

  const handleSearch = (query: string) => {
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query)}&page=1`);
    }
  };

  const handlePageChange = (page: number) => {
    if (searchQuery) {
      router.push(`/search?q=${encodeURIComponent(searchQuery)}&page=${page}`);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAnimeClick = (anime: Anime) => {
    const slug = encodeURIComponent(anime.url);
    const animeData = encodeURIComponent(JSON.stringify(anime));
    router.push(`/anime/${slug}?anime=${animeData}`);
  };

  return (
    <div className="min-h-screen bg-gray-950">
      <Toaster position="top-right" />
      
      <NavigationHeader 
        title="Search Results"
        showBackButton={true}
      />
      
      <div className="container mx-auto px-4 py-8">
        {/* Search Bar */}
        <div className="mb-8">
          <SearchBar
            onSearch={handleSearch}
            loading={loading}
            placeholder="Search for anime, movies, or series..."
            initialValue={searchQuery}
          />
        </div>

        {/* Results Header */}
        {searchQuery && (
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-2">
              Results for &quot;{searchQuery}&quot;
            </h2>
            <p className="text-gray-400">
              {animes.length > 0 ? `Found ${animes.length} results` : 'No results found'} - Page {currentPage}
            </p>
          </div>
        )}

        {/* Results Grid */}
        {searchQuery ? (
          <>
            <AnimeGrid
              animes={animes}
              onAnimeClick={handleAnimeClick}
              loading={loading}
            />

            {/* Pagination */}
            {animes.length > 0 && (
              <Pagination
                currentPage={pagination.currentPage}
                totalPages={pagination.totalPages}
                hasNextPage={pagination.hasNextPage}
                hasPreviousPage={pagination.hasPreviousPage}
                onPageChange={handlePageChange}
              />
            )}
          </>
        ) : (
          <div className="text-center py-24">
            <SearchIcon className="h-16 w-16 text-gray-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-white mb-4">Search for Content</h2>
            <p className="text-gray-400 max-w-md mx-auto">
              Enter a search term above to find anime, movies, or series.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
