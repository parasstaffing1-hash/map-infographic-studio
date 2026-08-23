import { useRef } from 'react';
import { MapPin } from 'lucide-react';
import type { Annotation } from '../domain/infographic';

type Props = {
  annotations: Annotation[];
  editable: boolean;
  onChange: (annotations: Annotation[]) => void;
};

export function AnnotationLayer({ annotations, editable, onChange }: Props) {
  const dragRef = useRef<{ id: string; target: HTMLElement } | null>(null);
  const update = (id: string, x: number, y: number) => onChange(annotations.map((annotation) => annotation.id === id ? { ...annotation, x, y } : annotation));

  return <div className={`annotation-layer ${editable ? 'editable' : ''}`} aria-label="Map annotations">{annotations.map((annotation) => {
    const style = { left: `${annotation.x}%`, top: `${annotation.y}%`, color: annotation.color, fontSize: annotation.size };
    return <button
      key={annotation.id}
      className={`map-annotation ${annotation.type}`}
      style={style}
      disabled={!editable}
      onPointerDown={(event) => { if (!editable) return; dragRef.current = { id: annotation.id, target: event.currentTarget }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => { if (!dragRef.current || dragRef.current.id !== annotation.id) return; const parent = event.currentTarget.parentElement?.getBoundingClientRect(); if (!parent) return; update(annotation.id, Math.max(0, Math.min(100, ((event.clientX - parent.left) / parent.width) * 100)), Math.max(0, Math.min(100, ((event.clientY - parent.top) / parent.height) * 100))); }}
      onPointerUp={() => { dragRef.current = null; }}
    >{annotation.type === 'marker' ? <><MapPin size={annotation.size + 5} fill={annotation.color} /><span>{annotation.text}</span></> : annotation.type === 'arrow' ? <><span className="annotation-arrow">↗</span><span>{annotation.text}</span></> : annotation.text}</button>;
  })}</div>;
}
