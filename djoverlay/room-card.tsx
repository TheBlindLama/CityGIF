"use client"

import { Disc3, Headphones, Users } from "lucide-react"
import type { Room } from "@/lib/types"

interface RoomCardProps {
  room: Room
  onJoin: (room: Room) => void
}

export function RoomCard({ room, onJoin }: RoomCardProps) {
  return (
    <button
      type="button"
      onClick={() => onJoin(room)}
      className="group flex w-full items-center gap-4 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
        <Disc3 className="h-5 w-5" />
      </div>

      <div className="min-w-0 flex-1">
        <span className="truncate text-sm font-semibold text-foreground">
          {room.name}
        </span>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Headphones className="h-3 w-3" />
            {room.dj}
          </span>
          {room.nowPlaying && (
            <span className="truncate opacity-70">
              {room.nowPlaying}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        <span className="font-mono text-foreground">{room.listeners}</span>
      </div>
    </button>
  )
}
