"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface CreateRoomFormProps {
  onCreateRoom: (name: string) => void
}

export function CreateRoomForm({ onCreateRoom }: CreateRoomFormProps) {
  const [name, setName] = useState("")

  const canSubmit = name.trim().length > 0

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="room-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Room name
        </label>
        <Input
          id="room-name"
          placeholder="Give your room a name..."
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-10 bg-secondary/50 text-sm"
          maxLength={40}
        />
      </div>

      <Button
        className="w-full"
        disabled={!canSubmit}
        onClick={() => {
          if (canSubmit) {
            onCreateRoom(name.trim())
          }
        }}
      >
        <Plus className="h-4 w-4" />
        Create Room
      </Button>
    </div>
  )
}
