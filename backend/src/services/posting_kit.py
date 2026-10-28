"""
Per-clip AI posting kit: titles, captions, hashtags and posting suggestions.

Uses the Gemini REST API directly so the Google Search grounding tool can be
attached without an extra dependency. When the grounding quota is unavailable
(new projects without billing), generation falls back to the plain model so
the feature keeps working; the response reports which mode was used.
"""

import json
import logging
import os
import re
from typing import Any, Dict, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_MODEL = "gemini-3.5-flash"
REQUEST_TIMEOUT_SECONDS = 90.0

_SYSTEM_PROMPT = """You are a short-form video strategist for YouTube Shorts, TikTok, Instagram Reels and Kick clips.
You are given the transcript excerpt of one clip cut from a longer video, plus metadata.
If Google Search is available, check what title/caption styles are performing for similar content right now and let that inform your output.

Return ONLY a valid JSON object (no markdown fences, no commentary) with exactly these keys:
{
  "titles": [3 strings — YouTube Shorts title candidates, hook-first, under 80 chars, honest not clickbait],
  "tiktok_caption": [string — TikTok caption under 120 chars, casual tone, at most 1-2 emoji],
  "hashtags": [5-8 short hashtag strings without the # symbol, mixing niche + broad tags],
  "kick_title": [string — punchy Kick clip title under 60 chars],
  "description": [string — YouTube Shorts description; first line restates the hook in one sentence, then blank line, then credit line 'Clip from {source_title}' and a question to drive comments],
  "first_comment": [string — a pinned-comment suggestion that invites replies, under 120 chars],
  "posting_tips": [2-4 short strings — concrete, clip-specific posting advice: best first frame, caption emphasis, what to A/B test],
  "trending_angle": [one sentence — why this clip could resonate with viewers right now]
}
"""

_USER_PROMPT_TEMPLATE = """Clip transcript:
{clip_text}

Metadata:
- Source: "{source_title}" ({source_platform})
- Clip length: {clip_duration:.0f} seconds
- Existing hook title burned into the video (keep titles consistent with it if present): {hook_title}

Generate the posting kit JSON now."""

_JSON_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)


def _extract_text(payload: Dict[str, Any]) -> str:
    candidates = payload.get("candidates") or []
    if not candidates:
        raise ValueError("AI response contained no candidates")
    parts = ((candidates[0].get("content") or {}).get("parts")) or []
    text = "".join(part.get("text", "") for part in parts).strip()
    if not text:
        raise ValueError("AI response contained no text")
    return text


def _coerce_json(text: str) -> Dict[str, Any]:
    """Parse the model output leniently: strip fences, then find the JSON object."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE).strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        match = _JSON_OBJECT_RE.search(cleaned)
        if not match:
            raise ValueError("AI response was not valid JSON")
        data = json.loads(match.group(0))
    if not isinstance(data, dict):
        raise ValueError("AI response was not a JSON object")
    return data


def _build_prompt(
    clip_text: str,
    source_title: str,
    source_platform: str,
    clip_duration: float,
    hook_title: str,
) -> str:
    transcript = (clip_text or "").strip()
    if not transcript:
        transcript = "(No transcript text available — infer from the hook title and source.)"
    elif len(transcript) > 6000:
        transcript = transcript[:6000] + "…"
    return (
        _SYSTEM_PROMPT.replace("{source_title}", source_title or "the source video")
        + "\n\n"
        + _USER_PROMPT_TEMPLATE.format(
            clip_text=transcript,
            source_title=source_title or "Unknown source",
            source_platform=source_platform or "video",
            clip_duration=clip_duration or 0,
            hook_title=hook_title or "(none)",
        )
    )


async def _call_gemini(
    api_key: str, model: str, prompt: str, grounded: bool
) -> Tuple[str, Dict[str, Any]]:
    payload: Dict[str, Any] = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.9, "maxOutputTokens": 8192},
    }
    if grounded:
        payload["tools"] = [{"google_search": {}}]
    url = f"{GEMINI_BASE_URL}/{model}:generateContent"
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        response = await client.post(
            url,
            params={"key": api_key},
            headers={"Content-Type": "application/json"},
            json=payload,
        )
        response.raise_for_status()
        return _extract_text(response.json()), response.json()


async def generate_posting_kit(
    *,
    clip_text: str,
    source_title: str,
    source_platform: str,
    clip_duration: float,
    hook_title: str,
) -> Dict[str, Any]:
    """Generate the per-clip posting kit, grounding when the quota allows it."""
    api_key = os.environ.get("GOOGLE_API_KEY", "").strip()
    if not api_key:
        raise ValueError("GOOGLE_API_KEY is not configured")
    model = os.environ.get("POSTING_KIT_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
    grounding_disabled = os.environ.get("POSTING_KIT_DISABLE_GROUNDING", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }
    prompt = _build_prompt(clip_text, source_title, source_platform, clip_duration, hook_title)

    grounded = False
    text = ""
    if not grounding_disabled:
        try:
            text, _ = await _call_gemini(api_key, model, prompt, grounded=True)
            grounded = True
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            logger.info(
                "Grounded posting-kit request failed with HTTP %s; falling back to plain generation",
                status,
            )
        except (httpx.RequestError, ValueError) as exc:
            logger.info("Grounded posting-kit request failed (%s); falling back", exc)
    if not text:
        text, _ = await _call_gemini(api_key, model, prompt, grounded=False)

    kit = _coerce_json(text)

    def _string_list(key: str) -> list:
        value = kit.get(key)
        if not isinstance(value, list):
            return []
        return [str(item).strip() for item in value if str(item).strip()]

    normalized: Dict[str, Any] = {
        "titles": _string_list("titles"),
        "tiktok_caption": str(kit.get("tiktok_caption") or "").strip(),
        "hashtags": _string_list("hashtags"),
        "kick_title": str(kit.get("kick_title") or "").strip(),
        "description": str(kit.get("description") or "").strip(),
        "first_comment": str(kit.get("first_comment") or "").strip(),
        "posting_tips": _string_list("posting_tips"),
        "trending_angle": str(kit.get("trending_angle") or "").strip(),
        "grounded": grounded,
        "model": model,
    }
    if not normalized["titles"] and hook_title:
        normalized["titles"] = [hook_title]
    return normalized
