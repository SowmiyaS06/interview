"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { getVapi } from "@/lib/vapi.sdk";
import { interviewer } from "@/constants";
import { createFeedback } from "@/lib/actions/general.action";

enum CallStatus {
  INACTIVE = "INACTIVE",
  CONNECTING = "CONNECTING",
  ACTIVE = "ACTIVE",
  FINISHED = "FINISHED",
}

interface SavedMessage {
  role: "user" | "system" | "assistant";
  content: string;
}

interface GenerateInterviewPayload {
  role: string;
  level?: string;
  type?: string;
  techstack?: string | string[];
  amount?: number;
  questions?: string | string[];
}

const RESERVED_MESSAGE_ROLES = new Set(["user", "assistant", "system", "tool", "function"]);
const RESERVED_MESSAGE_TYPES = new Set([
  "transcript",
  "function-call",
  "function-call-result",
  "add-message",
  "status-update",
]);

const VAPI_DEBUG_ENABLED = process.env.NEXT_PUBLIC_VAPI_DEBUG === "true";

const debugLog = (label: string, payload?: unknown) => {
  if (!VAPI_DEBUG_ENABLED) return;
  if (payload === undefined) {
    console.log(`[VAPI_DEBUG] ${label}`);
    return;
  }
  console.log(`[VAPI_DEBUG] ${label}`, payload);
};

const readStringValue = (source: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }

  return "";
};

const readNumberValue = (source: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = source[key];
    if (value === undefined || value === null) continue;

    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue > 0) {
      return numberValue;
    }
  }

  return undefined;
};

const readTechstackValue = (source: Record<string, unknown>) => {
  const techstack =
    source.techstack ??
    source.techStack ??
    source.technologies ??
    source.skills ??
    source.stack ??
    source.tools;

  if (Array.isArray(techstack)) {
    const values = techstack.map((item) => String(item).trim()).filter(Boolean);
    return values.length ? values : undefined;
  }

  if (typeof techstack === "string") {
    const normalized = techstack.trim();
    return normalized || undefined;
  }

  return undefined;
};

const readQuestionsValue = (source: Record<string, unknown>) => {
  const questions =
    source.questions ??
    source.customQuestions ??
    source.questionList ??
    source.questionsList;

  const numberedQuestions = Object.entries(source)
    .filter(([key, value]) => /^question\d+$/i.test(key) && value !== undefined && value !== null)
    .map(([, value]) => String(value).trim())
    .filter(Boolean);

  if (numberedQuestions.length) {
    return numberedQuestions;
  }

  if (Array.isArray(questions)) {
    const values = questions.map((item) => String(item).trim()).filter(Boolean);
    return values.length ? values : undefined;
  }

  if (typeof questions === "string") {
    const normalized = questions.trim();
    return normalized || undefined;
  }

  return undefined;
};

const toGeneratePayload = (value: unknown): GenerateInterviewPayload | null => {
  if (!value || typeof value !== "object") return null;

  const source = value as Record<string, unknown>;

  const hasInterviewSpecificKeys =
    "jobRole" in source ||
    "position" in source ||
    "targetRole" in source ||
    "desiredRole" in source ||
    "interviewRole" in source ||
    "level" in source ||
    "experienceLevel" in source ||
    "seniority" in source ||
    "expertiseLevel" in source ||
    "techstack" in source ||
    "techStack" in source ||
    "technologies" in source ||
    "skills" in source ||
    "stack" in source ||
    "tools" in source ||
    "amount" in source ||
    "questionCount" in source ||
    "numberOfQuestions" in source ||
    "totalQuestions" in source ||
    "questions" in source ||
    "customQuestions" in source ||
    "questionList" in source ||
    "questionsList" in source;

  if (!hasInterviewSpecificKeys) {
    return null;
  }

  const roleValue = readStringValue(source, [
    "role",
    "jobRole",
    "position",
    "targetRole",
    "desiredRole",
    "interviewRole",
  ]);

  const levelValue = readStringValue(source, [
    "level",
    "experienceLevel",
    "seniority",
    "expertiseLevel",
  ]);

  const typeValue = readStringValue(source, ["type", "interviewType", "focus", "questionType"]);

  const techstack = readTechstackValue(source);
  const questions = readQuestionsValue(source);
  const amountValue =
    readNumberValue(source, [
      "amount",
      "questionCount",
      "numberOfQuestions",
      "totalQuestions",
    ]);

  const hasMeaningfulData =
    !!roleValue ||
    !!levelValue ||
    !!typeValue ||
    !!techstack ||
    !!questions ||
    !!amountValue;

  if (!hasMeaningfulData) {
    return null;
  }

  if (roleValue && RESERVED_MESSAGE_ROLES.has(roleValue.toLowerCase())) {
    return null;
  }

  if (typeValue && RESERVED_MESSAGE_TYPES.has(typeValue.toLowerCase())) {
    return null;
  }

  const role = roleValue || "General";
  const level = levelValue || undefined;
  const type = typeValue || undefined;
  const amount = amountValue;

  return {
    role,
    level,
    type,
    techstack,
    amount,
    questions,
  };
};

const extractPayloadFromUnknown = (
  value: unknown
): GenerateInterviewPayload | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        const parsed = JSON.parse(trimmed);
        const payload = extractPayloadFromUnknown(parsed);
        if (payload) return payload;
      } catch {
        // continue fallback path
      }
    }
  }

  const direct = toGeneratePayload(value);
  if (direct) return direct;

  if (value && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const payload = extractPayloadFromUnknown(nested);
      if (payload) return payload;
    }
  }

  return null;
};

const extractPayloadFromMessage = (message: unknown): GenerateInterviewPayload | null => {
  if (!message || typeof message !== "object") return null;

  const source = message as Record<string, unknown>;
  const functionCall =
    source.functionCall && typeof source.functionCall === "object"
      ? (source.functionCall as Record<string, unknown>)
      : undefined;

  const functionCallResult =
    source.functionCallResult && typeof source.functionCallResult === "object"
      ? (source.functionCallResult as Record<string, unknown>)
      : undefined;

  const candidates: unknown[] = [
    source,
    source.payload,
    source.data,
    source.content,
    source.message,
    functionCall,
    functionCall?.parameters,
    functionCall?.arguments,
    functionCall?.payload,
    functionCallResult,
    functionCallResult?.result,
    functionCallResult?.output,
    functionCallResult?.payload,
  ];

  for (const candidate of candidates) {
    const payload = extractPayloadFromUnknown(candidate);
    if (payload) return payload;
  }

  return null;
};

const isMeetingEndedEjection = (message?: string) => {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("meeting ended due to ejection") ||
    lower.includes("meeting has ended")
  );
};

const isGenerateClosingPhrase = (text?: string) => {
  if (!text) return false;

  const normalized = text.toLowerCase().trim();

  return [
    "thank you",
    "thanks",
    "thankyou",
    "bye",
    "goodbye",
    "see you",
    "that's all",
    "thats all",
    "done",
  ].some((phrase) => normalized.includes(phrase));
};

const extractErrorMessage = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (!value || typeof value !== "object") return "";

  const source = value as Record<string, unknown>;
  const candidates = [
    source.message,
    source.errorMsg,
    source.reason,
    source.details,
    source.error,
  ];

  for (const candidate of candidates) {
    const message = extractErrorMessage(candidate);
    if (message) return message;
  }

  try {
    const serialized = JSON.stringify(source);
    return serialized === "{}" ? "" : serialized;
  } catch {
    return "";
  }
};

const getErrorDetails = (error: unknown) => {
  if (error instanceof Error) {
    const maybeCode = (error as Error & { code?: string }).code;
    return {
      message: error.message,
      code: maybeCode ?? "N/A",
    };
  }

  if (typeof error === "object" && error !== null) {
    const maybeCode = "code" in error ? String((error as { code?: unknown }).code) : "N/A";
    const maybeMessage = extractErrorMessage(error) || JSON.stringify(error);

    return {
      message: maybeMessage,
      code: maybeCode,
    };
  }

  return {
    message: String(error),
    code: "N/A",
  };
};

const Agent = ({
  userName,
  userId,
  interviewId,
  feedbackId,
  type,
  questions,
}: AgentProps) => {
  const router = useRouter();
  const vapi = useMemo(() => getVapi(), []);
  const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.INACTIVE);
  const [messages, setMessages] = useState<SavedMessage[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isGeneratingInterview, setIsGeneratingInterview] = useState(false);
  const [generatedPayload, setGeneratedPayload] = useState<GenerateInterviewPayload | null>(null);
  const generatedPayloadRef = useRef<GenerateInterviewPayload | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const lastUserTranscriptAtRef = useRef<number | null>(null);
  const callStatusRef = useRef<CallStatus>(CallStatus.INACTIVE);
  const suppressFinishRef = useRef(false);
  const autoStopTriggeredRef = useRef(false);
  const endingGenerateCallRef = useRef(false);
  const lastEjectionToastAtRef = useRef(0);
  const hasUserSpokenRef = useRef(false);
  const lastMessage = messages[messages.length - 1]?.content;

  const hasCompleteInterviewPayload = useCallback((payload: GenerateInterviewPayload | null) => {
    if (!payload) return false;

    const role = payload.role?.trim().toLowerCase();
    if (!role || RESERVED_MESSAGE_ROLES.has(role)) return false;

    const level = payload.level?.trim();
    if (!level) return false;

    const hasTechstack =
      (Array.isArray(payload.techstack) && payload.techstack.length > 0) ||
      (typeof payload.techstack === "string" && payload.techstack.trim().length > 0);

    const hasAmount = typeof payload.amount === "number" && Number.isFinite(payload.amount) && payload.amount > 0;

    return hasTechstack && hasAmount;
  }, []);

  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);


  const resetCallState = () => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    setCallStatus(CallStatus.INACTIVE);
    setIsSpeaking(false);
  };

  const handleEjectionGracefully = useCallback((message?: string) => {
    if (!isMeetingEndedEjection(message)) return false;

    suppressFinishRef.current = true;

    const now = Date.now();
    if (now - lastEjectionToastAtRef.current > 1500) {
      lastEjectionToastAtRef.current = now;
      toast.error("Call ended by meeting host/workflow. Please start again.");
    }

    if (type === "generate") {
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((track) => track.stop());
        micStreamRef.current = null;
      }

      setIsSpeaking(false);
      setCallStatus(CallStatus.FINISHED);
      return true;
    }

    resetCallState();
    return true;
  }, [type]);

  const saveGeneratedInterview = useCallback(async () => {
    const payloadToSave = generatedPayloadRef.current ?? generatedPayload;

    if (!payloadToSave) {
      debugLog("No generated payload captured from workflow messages.");
      return null;
    }

    debugLog("Saving generated interview payload", {
      role: payloadToSave.role,
      level: payloadToSave.level,
      type: payloadToSave.type,
      amount: payloadToSave.amount,
      hasTechstack: !!payloadToSave.techstack,
      hasQuestions: !!payloadToSave.questions,
    });

    const response = await fetch("/api/vapi/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...payloadToSave,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Failed to save generated interview.");
    }

    const body = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      interviewId?: string;
    };
    debugLog("Generate API response", body);
    return body.success ? (body.interviewId ?? null) : null;
  }, [generatedPayload]);

  const runInterviewGeneration = useCallback(async () => {
    if (isGeneratingInterview) return;

    const payloadReady = generatedPayloadRef.current ?? generatedPayload;

    if (!hasCompleteInterviewPayload(payloadReady)) {
      toast.error("Interview details were not captured correctly. Please try the call again.");
      resetCallState();
      return;
    }

    setIsGeneratingInterview(true);

    try {
      generatedPayloadRef.current = payloadReady;
      setGeneratedPayload(payloadReady);

      const generatedInterviewId = await saveGeneratedInterview();
      if (generatedInterviewId) {
        toast.success("Interview generated and saved.");
        router.push(`/interview/${generatedInterviewId}`);
        router.refresh();
        return;
      }

      toast.error("Failed to generate interview.");
    } catch (error) {
      const details = getErrorDetails(error);
      console.log("Failed to persist generated interview:", details);
      toast.error(`Interview save failed: ${details.message}`);
    } finally {
      setIsGeneratingInterview(false);
      resetCallState();
    }
  }, [generatedPayload, hasCompleteInterviewPayload, isGeneratingInterview, router, saveGeneratedInterview]);

  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const message = extractErrorMessage(event.reason);

      if (handleEjectionGracefully(message)) {
        event.preventDefault();
      }
    };

    const onWindowError = (event: ErrorEvent) => {
      const message =
        event.message ||
        extractErrorMessage(event.error);

      if (handleEjectionGracefully(message)) {
        event.preventDefault();
      }
    };

    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("error", onWindowError, true);

    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("error", onWindowError, true);
    };
  }, [handleEjectionGracefully]);

  useEffect(() => {
    if (!vapi) return;

    const completeGenerationFlow = () => {
      if (
        type !== "generate" ||
        autoStopTriggeredRef.current ||
        callStatusRef.current !== CallStatus.ACTIVE
      ) {
        return;
      }

      if (!hasUserSpokenRef.current) {
        debugLog("Skipping auto-stop because user details are not captured from speech yet");
        return;
      }

      autoStopTriggeredRef.current = true;
      debugLog("Auto-stop trigger set after usable payload capture");
    };

    const endGenerateCallAndContinue = () => {
      if (
        type !== "generate" ||
        !autoStopTriggeredRef.current ||
        callStatusRef.current !== CallStatus.ACTIVE ||
        endingGenerateCallRef.current
      ) {
        return;
      }

      endingGenerateCallRef.current = true;
      suppressFinishRef.current = true;
      setCallStatus(CallStatus.FINISHED);
      debugLog("Ending generate call and continuing to save");

      try {
        vapi.stop();
      } catch {
        // no-op: FINISHED state already advances generation flow
      }
    };

    const onCallStart = () => {
      suppressFinishRef.current = false;
      autoStopTriggeredRef.current = false;
      endingGenerateCallRef.current = false;
      hasUserSpokenRef.current = false;
      generatedPayloadRef.current = null;
      setGeneratedPayload(null);
      setCallStatus(CallStatus.ACTIVE);
      debugLog("Call started", { type });
    };

    const onCallEnd = () => {
      if (suppressFinishRef.current) {
        suppressFinishRef.current = false;

        if (type === "generate" && autoStopTriggeredRef.current) {
          setCallStatus(CallStatus.FINISHED);
          return;
        }

        resetCallState();
        return;
      }

      if (callStatusRef.current === CallStatus.INACTIVE) {
        return;
      }
      setCallStatus(CallStatus.FINISHED);
      debugLog("Call ended", { type, finalStatus: callStatusRef.current });
    };

    const onMessage = (message: Message) => {
      debugLog("Incoming Vapi message", {
        type: (message as { type?: string }).type,
        role: (message as { role?: string }).role,
        transcriptType: (message as { transcriptType?: string }).transcriptType,
        keys: Object.keys(message as unknown as Record<string, unknown>),
      });

      if (message.type === "transcript") {
        if (message.role === "user") {
          lastUserTranscriptAtRef.current = Date.now();
          if (message.transcriptType === "final") {
            hasUserSpokenRef.current = true;
          }
        }

        if (message.transcriptType !== "final") {
          return;
        }

        const newMessage = { role: message.role, content: message.transcript };
        setMessages((prev) => [...prev, newMessage]);

        if (
          message.role === "user" &&
          type === "generate" &&
          autoStopTriggeredRef.current &&
          isGenerateClosingPhrase(message.transcript)
        ) {
          endGenerateCallAndContinue();
        }
      }

      const payload = extractPayloadFromMessage(message);
      if (payload) {
        debugLog("Captured interview payload from workflow message", payload);
        generatedPayloadRef.current = payload;
        setGeneratedPayload(payload);

        if (hasCompleteInterviewPayload(payload)) {
          debugLog("Payload marked usable for generation", {
            role: payload.role,
            level: payload.level,
            type: payload.type,
            amount: payload.amount,
          });
          completeGenerationFlow();
        } else {
          debugLog("Payload ignored as not usable", payload);
        }
      }
    };

    const onSpeechStart = () => {
      console.log("speech start");
      setIsSpeaking(true);
    };

    const onSpeechEnd = () => {
      console.log("speech end");
      setIsSpeaking(false);
    };

    const onError = (error: unknown) => {
      const details = getErrorDetails(error);
      console.log("Vapi error details:", {
        raw: error,
        ...details,
      });

      if (handleEjectionGracefully(details.message)) {
        return;
      }

      toast.error(`Vapi error (${details.code}): ${details.message}`);
      resetCallState();
    };

    vapi.on("call-start", onCallStart);
    vapi.on("call-end", onCallEnd);
    vapi.on("message", onMessage);
    vapi.on("speech-start", onSpeechStart);
    vapi.on("speech-end", onSpeechEnd);
    vapi.on("error", onError);

    return () => {
      vapi.off("call-start", onCallStart);
      vapi.off("call-end", onCallEnd);
      vapi.off("message", onMessage);
      vapi.off("speech-start", onSpeechStart);
      vapi.off("speech-end", onSpeechEnd);
      vapi.off("error", onError);
    };
  }, [handleEjectionGracefully, hasCompleteInterviewPayload, runInterviewGeneration, type, vapi]);

  useEffect(() => {
    if (callStatus !== CallStatus.ACTIVE) return;

    const startedAt = Date.now();
    const interval = setInterval(() => {
      const lastHeardAt = lastUserTranscriptAtRef.current;
      const idleMs = lastHeardAt ? Date.now() - lastHeardAt : Date.now() - startedAt;

      if (idleMs > 20000) {
        toast.error("We cannot hear you. Please check your microphone permissions and input device.");
        clearInterval(interval);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [callStatus]);

  useEffect(() => {
    const handleGenerateFeedback = async (messages: SavedMessage[]) => {
      console.log("handleGenerateFeedback");

      const { success, feedbackId: id } = await createFeedback({
        interviewId: interviewId!,
        transcript: messages,
        feedbackId,
      });

      if (success && id) {
        router.push(`/interview/${interviewId}/feedback`);
      } else {
        console.log("Error saving feedback");
        router.push("/");
      }
    };

    if (callStatus === CallStatus.FINISHED) {
      if (type === "generate") {
        runInterviewGeneration();
      } else {
        handleGenerateFeedback(messages);
      }
    }
  }, [
    messages,
    callStatus,
    feedbackId,
    interviewId,
    router,
    type,
    userId,
    generatedPayload,
    isGeneratingInterview,
    runInterviewGeneration,
  ]);

  const handleCall = async () => {
    if (isGeneratingInterview) {
      return;
    }

    if (callStatus === CallStatus.CONNECTING || callStatus === CallStatus.ACTIVE) {
      return;
    }

    setCallStatus(CallStatus.CONNECTING);

    const connectingTimeout = setTimeout(() => {
      if (callStatusRef.current === CallStatus.CONNECTING) {
        toast.error("Call connection timed out. Please try again.");
        try {
          if (vapi) vapi.stop();
        } catch {
          console.log("No active Vapi call to stop after timeout.");
        }
        resetCallState();
      }
    }, 15000);

    try {
      if (!vapi) {
        throw new Error("Missing NEXT_PUBLIC_VAPI_WEB_TOKEN in environment variables.");
      }

      const workflowId = process.env.NEXT_PUBLIC_VAPI_WORKFLOW_ID;

      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error("Your browser does not support microphone access.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      micStreamRef.current = stream;

      const [audioTrack] = stream.getAudioTracks();
      if (!audioTrack) {
        throw new Error("No microphone detected.");
      }

      if (!audioTrack.enabled) {
        toast.error("Microphone is disabled. Please enable it and try again.");
      }

      audioTrack.onmute = () => {
        toast.error("Microphone muted.");
      };
      audioTrack.onended = () => {
        toast.error("Microphone disconnected.");
      };

      if (type === "generate") {
        if (!workflowId) {
          throw new Error("Missing NEXT_PUBLIC_VAPI_WORKFLOW_ID in environment variables.");
        }

        debugLog("Starting generate workflow", {
          workflowId,
          hasUserName: !!userName,
          hasUserId: !!userId,
        });

        await vapi.start(undefined, undefined, undefined, workflowId, {
          variableValues: {
            username: userName,
            userid: userId,
            userId,
          },
        });
      } else {
        const formattedQuestions = questions?.length
          ? questions.map((question) => `- ${question}`).join("\n")
          : "- Introduce yourself.\n- Tell me about your technical experience.";

        await vapi.start(interviewer, {
          variableValues: {
            questions: formattedQuestions,
          },
        });
      }
    } catch (error) {
      const details = getErrorDetails(error);
      console.log("Failed to start call details:", {
        raw: error,
        ...details,
      });
      toast.error(`Start call failed (${details.code}): ${details.message}`);
      resetCallState();
    } finally {
      clearTimeout(connectingTimeout);
    }
  };

  const handleDisconnect = () => {
    if (!vapi) {
      resetCallState();
      return;
    }

    setCallStatus(CallStatus.CONNECTING);
    try {
      vapi.stop();
    } catch (error) {
      const details = getErrorDetails(error);
      if (!handleEjectionGracefully(details.message)) {
        toast.error(`Stop call failed (${details.code}): ${details.message}`);
        resetCallState();
      }
    }
  };

  return (
    <>
      <div className="call-view">
        {/* AI Interviewer Card */}
        <div className="card-interviewer">
          <div className="avatar">
            <Image
              src="/ai-avatar.png"
              alt="profile-image"
              width={65}
              height={54}
              className="object-cover"
            />
            {isSpeaking && <span className="animate-speak" />}
          </div>
          <h3>AI Interviewer</h3>
        </div>

        {/* User Profile Card */}
        <div className="card-border">
          <div className="card-content">
            <Image
              src="/user-avatar.png"
              alt="profile-image"
              width={539}
              height={539}
              className="rounded-full object-cover size-30"
            />
            <h3>{userName}</h3>
          </div>
        </div>
      </div>

      {lastMessage && (
        <div className="transcript-border">
          <div className="transcript">
            <p
              className={cn(
                "transition-opacity duration-500 opacity-0",
                "animate-fadeIn opacity-100"
              )}
            >
              {lastMessage}
            </p>
          </div>
        </div>
      )}

      <div className="w-full flex justify-center">
        {callStatus !== "ACTIVE" ? (
          <button
            className={cn("relative btn-call", isGeneratingInterview && "opacity-80")}
            onClick={() => handleCall()}
            disabled={isGeneratingInterview}
          >
            <span
              className={cn(
                "absolute animate-ping rounded-full opacity-75",
                callStatus !== "CONNECTING" && "hidden"
              )}
            />

            <span className="relative">
              {isGeneratingInterview
                ? "Generating..."
                : callStatus === "INACTIVE" || callStatus === "FINISHED"
                ? "Call"
                : ". . ."}
            </span>
          </button>
        ) : (
          <button className="btn-disconnect" onClick={() => handleDisconnect()}>
            End
          </button>
        )}
      </div>

      {isGeneratingInterview && (
        <p className="interview-text mt-3">Generating interview and redirecting...</p>
      )}
    </>
  );
};

export default Agent;
