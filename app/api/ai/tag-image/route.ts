import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

interface TagImageRequest {
  thumbnailBase64?: string; // base64 encoded image or data URL
  filename?: string;
  mimeType?: string;
  camera?: string;
  placeName?: string;
  takenAt?: string;
  width?: number;
  height?: number;
}

interface TagImageResponse {
  success: boolean;
  tags: string[];
  description: string;
  source: 'gemini' | 'heuristic';
}

function generateHeuristicTags(req: TagImageRequest): { tags: string[]; description: string } {
  const tags = new Set<string>();
  const filename = (req.filename || '').toLowerCase();

  // Category & filename heuristics
  if (filename.includes('screenshot') || filename.includes('screen_shot')) {
    tags.add('Screenshot');
    tags.add('Screen Capture');
  } else if (filename.includes('doc') || filename.includes('scan') || filename.includes('receipt') || filename.includes('pdf')) {
    tags.add('Document');
    tags.add('Text');
  } else if (req.mimeType?.startsWith('video/') || filename.match(/\.(mp4|mov|mkv|webm)$/i)) {
    tags.add('Video');
    tags.add('Motion');
  } else {
    tags.add('Photo');
  }

  // Camera & gear tags
  if (req.camera) {
    const cam = req.camera.trim();
    tags.add(cam);
    if (/sony/i.test(cam)) tags.add('Sony Alpha');
    if (/leica/i.test(cam)) tags.add('Leica');
    if (/canon/i.test(cam)) tags.add('Canon EOS');
    if (/nikon/i.test(cam)) tags.add('Nikon');
    if (/fujifilm|fuji/i.test(cam)) tags.add('Fujifilm');
    if (/apple|iphone/i.test(cam)) tags.add('iPhone');
    if (/pixel/i.test(cam)) tags.add('Google Pixel');
  }

  // Aspect ratio heuristics
  if (req.width && req.height) {
    const ratio = req.width / req.height;
    if (ratio > 1.6) tags.add('Landscape');
    else if (ratio < 0.75) tags.add('Portrait');
    else if (Math.abs(ratio - 1) < 0.1) tags.add('Square');
  }

  // Location tags
  if (req.placeName) {
    tags.add(req.placeName);
  }

  // Time of day heuristics
  if (req.takenAt) {
    try {
      const date = new Date(req.takenAt);
      const hour = date.getUTCHours();
      if (hour >= 5 && hour <= 7) tags.add('Sunrise');
      else if (hour >= 17 && hour <= 19) tags.add('Sunset');
      else if (hour >= 21 || hour <= 4) tags.add('Night');
    } catch {
      // Ignore invalid date
    }
  }

  // Common keywords extracted from filename tokens
  const cleanTokens = filename
    .replace(/\.[^/.]+$/, '')
    .split(/[\s_\-+]+/)
    .filter((tok) => tok.length >= 3 && !/^\d+$/.test(tok) && !/^(img|dsc|pxl|photo|video)$/i.test(tok));

  for (const token of cleanTokens.slice(0, 4)) {
    tags.add(token.charAt(0).toUpperCase() + token.slice(1));
  }

  const tagList = Array.from(tags).slice(0, 8);
  const desc = req.camera
    ? `Captured with ${req.camera}${req.placeName ? ` in ${req.placeName}` : ''}.`
    : `Lossless media item${req.placeName ? ` from ${req.placeName}` : ''}.`;

  return { tags: tagList, description: desc };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as TagImageRequest;
    const apiKey = process.env.GEMINI_API_KEY?.trim();

    // Fallback if no Gemini API key or placeholder key
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || !body.thumbnailBase64) {
      const fallback = generateHeuristicTags(body);
      return NextResponse.json<TagImageResponse>({
        success: true,
        tags: fallback.tags,
        description: fallback.description,
        source: 'heuristic',
      });
    }

    // Clean base64 data URL prefix if present
    let rawBase64 = body.thumbnailBase64;
    let imageMime = 'image/jpeg';
    if (rawBase64.startsWith('data:')) {
      const match = rawBase64.match(/^data:([^;]+);base64,(.*)$/);
      if (match) {
        imageMime = match[1] || 'image/jpeg';
        rawBase64 = match[2];
      }
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are an expert AI photo curator and archivist. Analyze this photo and its metadata.
Filename: "${body.filename || 'photo.jpg'}"
Camera: "${body.camera || 'Unknown'}"
Location: "${body.placeName || 'Unknown'}"

Respond ONLY with a valid JSON object in this exact schema (no markdown, no backticks):
{
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6"],
  "description": "One concise, vivid sentence describing what is in the photo."
}
Tags should include:
- Visual subjects/objects (e.g. "Mountain", "Beach", "Dog", "Architecture", "Food", "Car", "Portrait")
- Setting & environment (e.g. "Outdoor", "Indoor", "Urban", "Nature")
- Lighting / mood / style (e.g. "Golden Hour", "Moody", "Black & White", "Vibrant", "Minimalist")
- Provide 5 to 8 clean, capitalized tags.`;

      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: imageMime,
                  data: rawBase64,
                },
              },
              {
                text: prompt,
              },
            ],
          },
        ],
      });

      const responseText = result.text?.trim() || '';
      // Strip markdown code fences if Gemini returned them
      const cleanJson = responseText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      const parsed = JSON.parse(cleanJson);
      if (Array.isArray(parsed.tags) && parsed.tags.length > 0) {
        const sanitizedTags = parsed.tags
          .filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0)
          .map((t: string) => t.trim().replace(/^#/, ''))
          .slice(0, 10);

        return NextResponse.json<TagImageResponse>({
          success: true,
          tags: sanitizedTags,
          description: typeof parsed.description === 'string' ? parsed.description : '',
          source: 'gemini',
        });
      }
    } catch (aiErr) {
      console.warn('[Gemini Tagging] AI analysis failed, falling back to heuristic tags:', aiErr);
    }

    // Heuristic fallback if AI generation failed or output was invalid
    const fallback = generateHeuristicTags(body);
    return NextResponse.json<TagImageResponse>({
      success: true,
      tags: fallback.tags,
      description: fallback.description,
      source: 'heuristic',
    });
  } catch (err) {
    return NextResponse.json<TagImageResponse>(
      {
        success: false,
        tags: [],
        description: '',
        source: 'heuristic',
      },
      { status: 500 }
    );
  }
}
