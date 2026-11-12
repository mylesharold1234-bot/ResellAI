import {redactDescription} from './product-understanding';
import {
  identificationInstructions,
  identificationSchema,
  parseIdentification,
} from "./identification";
import {
  MAX_IMAGE_BYTES,
  validateImageBatch,
  validateImageBytes,
} from "./images";
class IdentificationError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
// Read a bounded multipart body before allocating image buffers or calling a paid API.
async function boundedForm(request: Request) {
  const limit = MAX_IMAGE_BYTES + 64 * 1024;
  if (Number(request.headers.get("content-length")) > limit)
    throw new IdentificationError("Keep all photos under 10 MB combined.", 413);
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
    throw new IdentificationError("Send photos using the upload form.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new IdentificationError("Choose a product photo.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new IdentificationError(
          "Keep all photos under 10 MB combined.",
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return await new Response(bytes, {
      headers: { "Content-Type": request.headers.get("content-type")! },
    }).formData();
  } catch {
    throw new IdentificationError(
      "The upload could not be read. Please choose your photos again.",
      400,
    );
  }
}
export function createIdentifyHandler({
  apiKey,
  model = "gpt-4.1-mini",
  fetcher = fetch,
}: {
  apiKey?: string;
  model?: string;
  fetcher?: typeof fetch;
}) {
  return async function identify(request: Request): Promise<Response> {
    try {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin)
        return json(
          { error: "Open ResellAI directly to analyze photos." },
          403,
        );
      const form = await boundedForm(request);
      const entries = form.getAll("images");
      if (entries.some((f) => !(f instanceof File)))
        throw new IdentificationError("Choose valid image files.", 400);
      const files = entries as File[];
      try {
        validateImageBatch(files);
      } catch (e) {
        throw new IdentificationError((e as Error).message, 400);
      }
      const notes = form.get("notes");
      if (notes !== null && (typeof notes !== "string" || notes.length > 1500))
        throw new IdentificationError(
          "Keep additional information under 1,500 characters.",
          400,
        );
      const images = await Promise.all(
        files.map(async (file) => {
          const bytes = new Uint8Array(await file.arrayBuffer());
          try {
            validateImageBytes(file.type, bytes);
          } catch (e) {
            throw new IdentificationError((e as Error).message, 400);
          }
          return {
            type: "input_image",
            image_url: `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}`,
            detail: "high",
          };
        }),
      );
      if (!apiKey?.trim())
        return json(
          {
            error:
              "AI identification is not configured. Add OPENAI_API_KEY to resellai/.env.local and restart the development server.",
          },
          503,
        );
      const response = await fetcher("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          model,
          store: false,
          instructions: identificationInstructions,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `Identify this product. User-provided observations (may be inaccurate): ${redactDescription(notes || "None")}`,
                },
                ...images,
              ],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "product_identification",
              strict: true,
              schema: identificationSchema,
            },
          },
          max_output_tokens: 2200,
        }),
      });
      if (!response.ok) {
        if (response.status === 429)
          throw new IdentificationError(
            "OpenAI is temporarily rate-limited or has no available API quota. Check API billing or try again later.",
            429,
          );
        if (response.status === 401 || response.status === 403)
          throw new IdentificationError(
            "The server could not access OpenAI. Check your API key and model access.",
            502,
          );
        if (response.status === 400 || response.status === 404)
          throw new IdentificationError(
            "OpenAI could not analyze this request. Try a clearer photo or check the server model setting.",
            502,
          );
        throw new IdentificationError(
          "The AI service is temporarily unavailable. Please try again.",
          502,
        );
      }
      const body = await response.json();
      if (body.status !== "completed" || !Array.isArray(body.output))
        throw new IdentificationError(
          "The AI could not complete identification. Try fewer or clearer photos.",
          502,
        );
      const content = body.output
        .filter((o: { type: string }) => o.type === "message")
        .flatMap((o: { content: unknown[] }) => o.content || []);
      if (content.some((c: { type: string }) => c.type === "refusal"))
        throw new IdentificationError(
          "The AI could not identify this image. Try a clear photo of the product only.",
          422,
        );
      const text = content
        .filter((c: { type: string }) => c.type === "output_text")
        .map((c: { text: string }) => c.text)
        .join("");
      try {
        const identification=parseIdentification(JSON.parse(text));
        if(!(notes || "").trim() && identification.understanding) identification.understanding.conflicts=[];
        return json({ identification });
      } catch {
        throw new IdentificationError(
          "The AI returned an unreadable identification. Please try again.",
          502,
        );
      }
    } catch (error) {
      if (error instanceof IdentificationError)
        return json({ error: error.message }, error.status);
      if (
        error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name)
      )
        return json(
          {
            error:
              "Identification took too long. Try again with a clearer or smaller photo.",
          },
          504,
        );
      return json(
        {
          error:
            "Could not reach the AI service. Check the connection and try again.",
        },
        502,
      );
    }
  };
}
