# UHD Movies Node.js Extension

A Node.js conversion of the UHD Movies anime extension, originally written in Kotlin for Aniyomi.

## Features

- Fetch popular movies and anime from UHD Movies
- Search functionality
- Extract video links from multiple sources:
  - CloudFlare Workers
  - Google Drive
  - Direct links
- Bypass URL redirectors automatically
- Support for multiple video qualities
- Configurable preferences

## Installation

```bash
npm install
```

## Usage

```javascript
import UHDMovies from './src/index.js';

const extension = new UHDMovies();

const popular = await extension.getPopularAnime(1);
const searchResults = await extension.searchAnime(1, "action movies");
const details = await extension.getAnimeDetails(animeUrl);
const episodes = await extension.getEpisodeList(animeUrl);
const videos = await extension.getVideoList(episode);
```

## Configuration

Environment variables:

- `UHD_DOMAIN`: Base domain
- `UHD_QUALITY`: Preferred quality, such as `1080p`
- `UHD_SIZE_SORT`: Size sorting, `asc` or `desc`

```javascript
extension.updatePreferences({
  domain: "https://new-domain.com",
  quality: "720p",
  sizeSort: "desc"
});
```

## Playback

The Next.js application includes multi-source playback, Google video byte-range proxying, HLS compatibility fallbacks, source file-size information, and selected-server persistence.

## License

MIT License.
