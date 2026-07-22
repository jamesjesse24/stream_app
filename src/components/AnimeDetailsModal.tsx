'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Play, ExternalLink, Loader2, Copy } from 'lucide-react';
import { Anime, AnimeDetails, Episode, VideoLink } from '@/types';
import { formatTitle } from '@/lib/utils';
import UHDMoviesAPI from '@/lib/api';

interface AnimeDetailsModalProps {
  anime: Anime | null;
  isOpen: boolean;
  onClose: () => void;
  onPlayVideo: (videoLink: VideoLink) => void;
}

export function AnimeDetailsModal({ anime, isOpen, onClose, onPlayVideo }: AnimeDetailsModalProps) {
  const [details, setDetails] = useState<AnimeDetails | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [videoLinks, setVideoLinks] = useState<VideoLink[]>([]);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  const api = new UHDMoviesAPI();
  const videoLinksAbortController = useRef<AbortController | null>(null);
  const currentEpisodeRef = useRef<Episode | null>(null);

  useEffect(() => {
    if (anime && isOpen) {
      fetchAnimeDetails(anime.url);
    } else {
      // Cancel any ongoing video links request when modal closes
      if (videoLinksAbortController.current) {
        videoLinksAbortController.current.abort();
        videoLinksAbortController.current = null;
      }
      setVideoLinks([]);
      setSelectedEpisode(null);
      currentEpisodeRef.current = null;
    }
  }, [anime, isOpen]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (videoLinksAbortController.current) {
        videoLinksAbortController.current.abort();
      }
    };
  }, []);

  const fetchAnimeDetails = useCallback(async (url: string) => {
    setLoading(true);
    try {
      const [animeDetails, episodeList] = await Promise.all([
        api.getAnimeDetails(url),
        api.getEpisodeList(url),
      ]);

      setDetails(animeDetails);
      setEpisodes(episodeList);

      if (episodeList.length > 0) {
        handleEpisodeSelect(episodeList[0]);
      }
    } catch (error) {
      console.error('Error fetching anime details:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchVideoLinks = useCallback(async (episode: Episode) => {
    // Cancel any previous request
    if (videoLinksAbortController.current) {
      videoLinksAbortController.current.abort();
    }

    // Create new abort controller for this request
    videoLinksAbortController.current = new AbortController();
    const signal = videoLinksAbortController.current.signal;

    // Update current episode reference
    currentEpisodeRef.current = episode;

    setLoadingVideos(true);
    try {
      const links = await api.getVideoLinks(episode);
      
      // Check if this request is still current (hasn't been cancelled)
      if (!signal.aborted && currentEpisodeRef.current?.url === episode.url) {
        setVideoLinks(links);
      }
    } catch (error) {
      // Only log error if request wasn't cancelled
      if (!signal.aborted) {
        console.error('Error fetching video links:', error);
        setVideoLinks([]);
      }
    } finally {
      // Only update loading state if request wasn't cancelled
      if (!signal.aborted && currentEpisodeRef.current?.url === episode.url) {
        setLoadingVideos(false);
      }
    }
  }, []);

  const handleEpisodeSelect = (episode: Episode) => {
    // Prevent duplicate requests for the same episode
    if (selectedEpisode?.url !== episode.url) {
      setSelectedEpisode(episode);
      setVideoLinks([]);
      fetchVideoLinks(episode);
    }
  };

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(url);
      setTimeout(() => setCopiedLink(null), 2000);
    } catch (error) {
      console.error('Failed to copy link:', error);
    }
  };

  if (!anime) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-gray-900 border-gray-800">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-white">
            {formatTitle(anime.title)}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row gap-6">
              <img
                src={anime.thumbnailUrl || '/placeholder-anime.jpg'}
                alt={anime.title}
                className="w-full md:w-64 h-80 object-cover rounded-lg"
              />
              <div className="flex-1 space-y-4">
                <h3 className="text-lg font-semibold text-white">Description</h3>
                <p className="text-gray-300 text-sm leading-relaxed">
                  {details?.description || 'No description available.'}
                </p>
                <Badge className="bg-blue-600 text-white">
                  {details?.status || 'Unknown'}
                </Badge>
              </div>
            </div>

            {episodes.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-white mb-2">Episodes</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-60 overflow-y-auto">
                  {episodes.map((episode) => (
                    <Button
                      key={episode.url}
                      variant={selectedEpisode?.url === episode.url ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleEpisodeSelect(episode)}
                      className="justify-start text-left h-auto p-3"
                    >
                      {formatTitle(episode.name)}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {selectedEpisode && (
              <div>
                <h3 className="text-lg font-semibold text-white mb-2">Video Links</h3>
                {loadingVideos ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                  </div>
                ) : videoLinks.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-y-auto">
                    {videoLinks.map((videoLink, index) => (
                      <Card key={index} className="bg-gray-800 border-gray-700">
                        <CardContent className="p-4 flex justify-between items-center">
                          <span className="text-white font-medium">{videoLink.quality}</span>
                          <div className="flex items-center gap-2">
                            <Button size="sm" onClick={() => onPlayVideo(videoLink)} className="bg-green-600 hover:bg-green-700">
                              <Play className="h-4 w-4" />
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline" 
                              onClick={() => handleCopyLink(videoLink.url)}
                              className={copiedLink === videoLink.url ? "bg-green-600 text-white" : ""}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => window.open(videoLink.url, '_blank')}>
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-center py-8">No video links available.</p>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
