const express = require('express');
const simpleGit = require('simple-git');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3001;

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Root route serves the frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Paths
// Repository containing the MBSE model and PlantUML diagrams
const repoPath = process.env.REPO_PATH || path.join(__dirname, 'MBSE-Repo');
// Directory where generated diagrams are stored
const diagramsDir = path.join(__dirname, 'diagrams');
// PlantUML JAR location
const plantUmlJar = process.env.PLANTUML_JAR || path.join(__dirname, 'plantuml.jar');

// Enable CORS for frontend access
app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type"]
}));

// Ensure diagrams directory exists
if (!fs.existsSync(diagramsDir)) {
    fs.mkdirSync(diagramsDir, { recursive: true });
}

// 🟢 Fetch commits with correct parent-child relationships
app.get('/commits', async (req, res) => {
    try {
        const git = simpleGit(repoPath);
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
        const pumlFile = path.join(repoPath, 'DrivetrainDevelopment.plantuml'); // PlantUML file
        const diagramFile = path.join(diagramsDir, `diagram-${commitHash}.png`); // Output diagram filename

        // Ensure the PlantUML file exists
        if (!fs.existsSync(pumlFile)) {
            res.status(404).json({ error: 'DroneDevelopment.plantuml not found in this commit.' });
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
            const generatedFile = path.join(diagramsDir, 'DrivetrainDevelopment.png');
            if (fs.existsSync(generatedFile)) {
                fs.renameSync(generatedFile, diagramFile);
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

// Start server
app.listen(port, () => {
    console.log(`Backend server running at http://localhost:${port}`);
});
