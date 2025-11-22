# 🌉 X (Twitter) to Nostr Bridge Bot

A robust, Dockerized bot that automatically reposts tweets from a specific X account to Nostr.

## ✨ Features

- **Smart Polling:** Checks for new tweets every 60 seconds.
- **Rate Limit Protection:** Uses OAuth 1.0a authentication to minimize rate limits and handles 429 errors gracefully.
- **Media Support:** Automatically downloads images from tweets and re-uploads them to **Catbox.moe** (free, no API key required).
- **Clean Reposts:** Automatically removes original `t.co` tracking links when images are present, so Nostr clients display images natively without Twitter embeds.
- **Filtering:** Ignores replies and retweets to keep the feed clean.
- **Dockerized:** Easy to deploy anywhere (NAS, VPS, Mac, Linux).

## 🛠️ Prerequisites

Before running the bot, ensure you have:

1.  **X (Twitter) Developer Account:** You need a Project/App with **OAuth 1.0a** enabled. You will need 4 keys:
    -   Consumer Key (API Key)
    -   Consumer Secret (API Secret)
    -   Access Token
    -   Access Token Secret
2.  **Nostr Identity:** A private key (`nsec`) for your bot.
3.  **Target Account ID:** The numeric ID of the X account you want to mirror (e.g., use a tool like `tweeterid.com` to find it).

## 🚀 Quick Start via Docker (Recommended)

1.  **Clone the repository:**
    git clone https://github.com/your-User-Name/nostr-x-bridge.git
    cd nostr-x-bridge

2.  **Configure environment:**
    Copy the example file:
    cp .env.example .env

    Open `.env` and fill in your credentials:
    X_API_KEY=your_api_key
    X_API_SECRET=your_api_secret
    X_ACCESS_TOKEN=your_access_token
    X_ACCESS_SECRET=your_access_secret
    NOSTR_BOT_NSEC=nsec1...
    X_ACCOUNT_ID_TO_FOLLOW=123456789

3.  **Run:**
    docker-compose up -d

4.  **View Logs:**
    docker-compose logs -f

## 📦 Manual Installation (Node.js)

If you prefer running it without Docker:

1.  **Install dependencies:**
    npm install

2.  **Configure:**
    (Same step as above, create .env file)

3.  **Run:**
    node bridge.js

## 📝 License

MIT License
