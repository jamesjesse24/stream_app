import { NextRequest, NextResponse } from 'next/server';
import { getUHDMoviesInstance } from '../../../lib/uhdmovies-wrapper';

export const runtime = 'nodejs';

let uhdMoviesPromise: ReturnType<typeof getUHDMoviesInstance> | undefined;

function getUHDMovies() {
  uhdMoviesPromise ??= getUHDMoviesInstance();
  return uhdMoviesPromise;
}

function getPage(searchParams: URLSearchParams) {
  const page = Number.parseInt(searchParams.get('page') || '1', 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const page = getPage(searchParams);

  try {
    const uhdMovies = await getUHDMovies();

    switch (action) {
      case 'popular': {
        const result = await uhdMovies.getPopularAnime(page);
        return NextResponse.json({
          animeList: result.animeList,
          hasNextPage: result.hasNextPage,
          currentPage: page,
          totalPages: page + (result.hasNextPage ? 10 : 0),
        });
      }

      case 'search': {
        const query = searchParams.get('query') || '';
        const result = await uhdMovies.searchAnime(page, query);
        return NextResponse.json({
          animeList: result.animeList,
          hasNextPage: result.hasNextPage,
          currentPage: page,
          totalPages: page + (result.hasNextPage ? 10 : 0),
        });
      }

      case 'details': {
        const url = searchParams.get('url');
        if (!url) {
          return NextResponse.json({ error: 'URL required' }, { status: 400 });
        }

        return NextResponse.json(await uhdMovies.getAnimeDetails(url));
      }

      case 'episodes': {
        const url = searchParams.get('url');
        if (!url) {
          return NextResponse.json({ error: 'URL required' }, { status: 400 });
        }

        return NextResponse.json(await uhdMovies.getEpisodeList(url));
      }

      case 'videos': {
        const episodeData = searchParams.get('episode');
        if (!episodeData) {
          return NextResponse.json(
            { error: 'Episode data required' },
            { status: 400 },
          );
        }

        let episode: unknown;
        try {
          episode = JSON.parse(episodeData);
        } catch {
          return NextResponse.json(
            { error: 'Episode data must be valid JSON' },
            { status: 400 },
          );
        }

        return NextResponse.json(await uhdMovies.getVideoList(episode));
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('UHDMovies API error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 },
    );
  }
}

export async function POST() {
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405 },
  );
}
