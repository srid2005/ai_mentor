import os
import json
import uuid
import logging
from typing import Dict, Any, List
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from groq import Groq
from parser import parse_resume

# Load environment variables from .env file (if present)
load_dotenv()

# Groq model to use
GROQ_MODEL = "llama-3.3-70b-versatile"

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="AI Virtual Interviewer API",
    description="Backend API to manage candidate resume parsing, interview sessions, and generate questions.",
    version="1.0.0"
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Limit file size to 10 MB
MAX_FILE_SIZE = 10 * 1024 * 1024

# In-memory session store: maps session_id (str) -> session data (dict)
sessions: Dict[str, Dict[str, Any]] = {}


class StartInterviewRequest(BaseModel):
    resume_data: Dict[str, Any]


class StartInterviewResponse(BaseModel):
    session_id: str
    question: str


class RespondRequest(BaseModel):
    session_id: str
    response: str


class RespondResponse(BaseModel):
    question: str
    ended: bool = False


def _call_groq(system_prompt: str, user_prompt: str, is_json: bool = False) -> str:
    """
    Makes a chat completion call to Groq API.
    Returns the response text, or raises an exception on failure.
    """
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY not set")
    
    client = Groq(api_key=api_key)
    kwargs = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.7,
        "max_tokens": 500,
    }
    if is_json:
        kwargs["response_format"] = {"type": "json_object"}
        
    completion = client.chat.completions.create(**kwargs)
    return completion.choices[0].message.content.strip()


def _programmatic_fallback_name_role(resume_data: Dict[str, Any]):
    """Extract name and role from resume_data for fallback questions."""
    name = "there"
    role = "software engineering"
    name_keys = ["name", "fullName", "full_name", "candidate_name", "candidateName"]
    for k in name_keys:
        val = resume_data.get(k)
        if val and isinstance(val, str) and val.strip():
            name = val.strip()
            break
    if name == "there":
        contact = resume_data.get("contact", {})
        if isinstance(contact, dict):
            for k in name_keys:
                val = contact.get(k)
                if val and isinstance(val, str) and val.strip():
                    name = val.strip()
                    break
    role_keys = ["role", "title", "position", "headline", "target_role", "targetRole"]
    for k in role_keys:
        val = resume_data.get(k)
        if val and isinstance(val, str) and val.strip():
            role = val.strip()
            break
    if role == "software engineering":
        experience = resume_data.get("experience", [])
        if isinstance(experience, list) and len(experience) > 0:
            first_exp = experience[0]
            if isinstance(first_exp, dict):
                for k in ["title", "role", "position"]:
                    val = first_exp.get(k)
                    if val and isinstance(val, str) and val.strip():
                        role = val.strip()
                        break
    return name, role


def generate_first_question(resume_data: Dict[str, Any]) -> str:
    """
    Generates the opening interview question using Groq.
    Falls back to a programmatic question if GROQ_API_KEY is not set or call fails.
    """
    try:
        system_prompt = (
            "You are a professional, warm AI job interviewer. "
            "Your goal is to make the candidate feel comfortable and ask concise, relevant questions. "
            "Output ONLY the question text — no labels, no markdown, no meta-commentary."
        )
        user_prompt = (
            f"The candidate has the following resume data:\n{json.dumps(resume_data, indent=2)}\n\n"
            "Welcome the candidate warmly and ask your FIRST opening interview question. "
            "It should invite them to introduce themselves and relate to their background. "
            "Keep it to 2-3 sentences."
        )
        question = _call_groq(system_prompt, user_prompt)
        logger.info("Generated opening question via Groq.")
        return question
    except Exception as e:
        logger.warning(f"Groq call failed for first question: {e}. Using programmatic fallback.")

    # Programmatic fallback
    name, role = _programmatic_fallback_name_role(resume_data)
    if name != "there":
        return (
            f"Hi {name}, thank you for joining us today! To start, could you please tell me about yourself "
            f"and your journey, particularly focusing on your background as a {role}?"
        )
    return (
        "Hi there, thank you for joining us today! To start, could you please tell me about yourself "
        "and your journey in this field?"
    )


def generate_followup_question(resume_data: Dict[str, Any], history: List[Dict[str, str]]) -> str:
    """
    Generates an intelligent, context-aware follow-up question using Groq AI.
    The AI deeply analyzes the candidate's latest response against their resume 
    and full conversation history to produce a highly relevant next question.
    Only falls back to programmatic questions if Groq is completely unavailable.
    """
    interviewer_turns = [t for t in history if t.get("role") == "interviewer"]
    candidate_turns = [t for t in history if t.get("role") == "candidate"]
    turn_count = len(interviewer_turns)
    
    # Extract latest candidate response for focused analysis
    last_response = candidate_turns[-1]["content"] if candidate_turns else ""
    
    # Build structured history text
    history_text = "\n".join(
        f"{'INTERVIEWER' if t['role'] == 'interviewer' else 'CANDIDATE'}: {t['content']}" 
        for t in history
    )
    
    # Extract ALL key resume fields for the prompt
    skills = resume_data.get("skills", [])
    skills_str = ", ".join(skills[:15]) if isinstance(skills, list) and skills else "not listed"
    
    experience = resume_data.get("experience", [])
    exp_str = "\n  - ".join(experience[:6]) if isinstance(experience, list) and experience else "not listed"
    
    projects = resume_data.get("projects", [])
    proj_str = "\n  - ".join(projects[:4]) if isinstance(projects, list) and projects else "not listed"
    
    education = resume_data.get("education", [])
    edu_str = "\n  - ".join(education[:4]) if isinstance(education, list) and education else "not listed"
    
    certifications = resume_data.get("certifications", [])
    cert_str = "\n  - ".join(certifications[:4]) if isinstance(certifications, list) and certifications else "not listed"
    
    name = resume_data.get("name", "Candidate")
    
    # Determine if we should wrap up
    should_wrap_up = turn_count >= 5
    
    system_prompt = (
        "You are an expert AI technical interviewer with 15+ years of hiring experience. "
        "You conduct interviews that feel natural, insightful, and conversational — NOT scripted.\n\n"
        "YOUR CORE BEHAVIOR:\n"
        "1. DEEPLY VERIFY AND ANALYZE the candidate's last response — identify what they said well, what was vague, "
        "what technical claims need probing, and what they avoided or missed.\n"
        "2. NEVER repeat a question that was already asked. NEVER ask generic questions like 'tell me about yourself' again.\n"
        "3. Your follow-up MUST directly reference something specific the candidate just said — "
        "a tool they mentioned, a metric they claimed, a challenge they described, a decision they made.\n"
        "4. Vary your question types: technical deep-dives, scenario-based, problem-solving, "
        "architecture decisions, trade-off analysis, debugging approaches, team collaboration.\n"
        "5. If the candidate gave a shallow answer, probe deeper into specifics. "
        "If they gave a strong answer, challenge them with a harder scenario.\n"
        "6. Keep questions to 1-3 sentences. Be direct. No filler praise.\n\n"
        "OUTPUT FORMAT: You MUST return a valid JSON object with exactly two keys: 'analysis' and 'question'.\n"
        "- 'analysis': Your verification and evaluation of the candidate's response.\n"
        "- 'question': The actual follow-up question text."
    )
    
    if should_wrap_up:
        system_prompt = (
            "You are an expert AI technical interviewer wrapping up an interview session.\n"
            "Based on the full conversation, provide a brief, warm closing statement that:\n"
            "1. Acknowledges 1-2 specific strengths you observed from the candidate's responses.\n"
            "2. Thanks them genuinely.\n"
            "3. States the interview is now complete.\n"
            "Keep it to 2-3 sentences. "
            "OUTPUT FORMAT: You MUST return a valid JSON object with exactly two keys: 'analysis' and 'question'.\n"
            "- 'analysis': Your reasoning for the wrap-up.\n"
            "- 'question': The warm closing statement."
        )
    
    user_prompt = (
        f"=== CANDIDATE RESUME ===\n"
        f"Name: {name}\n"
        f"Skills: {skills_str}\n"
        f"Experience:\n  - {exp_str}\n"
        f"Projects:\n  - {proj_str}\n"
        f"Education:\n  - {edu_str}\n"
        f"Certifications:\n  - {cert_str}\n\n"
        f"=== INTERVIEW SO FAR ({turn_count} questions asked) ===\n"
        f"{history_text}\n\n"
        f"=== CANDIDATE'S LATEST RESPONSE ===\n"
        f"\"{last_response}\"\n\n"
    )
    
    if should_wrap_up:
        user_prompt += "Generate a warm, personalized closing statement to end this interview."
    else:
        user_prompt += (
            "Analyze the candidate's latest response above. Consider:\n"
            "- What specific claims or technical details did they mention that deserve deeper probing?\n"
            "- Did they give concrete examples with metrics/outcomes, or was it vague?\n"
            "- What relevant resume skills/experience haven't been explored yet?\n"
            "- What would a senior hiring manager want to know next?\n\n"
            "Now generate your analysis and ONE sharp, contextual follow-up question in JSON format."
        )
    
    # Primary attempt with rich analytical prompt (JSON mode)
    try:
        response_text = _call_groq(system_prompt, user_prompt, is_json=True)
        if response_text:
            try:
                import json
                parsed = json.loads(response_text)
                question = parsed.get("question", "")
                analysis = parsed.get("analysis", "")
                logger.info(f"AI Analysis: {analysis}")
                if question:
                    logger.info("Generated intelligent follow-up question via Groq JSON.")
                    return question
            except json.JSONDecodeError:
                logger.warning(f"Groq returned invalid JSON: {response_text}. Falling back to text.")
                return response_text
    except Exception as e:
        logger.warning(f"Groq primary call failed: {e}. Trying simplified prompt...")
    
    # Retry with a simpler prompt
    try:
        simple_system = "You are an AI interviewer. Ask one relevant follow-up question based on what the candidate just said."
        simple_user = f"Candidate said: \"{last_response}\"\nTheir skills: {skills_str}\nAsk a follow-up question:"
        question = _call_groq(simple_system, simple_user)
        if question:
            logger.info("Generated follow-up question via Groq (simplified prompt).")
            return question
    except Exception as e:
        logger.warning(f"Groq retry also failed: {e}. Using last-resort programmatic fallback.")
    
    # Absolute last-resort programmatic fallback (only if Groq is completely down)
    if turn_count >= 5:
        return "Thank you for sharing your experiences today. That concludes our interview — we appreciate your time and will be in touch soon!"
    
    # Even the fallback tries to be contextual by referencing resume skills
    if skills and isinstance(skills, list) and len(skills) > 0:
        import random
        picked_skills = random.sample(skills, min(2, len(skills)))
        return f"Could you walk me through a real-world scenario where you used {' and '.join(picked_skills)} together to solve a challenging problem? What trade-offs did you face?"
    
    return "Can you describe a technical challenge you recently faced and walk me through your approach to solving it step by step?"


@app.post("/parse")
async def parse_resume_endpoint(resume: UploadFile = File(...)):
    """
    Parses an uploaded PDF resume.
    """
    logger.info(f"Received resume parse request: {resume.filename}")
    
    if not resume.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")
        
    try:
        file_bytes = await resume.read()
        if len(file_bytes) > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail="File size exceeds the 10 MB limit.")
        
        parsed_data = parse_resume(file_bytes)
        logger.info("Successfully parsed resume.")
        return {
            "success": True,
            "message": "Resume parsed successfully",
            "data": parsed_data
        }
    except ValueError as val_err:
        logger.error(f"Validation error parsing resume: {val_err}")
        raise HTTPException(status_code=400, detail=str(val_err))
    except HTTPException as http_err:
        raise http_err
    except Exception as e:
        logger.error(f"Unexpected error parsing resume: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error while parsing the resume.")


@app.post("/interview/start", response_model=StartInterviewResponse)
async def start_interview(request: StartInterviewRequest):
    """
    Initializes a new interview session.
    Stores the parsed resume in memory and returns the first generated question.
    """
    logger.info("Received request to start a new interview session.")
    try:
        session_id = str(uuid.uuid4())
        resume_data = request.resume_data
        
        # Generate the first question based on the resume
        question = generate_first_question(resume_data)
        
        # Store in session state
        sessions[session_id] = {
            "resume_data": resume_data,
            "history": [
                {"role": "interviewer", "content": question}
            ]
        }
        
        logger.info(f"Successfully initialized session {session_id}.")
        return StartInterviewResponse(session_id=session_id, question=question)
        
    except Exception as e:
        logger.error(f"Failed to start interview session: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error while starting the interview session.")


@app.post("/interview/respond", response_model=RespondResponse)
async def respond_interview(request: RespondRequest):
    """
    Appends candidate's response to session history, generates the next question,
    and returns it.
    """
    session_id = request.session_id
    response_text = request.response
    
    logger.info(f"Received response for session {session_id}.")
    
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Interview session not found.")
        
    session = sessions[session_id]
    
    # Append candidate response to history
    session["history"].append({"role": "candidate", "content": response_text})
    
    # Generate next question
    next_question = generate_followup_question(session["resume_data"], session["history"])
    
    # Append next question to history
    session["history"].append({"role": "interviewer", "content": next_question})
    
    # Determine if it's the end of the interview
    end_phrases = ["concludes our", "interview is now complete", "interview is complete", "get back to you soon", "have a great day"]
    ended = any(phrase in next_question.lower() for phrase in end_phrases)
    
    # Or, as a safety check, if we have asked 6 or more questions:
    interviewer_turns = [turn for turn in session["history"] if turn.get("role") == "interviewer"]
    if len(interviewer_turns) >= 6:
        ended = True
        
    logger.info(f"Generated next question. Ended: {ended}")
    return RespondResponse(question=next_question, ended=ended)


@app.get("/health")
async def health_check():
    """
    Simple health check endpoint.
    """
    return {"status": "healthy", "active_sessions": len(sessions)}
