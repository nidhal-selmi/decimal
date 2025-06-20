// Base API URL (backend serving the JSON file with commits)
const API_BASE = "http://localhost:3001";

// DOM Elements
const diagramImage = document.getElementById("diagram-image");
const repoForm = document.getElementById("repo-form");
const repoInput = document.getElementById("repo-input");
const repoSubmit = document.getElementById("repo-submit");
const diagramContainer = document.getElementById("diagram-container");
const metadataContent = document.getElementById("metadata-content");
const graphContainer = document.getElementById("graph-container");
const nextButton = document.getElementById("next-commit");
const prevButton = document.getElementById("prev-commit");
const changeRepoButton = document.getElementById("change-repo");
const openChatBtn = document.getElementById("open-chat-btn");
const closeChatBtn = document.getElementById("close-chat-btn");
const chatPanel = document.getElementById("chatbot-panel");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSendBtn = document.getElementById("chat-send-btn");

// Temporary in-memory storage for commits
let commitsDatabase = [];
let currentCommitIndex = 0; // Tracks the currently selected commit

// Create a GitGraph instance using GitgraphJS (from the UMD build)
// The template is extended to hide branch labels.
const gitgraph = GitgraphJS.createGitgraph(graphContainer, {
  orientation: GitgraphJS.Orientation.VerticalReverse, // Vertical orientation
  mode: GitgraphJS.Mode.Compact,
  template: GitgraphJS.templateExtend(GitgraphJS.TemplateName.Metro, {
    colors: ["#ADD8E6", "#FF4500", "#32CD32", "#FFD700"],
    commit: {
      dot: {
        size: 8,
        color: "#ADD8E6",
        strokeColor: "#000000",
        strokeWidth: 1.5,
      },
      message: {
        color: "#000000",
        font: "bold 12pt sans-serif",
      },
    },
    branch: {
      color: "#4682B4",
      lineWidth: 3,
      label: { display: false } // Hide branch labels
    },
  }),
});

let commitNodes = {}; // Object to store commit nodes by hash

// Fetch commits from the backend and render the GitGraph
async function initializeApp() {
  try {
    const response = await fetch(`${API_BASE}/commits`);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    commitsDatabase = await response.json();

    // Commits are returned from newest to oldest; keep this order so the latest
    // commit is shown first

    if (!Array.isArray(commitsDatabase) || commitsDatabase.length === 0) {
      throw new Error("No valid commit data received.");
    }
    renderGitGraph();
    updateNavigationButtons();
  } catch (error) {
    console.error("Error initializing app:", error.message);
  }
}

function renderGitGraph() {
  // Clear the existing graph and reset stored commit nodes
  gitgraph.clear();
  commitNodes = {};

  // Create a default branch (without displaying a name)
  const branches = { main: gitgraph.branch("") };

  // Render each commit from the backend with the new tag format.
  commitsDatabase.forEach((commit, index) => {
    let branchName = ""; // We use an empty branch name for all commits

    // (Optional: If you want to handle branch splits based on the commit message, you could add logic here.)

    // Create a commit node on the branch with a subject "decision {n}"
    commitNodes[commit.hash] = branches[branchName || "main"].commit({
      subject: " " + (index + 1),
      style: {
        dot: {
          color: index === currentCommitIndex ? "#052a5e" : "#ADD8E6", // Highlight selected commit
          size: 10,
          strokeColor: "#000000",
          strokeWidth: 2,
        },
        message: {
          color: "#000000",
          font: "bold 12pt sans-serif",
        },
      },
      onClick: () => {
        currentCommitIndex = index;
        selectCommit(commit.hash, commit.message);
        renderGitGraph(); // Re-render to update the highlighted commit
        updateNavigationButtons();
      },
    });
  });
}

function selectCommit(commitHash, commitMessage) {
  // Update the diagram image based on the commit hash (fetched from backend)
  const newSrc = `${API_BASE}/diagram/${commitHash}`;
  diagramImage.src = newSrc;
  diagramImage.onload = () =>
    console.log(`Diagram for ${commitHash} loaded successfully.`);
  diagramImage.onerror = () => {
    console.error(`Failed to load diagram for ${commitHash}.`);
    diagramImage.alt = "Failed to load diagram.";
  };

  // Highlight key phrases in the commit message
  const phrasesToHighlight = [
    "In the context of",
    "facing",
    "Facing",
    "we decided for",
    "and neglected",
    "to achieve",
    "accepting",
    "because",
  ];

  function highlightText(text) {
    const highlightColor = "lightblue";
    phrasesToHighlight.forEach(phrase => {
      const regex = new RegExp(phrase, "g");
      text = text.replace(
        regex,
        `<span style="background-color: ${highlightColor};">${phrase}</span>`
      );
    });
    return text;
  }

  // Update the metadata panel with the commit's Y-statement
  metadataContent.innerHTML = `<strong>Y-statement:</strong><br>${highlightText(commitMessage)}`;
  document.getElementById("metadata-panel").style.display = "block";
}

function nextCommit() {
  if (currentCommitIndex < commitsDatabase.length - 1) {
    currentCommitIndex++;
    const commit = commitsDatabase[currentCommitIndex];
    selectCommit(commit.hash, commit.message);
    renderGitGraph();
    updateNavigationButtons();
  }
}

function prevCommit() {
  if (currentCommitIndex > 0) {
    currentCommitIndex--;
    const commit = commitsDatabase[currentCommitIndex];
    selectCommit(commit.hash, commit.message);
    renderGitGraph();
    updateNavigationButtons();
  }
}

function updateNavigationButtons() {
  prevButton.disabled = currentCommitIndex === 0;
  nextButton.disabled = currentCommitIndex === commitsDatabase.length - 1;
}
async function setRepository(repo) {
  const response = await fetch(`${API_BASE}/repo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo })
  });
  if (!response.ok) throw new Error("Failed to set repository");
  return response.json();
}

function checkStoredRepo() {
  const stored = localStorage.getItem("repoPath");
  if (stored) {
    setRepository(stored).then(() => {
      repoForm.style.display = "none";
      diagramContainer.style.display = "inline-flex";
      changeRepoButton.style.display = "inline";
      initializeApp();
    }).catch(() => {
      repoForm.style.display = "block";
      changeRepoButton.style.display = "none";
    });
  } else {
    repoForm.style.display = "block";
    changeRepoButton.style.display = "none";
  }
}

repoSubmit.addEventListener("click", async () => {
  const value = repoInput.value.trim();
  if (!value) return;
  try {
    await setRepository(value);
    localStorage.setItem("repoPath", value);
    repoForm.style.display = "none";
    diagramContainer.style.display = "inline-flex";
    changeRepoButton.style.display = "inline";
    initializeApp();
  } catch (e) {
    alert("Failed to load repository: " + e.message);
  }
});


// Initialize the application
checkStoredRepo();

// Add event listeners for navigation buttons
nextButton.addEventListener("click", nextCommit);
prevButton.addEventListener("click", prevCommit);
changeRepoButton.addEventListener("click", () => {
  localStorage.removeItem("repoPath");
  repoForm.style.display = "block";
  diagramContainer.style.display = "none";
  changeRepoButton.style.display = "none";
});

// Chatbot interactions
openChatBtn.addEventListener("click", () => {
  chatPanel.classList.add("open");
});
closeChatBtn.addEventListener("click", () => {
  chatPanel.classList.remove("open");
});

async function sendQuestion() {
  const question = chatInput.value.trim();
  if (!question) return;
  const qDiv = document.createElement("div");
  qDiv.textContent = question;
  chatMessages.appendChild(qDiv);
  chatInput.value = "";
  const response = await fetch(`${API_BASE}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question })
  });
  if (!response.ok) {
    const err = await response.json();
    const eDiv = document.createElement("div");
    eDiv.textContent = `Error: ${err.error}`;
    chatMessages.appendChild(eDiv);
    return;
  }
  const data = await response.json();
  if (data.answer) {
    const answerDiv = document.createElement("div");
    answerDiv.innerHTML = linkifyCommits(data.answer, data.results || []);
    chatMessages.appendChild(answerDiv);
  } else {
    const aDiv = document.createElement("div");
    aDiv.textContent = "No matching decisions found.";
    chatMessages.appendChild(aDiv);
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function linkifyCommits(text, results) {
  let hashes = (results || []).map(r => r.hash);
  if (hashes.length === 0) {
    const regex = /\b[0-9a-f]{7,40}\b/g;
    hashes = text.match(regex) || [];
  }
  hashes.forEach(h => {
    const re = new RegExp(`(commit\s+)?${h}`, 'g');
    const link = `<a href="#" class="commit-link" data-hash="${h}">$&</a>`;
    text = text.replace(re, link);
  });
  return text;
}

document.addEventListener('click', e => {
  if (e.target.classList.contains('commit-link')) {
    e.preventDefault();
    const hash = e.target.getAttribute('data-hash');
    const idx = commitsDatabase.findIndex(c => c.hash === hash);
    if (idx !== -1) {
      currentCommitIndex = idx;
      selectCommit(hash, commitsDatabase[idx].message);
      renderGitGraph();
      updateNavigationButtons();
      chatPanel.classList.remove("open");
    }
  }
});

chatSendBtn.addEventListener("click", sendQuestion);
chatInput.addEventListener("keypress", e => {
  if (e.key === "Enter") sendQuestion();
});

