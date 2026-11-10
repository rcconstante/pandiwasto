import { useState, type ReactNode } from "react";
import { DragDropProvider, useDraggable, useDroppable } from "@dnd-kit/react";
import { Howl } from "howler";
import { Star, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import clickUrl from "./styles/assets/sounds/click.mp3";

const clickSound = new Howl({ src: [clickUrl], volume: 0.5 });

function DragItem() {
  const { ref } = useDraggable({ id: "gem" });
  return (
    <div
      ref={ref}
      className="cursor-grab rounded-lg bg-yellow-300 px-4 py-2 text-black"
    >
      💎 Drag me
    </div>
  );
}

function DropZone({ children }: { children: ReactNode }) {
  const { ref } = useDroppable({ id: "chest" });
  return (
    <div
      ref={ref}
      className="flex h-32 w-64 items-center justify-center rounded-xl border-2 border-dashed"
    >
      {children}
    </div>
  );
}

export default function DesignTest() {
  const [dropped, setDropped] = useState(false);

  return (
    <div className="mt-8 space-y-6 border-t pt-6">
      <h2 className="font-display text-4xl">Design Tools Test</h2>
      <p className="font-sans">This line should be in Poppins.</p>

      <div className="flex items-center gap-3">
        <Button onClick={() => clickSound.play()}>
          <Volume2 /> Play sound
        </Button>
        <Star className="text-yellow-500" />
      </div>

      <DragDropProvider
        onDragEnd={(event) => {
          if (event.canceled) return;
          setDropped(event.operation.target?.id === "chest");
        }}
      >
        {!dropped && <DragItem />}
        <DropZone>{dropped ? <DragItem /> : "Drop here"}</DropZone>
      </DragDropProvider>
    </div>
  );
}