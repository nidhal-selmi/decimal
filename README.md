# DeciMaL - Decision Management Lab

This project visualizes MBSE decisions using git commits. A small Express server exposes commit history and dynamically generates PlantUML diagrams for each commit. A simple client written in vanilla JavaScript consumes the API and renders a gitgraph.

## Project structure

- `server.js` – Express backend serving commit information and diagrams.
  Stores commit messages (Y-statements) in a SQLite database and exposes a
  query API that matches common decision questions using regular expressions.
- `public/` – Static frontend assets
  - `index.html`
  - `app.js`
  - `styles.css`
- `diagrams/` – Generated PlantUML diagrams (ignored in git).

## Setup

1. Install Node.js and npm.
2. Install dependencies:
   ```sh
   npm install
   ```
3. Set the path to your MBSE git repository via the `REPO_PATH` environment variable or modify `server.js`.
4. The PlantUML JAR (`plantuml.jar`) is already included in the project root. Set `PLANTUML_JAR` to use a different JAR.
5. Start the server:
   ```sh
   npm start
   ```
6. Open `http://localhost:3001` in your browser to view the application.

## Notes

- Diagrams are generated on demand and stored under the `diagrams/` directory.
- This repository does not include the actual MBSE project. Configure `REPO_PATH` to point to your own repository containing PlantUML files.
- Y-statements extracted from commit messages are stored in `ystatements.db`.
  The `/ask` endpoint searches commit messages with predefined question
  patterns and regular expressions, returning matching commits to the frontend.

## Query examples

The question matcher understands a small set of patterns. Some supported
examples are:

- "In which decision is the goal to reduce weight?"
- "Which decision led to using carbon materials?"
- "What alternatives did decision D3 have?"
- "What is the goal of decision D5?"
- "Why was decision D8 made?"

Minor wording variations (e.g. "goal was" or "goal to") are tolerated.
=======
