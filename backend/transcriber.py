"""Video transcription service for ClipCheck.

Handles extracting transcripts from various video platforms:
- YouTube: uses youtube-transcript-api for captions
- Other platforms: uses yt-dlp + OpenAI Whisper API
"""

import os
import re
import json
import tempfile
import asyncio
from urllib.parse import urlparse, parse_qs
from typing import Optional

import httpx
from openai import OpenAI

# YouTube transcript API
try:
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api.formatters import TextFormatter
    YT_AVAILABLE = True
except ImportError:
    YT_AVAILABLE = False

# yt-dlp for non-YouTube platforms
try:
    import yt_dlp
    YT_DLP_AVAILABLE = True
except ImportError:
    YT_DLP_AVAILABLE = False

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def detect_platform(url: str) -> str:
    """Detect the video platform from the URL."""
    parsed = urlparse(url)
    domain = parsed.netloc.lower()

    if any(d in domain for d in ["youtube.com", "youtu.be", "m.youtube.com"]):
        return "youtube"
    elif any(d in domain for d in ["tiktok.com", "vm.tiktok.com"]):
        return "tiktok"
    elif any(d in domain for d in ["twitter.com", "x.com"]):
        return "twitter"
    elif any(d in domain for d in ["facebook.com", "fb.watch", "fb.com"]):
        return "facebook"
    elif any(d in domain for d in ["vimeo.com"]):
        return "vimeo"
    elif any(d in domain for d in ["instagram.com", "instagr.am"]):
        return "instagram"
    elif any(d in domain for d in ["dailymotion.com"]):
        return "dailymotion"
    else:
        return "unknown"


def extract_youtube_id(url: str) -> Optional[str]:
    """Extract YouTube video ID from various URL formats."""
    parsed = urlparse(url)
    
    # youtube.com/watch?v=VIDEO_ID
    if "youtube.com" in parsed.netloc:
        query_params = parse_qs(parsed.query)
        return query_params.get("v", [None])[0]
    
    # youtu.be/VIDEO_ID
    elif "youtu.be" in parsed.netloc:
        return parsed.path.lstrip("/").split("?")[0]
    
    # youtube.com/embed/VIDEO_ID
    elif "youtube.com" in parsed.netloc and "/embed/" in parsed.path:
        return parsed.path.split("/embed/")[1].split("?")[0]
    
    # youtube.com/shorts/VIDEO_ID
    elif "youtube.com" in parsed.netloc and "/shorts/" in parsed.path:
        return parsed.path.split("/shorts/")[1].split("?")[0]
    
    return None


async def get_youtube_transcript(video_id: str) -> Optional[str]:
    """Get transcript from YouTube using captions."""
    if not YT_AVAILABLE:
        return None
    
    try:
        # Try to get the transcript in the available language
        transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
        
        # Prefer English, then any language
        transcript = None
        try:
            transcript = transcript_list.find_transcript(["en", "en-US", "en-GB"])
        except Exception:
            # Try any translatable transcript
            try:
                transcript = transcript_list.find_transcript(["en"])
            except Exception:
                # Fall back to any available transcript
                try:
                    transcript = transcript_list.find_generated_transcript(["en"])
                except Exception:
                    # Get the first available transcript
                    for t in transcript_list:
                        transcript = t
                        break
        
        if transcript:
            # If it's not in English, try to translate
            try:
                if transcript.is_translatable:
                    transcript = transcript.translate("en")
            except Exception:
                pass
            
            fetched = transcript.fetch()
            text_parts = [item["text"] for item in fetched]
            return " ".join(text_parts)
        
        return None
    
    except Exception as e:
        print(f"YouTube transcript error: {e}")
        return None


async def transcribe_with_whisper(audio_url_or_path: str) -> Optional[str]:
    """Transcribe audio using OpenAI Whisper API."""
    try:
        with open(audio_url_or_path, "rb") as audio_file:
            response = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="text"
            )
        return response
    except Exception as e:
        print(f"Whisper transcription error: {e}")
        return None


async def download_audio(url: str) -> Optional[str]:
    """Download audio from a video URL using yt-dlp."""
    if not YT_DLP_AVAILABLE:
        return None
    
    temp_dir = tempfile.mkdtemp()
    output_template = os.path.join(temp_dir, "%(id)s.%(ext)s")
    
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": output_template,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
    }
    
    try:
        loop = asyncio.get_event_loop()
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = await loop.run_in_executor(None, lambda: ydl.extract_info(url, download=True))
            video_id = info.get("id", "audio")
            audio_path = os.path.join(temp_dir, f"{video_id}.mp3")
            
            if os.path.exists(audio_path):
                return audio_path
            
            # Try other extensions
            for ext in ["mp3", "m4a", "webm", "ogg"]:
                path = os.path.join(temp_dir, f"{video_id}.{ext}")
                if os.path.exists(path):
                    return path
        
        return None
    
    except Exception as e:
        print(f"Audio download error: {e}")
        return None


async def get_transcript(url: str) -> dict:
    """Get the transcript for a video URL.
    
    Returns:
        dict with keys: success, transcript, platform, title, error
    """
    platform = detect_platform(url)
    result = {
        "success": False,
        "transcript": None,
        "platform": platform,
        "title": None,
        "error": None,
    }
    
    try:
        if platform == "youtube":
            video_id = extract_youtube_id(url)
            if video_id:
                # First try YouTube captions
                transcript = await get_youtube_transcript(video_id)
                if transcript:
                    result["success"] = True
                    result["transcript"] = transcript
                    result["title"] = f"YouTube Video ({video_id})"
                    return result
                
                # Fall back to audio download + Whisper
                audio_path = await download_audio(url)
                if audio_path:
                    transcript = await transcribe_with_whisper(audio_path)
                    if transcript:
                        result["success"] = True
                        result["transcript"] = transcript
                        return result
        
        # For all other platforms, try yt-dlp + Whisper
        audio_path = await download_audio(url)
        if audio_path:
            transcript = await transcribe_with_whisper(audio_path)
            if transcript:
                result["success"] = True
                result["transcript"] = transcript
                result["title"] = f"Video from {platform}"
                return result
            else:
                result["error"] = "Failed to transcribe audio"
        else:
            result["error"] = f"Could not download audio from this {platform} video"
    
    except Exception as e:
        result["error"] = f"Transcription error: {str(e)}"
    
    return result
