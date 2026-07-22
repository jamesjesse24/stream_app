'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { SearchBar } from '@/components/SearchBar';
import { AnimeGrid } from '@/components/AnimeGrid';
import { Pagination } from '@/components/Pagination';
import { Button } from '@/components/ui/button';
import { Flame, TrendingUp, Search } from 'lucide-react';
import { Anime, PaginationInfo } from '@/types';
import { formatTitle } from '@/lib/utils';
import UHDMoviesAPI from '@/lib/api';
import toast, { Toaster } from 'react-hot-toast';

export default function HomePage() {
  const router = useRouter();
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

  const loadAnimes = useCallback(async () => {
    setLoading(true);
    try {
      let result;
      if (searchQuery.trim()) {
        result = await api.searchAnime(currentPage, searchQuery);
      } else {
        result = await api.getPopularAnime(currentPage);
      }

      console.log('API result:', result);
      console.log('Anime list length:', result.animeList?.length);

      if (result.animeList && result.animeList.length > 0) {
        setAnimes(result.animeList);
        setPagination({
          currentPage,
          totalPages: result.totalPages || Math.max(currentPage + (result.hasNextPage ? 5 : 0), currentPage),
          hasNextPage: result.hasNextPage,
          hasPreviousPage: currentPage > 1,
        });
      } else {
        setAnimes([]);
        setPagination({
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        });
        if (searchQuery.trim()) {
          toast.error(`No results found for "${searchQuery}"`);
        }
      }
    } catch (error) {
      console.error('Error loading animes:', error);
      setAnimes([]);
      toast.error('Failed to load content. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [currentPage, searchQuery]);

  useEffect(() => {
    loadAnimes();
  }, [loadAnimes]);

  const handleSearch = (query: string) => {
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query)}&page=1`);
    } else {
      setSearchQuery('');
      setCurrentPage(1);
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAnimeClick = (anime: Anime) => {
    const slug = encodeURIComponent(anime.url);
    const animeData = encodeURIComponent(JSON.stringify(anime));
    router.push(`/anime/${slug}?anime=${animeData}`);
  };

  return (
    <div className="min-h-screen">
      <Toaster position="top-right" />
      
      {/* Header */}
      <header className="sticky top-0 z-40 w-full border-b border-gray-800 bg-gray-950/80 backdrop-blur-md">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                <Flame className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold gradient-text">UHD Movies</h1>
                <p className="text-sm text-gray-400">Stream in High Quality</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Hero Section */}
        <section className="text-center py-12 mb-12">
          <h1 className="text-4xl md:text-6xl font-bold mb-6">
            <span className="gradient-text">Discover Amazing</span>
            <br />
            <span className="text-white">Anime Content</span>
          </h1>
          <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto">
            Stream your favorite anime in the highest quality available. Search through thousands of titles and enjoy seamless playback.
          </p>
          
          {/* Search Bar */}
          <div className="mb-8">
            <SearchBar
              onSearch={handleSearch}
              loading={loading}
              placeholder="Search for anime, movies, or series..."
            />
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap justify-center gap-4">
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                setSearchQuery('');
                setCurrentPage(1);
              }}
              className="bg-gray-900/50 border-gray-700 hover:bg-gray-800"
            >
              <TrendingUp className="h-5 w-5 mr-2" />
              Popular Now
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => handleSearch('action')}
              className="bg-gray-900/50 border-gray-700 hover:bg-gray-800"
            >
              <Search className="h-5 w-5 mr-2" />
              Action
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => handleSearch('romance')}
              className="bg-gray-900/50 border-gray-700 hover:bg-gray-800"
            >
              <Search className="h-5 w-5 mr-2" />
              Romance
            </Button>
          </div>
        </section>

        {/* Content Section */}
        <section>
          {/* Section Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">
                {searchQuery ? `Search Results for "${searchQuery}"` : 'Popular Anime'}
              </h2>
              <p className="text-gray-400">
                {searchQuery ? `Page ${currentPage}` : `Trending content - Page ${currentPage}`}
              </p>
            </div>
          </div>

          {/* Anime Grid */}
          <AnimeGrid
            animes={animes}
            onAnimeClick={handleAnimeClick}
            loading={loading}
          />

          {/* Pagination */}
          <Pagination
            currentPage={pagination.currentPage}
            totalPages={pagination.totalPages}
            hasNextPage={pagination.hasNextPage}
            hasPreviousPage={pagination.hasPreviousPage}
            onPageChange={handlePageChange}
          />
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 bg-gray-950/80 mt-16">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center">
            <div className="flex items-center justify-center space-x-2 mb-4">
              <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                <Flame className="h-5 w-5 text-white" />
              </div>
              <span className="text-xl font-bold gradient-text">UHD Movies</span>
            </div>
            <p className="text-gray-400 mb-4">
              Stream your favorite anime in the highest quality
            </p>
            <div className="flex justify-center space-x-4 text-sm text-gray-500">
              <span>© 2024 UHD Movies. All rights reserved.</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
