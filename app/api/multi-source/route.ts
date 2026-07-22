import { NextRequest, NextResponse } from 'next/server';
import SourceManager from '../../../lib/source-manager';

const sourceManager = new SourceManager();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const source = searchParams.get('source') || 'supjav';
  const lang = searchParams.get('lang') || 'en';
  const page = parseInt(searchParams.get('page') || '1');
  const query = searchParams.get('query') || '';

  // Construct source key
  const sourceKey = lang === 'en' ? source : `${source}-${lang}`;

  try {
    switch (action) {
      case 'popular':
        const popularResult = await sourceManager.executeOnSource(
          sourceKey,
          'getPopularAnime',
          page
        ) as any;
        return NextResponse.json({
          source: sourceManager.getSourceInfo(sourceKey),
          animeList: popularResult.animeList || [],
          hasNextPage: popularResult.hasNextPage || false,
          currentPage: page,
          totalPages: page + (popularResult.hasNextPage ? 10 : 0)
        });

      case 'search':
        const searchResult = await sourceManager.executeOnSource(
          sourceKey,
          'searchAnime',
          query,
          page
        ) as any;
        return NextResponse.json({
          source: sourceManager.getSourceInfo(sourceKey),
          animeList: searchResult.animeList || [],
          hasNextPage: searchResult.hasNextPage || false,
          currentPage: page,
          totalPages: page + (searchResult.hasNextPage ? 10 : 0)
        });

      case 'details':
        const url = searchParams.get('url');
        if (!url) {
          return NextResponse.json({ error: 'URL required' }, { status: 400 });
        }
        const details = await sourceManager.executeOnSource(
          sourceKey,
          'getAnimeDetails',
          url
        );
        return NextResponse.json({
          source: sourceManager.getSourceInfo(sourceKey),
          details
        });

      case 'episodes':
        const animeUrl = searchParams.get('url');
        if (!animeUrl) {
          return NextResponse.json({ error: 'URL required' }, { status: 400 });
        }
        const episodes = await sourceManager.executeOnSource(
          sourceKey,
          'getEpisodeList',
          animeUrl
        );
        return NextResponse.json({
          source: sourceManager.getSourceInfo(sourceKey),
          episodes
        });

      case 'videos':
        const episodeUrl = searchParams.get('url');
        if (!episodeUrl) {
          return NextResponse.json({ error: 'Episode URL required' }, { status: 400 });
        }
        const videos = await sourceManager.executeOnSource(
          sourceKey,
          'getVideoList',
          episodeUrl
        );
        return NextResponse.json({
          source: sourceManager.getSourceInfo(sourceKey),
          videos
        });

      case 'sources':
        const availableSources = sourceManager.getAvailableSources().map(key => ({
          key,
          ...sourceManager.getSourceInfo(key)
        }));
        return NextResponse.json({ sources: availableSources });

      case 'search-all':
        const excludeSourcesParam = searchParams.get('exclude');
        const excludeSources = excludeSourcesParam ? excludeSourcesParam.split(',') : [];
        const allSearchResults = await sourceManager.searchAllSources(query, page, excludeSources);
        return NextResponse.json(allSearchResults);

      case 'popular-all':
        const excludePopularParam = searchParams.get('exclude');
        const excludePopular = excludePopularParam ? excludePopularParam.split(',') : [];
        const allPopularResults = await sourceManager.getPopularFromAllSources(page, excludePopular);
        return NextResponse.json(allPopularResults);

      default:
        return NextResponse.json({ error: 'Invalid action. Supported actions: popular, search, details, episodes, videos, sources, search-all, popular-all' }, { status: 400 });
    }
  } catch (error) {
    console.error('Multi-source API Error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error',
      details: error instanceof Error ? error.stack : 'Unknown error'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405 }
  );
}
