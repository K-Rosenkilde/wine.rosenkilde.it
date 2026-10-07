// Reads a wine label from a bottle photo with Claude (vision + structured output).
// Returns a draft the user can correct before saving, or null if the label
// couldn't be read (no API key, refusal, API error) — the app then falls back
// to manual entry.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5-5";

const COLORS = ["rød", "hvid", "rosé", "mousserende", "dessert", "orange", ""];

// Every field is required by the schema; unknown values come back as "" / null.
const LABEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "name", "producer", "vintage", "grapes", "country", "region",
    "appellation", "color", "alcohol", "label_text",
  ],
  properties: {
    name: { type: "string", description: "The wine's name / cuvée as printed (without producer and vintage)." },
    producer: { type: "string", description: "Producer, house, château or domaine." },
    vintage: { type: ["integer", "null"], description: "Vintage year, null if non-vintage or not visible." },
    grapes: { type: "array", items: { type: "string" }, description: "Grape varieties on the label, or the typical ones for the appellation if clearly implied." },
    country: { type: "string", description: "Country in Danish, e.g. Frankrig, Italien, Spanien." },
    region: { type: "string", description: "Region, e.g. Bourgogne, Piemonte, Rioja." },
    appellation: { type: "string", description: "Appellation / DOC(G) / AVA, if shown." },
    color: { type: "string", enum: COLORS, description: "Wine style in Danish." },
    alcohol: { type: ["number", "null"], description: "Alcohol % vol, null if not visible." },
    label_text: { type: "string", description: "The main text you can read on the label, line by line." },
  },
};

const PROMPT = `Dette er et foto af en vinflaske eller en vinetiket.
Aflæs etiketten og udfyld felterne. Skriv kun det du kan se eller med sikkerhed kan udlede
(f.eks. druer der er påkrævet for appellationen); efterlad ellers feltet tomt ("" eller null).
Land og farve skrives på dansk.`;

/**
 * @param {string} apiKey  ANTHROPIC_API_KEY (Worker secret)
 * @param {ArrayBuffer} jpeg  the (client-resized) photo
 */
export async function readLabel(apiKey, jpeg) {
  if (!apiKey) return { draft: null, error: "AI-aflæsning er ikke sat op (mangler ANTHROPIC_API_KEY)." };

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4096,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: LABEL_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: toBase64(jpeg) } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") return { draft: null, error: "Etiketten kunne ikke aflæses." };
    const text = response.content.find((b) => b.type === "text");
    if (!text) return { draft: null, error: "Etiketten kunne ikke aflæses." };
    const d = JSON.parse(text.text);
    return {
      draft: {
        ...d,
        grapes: Array.isArray(d.grapes) ? d.grapes.join(", ") : String(d.grapes || ""),
      },
      error: null,
    };
  } catch (e) {
    console.error("readLabel failed", e);
    return { draft: null, error: "AI-aflæsning fejlede — udfyld felterne selv." };
  }
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
