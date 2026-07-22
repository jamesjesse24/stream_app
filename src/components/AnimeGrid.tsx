'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { formatTitle } from '@/lib/utils';
import { Anime } from '@/types';

interface AnimeCardProps {
  anime: Anime;
  onClick: () => void;
}

export function AnimeCard({ anime, onClick }: AnimeCardProps) {
  return (
    <Card 
      className="group cursor-pointer overflow-hidden bg-gray-900/50 border-gray-800 hover:border-blue-500/50 transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-blue-500/20"
      onClick={onClick}
    >
      <CardContent className="p-0">
        <div className="relative aspect-[3/4] overflow-hidden">
          <img
            src={anime.thumbnailUrl || '/placeholder-anime.svg'}
            alt={anime.title}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
            loading="lazy"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.src = '/placeholder-anime.svg';
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          <div className="absolute bottom-0 left-0 right-0 p-4 translate-y-full group-hover:translate-y-0 transition-transform duration-300">
            <h3 className="text-white font-semibold text-sm line-clamp-2">
              {formatTitle(anime.title)}
            </h3>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface AnimeGridProps {
  animes: Anime[];
  onAnimeClick: (anime: Anime) => void;
  loading?: boolean;
}

export function AnimeGrid({ animes, onAnimeClick, loading = false }: AnimeGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
        {Array.from({ length: 12 }).map((_, index) => (
          <div key={index} className="aspect-[3/4] bg-gray-800 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (animes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-24 h-24 bg-gray-800 rounded-full mb-4 flex items-center justify-center">
          <svg className="w-12 h-12 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2h4a1 1 0 011 1v1a1 1 0 01-1 1H3a1 1 0 01-1-1V5a1 1 0 011-1h4z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v12a2 2 0 002 2h12a2 2 0 002-2V7" />
          </svg>
        </div>
        <h3 className="text-xl font-semibold text-gray-300 mb-2">No anime found</h3>
        <p className="text-gray-500">Try adjusting your search criteria or check back later.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
      {animes.map((anime, index) => (
        <AnimeCard
          key={`${anime.url}-${index}`}
          anime={anime}
          onClick={() => onAnimeClick(anime)}
        />
      ))}
    </div>
  );
}
