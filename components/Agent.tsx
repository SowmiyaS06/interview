"use client";

import Image from "next/image";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { vapi } from "@/lib/vapi.sdk";
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
  level: string;
  type: string;
  techstack: string | string[];
  amount?: number;
}

const Agent = ({
  userName,
  userId,
  interviewId,
  feedbackId,
  type,
  questions,
}: AgentProps) => {
  const router = useRouter();
  const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.INACTIVE);
  const [messages, setMessages] = useState<SavedMessage[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [generatedPayload, setGeneratedPayload] = useState<GenerateInterviewPayload | null>(null);
  const callStatusRef = useRef<CallStatus>(CallStatus.INACTIVE);
  const lastMessage = messages[messages.length - 1]?.content;

  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  const getReadableError = (error: unknown) => {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return "Unable to start the call. Please try again.";
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
      const maybeMessage =
        "message" in error
          ? String((error as { message?: unknown }).message)
          : JSON.stringify(error);

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

  const resetCallState = () => {
    setCallStatus(CallStatus.INACTIVE);
    setIsSpeaking(false);
  };

  const toGeneratePayload = (value: unknown): GenerateInterviewPayload | null => {
    if (!value || typeof value !== "object") return null;

    const source = value as Record<string, unknown>;
    const role = String(source.role ?? "").trim();
    const level = String(source.level ?? "").trim();
    const type = String(source.type ?? source.interviewType ?? "").trim();
    const techstack = source.techstack ?? source.techStack;

    if (!role || !level || !type || !techstack) return null;

    let normalizedTechstack: string | string[];
    if (Array.isArray(techstack)) {
      normalizedTechstack = techstack.map((item) => String(item).trim()).filter(Boolean);
    } else {
      normalizedTechstack = String(techstack).trim();
    }

    const amount = Number(source.amount ?? source.questionCount ?? 5);

    return {
      role,
      level,
      type,
      techstack: normalizedTechstack,
      amount: Number.isFinite(amount) && amount > 0 ? amount : 5,
    };
  };

  const extractPayloadFromUnknown = (value: unknown): GenerateInterviewPayload | null => {
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

  const saveGeneratedInterview = async () => {
    if (!generatedPayload || !userId) {
      console.log("No generated payload captured from workflow messages.");
      return false;
    }

    const response = await fetch("/api/vapi/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...generatedPayload,
        userId,
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
    return !!body.success;
  };

  const isMeetingEndedEjection = (message?: string) => {
    if (!message) return false;
    const lower = message.toLowerCase();
    return (
      lower.includes("meeting ended due to ejection") ||
      lower.includes("meeting has ended")
    );
  };

  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as { message?: string } | string | undefined;
      const message =
        typeof reason === "string"
          ? reason
          : reason && typeof reason === "object" && "message" in reason
            ? String(reason.message)
            : "";

      if (isMeetingEndedEjection(message)) {
        event.preventDefault();
        toast.error("Call ended by meeting host/workflow. Please start again.");
        resetCallState();
      }
    };

    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    const onCallStart = () => {
      setCallStatus(CallStatus.ACTIVE);
    };

    const onCallEnd = () => {
      if (callStatusRef.current === CallStatus.INACTIVE) {
        return;
      }
      setCallStatus(CallStatus.FINISHED);
    };

    const onMessage = (message: Message) => {
      if (message.type === "transcript" && message.transcriptType === "final") {
        const newMessage = { role: message.role, content: message.transcript };
        setMessages((prev) => [...prev, newMessage]);
      }

      if (message.type === "function-call") {
        const payload = extractPayloadFromUnknown(message.functionCall?.parameters);
        if (payload) {
          console.log("Captured interview payload from function-call", payload);
          setGeneratedPayload(payload);
        }
      }

      if (message.type === "function-call-result") {
        const payload = extractPayloadFromUnknown(message.functionCallResult?.result);
        if (payload) {
          console.log("Captured interview payload from function-call-result", payload);
          setGeneratedPayload(payload);
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

      if (isMeetingEndedEjection(details.message)) {
        toast.error("Call ended by meeting host/workflow. Please start again.");
        resetCallState();
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
  }, []);

  useEffect(() => {
    const handleGenerateFeedback = async (messages: SavedMessage[]) => {
      console.log("handleGenerateFeedback");

      const { success, feedbackId: id } = await createFeedback({
        interviewId: interviewId!,
        userId: userId!,
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
        (async () => {
          try {
            const saved = await saveGeneratedInterview();
            if (saved) {
              toast.success("Interview generated and saved.");
            }
          } catch (error) {
            const details = getErrorDetails(error);
            console.log("Failed to persist generated interview:", details);
            toast.error(`Interview save failed: ${details.message}`);
          } finally {
            router.push("/");
            router.refresh();
          }
        })();
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
  ]);

  const handleCall = async () => {
    if (callStatus === CallStatus.CONNECTING || callStatus === CallStatus.ACTIVE) {
      return;
    }

    setCallStatus(CallStatus.CONNECTING);

    const connectingTimeout = setTimeout(() => {
      if (callStatusRef.current === CallStatus.CONNECTING) {
        toast.error("Call connection timed out. Please try again.");
        try {
          vapi.stop();
        } catch {
          console.log("No active Vapi call to stop after timeout.");
        }
        resetCallState();
      }
    }, 15000);

    try {
      const workflowId = process.env.NEXT_PUBLIC_VAPI_WORKFLOW_ID;
      const webToken = process.env.NEXT_PUBLIC_VAPI_WEB_TOKEN;

      if (!webToken) {
        throw new Error("Missing NEXT_PUBLIC_VAPI_WEB_TOKEN in environment variables.");
      }

      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error("Your browser does not support microphone access.");
      }

      await navigator.mediaDevices.getUserMedia({ audio: true });

      if (type === "generate") {
        if (!workflowId) {
          throw new Error("Missing NEXT_PUBLIC_VAPI_WORKFLOW_ID in environment variables.");
        }

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
    setCallStatus(CallStatus.CONNECTING);
    vapi.stop();
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
          <button className="relative btn-call" onClick={() => handleCall()}>
            <span
              className={cn(
                "absolute animate-ping rounded-full opacity-75",
                callStatus !== "CONNECTING" && "hidden"
              )}
            />

            <span className="relative">
              {callStatus === "INACTIVE" || callStatus === "FINISHED"
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
    </>
  );
};

export default Agent;
