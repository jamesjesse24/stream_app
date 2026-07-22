'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { NavigationHeader } from '@/components/NavigationHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Play, ExternalLink, Loader2, Copy, CheckCircle, XCircle, Clock, HardDriveDownload } from 'lucide-react';
import { AnimeDetails, Episode, VideoLink } from '@/types';
import { formatTitle } from '@/lib/utils';
import UHDMoviesAPI from '@/lib/api';
import toast from 'react-hot-toast';
import { formatMediaBytes } from '@/lib/media-info';

export default function AnimeDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const [anime, setAnime] = useState<any>(null); // Store original anime data
  const [details, setDetails] = useState<AnimeDetails | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [videoLinks, setVideoLinks] = useState<VideoLink[]>([]);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  const api = new UHDMoviesAPI();

  const fetchAnimeDetails = useCallback(async (url: string) => {
    setLoading(true);
    try {
      // First, try to get the anime from the URL if it contains anime data
      // This is a workaround since we need the thumbnail from the original anime list
      const searchParams = new URLSearchParams(window.location.search);
      const animeData = searchParams.get('anime');
      
      if (animeData) {
        try {
          const parsedAnime = JSON.parse(decodeURIComponent(animeData));
          console.log('Parsed anime data:', parsedAnime);
          setAnime(parsedAnime);
        } catch (e) {
          console.log('No anime data in URL params');
        }
      }

      const [animeDetails, episodeList] = await Promise.all([
        api.getAnimeDetails(url),
        api.getEpisodeList(url),
      ]);

      setDetails(animeDetails);
      setEpisodes(episodeList);

      // If we don't have anime data but have details, try to find the anime from search
      if (!animeData && animeDetails) {
        try {
          const searchResult = await api.searchAnime(1, animeDetails.title);
          const foundAnime = searchResult.animeList.find(a => a.url === url);
          if (foundAnime) {
            console.log('Found anime from search:', foundAnime);
            setAnime(foundAnime);
          }
        } catch (e) {
          console.log('Could not find anime from search');
        }
      }

      if (episodeList.length > 0) {
        setSelectedEpisode(episodeList[0]);
        fetchVideoLinks(episodeList[0]);
      }
    } catch (error) {
      console.error('Error fetching anime details:', error);
      toast.error('Failed to load anime details');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (params.slug) {
      const decodedUrl = decodeURIComponent(params.slug as string);
      fetchAnimeDetails(decodedUrl);
    }
  }, [params.slug, fetchAnimeDetails]);

  const fetchVideoLinks = async (episode: Episode) => {
    setLoadingVideos(true);
    try {
      const links = await api.getVideoLinks(episode);
      // Initialize links with checking status
      const linksWithStatus = links.map(link => ({
        ...link,
        status: 'checking' as const,
        statusChecked: false
      }));
      setVideoLinks(linksWithStatus);
      
      // Link availability is checked separately. File size comes from the
      // source page metadata collected while resolving the video links, so no
      // extra HEAD/range request competes with playback.
      void checkLinkStatuses(linksWithStatus);
    } catch (error) {
      console.error('Error fetching video links:', error);
      setVideoLinks([]);
      toast.error('Failed to load video links');
    } finally {
      setLoadingVideos(false);
    }
  };

  const checkLinkStatuses = async (links: VideoLink[]) => {
    for (const link of links) {
      let status: VideoLink['status'] = 'unknown';
      try {
        const response = await fetch('/api/check-link', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url: link.url }),
        });
        const result = await response.json();
        status = result.status;
      } catch {
        status = 'unknown';
      }

      setVideoLinks((current) =>
        current.map((item) =>
          item.url === link.url
            ? { ...item, status, statusChecked: true }
            : item,
        ),
      );
    }
  };


  const handleEpisodeSelect = (episode: Episode) => {
    if (selectedEpisode?.url !== episode.url) {
      setSelectedEpisode(episode);
      setVideoLinks([]);
      fetchVideoLinks(episode);
    }
  };

  const handlePlayVideo = (videoLink: VideoLink) => {
    if (selectedEpisode) {
      // Create a simpler episode identifier based on episode number
      const episodeId = selectedEpisode.episodeNumber || 1;
      const videoId = encodeURIComponent(videoLink.url);
      try {
        sessionStorage.setItem(
          `uhd-player-sources:${String(params.slug)}:${episodeId}`,
          JSON.stringify(videoLinks),
        );
      } catch {
        // The selected link still works when session storage is unavailable.
      }
      router.push(
        `/anime/${params.slug}/episode/${episodeId}/watch?video=${videoId}&quality=${encodeURIComponent(videoLink.quality)}`,
      );
    }
  };

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(url);
      toast.success('Link copied to clipboard');
      setTimeout(() => setCopiedLink(null), 2000);
    } catch (error) {
      console.error('Failed to copy link:', error);
      toast.error('Failed to copy link');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        </div>
      </div>
    );
  }

  if (!details) {
    return (
      <div className="min-h-screen bg-gray-950">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center py-24">
            <h1 className="text-2xl font-bold text-white mb-4">Anime Not Found</h1>
            <Button onClick={() => router.push('/')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Home
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <NavigationHeader 
        title={details ? formatTitle(details.title) : 'Anime Details'}
        showBackButton={true}
        showSearchButton={true}
      />
      
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center mb-8">
          <h1 className="text-3xl font-bold text-white">
            {formatTitle(details.title)}
          </h1>
        </div>

        {/* Main Content */}
        <div className="space-y-8">
          {/* Anime Info */}
          <div className="flex flex-col lg:flex-row gap-8">
            <div className="lg:w-1/3">
              <div className="aspect-[3/4] bg-gray-800 rounded-lg overflow-hidden">
                <img
                  src={anime?.thumbnailUrl || details?.thumbnailUrl || '/placeholder-anime.svg'}
                  alt={details.title}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    console.log('Image load error, using placeholder');
                    (e.target as HTMLImageElement).src = '/placeholder-anime.svg';
                  }}
                  onLoad={() => {
                    console.log('Image loaded successfully:', anime?.thumbnailUrl || details?.thumbnailUrl);
                  }}
                />
              </div>
            </div>
            <div className="lg:w-2/3 space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-white mb-4">Description</h2>
                <p className="text-gray-300 leading-relaxed">
                  {details.description || 'No description available.'}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <Badge className="bg-blue-600 text-white">
                  {details.status || 'Unknown'}
                </Badge>
                <Badge variant="outline" className="text-gray-300">
                  {episodes.length} Episodes
                </Badge>
              </div>
            </div>
          </div>

          {/* Episodes */}
          {episodes.length > 0 && (
            <div>
              <h2 className="text-2xl font-bold text-white mb-6">Episodes</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {episodes.map((episode) => (
                  <Button
                    key={episode.url}
                    variant={selectedEpisode?.url === episode.url ? 'default' : 'outline'}
                    size="lg"
                    onClick={() => handleEpisodeSelect(episode)}
                    className="justify-start text-left h-auto p-4"
                  >
                    <div className="w-full">
                      <div className="font-semibold">{formatTitle(episode.name)}</div>
                      <div className="text-sm opacity-70">Episode {episode.episodeNumber}</div>
                    </div>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Video Links */}
          {selectedEpisode && (
            <div>
              <h2 className="text-2xl font-bold text-white mb-6">
                Watch {formatTitle(selectedEpisode.name)}
              </h2>
              {loadingVideos ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                </div>
              ) : videoLinks.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {videoLinks.map((videoLink, index) => (
                    <Card key={index} className="bg-gray-800 border-gray-700">
                      <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-white font-semibold text-lg">{videoLink.quality}</h3>
                          <div className="flex items-center gap-2">
                            {videoLink.status === 'checking' && (
                              <div className="flex items-center gap-1 text-yellow-400">
                                <Clock className="h-4 w-4 animate-pulse" />
                                <span className="text-xs">Checking...</span>
                              </div>
                            )}
                            {videoLink.status === 'live' && (
                              <div className="flex items-center gap-1 text-green-400">
                                <CheckCircle className="h-4 w-4" />
                                <span className="text-xs">Live</span>
                              </div>
                            )}
                            {videoLink.status === 'dead' && (
                              <div className="flex items-center gap-1 text-red-400">
                                <XCircle className="h-4 w-4" />
                                <span className="text-xs">Dead</span>
                              </div>
                            )}
                            {videoLink.status === 'unknown' && (
                              <div className="flex items-center gap-1 text-gray-400">
                                <Clock className="h-4 w-4" />
                                <span className="text-xs">Unknown</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="mb-4 flex items-center gap-2 rounded-lg border border-white/10 bg-gray-950/45 px-3 py-2 text-sm text-gray-300">
                          <HardDriveDownload className="h-4 w-4 shrink-0 text-blue-400" />
                          <span className="text-gray-400">File size:</span>
                          <span className="font-semibold text-white">
                            {videoLink.fileSizeBytes
                              ? `${videoLink.fileSizeEstimated ? '~' : ''}${formatMediaBytes(videoLink.fileSizeBytes)}`
                              : videoLink.isHls
                                ? 'Estimated during playback'
                                : 'Not listed by server'}
                          </span>
                          {videoLink.fileSizeEstimated && (
                            <span className="text-xs text-gray-500">estimated</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button 
                            onClick={() => handlePlayVideo(videoLink)} 
                            className="bg-green-600 hover:bg-green-700 flex-1"
                            disabled={videoLink.status === 'dead'}
                          >
                            <Play className="h-4 w-4 mr-2" />
                            Play
                          </Button>
                          <Button 
                            variant="outline" 
                            onClick={() => handleCopyLink(videoLink.url)}
                            className={copiedLink === videoLink.url ? "bg-green-600 text-white" : ""}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="outline" 
                            onClick={() => window.open(videoLink.url, '_blank')}
                            disabled={videoLink.status === 'dead'}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-gray-400 text-lg">No video links available for this episode.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
