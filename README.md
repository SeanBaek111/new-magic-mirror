# Magic Mirror - Sign Language Learning Tool

Sign language learning web app built for the QUT Inclusive Technologies Group. While initially developed for Auslan at Endeavour Foundation centres, the app is language-agnostic and works with any sign language. Upload any sign video, and users can practise in front of their webcam with real-time pose tracking and scoring.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome.

## Features

- Real-time pose tracking via MediaPipe (pose + hand landmarks)
- DTW-based scoring with weighted features (arm angles, positions, velocity, finger angles)
- Admin page for adding custom words (no code needed)
- Supabase backend for cross-device word storage (with IndexedDB fallback)
- Skeleton overlay (green=pose, red/blue=hands) during practice

## Adding New Words

1. Go to **Manage Words** from the main screen
2. Upload a sign video, enter the word name and category
3. Click **Extract Landmarks** (processes in-browser via MediaPipe)
4. Click **Save Word**

## Project Structure

```
public/
  videos/              # Sign language demonstration videos (.mp4)
  data/                # Extracted pose reference data (.json)
src/
  App.jsx              # State-based routing (Select / Practice / Admin)
  words.js             # Built-in word registry
  components/
    MagicMirror.jsx    # Main mirror UI (watch, practice, scoring, feedback)
    AdminPage.jsx      # Word management (upload, process, save, delete)
  hooks/
    useMediaPipe.js    # MediaPipe initialization + detection hook
  utils/
    drawing.js         # Skeleton rendering on canvas
    poseComparison.js  # DTW + feature extraction + scoring
    videoProcessor.js  # Video to reference data extraction (browser)
    storage.js         # Word CRUD (Supabase or IndexedDB fallback)
```

## User Flow

1. **Select** - Choose a word to learn (built-in + custom)
2. **Watch** - Demonstration video plays
3. **Countdown** - 3-2-1 with webcam preview
4. **Practice** - Webcam mirror mode with real-time skeleton overlay
5. **Scoring** - DTW comparison against reference
6. **Feedback** - Score, stars, tips, retry option

## Supabase Setup (Optional)

By default, the app stores custom words in the browser's IndexedDB. To enable cross-device storage via Supabase:

1. Create a [Supabase](https://supabase.com/) project

2. Run this SQL in the Supabase SQL Editor to create the `words` table:

```sql
create table words (
  id text primary key,
  label text not null,
  category text default 'Uncategorised',
  video_path text,
  ref_data_path text,
  created_at timestamptz default now()
);

alter table words enable row level security;
create policy "Public access" on words for all using (true) with check (true);
```

3. Create two **public** Storage buckets in the Supabase dashboard:
   - `videos` -- for sign video files
   - `ref-data` -- for extracted landmark JSON

4. Copy `.env.example` to `.env` and fill in your project credentials:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Without these env vars, the app falls back to IndexedDB automatically.

## Deployment

```bash
npm run build
```

Deploy the `dist/` folder to any static host (Vercel, Netlify, GitHub Pages).

## Tech Stack

- Vite + React 19
- MediaPipe Tasks Vision (pose + hand landmarker)
- Supabase for cloud storage (optional, falls back to IndexedDB)
- DTW for temporal alignment scoring

## License

This project's source code is licensed under the [MIT License](LICENSE).

### Video Content

Sign language demonstration videos included in this project are sourced from [Auslan Signbank](https://auslan.org.au/) and are licensed under [Creative Commons BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/). This means:

- **Attribution** - Credit to Auslan Signbank is required
- **Non-Commercial** - Videos may only be used for non-commercial purposes
- **No Derivatives** - Videos may not be modified or adapted

These license terms apply only to the video content, not to the application source code.

## Acknowledgements

- [Auslan Signbank](https://auslan.org.au/) for sign language video resources
- [QUT Inclusive Technologies Group](https://research.qut.edu.au/dplab/research/inclusive-technologies-for-people-of-diverse-cognitive-abilities/) for research support
- [Endeavour Foundation](https://endeavour.com.au/) for collaboration and user testing
- [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/guide) by Google for pose and hand tracking models
