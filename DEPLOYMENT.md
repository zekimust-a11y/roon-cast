# Deployment Guide: Moving Roon Cast Bridge to 192.168.1.212

## Prerequisites on Remote Server

### 1. Software Requirements
```bash
# Check Node.js version (need 16+)
node --version

# Check npm
npm --version

# Check git
git --version

# If missing, install:
# Ubuntu/Debian:
sudo apt update
sudo apt install -y nodejs npm git

# macOS:
brew install node git

# Verify installation
node --version  # Should be v16.x or higher
```

### 2. Network Requirements
- Server must be on the same LAN as Roon Core (192.168.1.x network)
- Server must be on the same LAN as Chromecast
- Port 8080 must be accessible
- Firewall rules may need adjustment

## Deployment Methods

### Method 1: Git Clone (Recommended)

```bash
# SSH to remote server
ssh user@192.168.1.212

# Navigate to desired location
cd /home/user/apps  # or wherever you want

# Clone the repository
git clone https://github.com/zekimust-a11y/roon-cast.git
cd roon-cast

# Install dependencies
npm install

# Create .env file with server's IP
cat > .env << 'EOF'
PORT=8080
PUBLIC_HOST=192.168.1.212
PUBLIC_BASE_URL=http://192.168.1.212:8080
CAST_APP_ID=180705D2
CAST_NAMESPACE=urn:x-cast:com.zeki.rooncast
DEFAULT_RECEIVER_URL=https://zekimust-a11y.github.io/roon-cast/
EOF

# Start the server
npm start
```

### Method 2: rsync/scp Transfer

From your current laptop:

```bash
# Create deployment package
cd "/Users/zeki/My Drive (zekimust@gmail.com)/Personal/APPS/Chromecast"

# Sync to remote server (replace 'user' with actual username)
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'terminals' \
  . user@192.168.1.212:/home/user/apps/roon-cast/

# SSH to remote server
ssh user@192.168.1.212

# Go to app directory
cd /home/user/apps/roon-cast

# Install dependencies
npm install

# Update .env file
nano .env
# Set PUBLIC_HOST=192.168.1.212
# Set PUBLIC_BASE_URL=http://192.168.1.212:8080

# Start
npm start
```

## Running as a Service

### Option 1: PM2 (Recommended)

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start the app
cd /home/user/apps/roon-cast
pm2 start npm --name "roon-cast" -- start

# Save PM2 configuration
pm2 save

# Configure PM2 to start on boot
pm2 startup
# Follow the instructions it provides (will give you a command to run with sudo)

# Useful PM2 commands:
pm2 status          # Check status
pm2 logs roon-cast  # View logs
pm2 restart roon-cast  # Restart
pm2 stop roon-cast     # Stop
```

### Option 2: systemd Service

Create `/etc/systemd/system/roon-cast.service`:

```ini
[Unit]
Description=Roon Chromecast Bridge
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/home/user/apps/roon-cast
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable roon-cast
sudo systemctl start roon-cast

# Check status
sudo systemctl status roon-cast

# View logs
sudo journalctl -u roon-cast -f
```

## Firewall Configuration

### Ubuntu/Debian (ufw)
```bash
sudo ufw allow 8080/tcp
sudo ufw status
```

### CentOS/RHEL (firewalld)
```bash
sudo firewall-cmd --permanent --add-port=8080/tcp
sudo firewall-cmd --reload
```

### macOS
```bash
# Usually no firewall config needed on macOS
# If needed, go to System Preferences > Security & Privacy > Firewall
```

## Post-Deployment Steps

### 1. Authorize in Roon

1. Open Roon on any device
2. Go to **Settings → Extensions**
3. Find **"Roon Chromecast Bridge"**
4. Click **Enable** to authorize
5. Verify it shows "Connected"

### 2. Configure via Web Interface

1. Open `http://192.168.1.212:8080` in your browser
2. Select your Roon Core
3. Select your Zone
4. Select your Chromecast device

Settings are saved to `config.json` and persist across restarts.

### 3. Test

1. Play music in Roon
2. Casting should start automatically
3. Check logs: `pm2 logs roon-cast` or `sudo journalctl -u roon-cast -f`

### 4. Browser Test

Open `http://192.168.1.212:8080/test-receiver.html` in Chrome to see the receiver display without the Chromecast.

## Updating the App

### If using Git:
```bash
cd /home/user/apps/roon-cast
git pull origin main
npm install  # In case dependencies changed
pm2 restart roon-cast  # or sudo systemctl restart roon-cast
```

### If using rsync:
```bash
# From your laptop
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'config.json' \
  . user@192.168.1.212:/home/user/apps/roon-cast/

# On remote server
pm2 restart roon-cast
```

## Troubleshooting

### Chromecast not discovered
```bash
# Check if mDNS is working
avahi-browse -a  # Linux
dns-sd -B _googlecast._tcp  # macOS

# Ensure server is on same network as Chromecast
ip addr show  # Check IP address
ping 192.168.1.5  # Ping your Chromecast
```

### Roon Core not found
```bash
# Ensure server is on same network as Roon Core
# Check logs for "Core paired" message
pm2 logs roon-cast | grep "Core"
```

### Port 8080 already in use
```bash
# Find what's using the port
sudo lsof -i :8080
# Or change PORT in .env file
```

### Permission errors
```bash
# Ensure user has permission to app directory
ls -la /home/user/apps/roon-cast
# Fix if needed:
sudo chown -R your-username:your-username /home/user/apps/roon-cast
```

## Files That Will Be Created on Server

After first run, these files will be generated:

- `config.json` - Persisted zone/Chromecast selections
- `node_modules/` - Dependencies
- Log files (depending on service manager)

**Do NOT commit `config.json` to Git** - it contains device-specific IDs.

## Monitoring

### Check if running:
```bash
pm2 status
# or
sudo systemctl status roon-cast
```

### View logs:
```bash
pm2 logs roon-cast --lines 100
# or
sudo journalctl -u roon-cast -n 100 -f
```

### Check CPU/Memory usage:
```bash
pm2 monit
# or
htop  # find node process
```

## Reverting Back to Laptop

If you need to move back:

1. Stop service on 192.168.1.212: `pm2 stop roon-cast`
2. Start on laptop: `npm start`
3. Re-authorize in Roon (will appear as same extension)
4. Reconfigure zone/Chromecast in web UI

The `config.json` on each machine can have different selections.

## Security Considerations

- The server binds to `0.0.0.0` (all interfaces) by default
- Consider adding authentication if exposed outside LAN
- Keep Node.js and dependencies updated: `npm audit fix`
- Don't expose port 8080 to the internet

## Support

If issues occur:
1. Check logs first
2. Verify network connectivity (same LAN as Roon/Chromecast)
3. Test with browser receiver at `/test-receiver.html`
4. Check GitHub issues: https://github.com/zekimust-a11y/roon-cast/issues

