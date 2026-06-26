"""Database setup and models for ClipCheck."""

import os
import uuid
from datetime import datetime, timezone
from sqlalchemy import create_engine, Column, String, Text, DateTime, JSON, Integer
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./clipcheck.db")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def generate_uuid():
    return str(uuid.uuid4())


class Report(Base):
    __tablename__ = "reports"

    id = Column(String, primary_key=True, default=generate_uuid)
    video_url = Column(String(2048), nullable=False)
    platform = Column(String(50), nullable=True)
    title = Column(String(500), nullable=True)
    status = Column(String(20), default="processing")  # processing, completed, failed
    session_id = Column(String(100), nullable=True)
    transcript = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    claims = Column(JSON, nullable=True)  # List of claim objects
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    completed_at = Column(DateTime, nullable=True)


def init_db():
    """Initialize the database, creating tables if they don't exist."""
    Base.metadata.create_all(bind=engine)


def get_db():
    """Get a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
