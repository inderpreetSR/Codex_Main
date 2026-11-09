"""Offline LangChain document indexing and exact cosine retrieval."""

import os
from functools import lru_cache
from pathlib import Path

from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader
from pypdf.errors import PdfReadError
from transformers import AutoTokenizer

from app.contracts import JobError
from app.db import all_rows, engine, one, query
from app.guides import GUIDES
from app.retrieval_data import EMBEDDING_REVISION, VISIBLE

MODEL_PATH = os.getenv("EMBEDDING_PATH", "/models/minilm")
MAX_DOCUMENT_CHARS = 300_000
MAX_CHUNKS = 800


@lru_cache(maxsize=1)
def embedder():
    """Load the pinned offline model once per processing subprocess."""
    return HuggingFaceEmbeddings(
        model_name=MODEL_PATH,
        model_kwargs={"device": "cpu", "local_files_only": True},
        encode_kwargs={"normalize_embeddings": True},
        show_progress=False,
    )


@lru_cache(maxsize=1)
def splitter():
    """Split text below the embedding model's input limit."""
    # The Docker build pins the model snapshot. This loads only the packaged tokenizer.
    tokenizer = AutoTokenizer.from_pretrained(
        MODEL_PATH, revision=EMBEDDING_REVISION, local_files_only=True
    )
    return RecursiveCharacterTextSplitter.from_huggingface_tokenizer(
        tokenizer,
        chunk_size=220,
        chunk_overlap=40,
    )


def document_pages(path, name):
    """Extract bounded text and preserve page or heading information."""
    try:
        if Path(name).suffix.lower() == ".pdf":
            reader = PdfReader(path)
            if len(reader.pages) > 150:
                raise JobError("PDFs are limited to 150 pages.")
            total = 0
            for number, page in enumerate(reader.pages, start=1):
                text = (page.extract_text() or "").strip()
                total += len(text)
                if total > MAX_DOCUMENT_CHARS:
                    raise JobError("This document exceeds the extracted text limit.")
                if text:
                    yield text, f"Page {number}"
        else:
            raw = path.read_text(encoding="utf-8-sig")
            if len(raw) > MAX_DOCUMENT_CHARS:
                raise JobError("This document exceeds the extracted text limit.")
            section = "Text"
            lines = []
            for line in raw.splitlines():
                if line.startswith(("# ", "## ", "### ")):
                    if lines:
                        yield "\n".join(lines), section
                    section = line.lstrip("# ").strip()[:160] or "Text"
                    lines = []
                else:
                    lines.append(line)
            if lines:
                yield "\n".join(lines), section
    except (PdfReadError, UnicodeError) as error:
        raise JobError(
            "Upload a readable, unencrypted PDF or UTF-8 text document."
        ) from error


def index_source(connection, documents, upload_id=None):
    """Replace a source's vectors atomically."""
    chunks = [
        chunk
        for chunk in splitter().split_documents(documents)
        if chunk.page_content.strip()
    ]
    if not chunks:
        raise JobError(
            "No extractable text found. Upload a text version for scanned PDFs."
        )
    if len(chunks) > MAX_CHUNKS:
        raise JobError(
            "This document has too many text sections. Split it into smaller files."
        )
    if upload_id is None:
        query(connection, "DELETE FROM chunks WHERE upload_id IS NULL")
    else:
        query(connection, "DELETE FROM chunks WHERE upload_id = :id", id=upload_id)
    vectors = embedder().embed_documents([chunk.page_content for chunk in chunks])
    for chunk, vector in zip(chunks, vectors, strict=True):
        query(
            connection,
            """
            INSERT INTO chunks (upload_id, source, location, body, embedding, embedding_revision, source_chars)
            VALUES (:upload, :source, :location, :body, CAST(:embedding AS vector), :revision, :chars)
        """,
            upload=upload_id,
            source=chunk.metadata["source"],
            location=chunk.metadata["location"],
            body=chunk.page_content,
            embedding=str(vector),
            revision=EMBEDDING_REVISION,
            chars=chunk.metadata["source_chars"],
        )


def index_document(path, upload):
    """Index one private document after extraction."""
    sections = list(document_pages(path, upload["name"]))
    size = sum(len(text) for text, _ in sections)
    documents = [
        Document(
            page_content=text,
            metadata={
                "source": upload["name"],
                "location": location,
                "source_chars": size,
            },
        )
        for text, location in sections
    ]
    with engine.begin() as connection:
        if one(
            connection,
            "SELECT id FROM uploads WHERE id = :id FOR UPDATE",
            id=upload["id"],
        ):
            index_source(connection, documents, upload["id"])
    return {"indexed": True}


def ensure_guides(connection):
    """Build the shared guide index once per model revision."""
    if one(
        connection,
        """
        SELECT id FROM chunks WHERE upload_id IS NULL AND embedding_revision = :revision LIMIT 1
    """,
        revision=EMBEDDING_REVISION,
    ):
        return
    query(connection, "SELECT pg_advisory_xact_lock(9301884)")
    if not one(
        connection,
        """
        SELECT id FROM chunks WHERE upload_id IS NULL AND embedding_revision = :revision LIMIT 1
    """,
        revision=EMBEDDING_REVISION,
    ):
        index_source(
            connection,
            [
                Document(
                    page_content=text,
                    metadata={
                        "source": guide["title"],
                        "location": section,
                        "source_chars": len(text),
                    },
                )
                for guide in GUIDES
                for section, text in guide["sections"].items()
            ],
        )


def retrieve(job):
    """Embed the question and rank only the permitted project and guide corpus."""
    vector = str(embedder().embed_query(job["input"]["question"]))
    with engine.begin() as connection:
        ensure_guides(connection)
        ranked = all_rows(
            connection,
            """
            SELECT c.id, c.upload_id, c.embedding <=> CAST(:vector AS vector) AS distance
        """
            + VISIBLE
            + """
            AND c.embedding_revision = :revision AND c.embedding <=> CAST(:vector AS vector) <= 0.70
            ORDER BY distance, c.id LIMIT 6
        """,
            project=job["project_id"],
            vector=vector,
            revision=EMBEDDING_REVISION,
        )
        result = {"ids": [str(row["id"]) for row in ranked]}
        if job["input"]["mode"] == "answer":
            guides = all_rows(
                connection,
                """
                SELECT c.id FROM chunks c WHERE c.upload_id IS NULL AND c.embedding_revision = :revision
                AND c.embedding <=> CAST(:vector AS vector) <= 0.70
                ORDER BY c.embedding <=> CAST(:vector AS vector), c.id LIMIT 6
            """,
                vector=vector,
                revision=EMBEDDING_REVISION,
            )
            result.update(
                answer_pending=True, guides=[str(row["id"]) for row in guides]
            )
        return result
