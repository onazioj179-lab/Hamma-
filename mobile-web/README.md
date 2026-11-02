# Singularity Pack Mobile Web

Progressive Web App (PWA) interface for Singularity Pack compression with integrated HAMMA Performance AI.

## Features

- 📱 **Mobile-First Design**: Touch-optimized UI for phones and tablets
- 🧠 **HAMMA AI Integration**: Real-time performance monitoring and learning
- 🚀 **Backend Compression**: Uses Rust backend for actual compression
- 📊 **Live Stats**: Real-time compression metrics and HAMMA insights
- 🔄 **Auto-Refresh**: HAMMA stats update every 10 seconds
- 💯 **Progressive Enhancement**: The interface can be cached offline; compression and extraction require the backend

## Quick Start

### Option 1: Full Stack (Recommended)

From the project root, run:

```bash
scripts\start-mobile-web.bat
```

This starts both the backend (port 3000) and mobile web server (port 8080).

### Option 2: Manual Start

First, from the repository root, run `npm install` and
`npm run build:mobile-web` to generate the local ZIP extraction asset.

**Terminal 1 - Backend:**
```bash
cargo build --release -p spk-backend
target/release/spk-server.exe
```

**Terminal 2 - Mobile Web:**
```bash
cd mobile-web
python serve.py
```

Then open: http://localhost:8080

## Mobile Access

To access from your phone on the same network:

1. Find your PC's IP address: `ipconfig` (Windows) or `ifconfig` (Mac/Linux)
2. Open on mobile: `http://<your-ip>:8080`
3. Add to home screen for PWA experience

## HAMMA Integration

The mobile web app connects to the backend's HAMMA Performance AI system:

### API Endpoints Used

- `GET /api/compress` - Compress files, HAMMA learns from data
- `GET /api/hamma/stats` - Fetch current HAMMA statistics
- `GET /api/hamma/config` - Fetch HAMMA configuration

### How It Works

1. **User uploads file** → Mobile web sends to backend `/api/compress`
2. **Backend processes** → EnhancedPipeline with HAMMA gating/recording
3. **HAMMA learns** → Builds performance models from real compression data
4. **Stats displayed** → Mobile web fetches `/api/hamma/stats` every 10s
5. **Real-time updates** → User sees contexts, samples, speed, gain metrics

### HAMMA Metrics Shown

- **Contexts**: Number of unique file patterns learned
- **Samples**: Total observations recorded
- **Avg Speed**: Mean compression throughput (MB/s)
- **Avg Gain**: Mean compression ratio achieved

## Architecture

```
┌──────────────────┐
│   Mobile Web     │  Port 8080 (Python HTTP server)
│   (HTML/JS/CSS)  │  
└────────┬─────────┘
         │ HTTP API calls
         ↓
┌──────────────────┐
│  Backend Server  │  Port 3000 (Rust/Axum)
│  spk-backend     │  
└────────┬─────────┘
         │ Uses
         ↓
┌──────────────────┐
│   spk-core       │  Rust library
│ EnhancedPipeline │  
│   + HAMMA        │
└──────────────────┘
```

## Development

### File Structure

```
mobile-web/
├── index.html          # Main PWA interface (HAMMA integrated)
├── manifest.json       # PWA manifest
├── sw.js              # Service worker (offline support)
├── serve.py           # Python HTTP server with CORS
├── serve.bat          # Windows launcher
└── README.md          # This file
```

### Updating HAMMA UI

HAMMA stats are fetched in `index.html` via the `fetchHammaStats()` function:

```javascript
async function fetchHammaStats() {
    const response = await fetch('http://localhost:3000/api/hamma/stats');
    const stats = await response.json();
    // Update UI elements
}
```

Called automatically:
- After every compression
- Every 10 seconds via `setInterval`

### Testing

1. **Backend test**: `curl http://localhost:3000/api/health`
2. **HAMMA stats**: `curl http://localhost:3000/api/hamma/stats`
3. **Mobile web**: Open http://localhost:8080 in browser
4. **PWA test**: Open on mobile, add to home screen

## Troubleshooting

### HAMMA shows "not initialized"

- Compress at least one file to initialize the pipeline
- Backend must be running on port 3000
- Check backend logs for errors

### Mobile can't connect

- Ensure firewall allows port 3000 (backend) and 8080 (web)
- Both devices must be on same network
- Use PC's local IP, not `localhost`

### Compression fails

- Check backend is running: http://localhost:3000/api/health
- Look for CORS errors in browser console
- Verify file size isn't too large

## Production Deployment

For production, replace the Python server with a proper web server:

**Nginx example:**
```nginx
server {
    listen 8080;
    root /path/to/mobile-web;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }
}
```

## Next Steps

- [ ] Add WebSocket support for real-time HAMMA updates
- [ ] Implement backend extraction endpoint
- [ ] Add file queue for batch compression
- [ ] Offline compression using WASM
- [ ] Push notifications for completed jobs

---

**Version**: v23.0.0  
**Last Updated**: 2024  
**License**: MIT
