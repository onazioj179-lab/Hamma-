# Network Access Guide

## Dev Server is Always Running on All Devices

The Singularity Pack dev server is configured to be accessible from any device on your local network.

### Quick Start

**Option 1: Using npm**
```bash
npm run dev
```

**Option 2: Using startup scripts**
- Windows: Double-click `start-server.bat`
- PowerShell: Run `.\start-server.ps1`

### Access URLs

Once the server is running, you'll see:

```
➜  Local:   http://localhost:5009/
➜  Network: http://192.168.21.249:5009/
```

### Accessing from Different Devices

#### From the same computer:
```
http://localhost:5009/
```

#### From other devices (phone, tablet, another computer):
```
http://192.168.21.249:5009/
```
*Replace the IP address with your actual network IP shown in the terminal*

### How to Find Your Network IP

**Windows:**
```powershell
ipconfig | Select-String -Pattern "IPv4"
```

**Mac/Linux:**
```bash
ifconfig | grep "inet "
```

### Firewall Configuration

If you can't access from other devices:

1. **Windows Firewall:**
   - Open Windows Defender Firewall
   - Click "Allow an app through firewall"
   - Add Node.js or allow port 5009

2. **Alternative - Quick Command:**
   ```powershell
   New-NetFirewallRule -DisplayName "Vite Dev Server" -Direction Inbound -Protocol TCP -LocalPort 5009 -Action Allow
   ```

### Configuration Details

The server is configured in `vite.config.ts`:

```typescript
server: {
  port: 5009,
  host: '0.0.0.0',  // Listen on all network interfaces
  strictPort: true,
  cors: true,
}
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (network accessible) |
| `npm run dev:local` | Start dev server (localhost only) |
| `npm run start` | Alias for `npm run dev` |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build (network accessible) |

### Testing from Mobile Device

1. Make sure your phone/tablet is on the same WiFi network
2. Open browser on your mobile device
3. Navigate to: `http://YOUR_COMPUTER_IP:5009/`
4. The app will load and work fully on mobile

### Troubleshooting

**Server not accessible from other devices?**

1. Check firewall settings
2. Verify both devices are on the same network
3. Make sure no VPN is active
4. Try disabling antivirus temporarily
5. Check if port 5009 is available: `netstat -an | findstr :5009`

**Need to change the port?**

Edit `vite.config.ts` and modify:
```typescript
server: {
  port: YOUR_PORT_NUMBER,
}
```

### Security Note

⚠️ The dev server is for development only. Never expose it to the public internet.

The server includes security headers for WASM SharedArrayBuffer support:
- Cross-Origin-Opener-Policy: same-origin
- Cross-Origin-Embedder-Policy: require-corp

---

**Status:** ✅ Configured and running on all devices
**Last Updated:** December 5, 2025
