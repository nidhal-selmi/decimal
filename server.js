const express = require('express');
const simpleGit = require('simple-git');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { OpenAI } = require('openai');

// Load OpenAI API key from key.txt if present
const keyFile = path.join(__dirname, 'key.txt');
if (fs.existsSync(keyFile)) {
    try {
        const key = fs.readFileSync(keyFile, 'utf8').trim();
        if (key) {
            process.env.OPENAI_API_KEY = key;
        }
    } catch (err) {
        console.error('Failed to read key.txt:', err.message);
    }
}

const app = express();
const port = process.env.PORT || 3001;

// Parse JSON bodies
app.use(express.json());

// SQLite database for Y-statements
const dbPath = path.join(__dirname, 'ystatements.db');
let db;

function createDatabase() {
    db = new sqlite3.Database(dbPath);
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS ystatements (
            hash TEXT PRIMARY KEY,
            message TEXT,
            embedding TEXT
        )`);
    });
}

function removeDatabaseFile() {
    if (fs.existsSync(dbPath)) {
        try {
            fs.unlinkSync(dbPath);
        } catch (err) {
            console.error('Failed to delete existing database file:', err.message);
        }
    }
}

function initializeDatabase() {
    if (db) {
        db.close(err => {
            if (err) {
                console.error('Error closing database:', err.message);
            }
            removeDatabaseFile();
            createDatabase();
        });
    } else {
        removeDatabaseFile();
        createDatabase();
    }
}

initializeDatabase();

// OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return -1;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return -1;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Root route serves the frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Paths
// Repository containing the MBSE model and PlantUML diagrams
let repoPath = process.env.REPO_PATH || path.join(__dirname, 'MBSE-Repo');
// Directory where generated diagrams are stored
const diagramsDir = path.join(__dirname, 'diagrams');
// Directory where remote repositories are cloned
const cloneDir = path.join(__dirname, 'cloned-repo');
// PlantUML JAR location
const plantUmlJar = process.env.PLANTUML_JAR || path.join(__dirname, 'plantuml.jar');

// Clean previously cloned repository and generated diagrams on startup
if (fs.existsSync(cloneDir)) {
    fs.rmSync(cloneDir, { recursive: true, force: true });
}
if (fs.existsSync(diagramsDir)) {
    fs.rmSync(diagramsDir, { recursive: true, force: true });
}

// Enable CORS for frontend access
app.use(cors({

    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type"]
}));

// Set repository path via API
app.post("/repo", async (req, res) => {
  const { repo } = req.body;
  if (!repo) {
    return res.status(400).json({ error: "repo is required" });
  }
  if (fs.existsSync(repo)) {
    repoPath = repo;
    try {
      await simpleGit(repoPath).fetch();
    } catch (err) {
      console.error('Failed to fetch repository:', err.message);
    }
    initializeDatabase();
    return res.json({ repoPath });
  }
  try {
    if (fs.existsSync(cloneDir)) {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    }
    await simpleGit().clone(repo, cloneDir);
    repoPath = cloneDir;
    try {
      await simpleGit(repoPath).fetch();
    } catch (err) {
      console.error('Failed to fetch repository:', err.message);
    }
    initializeDatabase();
    res.json({ repoPath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// Ensure diagrams directory exists
if (!fs.existsSync(diagramsDir)) {
    fs.mkdirSync(diagramsDir, { recursive: true });
}

// 🟢 Fetch commits with correct parent-child relationships
app.get('/commits', async (req, res) => {
    try {
        const git = simpleGit(repoPath);
        // Ensure we have the latest commits from the repository
        try {
            await git.fetch();
        } catch (err) {
            console.error('Failed to fetch repository:', err.message);
        }
        const logData = await git.raw([
            "log", "--all", "--graph", "--pretty=format:%h|%p|%s"
        ]);

        let logLines = logData.split("\n").map(line => line.trim());

        // 🛑 Remove lines that start with "|/"
        logLines = logLines.filter(line => !line.startsWith("|/"));

        console.log("Filtered Git Log Output:", logLines); // Debugging raw output after cleanup

        const commits = [];
        const nodes = {}; // Store parsed commits

        logLines.forEach(line => {
            // Remove leading "*", "|", and spaces before parsing
            line = line.replace(/^(\*|\||\s)*/, "").trim();

            const parts = line.split("|");
            if (parts.length < 3) return; // Ignore invalid lines

            const hash = parts[0].trim();
            const parents = parts[1] ? parts[1].trim().split(" ").map(p => p.trim()) : [];
            const message = parts[2] ? parts[2].trim() : "No message";

            const commit = { hash, parents, message };

            // Add commit to nodes map and commits array
            nodes[hash] = commit;
            commits.push(commit);
        });

        // Save Y-statements and embeddings to the database
        let embeddings = [];
        if (process.env.OPENAI_API_KEY) {
            try {
                const embedResp = await openai.embeddings.create({
                    model: 'text-embedding-ada-002',
                    input: commits.map(c => c.message)
                });
                embeddings = embedResp.data.map(d => d.embedding);
            } catch (e) {
                console.error('Embedding generation failed:', e.message);
            }
        }

        const stmt = db.prepare('INSERT OR REPLACE INTO ystatements (hash, message, embedding) VALUES (?, ?, ?)');
        commits.forEach((c, idx) => {
            const emb = embeddings[idx] ? JSON.stringify(embeddings[idx]) : null;
            stmt.run(c.hash, c.message, emb);
        });
        stmt.finalize();

        console.log("Parsed Commits:", commits); // Debug parsed commits
        res.json(commits);
    } catch (error) {
        console.error("Error retrieving commits:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// 🟢 Generate and return diagram for a commit
app.get('/diagram/:commitHash', async (req, res) => {
    try {
        const { commitHash } = req.params;
        const git = simpleGit(repoPath);

        console.log(`Checking out commit: ${commitHash}`);
        await git.checkout([commitHash]); // Checkout the specified commit

        // Paths
        const pumlFiles = fs.readdirSync(repoPath).filter(f => f.endsWith('.plantuml'));
        if (pumlFiles.length === 0) {
            res.status(404).json({ error: 'No PlantUML files found in this commit.' });
            return;
        }

        const pumlFile = path.join(repoPath, pumlFiles[0]); // Use the first PlantUML file found
        const baseName = path.parse(pumlFiles[0]).name;
        const generatedFile = path.join(diagramsDir, `${baseName}.png`);
        const diagramFile = path.join(diagramsDir, `diagram-${commitHash}.png`); // Output diagram filename

        // Ensure the PlantUML file exists
        if (!fs.existsSync(pumlFile)) {
            res.status(404).json({ error: `${pumlFiles[0]} not found in this commit.` });
            return;
        }

        // Check if the diagram already exists to avoid regenerating
        if (fs.existsSync(diagramFile)) {
            console.log(`Diagram for commit ${commitHash} already exists.`);
            res.sendFile(diagramFile);
            return;
        }

        // Generate the diagram with an explicit output filename
        console.log(`Generating diagram for commit ${commitHash}`);
        exec(`java -jar "${plantUmlJar}" -tpng "${pumlFile}" -o "${diagramsDir}"`, (error, stdout, stderr) => {
            if (error) {
                console.error(`Diagram generation failed: ${stderr}`);
                res.status(500).json({ error: `Failed to generate diagram: ${error.message}` });
                return;
            }

            // **Rename the file to include the commit hash**
            if (fs.existsSync(generatedFile)) {
                try {
                    fs.renameSync(generatedFile, diagramFile);
                } catch (renameError) {
                    // Handle cases where the file is locked or on a different device
                    if (renameError.code === 'EBUSY' || renameError.code === 'EXDEV') {
                        try {
                            fs.copyFileSync(generatedFile, diagramFile);
                            fs.unlinkSync(generatedFile);
                        } catch (copyError) {
                            console.error(`Diagram generation failed during file move: ${copyError.message}`);
                            res.status(500).json({ error: `Diagram generation failed: ${copyError.message}` });
                            return;
                        }
                    } else {
                        console.error(`Diagram generation failed during rename: ${renameError.message}`);
                        res.status(500).json({ error: `Diagram generation failed: ${renameError.message}` });
                        return;
                    }
                }
            } else {
                console.error("Diagram generation failed: Output file not found.");
                res.status(500).json({ error: "Diagram generation failed: Output file not found." });
                return;
            }

            // Send the generated diagram
            res.sendFile(diagramFile, (err) => {
                if (err) {
                    console.error(`Error sending diagram file: ${err.message}`);
                    res.status(500).json({ error: `Failed to send diagram: ${err.message}` });
                }
            });
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Keyword search powered by ChatGPT analysis
app.post('/ask', (req, res) => {
    const { question } = req.body;
    if (!question) {
        res.status(400).json({ error: 'Question is required' });
        return;
    }

    // Split question into tokens for naive search (fallback)
    const tokens = question
        .toLowerCase()
        .split(/\s+/)
        .filter(t => t.length > 2);

    db.all('SELECT rowid AS id, hash, message, embedding FROM ystatements', async (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        let results = [];
        let useVector = false;

        if (process.env.OPENAI_API_KEY) {
            try {
                const qEmbedResp = await openai.embeddings.create({
                    model: 'text-embedding-ada-002',
                    input: question
                });
                const qEmbedding = qEmbedResp.data[0].embedding;

                results = rows
                    .map(row => {
                        if (!row.embedding) return null;
                        const emb = JSON.parse(row.embedding);
                        const similarity = cosineSimilarity(qEmbedding, emb);
                        return { hash: row.hash, message: row.message, similarity };
                    })
                    .filter(Boolean)
                    .sort((a, b) => b.similarity - a.similarity)
                    .slice(0, 5);

                useVector = results.length > 0;
            } catch (e) {
                console.error('Vector search failed:', e.message);
            }
        }

        // Fallback to naive search if vector search is not available
        if (!useVector) {
            results = rows
                .map(row => {
                    const lower = row.message.toLowerCase();
                    const matched = tokens.every(t => lower.includes(t));
                    if (!matched) return null;
                    const firstToken = tokens.find(t => lower.includes(t));
                    const index = lower.indexOf(firstToken);
                    return { hash: row.hash, message: row.message, index };
                })
                .filter(Boolean);
        }

        // If no OpenAI API key is configured, just return the results
        if (!process.env.OPENAI_API_KEY) {
            res.json({ results });
            return;
        }

        try {
            const context = results
                .slice(0, 5)
                .map(r => `Commit: ${r.hash}\nMessage: ${r.message}`)
                .join('\n');

            const messages = [
                {
                    role: 'system',
                    content: 'You answer questions about MBSE decisions. Use the provided commit messages to form a short summary. Mention relevant commits using the phrase "commit <hash>" and do not repeat the full commit messages.'
                },
                {
                    role: 'user',
                    content: `Question: ${question}\n\nCommit messages:\n${context}`
                }
            ];

            const completion = await openai.chat.completions.create({
                model: 'gpt-3.5-turbo',
                messages
            });

            const answer = completion.choices[0].message.content.trim();
            res.json({ answer, results });
        } catch (e) {
            console.error('OpenAI request failed:', e.message);
            res.status(500).json({ error: e.message, results });
        }
    });
});

// Start server
app.listen(port, () => {
    console.log(`Backend server running at http://localhost:${port}`);
});
