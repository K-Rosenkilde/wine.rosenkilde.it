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

// ---- wine lists (smagning) --------------------------------------------------
// Reads a tasting's wine list (photo or PDF) into rows the user reviews before
// adding them to the event.

const LIST_ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["name", "producer", "vintage", "grapes", "country", "region", "appellation", "color", "normal_price", "offer_price"],
  properties: {
    name: { type: "string", description: "The wine's name / cuvée (without producer and vintage)." },
    producer: { type: "string", description: "Producer / house / domaine, if shown (or the house of the whole list)." },
    vintage: { type: ["integer", "null"], description: "Vintage year, null if not shown." },
    grapes: { type: "array", items: { type: "string" }, description: "Grape varieties if shown." },
    country: { type: "string", description: "Country in Danish, e.g. Frankrig." },
    region: { type: "string", description: "Region, e.g. Bourgogne." },
    appellation: { type: "string", description: "Appellation if shown." },
    color: { type: "string", enum: COLORS, description: "Wine style in Danish, if shown or obvious." },
    normal_price: { type: ["number", "null"], description: "Normal / list price per bottle (vejl. pris, normalpris)." },
    offer_price: { type: ["number", "null"], description: "Offer price per bottle for the tasting (tilbud, smagningspris, aftenens pris)." },
  },
};
const LIST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["currency", "wines"],
  properties: {
    currency: { type: "string", description: "Currency code of the prices, e.g. DKK." },
    wines: { type: "array", items: LIST_ITEM, description: "Every wine on the list, in the order listed." },
  },
};

const LIST_PROMPT = `Dette er vinlisten fra en vinsmagning (foto eller PDF).
Aflæs alle vine i den rækkefølge de står, med navn, producent/hus, årgang, druer, land, område og farve
hvis det fremgår. Har listen to priser, er den højeste normalprisen og den laveste tilbuds-/smagningsprisen;
er der kun én pris, så brug den som normalpris medmindre den tydeligt er en tilbudspris.
Priser er pr. flaske som tal uden valuta. Skriv kun det der står; efterlad ellers "" eller null.
Land og farve skrives på dansk.`;

/**
 * @param {string} apiKey
 * @param {ArrayBuffer} bytes  JPEG (client-resized) or PDF
 * @param {string} mediaType   "image/jpeg" | "application/pdf"
 */
export async function readWineList(apiKey, bytes, mediaType) {
  if (!apiKey) return { rows: null, error: "AI-aflæsning er ikke sat op (mangler ANTHROPIC_API_KEY)." };
  const source = { type: "base64", media_type: mediaType, data: toBase64(bytes) };
  const block = mediaType === "application/pdf" ? { type: "document", source } : { type: "image", source };
  const client = new Anthropic({ apiKey });
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: LIST_SCHEMA } },
      messages: [{ role: "user", content: [block, { type: "text", text: LIST_PROMPT }] }],
    });
    if (response.stop_reason === "refusal") return { rows: null, error: "Vinlisten kunne ikke aflæses." };
    if (response.stop_reason === "max_tokens") return { rows: null, error: "Vinlisten er for lang til at blive aflæst på én gang — prøv én side ad gangen." };
    const text = response.content.find((b) => b.type === "text");
    if (!text) return { rows: null, error: "Vinlisten kunne ikke aflæses." };
    const d = JSON.parse(text.text);
    const currency = String(d.currency || "DKK").toUpperCase().slice(0, 3) || "DKK";
    return {
      rows: (d.wines || []).map((w) => ({
        ...w,
        grapes: Array.isArray(w.grapes) ? w.grapes.join(", ") : String(w.grapes || ""),
        currency,
      })),
      error: null,
    };
  } catch (e) {
    console.error("readWineList failed", e);
    return { rows: null, error: "Aflæsning af vinlisten fejlede." };
  }
}
