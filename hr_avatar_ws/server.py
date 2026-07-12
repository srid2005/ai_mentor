"""
server.py  –  HR Interview  |  WebSocket-only FastAPI backend
Run:  uvicorn server:app --host 0.0.0.0 --port 8000 --reload
"""

import json
import random
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="HR Interview WS Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Serve the frontend files from the same directory as server.py ────────────
BASE_DIR = Path(__file__).parent

@app.get("/")
async def root():
    return FileResponse(BASE_DIR / "index.html")

app.mount("/static", StaticFiles(directory=BASE_DIR), name="static")

# Serve .obj / .js.js / .ttf files referenced by index.html directly at root
@app.get("/{filename:path}")
async def serve_asset(filename: str):
    file_path = BASE_DIR / filename
    if file_path.exists() and file_path.is_file():
        return FileResponse(file_path)
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail=f"{filename} not found")

# ─── Intent → response database ──────────────────────────────────────────────
INTENT_MAP = [
    {
        "keywords": ["yourself", "introduce", "about you", "who are you", "tell me about"],
        "responses": [
            (
                "Thanks for asking! I'm your AI interviewer for today's session. "
                "I have extensive experience evaluating candidates across software engineering, "
                "product management, and data science. "
                "My goal is to understand both your technical depth and how you think through problems. "
                "Let's have a great conversation!",
                "friendly",
            ),
            (
                "Of course! I'm here to conduct a comprehensive interview session. "
                "I'll be asking questions about your background, technical skills, "
                "and how you approach real-world challenges. "
                "Feel free to take your time — there are no trick questions, just honest ones.",
                "friendly",
            ),
        ],
    },
    {
        "keywords": ["experience", "background", "worked", "previous job", "career", "history"],
        "responses": [
            (
                "That's a strong background! Could you walk me through a specific project "
                "where you had to make a difficult architectural decision? "
                "I'm curious about the trade-offs you weighed.",
                "curious",
            ),
            (
                "Interesting — I'd love to dig deeper into your most impactful work. "
                "Can you quantify the results? "
                "How did your contributions measurably affect the team or the product?",
                "curious",
            ),
        ],
    },
    {
        "keywords": ["strength", "good at", "excel", "best skill", "i am strong", "i'm good"],
        "responses": [
            (
                "Those are impressive strengths! Self-awareness like that is highly valued. "
                "Can you give me a concrete example where this strength directly "
                "led to a successful outcome on a project?",
                "approving",
            ),
            (
                "Excellent — it's great to see someone who knows where they shine. "
                "How have you leveraged these strengths when onboarding into a new team or codebase?",
                "approving",
            ),
        ],
    },
    {
        "keywords": ["weakness", "struggle", "improve", "not great", "working on", "growth area"],
        "responses": [
            (
                "I appreciate your honesty — it takes maturity to reflect on growth areas. "
                "What concrete steps have you taken in the last six months to address this?",
                "thinking",
            ),
            (
                "Acknowledging a weakness and actively working on it is a strong signal. "
                "How has recognizing this changed the way you collaborate with others?",
                "thinking",
            ),
        ],
    },
    {
        "keywords": ["why this company", "why us", "why here", "why do you want", "interest in"],
        "responses": [
            (
                "That's exactly the kind of alignment we look for in candidates. "
                "Which specific product or challenge of ours resonates most with you personally?",
                "neutral",
            ),
            (
                "We love passionate people! What research have you done about "
                "our current technical stack or the problems we're actively solving?",
                "neutral",
            ),
        ],
    },
    {
        "keywords": ["five years", "5 years", "goal", "career plan", "aspire", "long term", "future"],
        "responses": [
            (
                "That's a clear and ambitious vision — I like it. "
                "How does this specific role serve as a stepping stone toward that goal?",
                "listening",
            ),
            (
                "Having a roadmap shows drive. "
                "How do you balance long-term ambitions with the day-to-day reality "
                "of shipping products under tight deadlines?",
                "listening",
            ),
        ],
    },
    {
        "keywords": ["team", "collaborate", "group", "colleague", "conflict", "together"],
        "responses": [
            (
                "Teamwork is everything here. Tell me about a time you disagreed "
                "with a teammate on a technical approach — how did you resolve it?",
                "friendly",
            ),
            (
                "What does your ideal team dynamic look like, "
                "and how do you adapt when the team culture differs from your preference?",
                "friendly",
            ),
        ],
    },
    {
        "keywords": ["problem", "challenge", "obstacle", "difficult", "hard situation", "pressure"],
        "responses": [
            (
                "Walk me through your exact thought process when you first hit that obstacle. "
                "What did you try first, and why? I want to understand your debugging mindset.",
                "skeptical",
            ),
            (
                "How did you prioritize when multiple things were breaking at once? "
                "And with the benefit of hindsight, what would you do differently?",
                "concerned",
            ),
        ],
    },
    {
        "keywords": ["python", "java", "javascript", "code", "programming", "framework",
                     "react", "node", "api", "database", "sql", "algorithm", "architecture"],
        "responses": [
            (
                "Solid technical choices! How do you keep up with the rapid evolution "
                "of frameworks and languages — do you have a deliberate learning routine?",
                "curious",
            ),
            (
                "Interesting stack. What drove those technology decisions — "
                "performance requirements, team familiarity, or ecosystem maturity? "
                "What would you choose if you were starting fresh today?",
                "curious",
            ),
        ],
    },
    {
        "keywords": ["salary", "compensation", "pay", "money", "package", "expect to earn"],
        "responses": [
            (
                "That's an important conversation, and I want us to be well aligned. "
                "Before we discuss numbers, let me better understand the full scope of value you bring. "
                "Could you walk me through your most impactful project first?",
                "concerned",
            ),
        ],
    },
    {
        "keywords": ["feedback", "review", "performance", "evaluation", "criticism"],
        "responses": [
            (
                "Feedback culture is crucial for growth. "
                "What's the most constructive piece of feedback you've received, "
                "and how did you apply it to become a better engineer?",
                "listening",
            ),
        ],
    },
    {
        "keywords": ["leadership", "lead", "managed", "mentor", "guide a team", "tech lead"],
        "responses": [
            (
                "Leadership experience is highly valued here. "
                "What's your philosophy on giving critical feedback to someone you're mentoring?",
                "approving",
            ),
            (
                "How do you balance technical contributions with the people-management side "
                "of leadership when both are demanding your time simultaneously?",
                "approving",
            ),
        ],
    },
]

FALLBACKS = [
    ("Thank you for sharing that. Could you elaborate with a specific example from your experience?", "listening"),
    ("That's an interesting perspective. How has this insight shaped your day-to-day work?", "curious"),
    ("I see — let's go a little deeper. What was the most significant decision you made in that situation?", "thinking"),
    ("Noted. How would you apply this mindset in a fast-paced environment where priorities shift frequently?", "neutral"),
    ("That's a solid answer. How do you measure success when outcomes are ambiguous?", "skeptical"),
    ("Interesting! What would you have done differently with the benefit of hindsight?", "curious"),
    ("I appreciate you sharing that. What did you learn from that experience that you still carry with you?", "listening"),
]


def generate_response(text: str) -> tuple[str, str]:
    lower = text.lower()
    for intent in INTENT_MAP:
        if any(kw in lower for kw in intent["keywords"]):
            return random.choice(intent["responses"])
    return random.choice(FALLBACKS)


# ─── WebSocket endpoint ───────────────────────────────────────────────────────
@app.websocket("/ws")
async def interview_ws(websocket: WebSocket):
    await websocket.accept()
    print("[WS] Client connected")
    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            user_text = data.get("text", "").strip()
            if not user_text:
                continue
            print(f"[USER] {user_text}")
            reply, tone = generate_response(user_text)
            print(f"[BOT]  ({tone}) {reply[:70]}…")
            await websocket.send_text(json.dumps({"text": reply, "tone": tone}))
    except WebSocketDisconnect:
        print("[WS] Client disconnected")
    except Exception as e:
        print(f"[WS] Error: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)