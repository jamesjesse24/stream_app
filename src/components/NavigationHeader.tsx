'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Flame, Search, Home } from 'lucide-react';

interface NavigationHeaderProps {
  title?: string;
  showBackButton?: boolean;
  showSearchButton?: boolean;
}

export function NavigationHeader({ title = 'UHD Movies', showBackButton = false, showSearchButton = false }: NavigationHeaderProps) {
  const router = useRouter();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-gray-800 bg-gray-950/95 backdrop-blur-md">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            {showBackButton && (
              <Button
                variant="ghost"
                onClick={() => router.back()}
                className="text-white hover:bg-gray-800"
              >
                <Home className="h-4 w-4 mr-2" />
                Back
              </Button>
            )}
            
            <div className="flex items-center space-x-2">
              <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                <Flame className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold gradient-text">{title}</h1>
                <p className="text-sm text-gray-400">Stream in High Quality</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {showSearchButton && (
              <Button
                variant="ghost"
                onClick={() => router.push('/search')}
                className="text-white hover:bg-gray-800"
              >
                <Search className="h-4 w-4 mr-2" />
                Search
              </Button>
            )}
            
            <Button
              variant="ghost"
              onClick={() => router.push('/')}
              className="text-white hover:bg-gray-800"
            >
              <Home className="h-4 w-4 mr-2" />
              Home
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
