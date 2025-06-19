# DeciMaL - Decision Management Lab

This project visualizes MBSE decisions using git commits. A small Express server exposes commit history and dynamically generates PlantUML diagrams for each commit. A simple client written in vanilla JavaScript consumes the API and renders a gitgraph.

## Project structure

- `server.js` – Express backend serving commit information and diagrams.
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
4. Place `plantuml.jar` in the project root (or specify a different location via `PLANTUML_JAR`).
5. Start the server:
   ```sh
   npm start
   ```
6. Open `http://localhost:3001` in your browser to view the application.

## Notes

- Diagrams are generated on demand and stored under the `diagrams/` directory.
- This repository does not include the actual MBSE project. Configure `REPO_PATH` to point to your own repository containing PlantUML files.
