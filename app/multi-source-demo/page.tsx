'use client';

import React, { useState } from 'react';
import MultiSourceBrowser from '../../src/components/MultiSourceBrowser';
import { Card, CardContent, CardHeader, CardTitle } from '../../src/components/ui/card';
import { Button } from '../../src/components/ui/button';
import { Input } from '../../src/components/ui/input';

export default function MultiSourceDemo() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'popular' | 'search'>('popular');

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-6xl mx-auto">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-3xl font-bold text-center">
              Multi-Source Anime Browser
            </CardTitle>
            <p className="text-center text-gray-600">
              Browse anime content from multiple sources including UHDMovies and SupJAV
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center space-x-4 mb-6">
              <Button
                variant={activeTab === 'popular' ? 'default' : 'outline'}
                onClick={() => setActiveTab('popular')}
              >
                Popular Content
              </Button>
              <Button
                variant={activeTab === 'search' ? 'default' : 'outline'}
                onClick={() => setActiveTab('search')}
              >
                Search
              </Button>
            </div>

            {activeTab === 'search' && (
              <div className="flex gap-2 mb-6">
                <Input
                  type="text"
                  placeholder="Enter search query..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1"
                />
              </div>
            )}
          </CardContent>
        </Card>

        <MultiSourceBrowser
          query={searchQuery}
          action={activeTab}
        />

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>API Usage Examples</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold mb-2">SupJAV API Endpoints:</h3>
                <div className="bg-gray-100 p-3 rounded text-sm font-mono space-y-1">
                  <div>GET /api/supjav?action=popular&lang=en&page=1</div>
                  <div>GET /api/supjav?action=search&query=example&lang=ja</div>
                  <div>GET /api/supjav?action=details&url=...</div>
                  <div>GET /api/supjav?action=episodes&url=...</div>
                  <div>GET /api/supjav?action=videos&url=...</div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">Multi-Source API Endpoints:</h3>
                <div className="bg-gray-100 p-3 rounded text-sm font-mono space-y-1">
                  <div>GET /api/multi-source?action=popular-all&page=1</div>
                  <div>GET /api/multi-source?action=search-all&query=example</div>
                  <div>GET /api/multi-source?action=popular&source=supjav&lang=ja</div>
                  <div>GET /api/multi-source?action=sources</div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">Enhanced Anime API (with source parameter):</h3>
                <div className="bg-gray-100 p-3 rounded text-sm font-mono space-y-1">
                  <div>GET /api/anime?action=popular&source=uhdmovies</div>
                  <div>GET /api/anime?action=search&source=supjav&lang=en&query=example</div>
                  <div>GET /api/anime?action=sources</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Supported Sources</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold mb-2">UHDMovies</h3>
                <ul className="space-y-1 text-sm text-gray-600">
                  <li>• Base URL: https://uhdmovies.email</li>
                  <li>• Type: Movie/Anime Site</li>
                  <li>• Languages: English</li>
                  <li>• Qualities: 2160p, 1080p, 720p, 480p</li>
                </ul>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">SupJAV</h3>
                <ul className="space-y-1 text-sm text-gray-600">
                  <li>• Base URL: https://supjav.com</li>
                  <li>• Type: JAV Site</li>
                  <li>• Languages: English, Japanese, Chinese</li>
                  <li>• Qualities: 1080p, 720p, 480p, 360p</li>
                  <li>• Supported Players: StreamTape, Voe, StreamWish, TV</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
