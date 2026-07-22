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

// Get popular anime
const popular = await extension.getPopularAnime(1);

// Search for anime
const searchResults = await extension.searchAnime(1, "action movies");

// Get anime details
const details = await extension.getAnimeDetails(animeUrl);

// Get episode list
const episodes = await extension.getEpisodeList(animeUrl);

// Get video links
const videos = await extension.getVideoList(episode);
```

## Configuration

You can configure the extension using environment variables:

- `UHD_DOMAIN`: Base domain (default: https://uhdmovies.vip)
- `UHD_QUALITY`: Preferred quality (default: 1080p)
- `UHD_SIZE_SORT`: Size sorting (asc/desc, default: asc)

Or by updating preferences programmatically:

```javascript
extension.updatePreferences({
  domain: "https://new-domain.com",
  quality: "720p",
  sizeSort: "desc"
});
```

## Dependencies

- `axios`: HTTP client
- `cheerio`: HTML parsing
- `tough-cookie`: Cookie management
- `form-data`: Multipart form handling

## Error Handling

The extension includes comprehensive error handling:

- Network timeouts and retries
- Invalid URL handling
- Missing content graceful degradation
- Cookie management errors

## API Reference

### Main Methods

- `getPopularAnime(page)`: Get popular anime list
- `searchAnime(page, query)`: Search for anime
- `getAnimeDetails(url)`: Get detailed anime information
- `getEpisodeList(url)`: Get episode list for an anime
- `getVideoList(episode)`: Get video links for an episode

### Configuration Methods

- `updatePreferences(prefs)`: Update extension preferences
- `getCurrentBaseUrl()`: Get current base URL (handles redirects)

## License

MIT License - Converted from original Kotlin implementation