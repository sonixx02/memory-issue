Snapshot AI — Validated Blueprint v2
Result of 10 rounds of recursive self-questioning and validation. Every decision below was proposed, challenged, and defended.

1. The Problem (Validated ✅)
LLMs are stateless. Every new chat = talking to a stranger. This causes:

Context loss — decisions from past sessions are forgotten
Preference amnesia — code style, writing tone, expertise level reset every time
Time waste — users re-explain the same things across sessions
Money waste — identical tokens re-generated for repeated questions
Generic responses — AI can't calibrate to your knowledge level or ongoing project
Existing solutions (ChatGPT Memory, Gemini Gems, Claude Projects) are shallow — they store manual text blobs, don't learn from conversations, and don't evolve over time.

2. The Architecture (4-Layer Memory System)
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 1: GLOBAL USER PROFILE                                      │
│  Scope: All workspaces, all conversations                          │
│  Contains: code style preferences, writing tone, expertise levels  │
│  Built: semi-auto (promoted from workspace snapshots)              │
│  Cost: $0 (stored locally)                                         │
│  Priority: Phase 3                                                 │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 2: WORKSPACE STATE FILE (MACRO MEMORY)         ✅ BUILT     │
│  Scope: Per workspace                                              │
│  Contains: project goal, locked decisions, rejected ideas, status  │
│  Built: LLM extraction on manual "Commit Snapshot"                 │
│  Cost: 1 API call per snapshot (~2K tokens)                        │
│  Priority: Done — needs editing UI + diff view                     │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 3: CONVERSATION RAG (MICRO MEMORY)             ❌ MISSING   │
│  Scope: Per workspace (searches ALL chats within workspace)        │
│  Contains: embeddings of every message, chunked and indexed        │
│  Built: AUTOMATIC in background (no user action needed)            │
│  Searched: local vector search via Orama (no API call)             │
│  Cost: $0 (all local)                                              │
│  Priority: Phase 1 — HIGHEST IMPACT                                │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 4: RESPONSE CACHE                              ❌ MISSING   │
│  Scope: Per workspace                                              │
│  Contains: question hash → answer pairs                            │
│  Built: automatically after each response                          │
│  Cost: $0 (saves money by avoiding repeat API calls)               │
│  Priority: Phase 4 — optimization                                  │
└─────────────────────────────────────────────────────────────────────┘
Key Design Decision: RAG is Automatic, State File is Manual
This was validated through 3 rounds of challenge:

RAG (Micro Memory)	State File (Macro Memory)
Trigger	Automatic after every chat	Manual "Commit Snapshot" button
What it captures	Everything — fine details, code, numbers	High-level decisions only
Processing	Local embedding model (FREE)	LLM API call (~$0.001)
Failure mode	Wrong chunks retrieved	Stale or incorrect decisions
Mitigation	Workspace isolation limits scope	User can edit State File
These systems are independent. RAG works even if the user never clicks "Commit Snapshot." The State File adds explicit, structured rules on top.

3. Technical Stack (Validated)
Component	Technology	Size/Cost	Validated?
Framework	Vite + React 19	Existing	✅ Already built
Database	Dexie.js (IndexedDB)	~50KB lib	✅ Already built
Vector search	Orama	~30KB lib	✅ Installed, not wired
Local embeddings	Transformers.js + all-MiniLM-L6-v2	~80MB model	✅ Feasible — 15-30ms/sentence, reasonable first-load time
LLM providers	OpenAI + Anthropic + Gemini	BYOK	✅ Already built
Streaming	Native fetch + SSE	—	✅ Already built
What I Challenged and Rejected:
Proposed	Why Rejected
BART summarization in browser	1.6GB model, 10-30s inference. Too heavy.
BERT NER in browser	400MB, marginal benefit over keyword extraction
All-LLM memory processing	3000x more expensive than local RAG
Dump everything into context window	300K tokens/request = $0.60/message
Auto-commit snapshots on every chat end	Unreliable (beforeunload), expensive if frequent
4. How It Works — Message Flow
When user sends a message:
[1] User types message
         │
    ┌────▼──── LOCAL (FREE) ─────────────────┐
    │ [2] Embed question with MiniLM (~10ms)  │
    │ [3] Vector search Orama for top 5       │
    │     relevant past chunks (~5ms)         │
    │ [4] Read State File from DB (~1ms)      │
    │ [5] Read Global User Profile (~1ms)     │
    └────┬───────────────────────────────────-┘
         │
    ┌────▼──── COMPILE ──────────────────────┐
    │ System Prompt =                         │
    │   User Profile (who you are) +          │
    │   State File (project context) +        │
    │   RAG chunks (relevant details) +       │
    │   "Respect locked decisions..."         │
    └────┬────────────────────────────────────┘
         │
    ┌────▼──── API CALL (costs tokens) ──────┐
    │ [6] Send compiled prompt + user message │
    │     to LLM provider                    │
    │ [7] Stream response back               │
    └────┬───────────────────────────────────-┘
         │
    ┌────▼──── BACKGROUND (FREE) ────────────┐
    │ [8] Embed new messages into Orama index │
    │     (runs in idle callback / worker)    │
    └────────────────────────────────────────-┘
When user clicks "Commit Snapshot":
[1] Collect recent messages from current chat
         │
    ┌────▼──── API CALL ─────────────────────┐
    │ [2] LLM extracts structured decisions   │
    │     into JSON State File                │
    └────┬───────────────────────────────────-┘
         │
    ┌────▼──── UI ───────────────────────────┐
    │ [3] Show DIFF to user (what changed)    │
    │ [4] Let user EDIT / CORRECT             │
    │ [5] "Make any of these global?" prompt  │
    │     → promotes to User Profile          │
    └────┬───────────────────────────────────-┘
         │
    ┌────▼──── SAVE ─────────────────────────┐
    │ [6] Save old state as snapshot history   │
    │ [7] Update workspace with new state     │
    └────────────────────────────────────────-┘
5. Build Phases
Phase 1: RAG Pipeline (Highest Impact)
Install Transformers.js, load MiniLM model
Build embedding service (Web Worker for non-blocking)
Create chunking logic (messages → overlapping text chunks)
Wire Orama for vector search + storage
Update Context Compiler to inject RAG results
Auto-embed messages after each conversation
Phase 2: State File Improvements
Add editable State Panel (add/remove/edit items)
Add snapshot diff view (before/after comparison)
Add snapshot history browsing UI
Add conflict detection (contradicting decisions)
Phase 3: Global User Profile
Create profile schema and storage
After each snapshot, prompt: "Make any global?"
Inject profile into all workspace system prompts
Add profile management UI
Phase 4: Polish & Optimization
Response cache for repeated questions
Chat auto-titling (LLM names chat after first exchange)
Data export/import (JSON backup/restore)
Fix streaming performance (throttle DB writes)
Inline rename for workspaces and chats
6. Verification Plan
Automated (can be observed):
RAG accuracy test: Create a workspace, chat about a specific topic (e.g., "my favorite color is blue"), start a new chat, ask "what is my favorite color?" — verify the RAG pulls the right chunk and the AI answers correctly
Snapshot extraction test: Have a conversation with clear decisions, commit snapshot, verify the State File accurately reflects the decisions
Embedding performance test: Embed 100 messages, measure time — should be under 5 seconds total
Manual (user validates):
Open the app in browser (npm run dev)
Create a workspace, create a chat, have a real conversation with an LLM
Click "Commit Snapshot" — verify the State Panel updates
Create a second chat in the same workspace — verify that context from chat #1 is available
Verify that the app doesn't lag or freeze during streaming responses
7. Risks Acknowledged
Risk	Severity	Mitigation
MiniLM model first-load takes 3-5s	Medium	Show loading indicator, cache in browser
RAG retrieves wrong context	Low	Workspace isolation limits scope
State File becomes stale/wrong	Medium	User can manually edit, diff view on commit
Anthropic CORS may break	Medium	Document limitation, suggest proxy as fallback
IndexedDB eviction on low storage	Low	navigator.storage.persist() already requested
~200MB RAM for embedding model	Low	Acceptable for desktop power users

Comment
Ctrl+Alt+M
