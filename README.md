# Resume Parser API — Phase 1

A production-ready, deterministic resume parsing API built with **FastAPI** and
**PyMuPDF**. This is Phase 1 of a larger Resume Intelligence System — it
performs **text extraction and rule-based field extraction only**. No
authentication, database, AI/LLM, vector database, embeddings, Docker, or
background workers are included by design.

## Features

- Extracts raw text from PDF resumes, preserving reading order.
- Deterministically extracts:
  - Name
  - Email
  - Phone number
  - LinkedIn URL
  - GitHub URL
  - Portfolio URL
  - Skills
  - Education
  - Experience
  - Projects
  - Certifications
- Never guesses missing information — returns `None` / `[]` when a field
  cannot be confidently extracted.
- Strict validation: PDF-only, 10 MB max file size.
- Structured logging (request received, processing time, errors) —
  resume contents are never logged.

## Project Structure

```text
resume-parser/
├── main.py              # FastAPI application (HTTP layer)
├── parser.py            # Resume parsing engine (pure functions)
├── uploads/              # Optional temporary storage (not used by default)
├── requirements.txt
├── .gitignore
└── README.md
```

## Requirements

- Python 3.12+

## Installation

```bash
python -m venv venv
source venv/bin/activate      # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## Running the API

```bash
uvicorn main:app --reload
```

The API will be available at `http://127.0.0.1:8000`.
Interactive docs (Swagger UI): `http://127.0.0.1:8000/docs`

## API Reference

### `POST /parse`

Parses an uploaded PDF resume.

**Request:** `multipart/form-data`

| Field    | Type | Required | Notes                          |
|----------|------|----------|---------------------------------|
| `resume` | file | Yes      | PDF only, max size 10 MB       |

**Example (curl):**

```bash
curl -X POST "http://127.0.0.1:8000/parse" \
  -F "resume=@/path/to/resume.pdf"
```

**Success response — `200 OK`:**

```json
{
  "success": true,
  "message": "Resume parsed successfully",
  "data": {
    "raw_text": "...",
    "name": "Jane Doe",
    "email": "jane.doe@example.com",
    "phone": "+1 555-123-4567",
    "linkedin": "linkedin.com/in/janedoe",
    "github": "github.com/janedoe",
    "portfolio": "janedoe.dev",
    "skills": ["Python", "FastAPI", "SQL"],
    "education": ["B.Sc. Computer Science, XYZ University, 2022"],
    "experience": ["Software Engineer, Acme Corp, 2022-Present"],
    "projects": ["Resume Parser API — FastAPI + PyMuPDF"],
    "certifications": ["AWS Certified Developer – Associate"]
  }
}
```

**Error responses:**

| Status | Cause                                    |
|--------|-------------------------------------------|
| 400    | Missing file, empty file, or non-PDF file |
| 413    | File exceeds 10 MB                        |
| 422    | Invalid or corrupted PDF                  |
| 500    | Unexpected server-side error              |

### `GET /health`

Simple health check for deployment/monitoring.

```json
{ "status": "ok" }
```

## Design Notes

- **Deterministic only:** All field extraction uses regex and rule-based
  heuristics (section header detection, pattern matching). There is no
  AI/LLM involved in Phase 1.
- **No guessing:** If a field cannot be confidently identified, it is
  returned as `None` (scalars) or `[]` (lists) rather than a best guess.
- **Privacy:** Resume contents (raw text or extracted fields) are never
  written to logs — only metadata such as filename, content type, and
  processing time.

## Roadmap

- **Phase 2:** Persist parsed data in a database.
- **Phase 3:** Use an LLM to extract richer features (soft skills,
  achievements, experience summaries, etc.).
- **Phase 4:** Resume matching, scoring, recommendations, and semantic
  search.
# ai_mentor
