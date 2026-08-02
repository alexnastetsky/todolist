import type { ReactNode } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Thin wrapper over dnd-kit: a vertical list where each row gets a ⠿ handle.
// The 5px activation distance keeps taps/clicks working normally.
export function SortableList({
  ids,
  onReorder,
  children,
}: {
  ids: number[];
  onReorder: (ids: number[]) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => {
        if (over && active.id !== over.id) {
          const from = ids.indexOf(Number(active.id));
          const to = ids.indexOf(Number(over.id));
          if (from >= 0 && to >= 0) onReorder(arrayMove(ids, from, to));
        }
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export function SortableRow({ id, children }: { id: number; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center ${isDragging ? 'opacity-60 relative z-10' : ''}`}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none px-1 self-stretch flex items-center text-muted-foreground/50 hover:text-foreground"
      >
        ⠿
      </button>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
