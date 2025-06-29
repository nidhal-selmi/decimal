const express = require('express');
const simpleGit = require('simple-git');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
// No external API usage

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
            message TEXT
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

        // Save Y-statements to the database
        const stmt = db.prepare('INSERT OR REPLACE INTO ystatements (hash, message) VALUES (?, ?)');
        commits.forEach(c => {
            stmt.run(c.hash, c.message);
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

// Simple question matcher for decision queries
app.post('/ask', (req, res) => {
    const { question } = req.body;
    if (!question) {
        res.status(400).json({ error: 'Question is required' });
        return;
    }

    // Supported question patterns
    const patterns = [
        // Goal-oriented questions
        { regex: /in (?:which|what) decision[^?]*goal(?: is| was| to| of)? ([^?]+)\?/i },
        { regex: /what is the goal of decision ([^?]+)\?/i },

        // Consequence questions
        { regex: /which decision[^?]*(?:led|leads|resulted|results) to ([^?]+)\?/i },

        // Alternatives for a decision
        { regex: /what alternatives(?: does| did)? decision ([^?]+) have\?/i },
        { regex: /what (?:were|are) the alternatives(?: for| to)? decision ([^?]+)\?/i },

        // Motivation
        { regex: /why was decision ([^?]+) made\?/i },
=======
        { regex: /in (?:which|what) decision[^?]*goal(?: is)? ([^?]+)\?/i },
        { regex: /which decision[^?]*led to ([^?]+)\?/i },
        { regex: /what alternatives(?: does| did)? decision ([^?]+) have\?/i }
    ];

    let term = question;
    for (const p of patterns) {
        const m = question.match(p.regex);
        if (m) {
            term = m[1];
            break;
        }
    }

    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(esc, 'i');

    db.all('SELECT rowid AS id, hash, message FROM ystatements', async (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        let results = rows
            .map(row => {
                if (regex.test(row.message)) {
                    return { hash: row.hash, message: row.message };
                }
                return null;
            })
            .filter(Boolean);

        const answer = results.length > 0
            ? `Found ${results.length} matching decision(s).`
            : 'No matching decisions found.';
        res.json({ answer, results });
    });
});

// Start server
app.listen(port, () => {
    console.log(`Backend server running at http://localhost:${port}`);
});
