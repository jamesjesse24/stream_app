import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

interface Source {
  key: string;
  name: string;
  baseUrl: string;
  supportedLanguages: string[];
  supportedQualities: string[];
  type: string;
  language?: string;
}

interface AnimeItem {
  title: string;
  thumbnail_url?: string;
  url: string;
  author?: string;
  artist?: string;
  genre?: string[];
  status: string;
}

interface SourceResult {
  source: Source;
  animeList: AnimeItem[];
  hasNextPage: boolean;
  error?: string;
}

interface MultiSourceBrowserProps {
  query?: string;
  action?: 'popular' | 'search';
}

export function MultiSourceBrowser({ query = '', action = 'popular' }: MultiSourceBrowserProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [results, setResults] = useState<Record<string, SourceResult>>({});
  const [loading, setLoading] = useState(false);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);

  useEffect(() => {
    fetchAvailableSources();
  }, []);

  const fetchAvailableSources = async () => {
    try {
      const response = await fetch('/api/anime?action=sources');
      const data = await response.json();
      setSources(data.sources || []);
      setSelectedSources(data.sources?.map((s: Source) => s.key) || []);
    } catch (error) {
      console.error('Error fetching sources:', error);
    }
  };

  const fetchFromAllSources = async () => {
    setLoading(true);
    setResults({});

    try {
      const excludeSources = sources
        .filter(s => !selectedSources.includes(s.key))
        .map(s => s.key);

      const endpoint = action === 'search' 
        ? `/api/multi-source?action=search-all&query=${encodeURIComponent(query)}&exclude=${excludeSources.join(',')}`
        : `/api/multi-source?action=popular-all&exclude=${excludeSources.join(',')}`;

      const response = await fetch(endpoint);
      const data = await response.json();
      setResults(data);
    } catch (error) {
      console.error('Error fetching from sources:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleSource = (sourceKey: string) => {
    setSelectedSources(prev => 
      prev.includes(sourceKey) 
        ? prev.filter(s => s !== sourceKey)
        : [...prev, sourceKey]
    );
  };

  const getSourceTypeColor = (type: string) => {
    switch (type) {
      case 'movie_site': return 'bg-blue-500';
      case 'jav_site': return 'bg-purple-500';
      default: return 'bg-gray-500';
    }
  };

  const getLanguageDisplay = (lang: string) => {
    const langMap: Record<string, string> = {
      'en': '🇺🇸 English',
      'ja': '🇯🇵 Japanese',
      'zh': '🇨🇳 Chinese'
    };
    return langMap[lang] || lang;
  };

  return (
    <div className="space-y-6">
      {/* Source Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Available Sources</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            {sources.map((source) => (
              <div
                key={source.key}
                className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                  selectedSources.includes(source.key)
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => toggleSource(source.key)}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">{source.name}</h3>
                  <Badge className={`text-white ${getSourceTypeColor(source.type)}`}>
                    {source.type.replace('_', ' ')}
                  </Badge>
                </div>
                <p className="text-sm text-gray-600 mb-1">{source.baseUrl}</p>
                {source.language && (
                  <p className="text-xs text-gray-500">
                    {getLanguageDisplay(source.language)}
                  </p>
                )}
                <div className="flex flex-wrap gap-1 mt-2">
                  {source.supportedQualities?.slice(0, 3).map((quality) => (
                    <Badge key={quality} variant="outline" className="text-xs">
                      {quality}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Button 
            onClick={fetchFromAllSources} 
            disabled={loading || selectedSources.length === 0}
            className="w-full"
          >
            {loading ? 'Fetching...' : `Fetch ${action === 'search' ? 'Search Results' : 'Popular'} from Selected Sources`}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {Object.keys(results).length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold">
            {action === 'search' ? `Search Results for "${query}"` : 'Popular Content'}
          </h2>
          {Object.entries(results).map(([sourceKey, result]) => (
            <Card key={sourceKey}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    {result.source?.name || sourceKey}
                    {result.source?.language && (
                      <Badge variant="outline">
                        {getLanguageDisplay(result.source.language)}
                      </Badge>
                    )}
                  </CardTitle>
                  {result.error ? (
                    <Badge variant="destructive">Error</Badge>
                  ) : (
                    <Badge variant="secondary">
                      {result.animeList?.length || 0} results
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {result.error ? (
                  <p className="text-red-500">{result.error}</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {result.animeList?.slice(0, 8).map((anime, index) => (
                      <div key={index} className="border rounded-lg p-3">
                        {anime.thumbnail_url && (
                          <img
                            src={anime.thumbnail_url}
                            alt={anime.title}
                            className="w-full h-32 object-cover rounded mb-2"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        )}
                        <h4 className="font-medium text-sm mb-1 line-clamp-2">
                          {anime.title}
                        </h4>
                        {anime.author && (
                          <p className="text-xs text-gray-500">
                            Maker: {anime.author}
                          </p>
                        )}
                        {anime.artist && (
                          <p className="text-xs text-gray-500">
                            Cast: {anime.artist}
                          </p>
                        )}
                        {anime.genre && anime.genre.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {anime.genre.slice(0, 2).map((g, i) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {g}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {result.animeList?.length > 8 && (
                  <p className="text-center text-gray-500 mt-4">
                    and {result.animeList.length - 8} more...
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default MultiSourceBrowser;
