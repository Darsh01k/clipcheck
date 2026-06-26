"""ClipCheck — Video Fact-Checker API

FastAPI backend that accepts video URLs, processes them through
transcription, claim extraction, and fact-checking pipeline.
"""

import os
import uuid
import asyncio
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl
from sqlalchemy.orm import Session

from database import init_db, get_db, Report
from transcriber import get_transcript
from fact_checker import full_fact_check


# ──────────────────────────────────────────────
# App Setup
# ──────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize the application."""
    init_db()
    print("✅ Database initialized")
    print(f"🔑 OpenAI API Key set: {bool(os.getenv('OPENAI_API_KEY'))}")
    yield

app = FastAPI(
    title="ClipCheck API",
    description="Video Fact-Checker — Submit any video URL and get AI-powered fact-checking",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow all origins for public tool
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static frontend files
frontend_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(frontend_path):
    app.mount("/static", StaticFiles(directory=frontend_path), name="static")


# ──────────────────────────────────────────────
# Models
# ──────────────────────────────────────────────

class FactCheckRequest(BaseModel):
    url: str
    session_id: str | None = None


class FactCheckResponse(BaseModel):
    report_id: str
    status: str
    message: str


class ReportsListParams(BaseModel):
    session_id: str


# ──────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────

@app.get("/")
async def root():
    """Serve the frontend."""
    index_path = os.path.join(frontend_path, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "ClipCheck API is running. Frontend not found."}


@app.get("/report/{report_id}")
async def report_page(report_id: str):
    """Serve the frontend (client-side routing handles report view)."""
    index_path = os.path.join(frontend_path, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Report page not found"}


@app.get("/history")
async def history_page():
    """Serve the frontend history page."""
    index_path = os.path.join(frontend_path, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "History page not found"}


# ──────────────────────────────────────────────
# API Endpoints
# ──────────────────────────────────────────────

@app.post("/api/fact-check", response_model=FactCheckResponse)
async def create_fact_check(request: FactCheckRequest):
    """Submit a video URL for fact-checking."""
    url = request.url.strip()
    
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Invalid URL format")
    
    # Create report entry
    from database import SessionLocal
    db = SessionLocal()
    
    try:
        report = Report(
            id=str(uuid.uuid4()),
            video_url=url,
            status="processing",
            session_id=request.session_id or "anonymous",
            created_at=datetime.now(timezone.utc),
        )
        db.add(report)
        db.commit()
        report_id = report.id
        
        # Start background processing
        asyncio.create_task(process_fact_check(report_id, url))
        
        return FactCheckResponse(
            report_id=report_id,
            status="processing",
            message="Fact-check started. Check status via GET /api/report/{report_id}"
        )
    
    finally:
        db.close()


@app.get("/api/report/{report_id}")
async def get_report(report_id: str):
    """Get the status and results of a fact-check report."""
    from database import SessionLocal
    db = SessionLocal()
    
    try:
        report = db.query(Report).filter(Report.id == report_id).first()
        
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")
        
        return {
            "id": report.id,
            "video_url": report.video_url,
            "platform": report.platform,
            "title": report.title,
            "status": report.status,
            "summary": report.summary,
            "claims": report.claims or [],
            "error": report.error,
            "created_at": report.created_at.isoformat() if report.created_at else None,
            "completed_at": report.completed_at.isoformat() if report.completed_at else None,
        }
    
    finally:
        db.close()


@app.get("/api/reports")
async def list_reports(session_id: str = Query(...)):
    """List all fact-check reports for a session."""
    from database import SessionLocal
    db = SessionLocal()
    
    try:
        reports = (
            db.query(Report)
            .filter(Report.session_id == session_id)
            .order_by(Report.created_at.desc())
            .limit(50)
            .all()
        )
        
        return [
            {
                "id": r.id,
                "video_url": r.video_url,
                "platform": r.platform,
                "status": r.status,
                "summary": r.summary,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
            }
            for r in reports
        ]
    
    finally:
        db.close()


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


# ──────────────────────────────────────────────
# Background Processing
# ──────────────────────────────────────────────

async def process_fact_check(report_id: str, video_url: str):
    """Process a fact-check in the background."""
    from database import SessionLocal
    
    print(f"\n🔍 Processing fact-check {report_id} for: {video_url}")
    
    db = SessionLocal()
    try:
        # Step 1: Get transcript
        print("  📝 Step 1: Getting transcript...")
        transcript_result = await get_transcript(video_url)
        
        if not transcript_result["success"]:
            report = db.query(Report).filter(Report.id == report_id).first()
            report.status = "failed"
            report.error = transcript_result.get("error", "Failed to get transcript")
            report.completed_at = datetime.now(timezone.utc)
            db.commit()
            print(f"  ❌ Transcript failed: {report.error}")
            return
        
        transcript = transcript_result["transcript"]
        platform = transcript_result["platform"]
        
        # Update report with transcript
        report = db.query(Report).filter(Report.id == report_id).first()
        report.transcript = transcript
        report.platform = platform
        db.commit()
        
        print(f"  ✅ Transcript obtained ({len(transcript)} chars)")
        
        # Step 2: Fact-check
        print("  🔎 Step 2: Running fact-check pipeline...")
        fact_check_result = await full_fact_check(transcript)
        
        # Update report with results
        report = db.query(Report).filter(Report.id == report_id).first()
        report.claims = fact_check_result.get("claims", [])
        report.summary = fact_check_result.get("summary", "")
        report.status = "completed"
        report.completed_at = datetime.now(timezone.utc)
        db.commit()
        
        claim_count = len(fact_check_result.get("claims", []))
        print(f"  ✅ Fact-check complete! {claim_count} claims analyzed.")
    
    except Exception as e:
        print(f"  ❌ Processing error: {e}")
        import traceback
        traceback.print_exc()
        
        try:
            report = db.query(Report).filter(Report.id == report_id).first()
            if report:
                report.status = "failed"
                report.error = f"Processing error: {str(e)}"
                report.completed_at = datetime.now(timezone.utc)
                db.commit()
        except Exception:
            pass
    
    finally:
        db.close()


# ──────────────────────────────────────────────
# Entry Point
# ──────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
