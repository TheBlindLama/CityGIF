"use client"

import { useState } from "react"
import {
  ArrowLeft,
  Disc3,
  Headphones,
  Link2,
  Play,
  ThumbsDown,
  ThumbsUp,
  Users,
  Volume2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Room } from "@/lib/types"

interface RoomViewProps {
  room: Room
  isDJ: boolean
  onLeave: () => void
}

export function RoomView({ room, isDJ, onLeave }: RoomViewProps) {
  const [youtubeUrl, setYoutubeUrl] = useState("")
  const [currentTrack, setCurrentTrack] = useState(room.nowPlaying)
  const [submitted, setSubmitted] = useState(false)
  const [reaction, setReaction] = useState<"like" | "dislike" | null>(null)
  const [likes, setLikes] = useState(7)
  const [dislikes, setDislikes] = useState(1)

  function handleSubmitUrl() {
    if (youtubeUrl.trim()) {
      setCurrentTrack(youtubeUrl.trim())
      setSubmitted(true)
      setReaction(null)
      setLikes(0)
      setDislikes(0)
    }
  }

  function handleLike() {
    if (reaction === "like") {
      setReaction(null)
      setLikes((p) => p - 1)
    } else {
      if (reaction === "dislike") setDislikes((p) => p - 1)
      setReaction("like")
      setLikes((p) => p + 1)
    }
  }

  function handleDislike() {
    if (reaction === "dislike") {
      setReaction(null)
      setDislikes((p) => p - 1)
    } else {
      if (reaction === "like") setLikes((p) => p - 1)
      setReaction("dislike")
      setDislikes((p) => p + 1)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Back button & room info */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onLeave}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label="Leave room"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {room.name}
          </h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {room.listeners} listening
            </span>
          </div>
        </div>
        {isDJ && (
          <span className="shrink-0 rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
            DJ
          </span>
        )}
      </div>

      {/* DJ Info */}
      <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-secondary/50 p-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Headphones className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Current DJ</p>
          <p className="truncate text-sm font-medium text-foreground">
            {isDJ ? "You" : room.dj}
          </p>
        </div>
      </div>

      {/* Now Playing */}
      <div className="mt-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Volume2 className="h-3.5 w-3.5" />
          Now Playing
        </div>
        {currentTrack ? (
          <div className="mt-2 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary">
              <Disc3 className="h-5 w-5 animate-spin text-primary" style={{ animationDuration: "3s" }} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {submitted ? "YouTube Track" : currentTrack}
              </p>
              {submitted && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground font-mono">
                  {currentTrack}
                </p>
              )}
            </div>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Play className="h-3.5 w-3.5" />
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {isDJ ? "Paste a YouTube link below to start playing." : "Waiting for the DJ to play something..."}
          </p>
        )}

        {/* Like / Dislike */}
        {currentTrack && (
          <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={handleLike}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                reaction === "like"
                  ? "bg-primary/15 text-primary"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
              aria-label="Like this track"
              aria-pressed={reaction === "like"}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              <span className="font-mono">{likes}</span>
            </button>
            <button
              type="button"
              onClick={handleDislike}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                reaction === "dislike"
                  ? "bg-destructive/15 text-destructive"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
              aria-label="Dislike this track"
              aria-pressed={reaction === "dislike"}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
              <span className="font-mono">{dislikes}</span>
            </button>
          </div>
        )}
      </div>

      {/* YouTube player placeholder area */}
      {currentTrack && (
        <div className="mt-3 flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-border bg-secondary/30">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Play className="h-8 w-8" />
            <span className="text-xs">YouTube player renders here</span>
          </div>
        </div>
      )}

      {/* User list */}
      <div className="mt-3 rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          In this room ({room.users.length})
        </div>
        <ScrollArea className="mt-2 max-h-28">
          <div className="flex flex-wrap gap-1.5">
            {room.users.map((user) => (
              <span
                key={user}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
                  user === room.dj
                    ? "bg-primary/10 text-primary"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                {user === room.dj && <Headphones className="h-3 w-3" />}
                {user}
              </span>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* DJ Controls */}
      {isDJ && (
        <div className="mt-auto pt-4">
          <label htmlFor="youtube-url" className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Link2 className="h-3.5 w-3.5" />
            YouTube URL
          </label>
          <div className="flex gap-2">
            <Input
              id="youtube-url"
              placeholder="https://youtube.com/watch?v=..."
              value={youtubeUrl}
              onChange={(e) => {
                setYoutubeUrl(e.target.value)
                setSubmitted(false)
              }}
              className="h-10 bg-secondary/50 text-sm font-mono"
            />
            <Button
              size="default"
              disabled={!youtubeUrl.trim()}
              onClick={handleSubmitUrl}
              className="shrink-0"
            >
              Play
            </Button>
          </div>
        </div>
      )}

      {/* Listener view: leave button */}
      {!isDJ && (
        <div className="mt-auto pt-4">
          <Button variant="outline" className="w-full bg-transparent" onClick={onLeave}>
            Leave Room
          </Button>
        </div>
      )}
    </div>
  )
}
