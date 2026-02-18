import { generateText } from "ai";
import { google } from "@ai-sdk/google";

import { db } from "@/firebase/admin";
import { getRandomInterviewCover } from "@/lib/utils";

type GeneratePayload = {
  type?: string;
  role?: string;
  level?: string;
  techstack?: string | string[];
  amount?: number | string;
  userid?: string;
  userId?: string;
  questions?: string[] | string;
};

const normalizeTechstack = (techstack: GeneratePayload["techstack"]) => {
  if (Array.isArray(techstack)) {
    return techstack.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof techstack === "string") {
    return techstack
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const parseQuestions = (input: string | string[] | undefined) => {
  if (Array.isArray(input)) {
    return input.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof input !== "string") return [];

  const cleaned = input
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    const arrayLikeMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayLikeMatch) {
      try {
        const parsed = JSON.parse(arrayLikeMatch[0]);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item).trim()).filter(Boolean);
        }
      } catch {
        // continue to line-split fallback
      }
    }
  }

  return cleaned
    .split("\n")
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .filter(Boolean);
};

export async function POST(request: Request) {
  let payload: GeneratePayload;

  try {
    payload = (await request.json()) as GeneratePayload;
  } catch {
    return Response.json(
      { success: false, error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  const type = String(payload.type ?? "Technical").trim();
  const role = String(payload.role ?? "").trim();
  const level = String(payload.level ?? "").trim();
  const amount = Number(payload.amount ?? 5);
  const userId = String(payload.userId ?? payload.userid ?? "").trim();
  const techStackList = normalizeTechstack(payload.techstack);

  console.log("[vapi/generate] Incoming payload", {
    role,
    level,
    type,
    amount,
    userId,
    techstackCount: techStackList.length,
    hasQuestions: !!payload.questions,
  });

  try {
    if (!userId || !role || !level) {
      return Response.json(
        {
          success: false,
          error: "Missing required fields: userId, role, level",
        },
        { status: 400 }
      );
    }

    let questions = parseQuestions(payload.questions);

    if (!questions.length) {
      const { text } = await generateText({
        model: google("gemini-2.0-flash-001"),
        prompt: `Prepare questions for a job interview.
          The job role is ${role}.
          The job experience level is ${level}.
          The tech stack used in the job is: ${techStackList.join(", ")}.
          The focus between behavioural and technical questions should lean towards: ${type}.
          The amount of questions required is: ${amount}.
          Please return only the questions, without any additional text.
          The questions are going to be read by a voice assistant so do not use "/" or "*" or any other special characters which might break the voice assistant.
          Return the questions formatted like this:
          ["Question 1", "Question 2", "Question 3"]
          
          Thank you! <3
      `,
      });

      questions = parseQuestions(text);
    }

    if (!questions.length) {
      return Response.json(
        { success: false, error: "Failed to generate valid interview questions" },
        { status: 500 }
      );
    }

    const interview = {
      role: role,
      type: type,
      level: level,
      techstack: techStackList,
      questions,
      userId,
      finalized: true,
      coverImage: getRandomInterviewCover(),
      createdAt: new Date().toISOString(),
    };

    const interviewRef = await db.collection("interviews").add(interview);
    console.log("[vapi/generate] Interview saved", {
      interviewId: interviewRef.id,
      userId,
      role,
    });

    return Response.json(
      { success: true, interviewId: interviewRef.id },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Unknown server error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ success: true, data: "Thank you!" }, { status: 200 });
}
