// Voyage AI embeddings — Anthropic's recommended provider.
// voyage-3-lite: 512 dims, ~$0.02 per 1M tokens. Effectively free at POC scale.
//
// IMPORTANT: the vector dimension here (512) must match the column
// definition in supabase/schema.sql (vector(512)). If you switch models,
// update both places.

const VOYAGE_MODEL = "voyage-3-lite";
export const EMBEDDING_DIMS = 512;

export async function embed(
  input: string | string[],
  inputType: "document" | "query" = "document"
): Promise<number[][]> {
  const texts = Array.isArray(input) ? input : [input];

  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: texts,
      input_type: inputType,
      output_dimension: EMBEDDING_DIMS,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Voyage embedding failed (${res.status}): ${detail}`);
  }

  const data = await res.json();
  // Returns embeddings in the same order as the input array.
  return data.data
    .sort((a: any, b: any) => a.index - b.index)
    .map((d: any) => d.embedding as number[]);
}

// Convenience: embed a single string and return one vector.
export async function embedOne(
  text: string,
  inputType: "document" | "query" = "query"
): Promise<number[]> {
  const [vec] = await embed(text, inputType);
  return vec;
}
