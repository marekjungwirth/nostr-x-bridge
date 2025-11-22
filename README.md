# 🌉 X (Twitter) to Nostr Bridge Bot

A robust, Dockerized bot that automatically reposts your tweets to Nostr.

## ✨ Features
- **Smart Polling:** Checks for new tweets every 60 seconds (configurable).
- **Rate Limit Protection:** Automatically pauses if X API limits are hit.
- **Media Support:** Downloads images from tweets and re-uploads them to free Nostr hosts (Catbox.moe, with Void.cat fallback).
- **Clean Reposts:** Removes t.co links and embeds images natively.
- **Filtering:** Ignores replies and retweets.
- **Dockerized:** Easy to deploy anywhere (NAS, VPS, Mac, Linux).

## 🚀 Quick Start

### 1. Clone the repository
    git clone [https://github.com/TVUJE_JMENO/nostr-x-bridge.git](https://github.com/TVUJE_JMENO/nostr-x-bridge.git)
    cd nostr-x-bridge

### 2. Configure environment
Copy the example configuration file:
    cp .env.example .env

Edit .env and fill in your API keys:
- **X API Keys:** From Twitter Developer Portal (OAuth 1.0a).
- **Nostr Key:** Your bot's private key (nsec).
- **Account ID:** The numeric ID of the X account to follow.

### 3. Run with Docker
    docker-compose up -d

### 4. View Logs
    docker-compose logs -f

## 🛠️ Requirements
- Docker & Docker Compose
- X (Twitter) Developer Account (Free tier is sufficient)
- A Nostr key pair for the bot

## 📜 License
MIT
