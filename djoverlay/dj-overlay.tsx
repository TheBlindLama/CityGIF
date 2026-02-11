"use client"

import { useState, useCallback } from "react"
import { Radio, X } from "lucide-react"
import { LobbyView } from "./lobby-view"
import { RoomView } from "./room-view"
import { MOCK_ROOMS } from "@/lib/mock-rooms"
import type { Room, OverlayView } from "@/lib/types"

export function DJOverlay() {
  const [isOpen, setIsOpen] = useState(false)
  const [view, setView] = useState<OverlayView>("lobby")
  const [rooms, setRooms] = useState<Room[]>(MOCK_ROOMS)
  const [activeRoom, setActiveRoom] = useState<Room | null>(null)
  const [isDJ, setIsDJ] = useState(false)

  const handleJoinRoom = useCallback((room: Room) => {
    setActiveRoom(room)
    setIsDJ(false)
    setView("room")
  }, [])

  const handleCreateRoom = useCallback(
    (name: string) => {
      const newRoom: Room = {
        id: crypto.randomUUID(),
        name,
        dj: "You",
        listeners: 1,
        users: ["You"],
        nowPlaying: null,
        youtubeUrl: null,
      }
      setRooms((prev) => [newRoom, ...prev])
      setActiveRoom(newRoom)
      setIsDJ(true)
      setView("room")
    },
    [],
  )

  const handleLeaveRoom = useCallback(() => {
    setActiveRoom(null)
    setIsDJ(false)
    setView("lobby")
  }, [])

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label="Open DJ panel"
      >
        <Radio className="h-6 w-6" />
      </button>

      {/* Overlay backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm transition-opacity"
          onClick={() => setIsOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setIsOpen(false)
          }}
          role="button"
          tabIndex={-1}
          aria-label="Close overlay"
        />
      )}

      {/* Overlay panel */}
      <div
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-2xl transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="SyncDJ panel"
      >
        {/* Panel header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Radio className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">SyncDJ</h2>
              <p className="text-[11px] text-muted-foreground">Listen together</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Panel body */}
        <div className="flex-1 overflow-hidden px-5 py-4">
          {view === "lobby" ? (
            <LobbyView
              rooms={rooms}
              onJoinRoom={handleJoinRoom}
              onCreateRoom={handleCreateRoom}
            />
          ) : activeRoom ? (
            <RoomView
              room={activeRoom}
              isDJ={isDJ}
              onLeave={handleLeaveRoom}
            />
          ) : null}
        </div>
      </div>
    </>
  )
}
