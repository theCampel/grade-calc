# Grade Lab

> Thank you to [Luke Tervit](https://github.com/luketervit) for the prompt engineering in this project!

Calculate your University of Edinburgh honours degree classification in seconds.

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/thecampel/grade-calc.git
cd grade-calc
npm install

# 2. Add your OpenAI API key (needed for transcript import)
cp .env.example .env
# Edit .env and add your key

# 3. Run
npm start
```

Then open **http://localhost:3000**

---
## Importing Your Transcript

1. Log into EUCLID -> My Student Record -> Assessment & Progression -> Select Year 3 or Year 4
2. Press Cmd/Ctrl + P to save as PDF
3. Drop the file into the "Import Transcript" tab (after you have setup your API key)
4. The AI extracts your modules, credits, and marks
---

## Setup Your API Key

The transcript import feature uses AI to parse your EUCLID export. You need an OpenAI API key.

### Option 1: Via the App (Easiest)
1. Open the app in your browser
2. Go to **Import** tab
3. Click **"Set API Key"** when prompted
4. Paste your key - it's saved to `.env` automatically

### Option 2: Via `.env` File
```bash
cp .env.example .env
```
Then edit `.env`:
```
OPENAI_API_KEY=sk-your-key-here
```

### Get an API Key
1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create new secret key
3. Copy it (you won't see it again)

---

## Features

| Feature | Description |
|---------|-------------|
| **Manual Entry** | Add modules, credits, and marks |
| **Transcript Import** | Upload EUCLID PDF → auto-extract grades |
| **What-If Calculator** | "What do I need to get a First?" |
| **Multiple Profiles** | Track different scenarios or compare with friends |

---

## How It Works

Your final grade = **(Year 3 × 50%) + (Year 4 × 50%)**

| Classification | Grade |
|----------------|-------|
| First Class | 70%+ |
| Upper Second (2:1) | 60-69% |
| Lower Second (2:2) | 50-59% |
| Third Class | 40-49% |

---

## Tips

- **Keyboard shortcuts**: Press `1-4` to switch views, `Cmd/Ctrl+S` to save
- **Predicted vs Confirmed**: Toggle status to mark grades as confirmed or predicted
- **Compare profiles**: Create multiple profiles to model different scenarios

---

## Tech Stack

- Express.js backend
- Vanilla JS frontend
- OpenAI GPT-4o for transcript parsing
- Local storage + JSON file persistence

---

## License

MIT - do whatever you want with it.
