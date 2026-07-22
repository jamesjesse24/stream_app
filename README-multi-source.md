# Multi-Source Anime Streaming Platform

A comprehensive Next.js application that aggregates anime content from multiple sources including UHDMovies and SupJAV. This project provides a unified API and web interface for browsing, searching, and streaming anime content.

## 🌟 Features

### Multi-Source Support
- **UHDMovies**: High-quality movie and anime content
- **SupJAV**: Japanese Adult Video content with multiple language support
- **Dynamic Source Management**: Easy to add new sources

### Supported Sources

#### UHDMovies
- Base URL: https://uhdmovies.email
- Type: Movie/Anime Site
- Languages: English
- Qualities: 2160p, 1080p, 720p, 480p

#### SupJAV
- Base URL: https://supjav.com
- Type: JAV Site
- Languages: English, Japanese, Chinese
- Qualities: 1080p, 720p, 480p, 360p
- Supported Video Hosts: StreamTape, Voe, StreamWish, TV Player

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Installation

1. Clone the repository
```bash
git clone <repository-url>
cd files
```

2. Install dependencies
```bash
npm install
```

3. Set up environment variables (optional)
```bash
# .env.local
UHD_DOMAIN=https://uhdmovies.email
UHD_QUALITY=1080p
UHD_SIZE_SORT=asc
ANIME_SOURCE=uhdmovies
BACKEND_URL=http://localhost:3001
```

4. Start the development server
```bash
npm run dev
```

5. Start the backend server (in another terminal)
```bash
npm run backend
```

6. Open [http://localhost:3000](http://localhost:3000) in your browser

## 📖 API Documentation

### Multi-Source API (`/api/multi-source`)

#### Get Popular Content from All Sources
```
GET /api/multi-source?action=popular-all&page=1&exclude=source1,source2
```

#### Search All Sources
```
GET /api/multi-source?action=search-all&query=example&page=1&exclude=source1
```

#### Get Content from Specific Source
```
GET /api/multi-source?action=popular&source=supjav&lang=en&page=1
GET /api/multi-source?action=search&source=supjav&lang=ja&query=example
```

#### Get Available Sources
```
GET /api/multi-source?action=sources
```

### SupJAV Specific API (`/api/supjav`)

#### Popular Content
```
GET /api/supjav?action=popular&lang=en&page=1
```

#### Search
```
GET /api/supjav?action=search&query=example&lang=ja&page=1
```

#### Get Details
```
GET /api/supjav?action=details&url=<anime-url>
```

#### Get Episodes
```
GET /api/supjav?action=episodes&url=<anime-url>
```

#### Get Video Sources
```
GET /api/supjav?action=videos&url=<episode-url>
```

#### Get Source Info
```
GET /api/supjav?action=info
```

### Enhanced Anime API (`/api/anime`)

The original anime API now supports source selection:

```
GET /api/anime?action=popular&source=uhdmovies&page=1
GET /api/anime?action=search&source=supjav&lang=en&query=example
GET /api/anime?action=sources
```

## 🔧 Configuration

### Adding New Sources

1. Create a wrapper class implementing the `AnimeSource` interface:

```typescript
class NewSource implements AnimeSource {
  name = "New Source";
  
  async getPopularAnime(page: number) { /* implementation */ }
  async searchAnime(query: string, page: number) { /* implementation */ }
  async getAnimeDetails(url: string) { /* implementation */ }
  async getEpisodeList(animeUrl: string) { /* implementation */ }
  async getVideoList(episodeUrl: string) { /* implementation */ }
}
```

2. Update the configuration in `src/config.js`:

```javascript
sources: {
  newsource: {
    name: "New Source",
    baseUrl: "https://newsource.com",
    supportedQualities: ["1080p", "720p"],
    supportedLanguages: ["en"],
    type: "anime_site"
  }
}
```

3. Register the source in `SourceManager`:

```typescript
this.sources.set('newsource', new NewSource());
```

## 🏗️ Architecture

### Project Structure
```
├── app/                          # Next.js App Router
│   ├── api/                      # API Routes
│   │   ├── anime/               # Original anime API
│   │   ├── supjav/              # SupJAV specific API
│   │   └── multi-source/        # Multi-source aggregation API
│   ├── multi-source-demo/       # Demo page
│   └── ...
├── lib/                          # Shared libraries
│   ├── supjav-wrapper.ts        # SupJAV implementation
│   ├── source-manager.ts        # Multi-source management
│   └── uhdmovies-wrapper.ts     # UHDMovies wrapper
├── src/                          # Source code
│   ├── components/              # React components
│   │   ├── MultiSourceBrowser.tsx  # Multi-source browser component
│   │   └── ui/                  # UI components
│   ├── config.js                # Configuration
│   └── backend.js               # Backend logic
└── ...
```

### Key Components

#### SourceManager
Manages multiple anime sources and provides unified access:
- Dynamic source registration
- Parallel source execution
- Error handling and fallbacks

#### SupJavWrapper
Implements SupJAV functionality:
- Multi-language support
- Video extraction from multiple hosts
- HLS playlist parsing

#### MultiSourceBrowser
React component for browsing multiple sources:
- Source selection interface
- Parallel result display
- Error handling

## 🎮 Demo

Visit `/multi-source-demo` to see the multi-source functionality in action:
- Browse popular content from all sources
- Search across multiple sources
- Toggle source selection
- View results from different content types

## 🔒 Video Extraction

The SupJAV wrapper supports video extraction from:
- **StreamTape**: Direct video URL extraction
- **Voe**: HLS stream extraction
- **StreamWish**: Direct video URL extraction  
- **TV Player**: HLS playlist parsing

## 🌐 Internationalization

SupJAV supports multiple languages:
- English (`en`)
- Japanese (`ja`) 
- Chinese (`zh`)

Language is specified via the `lang` parameter in API calls.

## 🚦 Error Handling

The system includes comprehensive error handling:
- Source-specific error isolation
- Graceful degradation when sources fail
- Detailed error reporting in API responses
- Fallback mechanisms for missing sources

## 📱 Frontend Integration

Use the MultiSourceBrowser component:

```tsx
import MultiSourceBrowser from '../src/components/MultiSourceBrowser';

<MultiSourceBrowser 
  query="search term"
  action="search" // or "popular"
/>
```

## 🔄 Development Workflow

1. **Add new source**: Create wrapper implementing AnimeSource interface
2. **Update config**: Add source configuration
3. **Register source**: Add to SourceManager
4. **Test API**: Use `/api/multi-source?action=sources` to verify
5. **Update frontend**: Modify components as needed

## 📋 TODO / Roadmap

- [ ] Add more video hosting providers
- [ ] Implement caching for better performance
- [ ] Add rate limiting to prevent abuse
- [ ] Create admin interface for source management
- [ ] Add source health monitoring
- [ ] Implement user preferences for source selection
- [ ] Add subtitle support
- [ ] Create mobile app integration

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Implement your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## ⚠️ Disclaimer

This software is for educational purposes only. Users are responsible for complying with applicable laws and website terms of service. The developers do not endorse or encourage the use of this software for any illegal activities.

## 🔗 Related Projects

- [Aniyomi Extensions](https://github.com/aniyomiorg/aniyomi-extensions) - Original SupJAV implementation
- [Next.js](https://nextjs.org/) - React framework
- [Cheerio](https://cheerio.js.org/) - Server-side HTML parsing
