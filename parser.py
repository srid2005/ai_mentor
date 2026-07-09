"""
parser.py

Deterministic (regex + rule based) resume parsing engine.

Public API:
    parse_resume(file_bytes: bytes) -> dict

No AI/LLM, no database, no external services. Pure text extraction
from PDF bytes followed by rule-based field extraction.
"""

from __future__ import annotations

import re
import logging
from typing import Optional

import fitz  # PyMuPDF

logger = logging.getLogger(__name__)

# =====================================================================
# CONSTANTS
# =====================================================================

# Section header aliases -> canonical section name
_SECTION_ALIASES: dict[str, tuple[str, ...]] = {
    "skills": (
        "skills",
        "technical skills",
        "core competencies",
        "skill set",
        "technologies",
    ),
    "education": (
        "education",
        "academic background",
        "academic qualifications",
        "educational qualifications",
    ),
    "experience": (
        "experience",
        "work experience",
        "professional experience",
        "employment history",
        "work history",
    ),
    "projects": (
        "projects",
        "personal projects",
        "academic projects",
        "key projects",
    ),
    "certifications": (
        "certifications",
        "certificates",
        "licenses",
        "licenses & certifications",
        "licenses and certifications",
    ),
}

# All known section header phrases (used to detect where a section ends)
_ALL_SECTION_HEADERS: set[str] = {
    alias for aliases in _SECTION_ALIASES.values() for alias in aliases
} | {
    "summary",
    "objective",
    "profile",
    "about",
    "about me",
    "contact",
    "contact information",
    "achievements",
    "awards",
    "publications",
    "interests",
    "hobbies",
    "languages",
    "references",
    "extracurricular activities",
}

_EMAIL_PATTERN = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")

# Matches common phone formats: +91 98765 43210, (123) 456-7890, 123-456-7890, etc.
_PHONE_PATTERN = re.compile(
    r"(?:(?:\+|00)\d{1,3}[\s.-]?)?"
    r"(?:\(\d{2,4}\)[\s.-]?)?"
    r"\d{3,5}[\s.-]?\d{3,4}[\s.-]?\d{0,4}"
)

_LINKEDIN_PATTERN = re.compile(
    r"(?:https?://)?(?:www\.)?linkedin\.com/[A-Za-z0-9\-_/%.]+", re.IGNORECASE
)

_GITHUB_PATTERN = re.compile(
    r"(?:https?://)?(?:www\.)?github\.com/[A-Za-z0-9\-_/%.]+", re.IGNORECASE
)

_GENERIC_URL_PATTERN = re.compile(
    r"(?:https?://)?(?:www\.)?[A-Za-z0-9\-]+\.[A-Za-z]{2,}(?:/[A-Za-z0-9\-_/%.#?=&]*)?",
    re.IGNORECASE,
)

# Common skill keywords used as a fallback when there is no explicit
# "Skills" section (kept intentionally small and deterministic).
_KNOWN_SKILL_KEYWORDS: tuple[str, ...] = (
    "python", "java", "javascript", "typescript", "c++", "c#", "go", "rust",
    "sql", "nosql", "html", "css", "react", "angular", "vue", "node.js",
    "django", "flask", "fastapi", "spring", "docker", "kubernetes", "aws",
    "azure", "gcp", "git", "linux", "pandas", "numpy", "tensorflow",
    "pytorch", "machine learning", "deep learning", "rest api", "graphql",
    "mongodb", "postgresql", "mysql", "redis", "kafka", "airflow",
)

_MAX_PHONE_DIGITS = 15
_MIN_PHONE_DIGITS = 7


# =====================================================================
# PUBLIC API
# =====================================================================

def parse_resume(file_bytes: bytes) -> dict:
    """
    Parse a resume PDF (given as raw bytes) and extract structured data.

    Args:
        file_bytes: Raw bytes of a PDF file.

    Returns:
        A dictionary containing the raw extracted text plus deterministically
        extracted fields. Fields that cannot be confidently extracted are
        returned as None (scalars) or [] (lists) -- never guessed.

    Raises:
        ValueError: If the bytes do not represent a valid / readable PDF,
            or the PDF contains no extractable text.
    """
    raw_text = _extract_text(file_bytes)

    if not raw_text.strip():
        raise ValueError("No extractable text found in PDF")

    lines = [line for line in raw_text.splitlines() if line.strip()]
    sections = _split_into_sections(lines)

    return {
        "raw_text": raw_text,
        "name": _extract_name(lines),
        "email": _extract_email(raw_text),
        "phone": _extract_phone(raw_text),
        "linkedin": _extract_linkedin(raw_text),
        "github": _extract_github(raw_text),
        "portfolio": _extract_portfolio(raw_text),
        "skills": _extract_skills(sections, raw_text),
        "education": _extract_education(sections),
        "experience": _extract_experience(sections),
        "projects": _extract_projects(sections),
        "certifications": _extract_certifications(sections),
    }


# =====================================================================
# TEXT EXTRACTION
# =====================================================================

def _extract_text(file_bytes: bytes) -> str:
    """
    Extract text from every page of the PDF, preserving reading order,
    and normalize whitespace.
    """
    try:
        document = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as exc:  # PyMuPDF raises various exceptions for bad files
        raise ValueError(f"Unable to open PDF: {exc}") from exc

    try:
        if document.page_count == 0:
            raise ValueError("PDF contains no pages")

        page_texts: list[str] = []
        for page in document:
            # "text" mode preserves natural top-to-bottom, left-to-right order.
            page_texts.append(page.get_text("text"))

        combined = "\n".join(page_texts)
        return _normalize_whitespace(combined)
    finally:
        document.close()


def _normalize_whitespace(text: str) -> str:
    """Collapse excessive blank lines and trailing/leading spaces per line."""
    lines = [line.strip() for line in text.splitlines()]
    normalized_lines: list[str] = []
    blank_streak = 0

    for line in lines:
        if line == "":
            blank_streak += 1
            if blank_streak <= 1:
                normalized_lines.append(line)
        else:
            blank_streak = 0
            # Collapse internal runs of whitespace to a single space.
            normalized_lines.append(re.sub(r"[ \t]+", " ", line))

    return "\n".join(normalized_lines).strip()


# =====================================================================
# SECTION SPLITTING
# =====================================================================

def _split_into_sections(lines: list[str]) -> dict[str, list[str]]:
    """
    Split resume lines into named sections based on detected section
    header lines. Returns a dict of canonical_section_name -> list of
    content lines (header line excluded).
    """
    sections: dict[str, list[str]] = {}
    current_section: Optional[str] = None

    for line in lines:
        canonical = _match_section_header(line)
        if canonical is not None:
            current_section = canonical
            sections.setdefault(current_section, [])
            continue

        if current_section is not None:
            sections[current_section].append(line)

    return sections


def _match_section_header(line: str) -> Optional[str]:
    """
    Determine whether a line is a section header. A line qualifies if,
    once stripped of punctuation/whitespace, it matches a known section
    alias (case-insensitive) and is short (headers are not long sentences).
    """
    cleaned = re.sub(r"[^a-zA-Z& ]", "", line).strip().lower()
    if not cleaned or len(cleaned.split()) > 5:
        return None

    for canonical, aliases in _SECTION_ALIASES.items():
        if cleaned in aliases:
            return canonical

    return None


# =====================================================================
# FIELD EXTRACTORS
# =====================================================================

def _extract_name(lines: list[str]) -> Optional[str]:
    """
    Heuristic: the candidate's name is typically the first non-empty line
    that does not look like an email, phone number, URL, or section header,
    and consists mostly of alphabetic words (2-4 words, no digits).
    """
    for line in lines[:5]:
        candidate = line.strip()
        if not candidate:
            continue
        if _EMAIL_PATTERN.search(candidate):
            continue
        if any(char.isdigit() for char in candidate):
            continue
        if _match_section_header(candidate):
            continue
        if "@" in candidate or "http" in candidate.lower():
            continue

        words = candidate.split()
        if 1 <= len(words) <= 4 and all(
            re.match(r"^[A-Za-z.'\-]+$", word) for word in words
        ):
            return candidate

    return None


def _extract_email(text: str) -> Optional[str]:
    match = _EMAIL_PATTERN.search(text)
    return match.group(0) if match else None


def _extract_phone(text: str) -> Optional[str]:
    for match in _PHONE_PATTERN.finditer(text):
        candidate = match.group(0)
        digit_count = sum(char.isdigit() for char in candidate)
        if _MIN_PHONE_DIGITS <= digit_count <= _MAX_PHONE_DIGITS:
            return candidate.strip()
    return None


def _extract_linkedin(text: str) -> Optional[str]:
    match = _LINKEDIN_PATTERN.search(text)
    return _clean_url(match.group(0)) if match else None


def _extract_github(text: str) -> Optional[str]:
    match = _GITHUB_PATTERN.search(text)
    return _clean_url(match.group(0)) if match else None


def _extract_portfolio(text: str) -> Optional[str]:
    """
    Any URL that is not LinkedIn, GitHub, or part of an email address
    is treated as a candidate portfolio link. Email addresses are
    stripped from the text first so their local-part / domain fragments
    (e.g. "jane.doe" in "jane.doe@example.com") are never mistaken for
    a URL.
    """
    text_without_emails = _EMAIL_PATTERN.sub(" ", text)

    for match in _GENERIC_URL_PATTERN.finditer(text_without_emails):
        url = match.group(0)
        lowered = url.lower()
        if "linkedin.com" in lowered or "github.com" in lowered:
            continue
        if "@" in url:
            continue
        return _clean_url(url)
    return None


def _clean_url(url: str) -> str:
    return url.strip().rstrip(".,;")


def _extract_skills(sections: dict[str, list[str]], raw_text: str) -> list[str]:
    lines = sections.get("skills")
    if lines:
        skills: list[str] = []
        for line in lines:
            # Split on common delimiters used to list skills.
            parts = re.split(r"[,|/•·;\u2022]", line)
            for part in parts:
                cleaned = part.strip(" -\t")
                if cleaned:
                    skills.append(cleaned)
        if skills:
            return skills

    # Fallback: scan the full text for known skill keywords.
    lowered_text = raw_text.lower()
    found = [
        keyword for keyword in _KNOWN_SKILL_KEYWORDS if keyword in lowered_text
    ]
    return found


def _extract_education(sections: dict[str, list[str]]) -> list[str]:
    return sections.get("education", []) or []


def _extract_experience(sections: dict[str, list[str]]) -> list[str]:
    return sections.get("experience", []) or []


def _extract_projects(sections: dict[str, list[str]]) -> list[str]:
    return sections.get("projects", []) or []


def _extract_certifications(sections: dict[str, list[str]]) -> list[str]:
    return sections.get("certifications", []) or []
