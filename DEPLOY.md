# LoopCoach Deployment

LoopCoach is currently a static browser app. The first public version does not need an application server, database, or backend API.

You do need HTTPS for real phone-camera use on public networks. Most modern browsers block camera access on ordinary `http://` sites.

## Best First Deployment

Use one of these static hosting products:

- Cloudflare Pages
- Vercel
- Netlify
- GitHub Pages

Upload or connect this folder:

```text
/Users/wu/golf-ai-coach
```

Build command:

```text
none
```

Output directory:

```text
/
```

After deployment, open the generated `https://...` URL on your phone and tap `开始实时指导`.

## VPS Deployment With Docker

Use this when you want your own server and domain.

### 1. Buy or prepare

- A VPS with Ubuntu
- A domain name, for example `loopcoach.example.com`
- DNS `A` record pointing the domain to the VPS public IP

### 2. Install Docker

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
```

### 3. Copy the project

Copy `/Users/wu/golf-ai-coach` to the server, for example:

```bash
scp -r /Users/wu/golf-ai-coach user@your-server-ip:~/loopcoach
```

### 4. Edit the domain

On the server:

```bash
cd ~/loopcoach
nano Caddyfile
```

Replace:

```text
your-domain.com
```

with your real domain.

### 5. Start

```bash
docker compose up -d
```

Open:

```text
https://your-domain.com
```

Caddy will request and renew the HTTPS certificate automatically.

## Simple VPS Deployment Without Docker

If you only want a quick server, install Caddy and serve the folder directly:

```bash
sudo apt install -y caddy
cd ~/loopcoach
sudo caddy run --config Caddyfile
```

## Why HTTPS Matters

The camera API requires a secure origin. `localhost` is treated as secure for development, but a public IP such as `http://1.2.3.4` is not. Use a real domain with HTTPS for normal phone access.

## Later Backend

A backend becomes necessary when you add:

- User accounts
- Saved videos
- Coach-labeled datasets
- Paid subscriptions
- Server-side AI inference
- Team or coach dashboards

For the current MVP, static hosting is enough.
