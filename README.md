AltoSymbiosisAgents
A local-first desktop app for working with AI on your own computer. Chat with Claude and your local models side by side — they share routing, memory, and your indexed files. Simple turns stay local; complex turns reach Claude. The symbiosis is in the loop, not the marketing.
What it does

Two model families, one chat. Routes each turn between your local model (Ollama or LM Studio) and Claude. The status bar shows which answered and what it cost.
Agent teams. Create specialists with system prompts and skills. Group them; the coordinator decomposes turns, dispatches sub-tasks, chains structured handoffs between agents, and synthesizes the final answer.
RAG over your files. Index documents with fastembed (ONNX, no network, no PyTorch). Hybrid retrieval over vectors and keywords via sqlite-vec + BM25.
Three-layer memory. Recent turns, promoted facts, document RAG — all on disk, all yours.
MCP support. Standard Model Context Protocol — connect your existing tools to your agents.
Sandboxed tool dispatch. A CaMeL-style restricted-Python interpreter refuses to let untrusted data drive control flow. Built from the DeepMind CaMeL paper, not invented.

What it does not do
No code execution. No shell access. No browser automation. No filesystem writes outside its own database. No cloud sync. No telemetry. Your Anthropic API key lives in the OS keyring; your messages, files, and conversation history live in your user-data folder. Uninstall and that folder takes everything with it.
Built for
People who want capable AI tools that stay on the machine they're sitting at — researchers, writers, analysts, hobbyists. Anyone who reads agent-security press in 2026 and prefers the version of AI tooling that doesn't ask for shell access.
