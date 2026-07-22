# UHD Movies Next.js Application

A modern, responsive web application for streaming anime content built with Next.js, TypeScript, and Tailwind CSS.

## Features

- **🎨 Modern Design**: Beautiful dark theme with gradient effects and glass morphism
- **🔍 Advanced Search**: Real-time search with debouncing and pagination
- **📱 Responsive**: Works perfectly on desktop, tablet, and mobile devices
- **🎥 Video Player**: Built-in video player with fullscreen support
- **⚡ Fast Performance**: Server-side rendering and optimized loading
- **🎯 Modal System**: Elegant modals for anime details and video playback
- **📄 Pagination**: Smart pagination with up to 10 items per page
- **🎭 Animations**: Smooth transitions and hover effects

## Tech Stack

- **Frontend**: Next.js 14, React 18, TypeScript
- **Styling**: Tailwind CSS, Radix UI components
- **Backend Integration**: UHD Movies API (existing codebase)
- **Video Player**: React Player with custom controls
- **Icons**: Lucide React
- **Notifications**: React Hot Toast

## Installation

1. Install dependencies:
```bash
npm install
```

2. Run the development server:
```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── src/
│   ├── components/
│   │   ├── ui/           # Reusable UI components
│   │   ├── AnimeGrid.tsx
│   │   ├── AnimeDetailsModal.tsx
│   │   ├── VideoPlayerModal.tsx
│   │   ├── SearchBar.tsx
│   │   └── Pagination.tsx
│   ├── lib/
│   │   ├── api.ts        # API integration
│   │   └── utils.ts      # Utility functions
│   └── types/
│       └── index.ts      # TypeScript interfaces
├── src/ (original backend)
│   ├── index.js
│   ├── config.js
│   ├── redirector-bypasser.js
│   └── utils.js
└── public/               # Static assets
```

## Features Overview

### 🎨 Design System
- **Dark Theme**: Optimized for comfortable viewing
- **Gradient Effects**: Beautiful blue-to-purple gradients
- **Glass Morphism**: Semi-transparent elements with backdrop blur
- **Responsive Grid**: Adaptive layout for different screen sizes

### 🔍 Search & Discovery
- **Real-time Search**: Instant results as you type
- **Popular Content**: Trending anime on homepage
- **Category Filters**: Quick access to action, romance, etc.
- **Pagination**: Navigate through pages of results

### 🎥 Video Experience
- **Modal Player**: Full-featured video player in modal
- **Multiple Sources**: Support for various video qualities
- **Fullscreen Mode**: Immersive viewing experience
- **Custom Controls**: Volume, fullscreen, and playback controls

### 📱 User Experience
- **Loading States**: Smooth loading animations
- **Error Handling**: Graceful error messages
- **Responsive Design**: Works on all devices
- **Keyboard Navigation**: Accessible interaction

## API Integration

The application integrates with the existing UHD Movies backend:

- **Popular Anime**: Fetch trending content
- **Search**: Real-time search functionality
- **Anime Details**: Get detailed information
- **Episodes**: List available episodes
- **Video Links**: Extract streaming URLs

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run backend` - Run the original backend

## Environment Setup

No environment variables required for basic functionality. The application uses the existing UHD Movies API backend.

## Browser Support

- ✅ Chrome (recommended)
- ✅ Firefox
- ✅ Safari
- ✅ Edge

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License.
