import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const description: string = (body.description ?? "").trim();

    if (!description) {
      return NextResponse.json(
        { error: "description is required" },
        { status: 400 },
      );
    }

    const prompt = `You are a social media expert. Generate an engaging YouTube Shorts caption based on this video description: ${description}. Include relevant emojis, a hook in the first line, and 3-5 hashtags at the end. Keep it under 200 characters. Return only the caption, nothing else.`;

    const output = await replicate.run("meta/meta-llama-3-8b-instruct", {
      input: {
        prompt,
        max_tokens: 256,
        temperature: 0.8,
        top_p: 0.9,
      },
    });

    // Replicate streams output as an array of string tokens — join them
    const caption = Array.isArray(output)
      ? (output as string[]).join("").trim()
      : String(output).trim();

    if (!caption) {
      return NextResponse.json(
        { error: "Model returned an empty response. Please try again." },
        { status: 502 },
      );
    }

    return NextResponse.json({ caption });
  } catch (err: unknown) {
    console.error("[generate-caption]", err);

    const message =
      err instanceof Error ? err.message : "Unexpected error occurred.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
