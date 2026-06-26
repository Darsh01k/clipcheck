"""Fact-checking engine for ClipCheck.

Pipeline:
1. Extract factual claims from transcript using OpenAI
2. Search the web for evidence on each claim
3. Evaluate each claim against evidence using OpenAI
4. Return structured results with verdicts and sources
"""

import os
import json
import asyncio
from typing import List, Dict, Any
from openai import OpenAI
from duckduckgo_search import DDGS

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


# ──────────────────────────────────────────────
# Step 1: Extract claims from transcript
# ──────────────────────────────────────────────

CLAIM_EXTRACTION_PROMPT = """You are an expert fact-checker. Analyze the following video transcript and extract ALL factual claims made. A factual claim is a statement that can be verified as true or false (e.g., statistics, dates, events, scientific claims, historical references).

Do NOT include:
- Opinions or subjective statements
- Rhetorical questions
- Generic filler statements
- Jokes or obvious hyperbole

For each claim, provide:
1. The exact claim text (as close to verbatim as possible)
2. The context (1-2 sentence surrounding context)
3. A category (e.g., "Statistics", "Historical", "Scientific", "Political", "Health", "Economic")

Return a JSON object with a "claims" array:
{
  "claims": [
    {
      "text": "The exact claim",
      "context": "Brief surrounding context",
      "category": "Category name"
    }
  ]
}

TRANSCRIPT:
"""


async def extract_claims(transcript: str, max_claims: int = 15) -> List[Dict[str, str]]:
    """Extract factual claims from a transcript using OpenAI."""
    if not transcript or len(transcript.strip()) < 20:
        return []

    try:
        # Truncate very long transcripts
        max_chars = 25000
        truncated = transcript[:max_chars] if len(transcript) > max_chars else transcript
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": CLAIM_EXTRACTION_PROMPT},
                    {"role": "user", "content": truncated}
                ],
                response_format={"type": "json_object"},
                temperature=0.3,
                max_tokens=4000,
            )
        )
        
        content = response.choices[0].message.content
        result = json.loads(content)
        claims = result.get("claims", [])
        
        # Limit to max_claims
        return claims[:max_claims]
    
    except Exception as e:
        print(f"Claim extraction error: {e}")
        return []


# ──────────────────────────────────────────────
# Step 2: Search web for evidence
# ──────────────────────────────────────────────

async def search_for_evidence(claim_text: str, max_results: int = 5) -> List[Dict[str, str]]:
    """Search the web for evidence related to a claim."""
    try:
        loop = asyncio.get_event_loop()
        
        def search():
            with DDGS() as ddgs:
                results = []
                for r in ddgs.text(claim_text, max_results=max_results):
                    results.append({
                        "title": r.get("title", ""),
                        "url": r.get("href", ""),
                        "snippet": r.get("body", "")
                    })
                return results
        
        results = await loop.run_in_executor(None, search)
        return results
    
    except Exception as e:
        print(f"Web search error for '{claim_text[:50]}...': {e}")
        return []


# ──────────────────────────────────────────────
# Step 3: Evaluate claim against evidence
# ──────────────────────────────────────────────

VERIFICATION_PROMPT = """You are an expert fact-checker. Your task is to evaluate a factual claim against provided web search evidence.

Claim: "{claim}"
Context: "{context}"
Category: {category}

Search Results:
{search_results}

Instructions:
1. Carefully analyze the claim against the search results
2. Determine if the claim is TRUE, FALSE, or MISLEADING
3. Provide a clear, detailed explanation
4. Cite specific sources from the search results

Verdict definitions:
- TRUE: The claim is supported by reliable evidence
- FALSE: The claim contradicts reliable evidence
- MISLEADING: The claim contains elements of truth but is presented in a misleading way, omits critical context, or mixes fact with fiction

Return a JSON object:
{{
  "verdict": "TRUE" or "FALSE" or "MISLEADING" or "UNVERIFIABLE",
  "confidence": "HIGH" or "MEDIUM" or "LOW",
  "explanation": "Detailed explanation of your reasoning",
  "sources": [
    {{
      "title": "Source title",
      "url": "Source URL",
      "relevance": "How this source supports or refutes the claim"
    }}
  ],
  "key_evidence": "A 1-2 sentence summary of the strongest evidence"
}}
"""


async def verify_claim(claim: Dict[str, str], search_results: List[Dict[str, str]]) -> Dict[str, Any]:
    """Verify a single claim against search evidence."""
    
    search_text = ""
    for i, result in enumerate(search_results, 1):
        search_text += f"\n[{i}] {result['title']}\n   URL: {result['url']}\n   {result['snippet']}\n"
    
    if not search_results:
        search_text = "No search results found for this claim."
    
    prompt = VERIFICATION_PROMPT.format(
        claim=claim.get("text", ""),
        context=claim.get("context", ""),
        category=claim.get("category", "General"),
        search_results=search_text
    )
    
    try:
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "You are an expert fact-checker. Always respond with valid JSON."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"},
                temperature=0.3,
                max_tokens=2000,
            )
        )
        
        content = response.choices[0].message.content
        result = json.loads(content)
        
        return {
            "claim": claim.get("text", ""),
            "context": claim.get("context", ""),
            "category": claim.get("category", "General"),
            "verdict": result.get("verdict", "UNVERIFIABLE"),
            "confidence": result.get("confidence", "LOW"),
            "explanation": result.get("explanation", ""),
            "sources": result.get("sources", []),
            "key_evidence": result.get("key_evidence", ""),
        }
    
    except Exception as e:
        print(f"Verification error for claim: {e}")
        return {
            "claim": claim.get("text", ""),
            "context": claim.get("context", ""),
            "category": claim.get("category", "General"),
            "verdict": "UNVERIFIABLE",
            "confidence": "LOW",
            "explanation": f"Error during verification: {str(e)}",
            "sources": [],
            "key_evidence": "",
        }


# ──────────────────────────────────────────────
# Step 4: Generate report summary
# ──────────────────────────────────────────────

def generate_summary(claims: List[Dict[str, Any]]) -> str:
    """Generate a brief summary of the fact-check report."""
    total = len(claims)
    true_count = sum(1 for c in claims if c.get("verdict") == "TRUE")
    false_count = sum(1 for c in claims if c.get("verdict") == "FALSE")
    misleading_count = sum(1 for c in claims if c.get("verdict") == "MISLEADING")
    unverifiable_count = sum(1 for c in claims if c.get("verdict") == "UNVERIFIABLE")
    
    if total == 0:
        return "No factual claims were identified in this video."
    
    true_pct = round(true_count / total * 100)
    false_pct = round(false_count / total * 100)
    
    summary = f"Analysis of {total} claim(s): "
    summary += f"**{true_count}** True ({true_pct}%), "
    summary += f"**{false_count}** False ({false_pct}%), "
    summary += f"**{misleading_count}** Misleading, "
    summary += f"**{unverifiable_count}** Unverifiable."
    
    return summary


# ──────────────────────────────────────────────
# Main pipeline
# ──────────────────────────────────────────────

async def full_fact_check(transcript: str) -> Dict[str, Any]:
    """Run the full fact-checking pipeline on a transcript.
    
    Returns:
        dict with keys: claims (list), summary (str)
    """
    # Step 1: Extract claims
    claims = await extract_claims(transcript)
    
    if not claims:
        return {
            "claims": [],
            "summary": "No factual claims were identified in this video."
        }
    
    # Step 2 & 3: For each claim, search + verify
    verified_claims = []
    
    for i, claim in enumerate(claims):
        print(f"  Fact-checking claim {i+1}/{len(claims)}: {claim.get('text', '')[:60]}...")
        
        # Search the web for evidence
        search_results = await search_for_evidence(claim.get("text", ""))
        
        # Verify the claim
        result = await verify_claim(claim, search_results)
        verified_claims.append(result)
        
        # Small delay between searches to be respectful
        if i < len(claims) - 1:
            await asyncio.sleep(0.5)
    
    # Step 4: Generate summary
    summary = generate_summary(verified_claims)
    
    return {
        "claims": verified_claims,
        "summary": summary,
    }
