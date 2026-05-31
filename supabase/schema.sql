-- ============================================================
-- Interview Coach — Supabase schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor).
-- ============================================================

-- Knowledge base table.
-- Stores chunks of CVs, previous summaries, and question frameworks.
-- The `embedding` column is NULLABLE: the live POC stores text only and
-- loads it whole (cached). Embeddings/vector search are for the later
-- "large knowledge base" track (sales templates with many brochures).
create table if not exists knowledge_docs (
  id          bigint generated always as identity primary key,
  content     text not null,
  doc_type    text not null default 'framework',  -- 'cv' | 'summary' | 'framework'
  candidate   text,                               -- nullable; scopes CVs/summaries
  source      text,                               -- original filename
  created_at  timestamptz not null default now()
);

create index if not exists knowledge_docs_candidate_idx
  on knowledge_docs (candidate);

-- ============================================================
-- OPTIONAL — vector search (for the future large-knowledge-base track).
-- Uncomment and run if/when you switch the live loop back to RAG.
-- ============================================================
-- create extension if not exists vector;
-- alter table knowledge_docs add column if not exists embedding vector(512);
-- create index if not exists knowledge_docs_embedding_idx
--   on knowledge_docs using ivfflat (embedding vector_cosine_ops) with (lists = 100);
--
-- create or replace function match_knowledge_docs(
--   query_embedding vector(512),
--   match_count int default 3,
--   candidate_filter text default null
-- )
-- returns table (id bigint, content text, doc_type text, source text, candidate text, similarity float)
-- language sql stable as $$
--   select kd.id, kd.content, kd.doc_type, kd.source, kd.candidate,
--          1 - (kd.embedding <=> query_embedding) as similarity
--   from knowledge_docs kd
--   where candidate_filter is null or kd.candidate = candidate_filter or kd.candidate is null
--   order by kd.embedding <=> query_embedding
--   limit match_count;
-- $$;
