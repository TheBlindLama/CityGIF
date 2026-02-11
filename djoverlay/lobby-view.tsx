"use client"

import { useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { RoomCard } from "./room-card"
import { CreateRoomForm } from "./create-room-form"
import type { Room } from "@/lib/types"

interface LobbyViewProps {
  rooms: Room[]
  onJoinRoom: (room: Room) => void
  onCreateRoom: (name: string) => void
}

export function LobbyView({ rooms, onJoinRoom, onCreateRoom }: LobbyViewProps) {
  const [showCreate, setShowCreate] = useState(false)

  return (
    <div className="flex h-full flex-col">
      {/* Tab toggle */}
      <div className="flex gap-1 rounded-lg bg-secondary p-1">
        <button
          type="button"
          onClick={() => setShowCreate(false)}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            !showCreate
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Browse Rooms
        </button>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            showCreate
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Create Room
        </button>
      </div>

      {showCreate ? (
        <div className="mt-4">
          <CreateRoomForm onCreateRoom={onCreateRoom} />
        </div>
      ) : (
        <>
          {/* Room count */}
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {rooms.length} room{rooms.length !== 1 ? "s" : ""} available
            </span>
          </div>

          {/* Room list */}
          <ScrollArea className="mt-2 flex-1">
            <div className="space-y-2 pb-2">
              {rooms.length > 0 ? (
                rooms.map((room) => (
                  <RoomCard key={room.id} room={room} onJoin={onJoinRoom} />
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <p className="text-sm text-muted-foreground">No rooms yet</p>
                  <button
                    type="button"
                    onClick={() => setShowCreate(true)}
                    className="mt-2 text-sm font-medium text-primary hover:underline"
                  >
                    Create one
                  </button>
                </div>
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  )
}
