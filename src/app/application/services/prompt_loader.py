"""Loads system prompts for agents from .github markdown files."""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[4]
_AGENTS_DIR = _REPO_ROOT / ".github" / "agents"
_SKILLS_DIR = _REPO_ROOT / ".github" / "skills"

_USE_CASE_MAP: dict[str, dict[str, tuple[str, ...]]] = {
    "generate": {"agents": ("api-test-orchestrator", "testcase-generator"), "skills": ("api-test-generation", "api-testing-standards")},
    "execute": {"agents": ("api-test-orchestrator", "test-executor"), "skills": ("api-test-execution",)},
    "analyse": {"agents": ("api-test-orchestrator", "test-response-analyst"), "skills": ("api-test-reporting", "api-batch-triage")},
    "full": {"agents": ("api-test-orchestrator", "testcase-generator", "test-executor", "test-response-analyst"),
             "skills": ("api-test-generation", "api-test-execution", "api-test-reporting", "api-batch-triage")},
}


def _strip_frontmatter(text: str) -> str:
    text = text.strip()
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            return text[end + 4:].lstrip()
    return text


@lru_cache(maxsize=128)
def _load_file(path: Path) -> str:
    return _strip_frontmatter(path.read_text(encoding="utf-8"))


def load_agent(agent_name: str) -> str:
    return _load_file(_AGENTS_DIR / f"{agent_name}.agent.md")


def load_skill(skill_name: str) -> str:
    return _load_file(_SKILLS_DIR / skill_name / "SKILL.md")


def _compose_prompt(*, agents: tuple[str, ...], skills: tuple[str, ...], append: str = "") -> str:
    parts: list[str] = []
    for agent_name in agents:
        parts.append(f"## Agent: {agent_name}\n\n{load_agent(agent_name)}")
    for skill in skills:
        skill_body = load_skill(skill)
        skill_body = re.sub(r"## Repo Context\b.*", "", skill_body, flags=re.DOTALL).rstrip()
        parts.append(f"## Skill: {skill}\n\n{skill_body}")
    if append:
        parts.append(append)
    return "\n\n---\n\n".join(parts)


@lru_cache(maxsize=64)
def _build_use_case_prompt_cached(use_case: str, append: str = "") -> str:
    uc = use_case.strip().lower()
    mapping = _USE_CASE_MAP[uc]
    return _compose_prompt(agents=mapping["agents"], skills=mapping["skills"], append=append)


def load_use_case_prompt(*, use_case: str, append: str = "") -> str:
    return _build_use_case_prompt_cached(use_case, append)


def load_agent_prompt(*, agent: str, skills: list[str] | None = None, append: str = "") -> str:
    return _compose_prompt(agents=(agent,), skills=tuple(skills or []), append=append)
