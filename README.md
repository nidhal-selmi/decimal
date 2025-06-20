# DeciMaL - Decision Management Lab

This project visualizes MBSE decisions using git commits. A small Express server exposes commit history and dynamically generates PlantUML diagrams for each commit. A simple client written in vanilla JavaScript consumes the API and renders a gitgraph.

## Project structure

- `server.js` – Express backend serving commit information and diagrams.
  Stores commit messages (Y-statements) in a SQLite database and exposes a
  query API that supports regular expression matching. Optional OpenAI
  embeddings are used when available.
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
5. Provide your OpenAI API key in a file named `key.txt` at the project root or
   set the `OPENAI_API_KEY` environment variable. The server will automatically
   read the key from `key.txt` if present.
6. Start the server:
   ```sh
   npm start
   ```
7. Open `http://localhost:3001` in your browser to view the application.

## Notes

- Diagrams are generated on demand and stored under the `diagrams/` directory.
- This repository does not include the actual MBSE project. Configure `REPO_PATH` to point to your own repository containing PlantUML files.
- Y-statements extracted from commit messages are stored in `ystatements.db` with
  optional OpenAI embeddings. The `/ask` endpoint can search commit messages
  using regular expressions and, when embeddings are available, performs a
  vector search for additional context. Results are returned directly to the
  frontend, which links to the relevant commit messages.
