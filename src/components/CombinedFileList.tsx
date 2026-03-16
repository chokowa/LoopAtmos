"use client";

import React from "react";
import { X, GripVertical, Plus, Music } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface AudioFileItem {
  id: string;
  file: File;
}

interface SortableItemProps {
  item: AudioFileItem;
  index: number;
  isActive: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

function SortableFileItem({ item, index, isActive, onSelect, onRemove }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`source-card ${
        isDragging ? "source-card-dragging" : isActive ? "source-card-active" : ""
      }`}
      onClick={() => onSelect(item.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(item.id);
        }
      }}
    >
      <div
        {...attributes}
        {...listeners}
        className="source-card-grip"
      >
        <GripVertical className="h-4 w-4" />
      </div>

      <div className="source-card-icon">
        <Music className="h-4 w-4" />
      </div>

      <div className="source-card-info">
        <p className="source-card-name" title={item.file.name}>
          {item.file.name}
        </p>
        <div className="source-card-meta">
          <span className="source-card-tag">Track {index + 1}</span>
          <span>{(item.file.size / 1024 / 1024).toFixed(2)} MB</span>
        </div>
      </div>

      <div className="source-card-actions">
        {isActive && <span className="source-card-badge">ACTIVE</span>}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(item.id);
          }}
          className="source-card-remove flex items-center justify-center"
          title="Remove"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

interface FileListProps {
  files: AudioFileItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onReorder: (newFiles: AudioFileItem[]) => void;
}

export default function CombinedFileList({
  files,
  activeId,
  onSelect,
  onRemove,
  onAdd,
  onReorder,
}: FileListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = files.findIndex((f) => f.id === active.id);
      const newIndex = files.findIndex((f) => f.id === over.id);
      onReorder(arrayMove(files, oldIndex, newIndex));
    }
  };

  return (
    <div className="source-stack">
      <div className="source-stack-header">
        <div>
          <p className="source-stack-title">Layer Stack</p>
          <p className="source-stack-subtitle">Drag to reorder. Click to preview.</p>
        </div>
        <span className="chip">{files.length} layers</span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={files.map((f) => f.id)} strategy={verticalListSortingStrategy}>
          <div className="source-list">
            {files.map((item, index) => (
              <SortableFileItem
                key={item.id}
                item={item}
                index={index}
                isActive={item.id === activeId}
                onSelect={onSelect}
                onRemove={onRemove}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <label className="source-add group relative overflow-hidden">
        <input
          type="file"
          className="absolute inset-0 opacity-0 cursor-pointer"
          accept="audio/*"
          onChange={onAdd}
          multiple
        />
        <Plus className="h-4 w-4" />
        Add layer
      </label>
    </div>
  );
}
