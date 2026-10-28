"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Copy, Globe, Loader2, RefreshCw, Sparkles, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCopyText } from "@/lib/copy-text";
import { cn } from "@/lib/utils";

interface PostingKitData {
  titles: string[];
  tiktok_caption: string;
  hashtags: string[];
  kick_title: string;
  description: string;
  first_comment: string;
  posting_tips: string[];
  trending_angle: string;
  grounded: boolean;
  model: string;
}

const FALLBACK_ERROR = "Could not generate the posting kit. Try again in a moment.";

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const data = await response.json();
    const detail = (data as { detail?: unknown })?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (detail && typeof detail === "object" && "message" in (detail as Record<string, unknown>)) {
      const message = (detail as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
  } catch {
    // Non-JSON error body: keep the fallback.
  }
  return FALLBACK_ERROR;
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

function CopyField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  const copy = useCopyText();
  if (!value) return null;
  return (
    <div className="space-y-1">
      <FieldLabel>{label}</FieldLabel>
      <div className={cn("rounded-lg bg-muted/40 px-3 py-2", multiline ? "whitespace-pre-line" : "break-words")}>{value}</div>
      <button
        type="button"
        onClick={() => copy(value)}
        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        aria-label={`Copy ${label}`}
      >
        <Copy className="size-3" /> Copy
      </button>
    </div>
  );
}

export function PostingKit({ taskId, clipId }: { taskId: string; clipId: string }) {
  const copy = useCopyText();
  const [kit, setKit] = useState<PostingKitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/tasks/${taskId}/clips/${clipId}/posting-kit${refresh ? "?refresh=1" : ""}`,
          { method: "POST" },
        );
        if (!response.ok) {
          setError(await readErrorDetail(response));
          return;
        }
        const data = await response.json();
        const nextKit = (data as { posting_kit?: PostingKitData }).posting_kit;
        if (!nextKit) {
          setError(FALLBACK_ERROR);
          return;
        }
        setKit(nextKit);
      } catch {
        setError(FALLBACK_ERROR);
      } finally {
        setLoading(false);
      }
    },
    [taskId, clipId],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  if (loading && !kit) {
    return (
      <section className="rounded-xl border p-4">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Generating posting kit…
        </p>
      </section>
    );
  }

  if (!kit) {
    return (
      <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
        <p className="text-sm text-amber-900">{error ?? FALLBACK_ERROR}</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => load(true)}>
          <RefreshCw className="size-4" /> Try again
        </Button>
      </section>
    );
  }

  const hashtagsText = kit.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ");
  const fullKitText = [
    "YouTube Shorts titles:",
    ...kit.titles.map((title) => `- ${title}`),
    "",
    `Kick clip title: ${kit.kick_title}`,
    `TikTok caption: ${kit.tiktok_caption}`,
    `Hashtags: ${hashtagsText}`,
    "",
    "YouTube description:",
    kit.description,
    "",
    `Pinned first comment: ${kit.first_comment}`,
    "",
    "Posting tips:",
    ...kit.posting_tips.map((tip) => `- ${tip}`),
    "",
    `Trending angle: ${kit.trending_angle}`,
  ].join("\n");

  return (
    <section className="rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4" /> AI posting kit
          <span
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
              kit.grounded ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground",
            )}
          >
            {kit.grounded ? <Globe className="size-3" /> : <WifiOff className="size-3" />}
            {kit.grounded ? "Live trends" : "Offline mode"}
          </span>
        </p>
        <Button size="icon-sm" variant="ghost" onClick={() => load(true)} aria-label="Regenerate posting kit">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        </Button>
      </div>

      {error && kit && <p className="mt-2 text-xs text-amber-700">{error}</p>}

      <div className="mt-3 space-y-3 text-sm">
        {kit.titles.length > 0 && (
          <div className="space-y-1">
            <FieldLabel>YouTube Shorts titles</FieldLabel>
            {kit.titles.map((title, index) => (
              <div key={`title-${index}`} className="flex items-start justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
                <span className="min-w-0 break-words">{title}</span>
                <button
                  type="button"
                  onClick={() => copy(title)}
                  className="mt-0.5 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Copy title"
                >
                  <Copy className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <CopyField label="Kick clip title" value={kit.kick_title} />
          <CopyField label="TikTok caption" value={kit.tiktok_caption} />
          <CopyField label="Pinned first comment" value={kit.first_comment} />
        </div>

        <CopyField label="YouTube description" value={kit.description} multiline />

        {kit.hashtags.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <FieldLabel>Hashtags</FieldLabel>
              <button
                type="button"
                onClick={() => copy(hashtagsText)}
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Copy all hashtags"
              >
                <Copy className="size-3" /> Copy all
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {kit.hashtags.map((tag, index) => {
                const label = `#${tag.replace(/^#/, "")}`;
                return (
                  <button
                    key={`tag-${index}`}
                    type="button"
                    onClick={() => copy(label)}
                    className="rounded-full bg-muted px-2.5 py-0.5 text-xs transition-colors hover:bg-muted/70"
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {kit.posting_tips.length > 0 && (
          <div className="space-y-1">
            <FieldLabel>Posting tips</FieldLabel>
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              {kit.posting_tips.map((tip, index) => (
                <li key={`tip-${index}`}>{tip}</li>
              ))}
            </ul>
          </div>
        )}

        {kit.trending_angle && <p className="text-xs italic text-muted-foreground">{kit.trending_angle}</p>}

        <Button size="sm" variant="outline" onClick={() => copy(fullKitText)}>
          <Copy className="size-4" /> Copy full kit
        </Button>
      </div>
    </section>
  );
}
