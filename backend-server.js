import express from 'express';
import cors from 'cors';

// Use dynamic import for ES6 module
async function startServer() {
  const app = express();
  const port = process.env.PORT || 3001;

  // Import the ES6 module
  const moduleExport = await import('./src/index.js');
  const UHDMovies = moduleExport.default;

  // Initialize UHDMovies instance
  const extension = new UHDMovies();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'UHDMovies API' });
  });

  // Popular anime endpoint
  app.get('/popular', async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const result = await extension.getPopularAnime(page);
      res.json(result);
    } catch (error) {
      console.error('Error fetching popular anime:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Search anime endpoint
  app.get('/search', async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const query = req.query.query || '';
      const result = await extension.searchAnime(page, query);
      res.json(result);
    } catch (error) {
      console.error('Error searching anime:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Anime details endpoint
  app.get('/details', async (req, res) => {
    try {
      const url = req.query.url;
      if (!url) {
        return res.status(400).json({ error: 'URL parameter required' });
      }
      const result = await extension.getAnimeDetails(url);
      res.json(result);
    } catch (error) {
      console.error('Error fetching anime details:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Episodes endpoint
  app.get('/episodes', async (req, res) => {
    try {
      const url = req.query.url;
      if (!url) {
        return res.status(400).json({ error: 'URL parameter required' });
      }
      const result = await extension.getEpisodeList(url);
      res.json(result);
    } catch (error) {
      console.error('Error fetching episodes:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Video links endpoint
  app.get('/videos', async (req, res) => {
    try {
      const episodeData = req.query.episode;
      if (!episodeData) {
        return res.status(400).json({ error: 'Episode data required' });
      }
      const episode = JSON.parse(episodeData);
      const result = await extension.getVideoList(episode);
      res.json(result);
    } catch (error) {
      console.error('Error fetching video links:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Error handling middleware
  app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
  });

  // Start server
  app.listen(port, () => {
    console.log(`UHDMovies API server running on port ${port}`);
    console.log(`Health check: http://localhost:${port}/health`);
  });
}

// Start the server
startServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
